/**
 * WCT group (2026-11-18, Elroy): map the imported quotations' free-text salesperson ("Henry", "Henry & Joyna",
 * "Hnery") to AIMS users. DRY RUN by default: prints each distinct name per org with its quotation count and the
 * proposed user(s) (email), or "no match" / "ambiguous". Orgs: WCT (S) and BC Air (Racking and YMM have no
 * quotations). No other org is read.
 *
 * Who a user is comes from AIMS only (no Clerk): UserOrganization (userId, salesmanCode) plus the names and
 * emails AIMS itself recorded in the Activity Log (the Users screen's create / update bodies for that user id or
 * salesman code, else the user's own latest actor name / email).
 *
 * Rules: names are split on & / , + "and"; "(Follow Up)" style notes are dropped; a name matches a user when it is
 * the user's full name, first name or email name (henry@ -> "henry"), case-insensitive. Known typos: "Hnery",
 * "Heny" -> Henry Hoo. "HH" is AMBIGUOUS (Nat HH hh@wct.com.sg or Henry Hoo henry@wct.com.sg): both are listed,
 * nothing is mapped.
 *
 * --apply (NOT run; needs Elroy's go): stores ONE per-org map, no Document is touched (imported quotations are
 * finalised and their free text stays as it is): a CustomField row (entityType 'Quotation', fieldName
 * 'salesperson_aliases', options [{ text, userIds }]) like the quotation category list. Fill-empty only: a
 * name already in the map is never overwritten. Writes an ActionLog row (system:wct-salesperson-aliases) and a
 * log json. The Sales report and the jobs calendar would read the map (resolve: salesman code / user id first,
 * then the map, then the name rules).
 *
 *   npx ts-node --transpile-only scripts/wct-salesperson-aliases.ts --env prod             # dry run
 *   npx ts-node --transpile-only scripts/wct-salesperson-aliases.ts --env prod --apply     # writes the map
 */
import 'dotenv/config';
import * as fs from 'fs';
import { Client, types } from 'pg';

types.setTypeParser(1114, (s: string) => s);

const ORGS = ['5c700000-0000-4000-8000-5c7000000001', '5c700000-0000-4000-8000-5c7000000004'];
const SCRIPT = 'wct-salesperson-aliases';
const FIELD = 'salesperson_aliases';
const TYPOS: Record<string, string> = { hnery: 'henry', heny: 'henry' };
const AMBIGUOUS: Record<string, string[]> = { hh: ['hh@wct.com.sg', 'henry@wct.com.sg'] };
const env = process.argv.includes('--env') ? process.argv[process.argv.indexOf('--env') + 1] : 'dev';
const apply = process.argv.includes('--apply');

interface Person {
  userId: string;
  code: string;
  name: string;
  email: string;
  member: boolean;
}

const norm = (s: string) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
export const tokensOf = (text: string): string[] =>
  String(text || '')
    .replace(/\([^)]*\)/g, ' ')
    .split(/\s*(?:&|\/|,|\+|\band\b)\s*/i)
    .map(norm)
    .filter(Boolean);

function matchToken(token: string, people: Person[]): { users: Person[]; ambiguous?: Person[] } {
  if (AMBIGUOUS[token]) return { users: [], ambiguous: people.filter((p) => AMBIGUOUS[token].includes(p.email)) };
  const t = TYPOS[token] ?? token;
  const users = people.filter((p) => {
    const full = norm(p.name);
    const first = full.split(' ')[0];
    const local = p.email.split('@')[0];
    return !!full && (t === full || t === first || t === local || (t.split(' ')[0] === first && full.startsWith(t)));
  });
  return { users };
}

(async () => {
  if (env !== 'dev' && env !== 'prod') throw new Error('--env dev|prod');
  const url = env === 'prod' ? process.env.PROD_DATABASE_URL : process.env.DATABASE_URL;
  if (!url) throw new Error('database url not set');
  if (env !== 'prod') throw new Error('documents are per-org on dev; run with --env prod (read-only unless --apply)');
  const c = new Client({ connectionString: url });
  await c.connect();
  const q = async (sql: string, p: any[] = []) => (await c.query(sql, p)).rows;

  // Everyone AIMS knows in the group (members of any of the orgs, names from the Activity Log).
  const members = await q(`select "organizationId" org, "userId", "salesmanCode" from "UserOrganization" where "organizationId" = any($1) and "isActive"`, [ORGS]);
  const ids = [...new Set(members.map((m: any) => m.userId))];
  const bodies = await q(
    `select path, details->'body'->>'email' email, details->'body'->>'firstName' fn, details->'body'->>'lastName' ln, details->'body'->>'salesmanCode' code, "createdAt"
       from "ActionLog" where path like '/users%' and details->'body'->>'email' is not null and coalesce(details->>'error','') = '' order by "createdAt"`,
  );
  const actors = await q(
    `select distinct on ("actorId") "actorId", "actorName", "actorEmail" from "ActionLog" where "actorId" = any($1) and ("actorName" is not null or "actorEmail" is not null) order by "actorId", "createdAt" desc`,
    [ids],
  );
  const codeOf = (u: string) => members.find((m: any) => m.userId === u && m.salesmanCode)?.salesmanCode || '';
  const ident = (u: string) => {
    const code = codeOf(u);
    let name = '';
    let email = '';
    for (const b of bodies) if (b.path === `/users/${u}` || (code && b.code === code && b.path === '/users')) {
      name = `${b.fn || ''} ${b.ln || ''}`.trim() || name;
      email = (b.email || email).toLowerCase();
    }
    const a = actors.find((x: any) => x.actorId === u);
    return { name: name || a?.actorName || '', email: email || (a?.actorEmail || '').toLowerCase(), code };
  };

  const out: any[] = [];
  for (const org of ORGS) {
    const oname = (await q(`select name from "Organization" where id = $1`, [org]))[0]?.name;
    const memberIds = new Set(members.filter((m: any) => m.org === org).map((m: any) => m.userId));
    const people: Person[] = ids.map((u) => ({ userId: u, ...ident(u), member: memberIds.has(u) })).filter((p) => p.name || p.email);
    const names = await q(
      `select coalesce(nullif(config->>'salesPerson',''), config->'documentInfo'->>'salesPerson') sp, count(*)::int n
         from "Document" where "organizationId" = $1 and type in ('QUOTATION','QO','QO1','QO2','QT') and config ? 'erpImport'
          and coalesce(nullif(config->>'salesPerson',''), config->'documentInfo'->>'salesPerson') is not null
        group by 1 order by 2 desc, 1`,
      [org],
    );
    const existing = (await q(`select options from "CustomField" where "organizationId" = $1 and "entityType" = 'Quotation' and "fieldName" = $2`, [org, FIELD]))[0]?.options || [];
    const have = new Set((Array.isArray(existing) ? existing : []).map((o: any) => norm(o.text)));
    console.log(`\n${oname} (${org}): ${names.length} distinct names on ${names.reduce((s: number, r: any) => s + r.n, 0)} imported quotations`);
    console.log('  NAME | QUOTATIONS | PROPOSED USER(S)');
    for (const r of names) {
      const toks = tokensOf(r.sp);
      const per = toks.map((t) => ({ t, ...matchToken(t, people) }));
      const users = [...new Map(per.flatMap((p) => p.users).map((u) => [u.userId, u])).values()];
      const amb = per.flatMap((p) => p.ambiguous || []);
      const missing = per.filter((p) => !p.users.length && !p.ambiguous).map((p) => p.t);
      const show = (u: Person) => `${u.name || '?'} <${u.email || 'no email'}>${u.member ? '' : ' (not a member of this org)'}`;
      const proposal = amb.length
        ? `AMBIGUOUS, not mapped: ${amb.map(show).join(' OR ')}`
        : users.length
        ? `${users.map(show).join(' + ')}${missing.length ? `; no match for "${missing.join('", "')}"` : ''}`
        : 'no match';
      const already = have.has(norm(r.sp));
      console.log(`  ${r.sp} | ${r.n} | ${proposal}${already ? ' (already in the map, left as it is)' : ''}`);
      out.push({ org, name: r.sp, quotations: r.n, userIds: amb.length ? [] : users.map((u) => u.userId), emails: users.map((u) => u.email), ambiguous: amb.map((u) => u.email), noMatch: missing, already });
    }
  }

  const toWrite = out.filter((o) => o.userIds.length && !o.already);
  fs.writeFileSync(`${__dirname}/${SCRIPT}.${env}.${apply ? 'apply' : 'dryrun'}.json`, JSON.stringify({ at: new Date().toISOString(), apply, rows: out }, null, 2));
  if (!apply) {
    console.log(`\nDRY RUN: ${toWrite.length} name(s) would be mapped, nothing written. Re-run with --apply after Elroy's go.`);
    await c.end();
    return;
  }
  await c.query('begin');
  try {
    for (const org of ORGS) {
      const rows = toWrite.filter((o) => o.org === org);
      if (!rows.length) continue;
      const cur = (await q(`select id, options from "CustomField" where "organizationId" = $1 and "entityType" = 'Quotation' and "fieldName" = $2`, [org, FIELD]))[0];
      const merged = [...(Array.isArray(cur?.options) ? cur.options : []), ...rows.map((o) => ({ text: o.name, userIds: o.userIds }))];
      if (cur) await c.query(`update "CustomField" set options = $2::jsonb, "updatedAt" = now() where id = $1`, [cur.id, JSON.stringify(merged)]);
      else
        await c.query(
          `insert into "CustomField"(id, "organizationId", "entityType", "fieldName", "displayLabel", "fieldType", required, options, "isActive", "showInForm", "showInList", "createdAt", "updatedAt")
           values (gen_random_uuid()::text, $1, 'Quotation', $2, 'Salesperson aliases', 'json', false, $3::jsonb, true, false, false, now(), now())`,
          [org, FIELD, JSON.stringify(merged)],
        );
      await c.query(
        `insert into "ActionLog"(id, "actorType", "actorId", "actorName", "organizationId", channel, action, resource, "resourceId", details, status)
         values (gen_random_uuid(), 'SYSTEM', $3, 'System creation', $1, 'operator', 'UPDATE', 'quotation-salesperson-aliases', $1, $2, 'SUCCESS')`,
        [org, JSON.stringify({ added: rows.map((o) => ({ text: o.name, userIds: o.userIds })) }), `system:${SCRIPT}`],
      );
    }
    await c.query('commit');
  } catch (e) {
    await c.query('rollback');
    throw e;
  }
  console.log(`APPLIED: ${toWrite.length} name(s) mapped.`);
  await c.end();
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
