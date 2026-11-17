/**
 * Jobs calendar style (WCT group, 2026-11-18): turn enableCalendarStyle on and
 * seed the people colours for the 4 WCT group orgs:
 *   WCT (S) …0001, WCT Racking …0002, YMM Kitchen …0003, BC Air …0004.
 *
 *  - Flag: features.enableCalendarStyle -> true (orgs where it is not on yet).
 *  - Salesperson fills (by login email): hh@ #039be5, amy@ #8e24aa,
 *    pc@ #e67c73, joyna@ #3f51b5.
 *  - PTW applicant bars (by name): Bala #d50000 (red, the default applicant),
 *    Joyna #f6bf26 (yellow), Kherry #0b8043 (green).
 * Colours go to UserOrganization.settings.calendar of each org the person is
 * an active member of. Fill only: a colour already set is kept and reported;
 * the default applicant is set only where the org has none.
 *
 * People: user ids come from the Activity Log (actorEmail / actorName of the
 * person's own past actions) and, when CLERK_LOOKUP_KEY is set (the Clerk
 * secret of that environment; dev uses CLERK_SECRET_KEY), from Clerk by email
 * or name. A name matching two people is reported as ambiguous and skipped;
 * nobody is guessed. Anyone not found is listed: set them in Settings > Job
 * fields > Calendar colours.
 *
 * No other org is read or written. Dry run by default; --apply writes, one
 * "System creation" Activity Log row per org changed + a local log file.
 *
 *   npx ts-node --transpile-only scripts/wct-calendar-style-seed.ts --env prod            # dry run
 *   npx ts-node --transpile-only scripts/wct-calendar-style-seed.ts --env prod --apply
 */
import 'dotenv/config';
import * as fs from 'fs';
import { Client } from 'pg';

const ALL_ORGS = ['5c700000-0000-4000-8000-5c7000000001', '5c700000-0000-4000-8000-5c7000000002', '5c700000-0000-4000-8000-5c7000000003', '5c700000-0000-4000-8000-5c7000000004'];

// --exclude <orgId>[,<orgId>]: leave these group orgs out (e.g. YMM).
const EXCLUDE = new Set((process.argv.includes('--exclude') ? process.argv[process.argv.indexOf('--exclude') + 1] : '').split(',').filter(Boolean));
const ORGS = ALL_ORGS.filter((id) => !EXCLUDE.has(id));
const FLAG = 'enableCalendarStyle';
const FILLS: Record<string, string> = { 'hh@wct.com.sg': '#039be5', 'amy@wct.com.sg': '#8e24aa', 'pc@wct.com.sg': '#e67c73', 'joyna@wct.com.sg': '#3f51b5' };
const BARS: Record<string, string> = { Bala: '#d50000', Joyna: '#f6bf26', Kherry: '#0b8043' };
const DEFAULT_APPLICANT = 'Bala';
const env = process.argv.includes('--env') ? process.argv[process.argv.indexOf('--env') + 1] : 'dev';
const apply = process.argv.includes('--apply');

type Found = { id: string; name: string | null; via: string } | { ambiguous: string[] } | null;

async function clerkUsers(key: string | undefined, query: Record<string, string>): Promise<any[] | null> {
  if (!key) return null;
  const res = await fetch(`https://api.clerk.com/v1/users?${new URLSearchParams({ ...query, limit: '20' })}`, { headers: { Authorization: `Bearer ${key}` } });
  if (!res.ok) throw new Error(`Clerk lookup failed (${res.status})`);
  return (await res.json()) as any[];
}
/** The DB id of a Clerk user: external_id (imported users) else the Clerk id. */
const dbIdOf = (u: any): string => u.external_id || u.id;
const nameOfClerk = (u: any): string => `${u.first_name || ''} ${u.last_name || ''}`.trim() || u.username || '';

(async () => {
  if (env !== 'dev' && env !== 'prod') throw new Error('--env dev|prod');
  const url = env === 'prod' ? process.env.PROD_DATABASE_URL : process.env.DATABASE_URL;
  if (!url) throw new Error('database url not set');
  const clerkKey = env === 'dev' ? process.env.CLERK_SECRET_KEY : process.env.CLERK_LOOKUP_KEY;
  // Prod: one "public" schema. Dev: platform tables in "platform".
  const P = env === 'prod' ? '"public"' : '"platform"';
  const c = new Client({ connectionString: url });
  await c.connect();
  const q = async (sql: string, p: any[] = []) => (await c.query(sql, p)).rows;
  console.log(`${env.toUpperCase()} ${apply ? '*** APPLY ***' : 'DRY RUN'}: calendar style for the WCT group (Clerk lookup ${clerkKey ? 'on' : 'off: Activity Log only'})`);

  const memberIds = new Set<string>((await q(`select distinct "userId" from ${P}."UserOrganization" where "organizationId"::text = any($1) and "isActive"`, [ORGS])).map((r) => r.userId));

  const byEmail = async (email: string): Promise<Found> => {
    const rows = await q(`select distinct "actorId", "actorName" from ${P}."ActionLog" where "actorType" = 'USER' and lower("actorEmail") = lower($1)`, [email]);
    const ids = [...new Set(rows.map((r) => r.actorId as string))].filter((id) => memberIds.has(id));
    if (ids.length === 1) return { id: ids[0], name: rows.find((r) => r.actorId === ids[0])?.actorName ?? null, via: 'Activity Log email' };
    if (ids.length > 1) return { ambiguous: ids };
    const cu = await clerkUsers(clerkKey, { email_address: email });
    const hits = (cu ?? []).filter((u) => memberIds.has(dbIdOf(u)));
    if (hits.length === 1) return { id: dbIdOf(hits[0]), name: nameOfClerk(hits[0]), via: 'Clerk email' };
    if (hits.length > 1) return { ambiguous: hits.map(dbIdOf) };
    return null;
  };
  const byName = async (name: string): Promise<Found> => {
    const rows = await q(
      `select distinct "actorId", "actorName" from ${P}."ActionLog" where "actorType" = 'USER' and ("actorName" ilike $1 or "actorName" ilike $2)`,
      [`${name}`, `${name} %`],
    );
    const fromLog = [...new Set(rows.map((r) => r.actorId as string))].filter((id) => memberIds.has(id));
    const cu = await clerkUsers(clerkKey, { query: name });
    const fromClerk = (cu ?? []).filter((u) => memberIds.has(dbIdOf(u)) && String(u.first_name || '').trim().toLowerCase() === name.toLowerCase()).map(dbIdOf);
    const ids = [...new Set([...fromLog, ...fromClerk])];
    if (ids.length === 1) return { id: ids[0], name: rows.find((r) => r.actorId === ids[0])?.actorName ?? name, via: fromLog.length ? 'Activity Log name' : 'Clerk name' };
    if (ids.length > 1) return { ambiguous: ids };
    return null;
  };

  // Who gets what: userId -> { fill?, bar?, ptwDefault? }
  const plan = new Map<string, { label: string; fill?: string; bar?: string; ptwDefault?: boolean }>();
  const missing: string[] = [];
  for (const [email, fill] of Object.entries(FILLS)) {
    const f = await byEmail(email);
    if (!f) missing.push(`${email} (salesperson fill ${fill}): not found`);
    else if ('ambiguous' in f) missing.push(`${email}: ambiguous (${f.ambiguous.join(', ')})`);
    else plan.set(f.id, { ...(plan.get(f.id) ?? { label: `${email} (${f.name ?? '?'}, via ${f.via})` }), fill });
  }
  for (const [name, bar] of Object.entries(BARS)) {
    const f = await byName(name);
    if (!f) missing.push(`${name} (PTW bar ${bar}${name === DEFAULT_APPLICANT ? ', default applicant' : ''}): not found`);
    else if ('ambiguous' in f) missing.push(`${name}: ambiguous, ${f.ambiguous.length} people (${f.ambiguous.join(', ')}), skipped`);
    else {
      const cur = plan.get(f.id) ?? { label: `${name} (${f.name ?? '?'}, via ${f.via})` };
      plan.set(f.id, { ...cur, bar, ...(name === DEFAULT_APPLICANT ? { ptwDefault: true } : {}) });
    }
  }

  const done: any[] = [];
  let todo = 0;
  for (const org of ORGS) {
    const o = (await q(`select name from ${P}."Organization" where id::text = $1`, [org]))[0];
    if (!o) {
      console.log(`  ${org}: org not found, skipped`);
      continue;
    }
    const ui = (await q(`select id, features from ${P}."OrganizationUIConfig" where "organizationId"::text = $1`, [org]))[0];
    const features = (ui?.features || {}) as Record<string, unknown>;
    const writes: any[] = [];
    console.log(`  ${o.name}:`);
    if (features[FLAG] === true) console.log(`    ${FLAG}: already on`);
    else if (!ui) console.log(`    ${FLAG}: no UI config row, skipped`);
    else {
      console.log(`    ${FLAG}: ${apply ? 'WRITE ' : ''}off -> on`);
      writes.push({ kind: 'flag' });
    }
    const members = await q(`select "userId", settings from ${P}."UserOrganization" where "organizationId"::text = $1 and "isActive"`, [org]);
    const hasDefault = members.some((m) => m.settings?.calendar?.ptwDefault === true);
    for (const m of members) {
      const p = plan.get(m.userId);
      if (!p) continue;
      const cal = { ...(m.settings?.calendar || {}) };
      const changes: string[] = [];
      if (p.fill) {
        if (cal.fill) changes.push(`fill kept ${cal.fill} (seed ${p.fill})`);
        else {
          cal.fill = p.fill;
          changes.push(`fill ${p.fill}`);
        }
      }
      if (p.bar) {
        if (cal.bar) changes.push(`bar kept ${cal.bar} (seed ${p.bar})`);
        else {
          cal.bar = p.bar;
          changes.push(`bar ${p.bar}`);
        }
      }
      if (p.ptwDefault) {
        if (hasDefault && cal.ptwDefault !== true) changes.push('default applicant kept (org has one)');
        else if (cal.ptwDefault !== true) {
          cal.ptwDefault = true;
          changes.push('default PTW applicant');
        }
      }
      const changed = JSON.stringify(cal) !== JSON.stringify(m.settings?.calendar || {});
      console.log(`    ${p.label}: ${changes.join(', ')}${changed ? '' : ' (nothing to write)'}`);
      if (changed) writes.push({ kind: 'person', userId: m.userId, calendar: { fill: cal.fill ?? null, bar: cal.bar ?? null, ptwDefault: cal.ptwDefault === true }, settings: m.settings });
    }
    todo += writes.length;
    if (!apply || !writes.length) continue;
    await c.query('begin');
    try {
      for (const w of writes) {
        if (w.kind === 'flag') {
          await c.query(`update ${P}."OrganizationUIConfig" set features = coalesce(features, '{}'::jsonb) || jsonb_build_object($2::text, true), "updatedAt" = now() where id = $1`, [ui.id, FLAG]);
        } else {
          const settings = { ...(w.settings && typeof w.settings === 'object' ? w.settings : {}), calendar: w.calendar };
          await c.query(`update ${P}."UserOrganization" set settings = $3::jsonb, "updatedAt" = now() where "organizationId"::text = $1 and "userId" = $2`, [org, w.userId, JSON.stringify(settings)]);
        }
      }
      await c.query(
        `insert into ${P}."ActionLog"(id, "actorType", "actorId", "actorName", "organizationId", channel, action, resource, "resourceId", details, status)
         values (gen_random_uuid(), 'SYSTEM', 'system:wct-calendar-style-seed', 'System creation', $1, 'operator', 'UPDATE', 'CalendarStyle', $1, $2, 'SUCCESS')`,
        [org, JSON.stringify({ writes: writes.map((w) => (w.kind === 'flag' ? { flag: FLAG, value: true } : { userId: w.userId, calendar: w.calendar })) })],
      );
      await c.query('commit');
    } catch (e) {
      await c.query('rollback');
      throw e;
    }
    done.push({ org, name: o.name, writes: writes.map((w) => (w.kind === 'flag' ? { flag: FLAG } : { userId: w.userId, calendar: w.calendar })) });
  }
  if (missing.length) {
    console.log('  Not seeded (set in Settings > Job fields > Calendar colours):');
    for (const m of missing) console.log(`    ${m}`);
  }
  if (!apply) console.log(`DRY RUN: ${todo} write(s), nothing written. Re-run with --apply.`);
  else {
    fs.writeFileSync(`${__dirname}/wct-calendar-style-seed.${env}.log.json`, JSON.stringify({ at: new Date().toISOString(), done, missing }, null, 2));
    console.log(`APPLIED: ${done.length} org(s) changed.`);
  }
  await c.end();
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
