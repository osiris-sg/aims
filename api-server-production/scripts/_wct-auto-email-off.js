// Set features.disableAutoCustomerEmails = true for WCT (S) Systems ONLY (Elroy, 16 Nov 2026).
// Dry run by default; --apply writes. Logs an ActionLog "System creation" row + a local log file.
require('dotenv').config({ path: __dirname + '/../.env' });
const { Client } = require('pg');
const fs = require('fs');
const WCT = '5c700000-0000-4000-8000-5c7000000001';
const KEY = 'disableAutoCustomerEmails';
const APPLY = process.argv.includes('--apply');
(async () => {
  const c = new Client({ connectionString: process.env.PROD_DATABASE_URL }); await c.connect();
  const q = async (s, p) => (await c.query(s, p)).rows;
  const ui = (await q(`select id, features from "OrganizationUIConfig" where "organizationId"=$1`, [WCT]))[0];
  if (!ui) throw new Error('WCT has no OrganizationUIConfig row');
  const before = (ui.features || {})[KEY];
  const others = await q(`select o.name from "OrganizationUIConfig" u join "Organization" o on o.id=u."organizationId" where u."organizationId" <> $1 and u.features ? $2`, [WCT, KEY]);
  console.log(`WCT (S) ${KEY}: ${JSON.stringify(before)} -> true`);
  console.log(`other orgs carrying the key: ${others.length ? others.map((r) => r.name).join(', ') : 'none'}`);
  if (before === true) { console.log('already on, nothing to do'); await c.end(); return; }
  if (!APPLY) { console.log('DRY RUN: no write. Re-run with --apply.'); await c.end(); return; }
  await c.query('begin');
  await c.query(`update "OrganizationUIConfig" set features = coalesce(features,'{}'::jsonb) || jsonb_build_object($2::text, true) where id=$1`, [ui.id, KEY]);
  await c.query(`insert into "ActionLog"(id, "actorType", "actorId", "actorName", "organizationId", channel, action, resource, details, status)
     values (gen_random_uuid(), 'SYSTEM', 'system:wct-auto-email-off', 'System creation', $1, 'operator', 'UPDATE', 'organization-features', $2, 'SUCCESS')`,
    [WCT, JSON.stringify({ note: `${KEY}: ${JSON.stringify(before)} -> true (Elroy 16 Nov: stop automatic customer emails, WCT only)` })]);
  await c.query('commit');
  const after = (await q(`select features->$2 v from "OrganizationUIConfig" where id=$1`, [ui.id, KEY]))[0].v;
  fs.writeFileSync(__dirname + '/_wct-auto-email-off.log.json', JSON.stringify({ at: new Date().toISOString(), org: WCT, key: KEY, before, after }, null, 2));
  console.log(`APPLIED: ${KEY} = ${JSON.stringify(after)}`);
  await c.end();
})().catch((e) => { console.error(e.message); process.exit(1); });
