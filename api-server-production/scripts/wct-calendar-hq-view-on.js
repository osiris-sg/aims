// Calendar HQ view (2026-11-18): set features.calendarHqView = true for WCT (S) Systems ONLY.
// WCT (S) is the group parent: its calendar already shows every job and note to every office
// user (no per-person hiding) plus Racking / BC Air / YMM via the group calendar; the flag adds
// the Salesperson filter. The children see only their own calendar, so they do not need it.
// Dry run by default (prints before -> after, the calendar-style prerequisite, and which other
// orgs carry the key); --apply writes in one transaction and logs an ActionLog "System creation"
// row per org + a local log file.
//   node scripts/wct-calendar-hq-view-on.js                        dry run on dev
//   node scripts/wct-calendar-hq-view-on.js --env prod             dry run on prod
//   node scripts/wct-calendar-hq-view-on.js --env prod --apply     writes + ActionLog rows + log json
// dev = DATABASE_URL, platform schema (per-org tenancy); prod = PROD_DATABASE_URL, public schema. URLs never printed.
// --exclude <orgId>[,<orgId>]: leave these orgs out. Do not --apply on prod without Elroy's go.
require('dotenv').config({ path: __dirname + '/../.env' });
const { Client } = require('pg');
const fs = require('fs');
const KEY = 'calendarHqView';
const GROUP = {
  '5c700000-0000-4000-8000-5c7000000001': 'WCT (S) Systems',
};
const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : '');
const EXCLUDE = new Set(arg('--exclude').split(',').filter(Boolean));
for (const id of EXCLUDE) delete GROUP[id];
const ENV = arg('--env') || 'dev';
if (!['prod', 'dev'].includes(ENV)) throw new Error('--env must be prod or dev');
const URL_VAR = ENV === 'prod' ? 'PROD_DATABASE_URL' : 'DATABASE_URL';
const S = ENV === 'prod' ? '"public"' : '"platform"';

const APPLY = process.argv.includes('--apply');
(async () => {
  if (!process.env[URL_VAR]) throw new Error(`${URL_VAR} is not set`);
  console.log(`env: ${ENV}${APPLY ? '' : ' (dry run)'}`);
  const c = new Client({ connectionString: process.env[URL_VAR] });
  await c.connect();
  const q = async (s, p) => (await c.query(s, p)).rows;
  const ids = Object.keys(GROUP);
  const rows = await q(`select id::text id, "organizationId"::text "organizationId", features->$2 as v, features->'enableCalendarStyle' as style, features->'enableGroupCalendar' as grp from ${S}."OrganizationUIConfig" where "organizationId"::text = any($1::text[])`, [ids, KEY]);
  const plan = [];
  for (const id of ids) {
    const r = rows.find((x) => x.organizationId === id);
    if (!r) { console.log(`${GROUP[id]}: no OrganizationUIConfig row, skipped`); continue; }
    const before = r.v === undefined ? null : r.v;
    console.log(`${GROUP[id]}: ${KEY} ${JSON.stringify(before)} -> true${before === true ? ' (already on)' : ''}`);
    console.log(`  enableCalendarStyle=${JSON.stringify(r.style ?? null)} (the Salesperson filter needs it), enableGroupCalendar=${JSON.stringify(r.grp ?? null)}`);
    if (before !== true) plan.push({ uiId: r.id, org: id, before });
  }
  const others = await q(`select o.name, u.features->$2 as v from ${S}."OrganizationUIConfig" u join ${S}."Organization" o on o.id = u."organizationId" where not (u."organizationId"::text = any($1::text[])) and u.features ? $2`, [ids, KEY]);
  console.log(`other orgs carrying the key: ${others.length ? others.map((r) => `${r.name}=${JSON.stringify(r.v)}`).join(', ') : 'none'} (left unchanged)`);
  if (!plan.length) { console.log('nothing to do'); await c.end(); return; }
  if (!APPLY) { console.log(`DRY RUN: ${plan.length} change(s), no write. Re-run with --apply.`); await c.end(); return; }
  await c.query('begin');
  for (const p of plan) {
    await c.query(`update ${S}."OrganizationUIConfig" set features = coalesce(features,'{}'::jsonb) || jsonb_build_object($2::text, true) where id::text = $1`, [p.uiId, KEY]);
    await c.query(`insert into ${S}."ActionLog"(id, "actorType", "actorId", "actorName", "organizationId", channel, action, resource, details, status)
       values (gen_random_uuid(), 'SYSTEM', 'system:wct-calendar-hq-view-on', 'System creation', $1, 'operator', 'UPDATE', 'organization-features', $2, 'SUCCESS')`,
      [p.org, JSON.stringify({ note: `${KEY}: ${JSON.stringify(p.before)} -> true (jobs calendar HQ view: Salesperson filter, WCT (S))` })]);
  }
  await c.query('commit');
  fs.writeFileSync(__dirname + `/wct-calendar-hq-view-on.${ENV}.log.json`, JSON.stringify({ at: new Date().toISOString(), env: ENV, key: KEY, changed: plan.map((p) => ({ org: p.org, before: p.before })) }, null, 2));
  console.log(`APPLIED: ${plan.length} org(s)`);
  await c.end();
})().catch((e) => { console.error(e.message); process.exit(1); });
