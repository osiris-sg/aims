/**
 * PTW applicants list seed (WCT group, 2026-11-19): Settings > Job fields > PTW applicants for WCT (S),
 * Racking and BC Air (src/deliveries/ptw-applicants.ts). DRY RUN BY DEFAULT (read-only session).
 *
 *   Bala   red    #d50000  default, linked to submission@wct.com.sg
 *   Joyna  yellow #f6bf26  linked to joyna@wct.com.sg
 *   Kherry green  #0b8043  name only, no login
 *
 * Writes (only with --apply; prod also needs --confirm-prod): one storage-only CustomField row per org
 * (entityType 'Delivery', fieldName 'ptw_applicants', fieldType 'json', isActive false) + one ActionLog row.
 * An org that already has a list is skipped (never overwritten). Nothing else changes: jobs keep what they
 * store; the report lists the jobs whose applicant is not on the list (they show marked "(not in list)").
 *
 *   node scripts/wct-ptw-applicants-seed.js --env prod                          dry run
 *   node scripts/wct-ptw-applicants-seed.js --env prod --apply --confirm-prod   write
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { Client } = require('pg');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ORGS = {
  '5c700000-0000-4000-8000-5c7000000001': 'WCT (S)',
  '5c700000-0000-4000-8000-5c7000000002': 'Racking',
  '5c700000-0000-4000-8000-5c7000000004': 'BC Air',
};
const SEED = [
  { id: 'pta_bala', name: 'Bala', colour: '#d50000', email: 'submission@wct.com.sg', default: true },
  { id: 'pta_joyna', name: 'Joyna', colour: '#f6bf26', email: 'joyna@wct.com.sg' },
  { id: 'pta_kherry', name: 'Kherry', colour: '#0b8043', email: null },
];
const argv = process.argv.slice(2);
const one = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
const ENV = one('--env', 'dev');
const APPLY = argv.includes('--apply');
const SCHEMA = one('--search-path', null); // dev per-org tenancy, e.g. org_wct,platform
const JOB = 'system:wct-ptw-applicants-seed';

const hex = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const dist = (a, b) => Math.hypot(...hex(a).map((c, i) => c - hex(b)[i]));
const MIN_COLOUR_DISTANCE = 80; // src/dashboard/calendar-style.ts

(async () => {
  if (!['dev', 'prod'].includes(ENV)) throw new Error('--env dev|prod');
  if (APPLY && ENV === 'prod' && !argv.includes('--confirm-prod')) throw new Error('prod --apply needs --confirm-prod');
  const url = ENV === 'prod' ? process.env.PROD_DATABASE_URL : process.env.DATABASE_URL;
  if (!url) throw new Error('database url not set');
  const c = new Client({ connectionString: url });
  await c.connect();
  if (SCHEMA) await c.query(`SET search_path TO ${SCHEMA.split(',').map((x) => `"${x.replace(/"/g, '')}"`).join(', ')}`);
  if (!APPLY) await c.query('SET default_transaction_read_only = on');
  const q = async (sql, p = []) => (await c.query(sql, p)).rows;
  const at = new Date().toISOString();
  const log = { env: ENV, mode: APPLY ? 'APPLY' : 'DRY RUN', at, writes: [] };
  const say = (s = '') => console.log(s);

  say(`${ENV.toUpperCase()} PTW applicants seed ${log.mode} (${at})`);
  // Logins: prod keeps no user table (emails live in Clerk). A login's id is found from what AIMS recorded about
  // the group's members (same method as scripts/wct-calendar-style-seed.ts): Activity Log actor emails, the
  // legacy AuditLog, and successful user edits. Never guessed: no match or several = not linked (reported).
  const groupMembers = new Set((await q(`select distinct "userId" from "UserOrganization" where "organizationId"::text = any($1) and "isActive"`, [Object.keys(ORGS)])).map((r) => r.userId));
  const seen = new Map(); // email -> Set(userId)
  const note = (id, email) => {
    if (!id || !groupMembers.has(id) || typeof email !== 'string' || !email.includes('@')) return;
    const e = email.trim().toLowerCase();
    seen.set(e, new Set([...(seen.get(e) ?? []), id]));
  };
  for (const r of await q(`select "actorId", "actorEmail" from "ActionLog" where "actorType" = 'USER' and "actorEmail" is not null group by 1, 2`)) note(r.actorId, r.actorEmail);
  for (const r of await q(`select substring(path from '^/users/([A-Za-z0-9_]+)$') id, details #>> '{body,email}' email from "ActionLog" where method = 'PATCH' and path ~ '^/users/user_[A-Za-z0-9]+$' and "statusCode" = 200`)) note(r.id, r.email);
  for (const r of await q(`select "userId", "userEmail" from "AuditLog" group by 1, 2`).catch(() => [])) note(r.userId, r.userEmail);
  const userOf = new Map();
  for (const s of SEED) {
    if (!s.email) continue;
    const ids = [...(seen.get(s.email) ?? [])];
    if (ids.length === 1) userOf.set(s.email, ids[0]);
    say(`  ${s.name}: ${s.email} -> ${ids.length === 1 ? `login ${ids[0]}` : ids.length ? `AMBIGUOUS (${ids.join(', ')}): not linked` : 'no AIMS record of this login among the group members: not linked (link it in Settings > Job fields > PTW applicants)'}`);
  }

  if (APPLY) await c.query('BEGIN');
  try {
    for (const [org, name] of Object.entries(ORGS)) {
      say(`\n${name} (${org})`);
      const ui = (await q(`select features from "OrganizationUIConfig" where "organizationId" = $1`, [org]))[0];
      const on = ui?.features?.enableCalendarStyle === true;
      say(`  enableCalendarStyle: ${on ? 'on' : 'OFF'}`);
      const existing = (await q(`select id, options, "defaultValue" from "CustomField" where "organizationId" = $1 and "entityType" = 'Delivery' and "fieldName" = 'ptw_applicants'`, [org]))[0];
      if (existing) say(`  already has a PTW applicants list (${(existing.options || []).map((e) => e.name).join(', ')}): skipped`);
      const members = await q(`select "userId", settings from "UserOrganization" where "organizationId" = $1 and "isActive" = true`, [org]);
      const memberIds = new Set(members.map((m) => m.userId));
      const entries = SEED.map((s) => ({ id: s.id, name: s.name, colour: s.colour, userId: s.email ? userOf.get(s.email) ?? null : null, hidden: false }));
      for (const e of entries) {
        const s = SEED.find((x) => x.id === e.id);
        say(`  ${e.name.padEnd(7)} ${e.colour} ${s.default ? 'default ' : '        '}${s.email ? `login ${s.email}${e.userId ? (memberIds.has(e.userId) ? ' (member)' : ' (NOT a member of this company: linked anyway, old jobs that stored this login read as the entry)') : ' (no such user: name only)'}` : 'no login'}`);
      }
      // Bars vs salesperson fills (same rule as Settings).
      const fills = members.map((m) => m.settings?.calendar?.fill).filter((x) => typeof x === 'string' && /^#[0-9a-f]{6}$/i.test(x));
      const clash = entries.flatMap((e) => fills.filter((f) => dist(f.toLowerCase(), e.colour) < MIN_COLOUR_DISTANCE).map((f) => `${e.name} ${e.colour} vs fill ${f}`));
      say(`  colour check vs ${fills.length} salesperson colour(s): ${clash.length ? 'CLASH ' + clash.join('; ') : 'ok'}`);
      const oldDefault = members.filter((m) => m.settings?.calendar?.ptwDefault === true).map((m) => m.userId);
      const oldBars = members.filter((m) => m.settings?.calendar?.bar).length;
      say(`  before: default PTW applicant per person: ${oldDefault.length ? oldDefault.map((u) => (u === entries[0].userId ? 'Bala' : u === entries[1].userId ? 'Joyna' : `user ${u}`)).join(', ') : 'none'} · people with their own PTW colour: ${oldBars}`);
      // Jobs with a stored applicant (calendar style JSON).
      const field = (await q(`select id from "CustomField" where "organizationId" = $1 and "entityType" = 'Delivery' and "fieldName" = 'job_calendar_style'`, [org]))[0];
      const jobs = field
        ? await q(
            `select v."entityId" id, v.value->>'ptwApplicantId' a, v.value->>'ptwApplicantName' n, d."jobNumber" no, d.status, d."ptwStatus" ptw
               from "CustomFieldValue" v left join "Delivery" d on d.id::text = v."entityId"
              where v."customFieldId" = $1 and coalesce(v.value->>'ptwApplicantId', '') <> ''`,
            [field.id],
          ).catch(() => q(`select v."entityId" id, v.value->>'ptwApplicantId' a, v.value->>'ptwApplicantName' n from "CustomFieldValue" v where v."customFieldId" = $1 and coalesce(v.value->>'ptwApplicantId', '') <> ''`, [field.id]))
        : [];
      const resolves = (k) => entries.some((e) => e.id === k || (e.userId && e.userId === k));
      const outside = jobs.filter((j) => !resolves(j.a));
      say(`  jobs with a PTW applicant stored: ${jobs.length} · read as a list entry: ${jobs.length - outside.length} · NOT in the list (kept, shown marked): ${outside.length}`);
      if (outside.length) {
        const em = new Map([...seen].flatMap(([e, ids]) => [...ids].map((id) => [id, e])));
        for (const j of outside) say(`    job ${j.no ?? j.id} (${j.status ?? '?'}, PTW ${j.ptw ?? '?'}): applicant ${j.n || em.get(j.a) || j.a}`);
      }
      if (!on || existing) continue;
      if (APPLY) {
        const id = crypto.randomUUID();
        await c.query(
          `insert into "CustomField" (id, "organizationId", "entityType", "fieldName", "displayLabel", "fieldType", required, options, "defaultValue", "sortOrder", "isActive", "showInList", "showInForm", "updatedAt")
           values ($1, $2, 'Delivery', 'ptw_applicants', 'PTW applicants', 'json', false, $3::jsonb, 'pta_bala', 0, false, false, false, now())`,
          [id, org, JSON.stringify(entries)],
        );
        await c.query(
          `insert into "ActionLog"(id, "actorType", "actorId", "actorName", "organizationId", channel, action, resource, "resourceId", details, status)
           values (gen_random_uuid(), 'SYSTEM', $1, 'System creation', $2, 'operator', 'CREATE', 'job-fields', $3, $4, 'SUCCESS')`,
          [JOB, org, id, JSON.stringify({ note: 'PTW applicants list seeded: Bala (default), Joyna, Kherry' })],
        );
        log.writes.push({ op: 'INSERT CustomField ptw_applicants', org, name, id, entries, defaultId: 'pta_bala' });
        say(`  CREATED the list (${id})`);
      } else say('  would create the list');
    }
    if (APPLY) await c.query('COMMIT');
  } catch (e) {
    if (APPLY) await c.query('ROLLBACK');
    throw e;
  } finally {
    if (APPLY) {
      const f = path.join(__dirname, `wct-ptw-applicants-seed.${ENV}.log.json`);
      fs.writeFileSync(f, JSON.stringify(log, null, 1));
      say(`\nlog: ${f}`);
    }
    await c.end();
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
