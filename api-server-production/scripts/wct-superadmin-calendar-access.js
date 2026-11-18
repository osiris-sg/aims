// WCT (S) superadmin calendar access (Elroy 2026-11-18): grant dashboard:read to the "superadmin"
// role of WCT (S) Systems ONLY, so its holders see the jobs calendar like Admin (all jobs + notes,
// group items; opening another company's item still needs membership there). Roles are per org
// (Role.organizationId), so no other org's superadmin changes. Nothing else is granted.
// Dry run by default; --apply links the permission in one transaction + ActionLog row + log json.
//   node scripts/wct-superadmin-calendar-access.js --env prod            dry run on prod
//   node scripts/wct-superadmin-calendar-access.js --env prod --apply    writes
// dev = DATABASE_URL, platform schema; prod = PROD_DATABASE_URL, public schema. URLs never printed.
require('dotenv').config({ path: __dirname + '/../.env' });
const { Client } = require('pg');
const fs = require('fs');
const ORG = '5c700000-0000-4000-8000-5c7000000001';
const ROLE = 'superadmin';
const PERM = 'dashboard:read';
const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : '');
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
  const [role] = await q(`select id, name, "organizationId" from ${S}."Role" where "organizationId" = $1 and lower(name) = $2`, [ORG, ROLE]);
  const [perm] = await q(`select id from ${S}."Permission" where name = $1`, [PERM]);
  if (!role || !perm) throw new Error(`missing ${!role ? 'role' : 'permission'}`);
  const [has] = await q(`select 1 from ${S}."_PermissionToRole" where "A" = $1 and "B" = $2`, [perm.id, role.id]);
  const holders = await q(`select count(*)::int n from ${S}."UserRole" where "roleId" = $1`, [role.id]);
  const [cnt] = await q(`select count(*)::int n from ${S}."_PermissionToRole" where "B" = $1`, [role.id]);
  console.log(`WCT (S) Systems role "${role.name}" (${holders[0].n} holder(s), ${cnt.n} permissions): ${PERM} ${has ? 'already granted' : 'missing -> granted'}`);
  console.log('other orgs: untouched (roles are per org)');
  if (has) { console.log('nothing to do'); await c.end(); return; }
  if (!APPLY) { console.log('DRY RUN: 1 change, no write. Re-run with --apply.'); await c.end(); return; }
  await c.query('begin');
  await c.query(`insert into ${S}."_PermissionToRole"("A","B") values ($1,$2) on conflict do nothing`, [perm.id, role.id]);
  await c.query(`insert into ${S}."ActionLog"(id, "actorType", "actorId", "actorName", "organizationId", channel, action, resource, "resourceId", details, status)
     values (gen_random_uuid(), 'SYSTEM', 'system:wct-superadmin-calendar-access', 'System creation', $1, 'operator', 'UPDATE', 'role', $2, $3, 'SUCCESS')`,
    [ORG, role.id, JSON.stringify({ note: `Role ${role.name}: granted ${PERM} (jobs calendar access, like Admin)` })]);
  await c.query('commit');
  fs.writeFileSync(__dirname + `/wct-superadmin-calendar-access.${ENV}.log.json`, JSON.stringify({ at: new Date().toISOString(), env: ENV, org: ORG, roleId: role.id, granted: PERM }, null, 2));
  console.log('APPLIED: 1 permission granted');
  await c.end();
})().catch((e) => { console.error(e.message); process.exit(1); });
