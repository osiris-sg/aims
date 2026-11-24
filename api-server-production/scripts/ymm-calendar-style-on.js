// YMM calendar style (2026-11-25, Elroy): turn on the jobs calendar style + Calendar colours for YMM Kitchen
// (5c700000-0000-4000-8000-5c7000000003) like its sister companies (WCT (S), Racking, BC Air). Writes ONLY these keys of
// YMM's features JSON (other keys and other orgs untouched):
//   enableCalendarStyle = true   the calendar style, Org Settings > Calendar colours, the calendar "Settings" button
//   enableJobsCalendar  = true   the jobs calendar itself (Jobs > Calendar); without it YMM has no calendar to style
//   hideSiteClockJobs   = true   as the sisters (YMM has no SiteClock link, so nothing is hidden today)
// Dry run by default: prints YMM's current value of every calendar key, the sisters' values (read only), the diff
// against them and what would change, plus what else YMM would need (not written here).
//   node scripts/ymm-calendar-style-on.js                                 dry run on dev
//   node scripts/ymm-calendar-style-on.js --env prod                      dry run on prod (read only)
//   node scripts/ymm-calendar-style-on.js --env prod --apply --confirm-prod   writes + one ActionLog SYSTEM row + log json
// dev = DATABASE_URL, platform schema (per-org tenancy); prod = PROD_DATABASE_URL, public schema. URLs never printed.
// Do not --apply on prod without Elroy's go.
require('dotenv').config({ path: __dirname + '/../.env' });
const { Client } = require('pg');
const fs = require('fs');

const YMM = '5c700000-0000-4000-8000-5c7000000003';
const SISTERS = {
  '5c700000-0000-4000-8000-5c7000000001': 'WCT (S)',
  '5c700000-0000-4000-8000-5c7000000002': 'Racking',
  '5c700000-0000-4000-8000-5c7000000004': 'BC Air',
};
const SET = { enableCalendarStyle: true, enableJobsCalendar: true, hideSiteClockJobs: true };
// Calendar-related keys compared with the sisters (read only; only SET is ever written).
const CALENDAR_KEYS = ['enableCalendarStyle', 'enableJobsCalendar', 'hideSiteClockJobs', 'enableGroupCalendar', 'calendarHqView', 'enableJobFields', 'enableWctOrders', 'enableWorkersTeams', 'enableSiteClockLink'];

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : '');
const ENV = arg('--env') || 'dev';
if (!['prod', 'dev'].includes(ENV)) throw new Error('--env must be prod or dev');
const URL_VAR = ENV === 'prod' ? 'PROD_DATABASE_URL' : 'DATABASE_URL';
const S = ENV === 'prod' ? '"public"' : '"platform"';
const APPLY = process.argv.includes('--apply');
if (APPLY && ENV === 'prod' && !process.argv.includes('--confirm-prod')) throw new Error('--apply on prod needs --confirm-prod');

(async () => {
  if (!process.env[URL_VAR]) throw new Error(`${URL_VAR} is not set`);
  console.log(`env: ${ENV}${APPLY ? '' : ' (dry run, read only)'}`);
  const c = new Client({ connectionString: process.env[URL_VAR] });
  await c.connect();
  const q = async (sql, p) => (await c.query(sql, p)).rows;
  const ids = [YMM, ...Object.keys(SISTERS)];
  const rows = await q(`select id::text id, "organizationId"::text org, features from ${S}."OrganizationUIConfig" where "organizationId"::text = any($1::text[])`, [ids]);
  const feat = (org) => rows.find((r) => r.org === org)?.features || {};
  const ymm = rows.find((r) => r.org === YMM);
  if (!ymm) throw new Error('YMM has no OrganizationUIConfig row');

  console.log('\nCalendar keys (YMM | WCT (S) | Racking | BC Air):');
  for (const k of CALENDAR_KEYS) {
    const v = (o) => JSON.stringify(feat(o)[k] ?? null);
    console.log(`  ${k.padEnd(22)} ${v(YMM).padEnd(6)} | ${Object.keys(SISTERS).map(v).join(' | ')}`);
  }
  const styled = Object.keys(SISTERS).filter((o) => feat(o).enableCalendarStyle === true);
  const diff = [...new Set(styled.flatMap((o) => Object.keys(feat(o))))]
    .filter((k) => /calendar|siteclock|jobfields|workersteams|wctorders/i.test(k))
    .filter((k) => styled.every((o) => feat(o)[k] === true) && feat(YMM)[k] !== true);
  console.log(`\nCalendar keys every calendar-style sister has on and YMM lacks: ${diff.join(', ') || 'none'}`);

  const plan = Object.entries(SET).filter(([k, v]) => feat(YMM)[k] !== v).map(([k, v]) => ({ key: k, before: feat(YMM)[k] ?? null, after: v }));
  console.log('\nWould write (YMM only):');
  for (const [k, v] of Object.entries(SET)) {
    const p = plan.find((x) => x.key === k);
    console.log(`  ${k}: ${JSON.stringify(feat(YMM)[k] ?? null)} -> ${JSON.stringify(v)}${p ? '' : ' (already)'}`);
  }

  // What else the calendar would need on YMM (read only, never written here).
  const fields = await q(`select "fieldName", "isActive", coalesce(jsonb_array_length(case when jsonb_typeof(options) = 'array' then options else '[]'::jsonb end), 0) n from ${S}."CustomField" where "organizationId"::text = $1 and "entityType" = 'Delivery'`, [YMM]);
  const jobs = await q(`select count(*)::int n from ${S}."Delivery" where "organizationId"::text = $1`, [YMM]);
  const roles = await q(`select r.name, r."allowedModules" m from ${S}."Role" r where r."organizationId"::text = $1 order by r.name`, [YMM]);
  const members = await q(`select count(distinct uo."userId")::int n from ${S}."UserOrganization" uo where uo."organizationId"::text = $1`, [YMM]);
  const sales = await q(`select count(distinct ur."userId")::int n from ${S}."UserRole" ur join ${S}."Role" r on r.id = ur."roleId" where r."organizationId"::text = $1 and lower(r.name) like '%sales%'`, [YMM]);
  console.log('\nAlso on YMM (read only, not changed by this script):');
  console.log(`  jobs: ${jobs[0].n}; members: ${members[0].n}; people with a Sales role: ${sales[0].n}`);
  console.log(`  job fields: ${fields.map((f) => `${f.fieldName}${f.isActive ? '' : ' (inactive)'}${f.n ? ` [${f.n}]` : ''}`).join(', ') || 'none'}`);
  console.log(`  roles: ${roles.map((r) => `${r.name}=${JSON.stringify(r.m)}`).join(', ')}`);

  if (!plan.length) { console.log('\nnothing to do'); await c.end(); return; }
  if (!APPLY) { console.log(`\nDRY RUN: ${plan.length} key(s) would change on YMM, nothing written. Apply: --env ${ENV} --apply${ENV === 'prod' ? ' --confirm-prod' : ''}`); await c.end(); return; }
  await c.query('begin');
  const patch = Object.fromEntries(plan.map((p) => [p.key, p.after]));
  await c.query(`update ${S}."OrganizationUIConfig" set features = coalesce(features,'{}'::jsonb) || $2::jsonb where id::text = $1`, [ymm.id, JSON.stringify(patch)]);
  await c.query(
    `insert into ${S}."ActionLog"(id, "actorType", "actorId", "actorName", "organizationId", channel, action, resource, details, status)
     values (gen_random_uuid(), 'SYSTEM', 'system:ymm-calendar-style-on', 'System creation', $1, 'operator', 'UPDATE', 'organization-features', $2, 'SUCCESS')`,
    [YMM, JSON.stringify({ note: 'YMM jobs calendar style + Calendar colours on (as WCT (S), Racking, BC Air)', changes: plan })],
  );
  await c.query('commit');
  fs.writeFileSync(__dirname + `/ymm-calendar-style-on.${ENV}.log.json`, JSON.stringify({ at: new Date().toISOString(), env: ENV, org: YMM, changes: plan }, null, 2));
  console.log(`\nAPPLIED on YMM: ${plan.map((p) => p.key).join(', ')}`);
  await c.end();
})().catch((e) => { console.error(e.message); process.exit(1); });
