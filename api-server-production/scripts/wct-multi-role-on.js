// Turn features.enableMultiRole ON for the 4 WCT group orgs (WCT (S), Racking, YMM, BC Air).
// Multi-role users: Add / Edit User pick several roles (one Primary), no Edit User subtitle,
// WhatsApp help in an (i) tooltip. No other org is touched; no role rows are written (the
// primary is each person's earliest-assigned active role, so no backfill is needed).
//
//   node scripts/wct-multi-role-on.js                 dry run on dev
//   node scripts/wct-multi-role-on.js --env prod      dry run on prod
//   node scripts/wct-multi-role-on.js --env prod --apply   writes + ActionLog row + log json
require('dotenv').config({ path: __dirname + '/../.env' });
const { Client, types } = require('pg');
const fs = require('fs');
types.setTypeParser(1114, (s) => s);

const ORGS = ['5c700000-0000-4000-8000-5c7000000001', '5c700000-0000-4000-8000-5c7000000002', '5c700000-0000-4000-8000-5c7000000003', '5c700000-0000-4000-8000-5c7000000004'];
const KEY = 'enableMultiRole';
const SCRIPT = 'system:wct-multi-role-on';
const arg = (k) => {
  const i = process.argv.indexOf(k);
  return i > 0 ? process.argv[i + 1] : null;
};
const ENV = arg('--env') || 'dev';
const APPLY = process.argv.includes('--apply');

(async () => {
  const url = ENV === 'prod' ? process.env.PROD_DATABASE_URL : process.env.DATABASE_URL;
  if (!url) throw new Error(`no database url for --env ${ENV}`);
  const S = ENV === 'prod' ? '"public"' : '"platform"';
  const c = new Client({ connectionString: url });
  await c.connect();
  const q = async (s, p) => (await c.query(s, p)).rows;
  const rows = await q(
    `select o.id::text id, o.name, u.id::text ui, u.features from ${S}."Organization" o left join ${S}."OrganizationUIConfig" u on u."organizationId" = o.id where o.id::text = any($1::text[]) order by o.id`,
    [ORGS],
  );
  const others = await q(`select o.name from ${S}."OrganizationUIConfig" u join ${S}."Organization" o on o.id = u."organizationId" where not (u."organizationId"::text = any($1::text[])) and u.features ? $2`, [ORGS, KEY]);
  const plan = rows.map((r) => ({ id: r.id, name: r.name, ui: r.ui, before: r.ui ? (r.features || {})[KEY] ?? null : 'NO CONFIG ROW' }));
  console.log(`${ENV}: ${KEY} -> true`);
  for (const p of plan) console.log(`  ${p.name}: ${JSON.stringify(p.before)} -> true${p.before === true ? ' (already on)' : ''}`);
  if (rows.length !== ORGS.length) console.log(`  missing orgs: ${ORGS.filter((o) => !rows.some((r) => r.id === o)).join(', ')}`);
  console.log(`other orgs carrying the key: ${others.length ? others.map((r) => r.name).join(', ') : 'none'}`);
  const todo = plan.filter((p) => p.ui && p.before !== true);
  if (plan.some((p) => !p.ui)) console.log('an org has no OrganizationUIConfig row: it is skipped (not created here)');
  if (!todo.length) {
    console.log('nothing to do');
    await c.end();
    return;
  }
  if (!APPLY) {
    console.log(`DRY RUN: ${todo.length} org(s) would change; no write. Re-run with --apply.`);
    await c.end();
    return;
  }
  await c.query('begin');
  for (const p of todo) {
    await c.query(`update ${S}."OrganizationUIConfig" set features = coalesce(features, '{}'::jsonb) || jsonb_build_object($2::text, true) where id::text = $1`, [p.ui, KEY]);
    await c.query(
      `insert into ${S}."ActionLog"(id, "actorType", "actorId", "actorName", "organizationId", channel, action, resource, details, status)
       values (gen_random_uuid(), 'SYSTEM', $1, 'System creation', $2, 'operator', 'UPDATE', 'organization-features', $3, 'SUCCESS')`,
      [SCRIPT, p.id, JSON.stringify({ note: `${KEY}: ${JSON.stringify(p.before)} -> true (multi-role users, WCT group)` })],
    );
  }
  await c.query('commit');
  const after = await q(`select "organizationId"::text id, features->$2 v from ${S}."OrganizationUIConfig" where "organizationId"::text = any($1::text[])`, [ORGS, KEY]);
  fs.writeFileSync(__dirname + '/wct-multi-role-on.log.json', JSON.stringify({ at: new Date().toISOString(), env: ENV, key: KEY, before: plan, after }, null, 2));
  console.log(`APPLIED to ${todo.length} org(s)`);
  await c.end();
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
