// Quotation templates (2026-11-18): set features.enableQuotationTemplates = true for the
// four WCT group orgs ONLY (WCT (S), WCT Racking, YMM Kitchen, BC Air). Dry run by default
// (prints before -> after per org and which other orgs carry the key); --apply writes in
// one transaction and logs an ActionLog "System creation" row per org + a local log file.
// Reads PROD_DATABASE_URL (never printed). Do not --apply without Elroy's go.
require('dotenv').config({ path: __dirname + '/../.env' });
const { Client } = require('pg');
const fs = require('fs');
const KEY = 'enableQuotationTemplates';
const GROUP = {
  '5c700000-0000-4000-8000-5c7000000001': 'WCT (S) Systems',
  '5c700000-0000-4000-8000-5c7000000002': 'WCT Racking',
  '5c700000-0000-4000-8000-5c7000000003': 'YMM Kitchen',
  '5c700000-0000-4000-8000-5c7000000004': 'BC Air',
};
// --exclude <orgId>[,<orgId>]: leave these group orgs out (e.g. YMM).
const EXCLUDE = new Set((process.argv.includes('--exclude') ? process.argv[process.argv.indexOf('--exclude') + 1] : '').split(',').filter(Boolean));
for (const id of EXCLUDE) delete GROUP[id];

const APPLY = process.argv.includes('--apply');
(async () => {
  if (!process.env.PROD_DATABASE_URL) throw new Error('PROD_DATABASE_URL is not set');
  const c = new Client({ connectionString: process.env.PROD_DATABASE_URL });
  await c.connect();
  const q = async (s, p) => (await c.query(s, p)).rows;
  const ids = Object.keys(GROUP);
  const rows = await q(`select id, "organizationId", features->$2 as v from "OrganizationUIConfig" where "organizationId" = any($1)`, [ids, KEY]);
  const plan = [];
  for (const id of ids) {
    const r = rows.find((x) => x.organizationId === id);
    if (!r) { console.log(`${GROUP[id]}: no OrganizationUIConfig row, skipped`); continue; }
    const before = r.v === undefined ? null : r.v;
    console.log(`${GROUP[id]}: ${KEY} ${JSON.stringify(before)} -> true${before === true ? ' (already on)' : ''}`);
    if (before !== true) plan.push({ uiId: r.id, org: id, before });
  }
  const others = await q(`select o.name, u.features->$2 as v from "OrganizationUIConfig" u join "Organization" o on o.id = u."organizationId" where u."organizationId" <> all($1) and u.features ? $2`, [ids, KEY]);
  console.log(`other orgs carrying the key: ${others.length ? others.map((r) => `${r.name}=${JSON.stringify(r.v)}`).join(', ') : 'none'} (left unchanged)`);
  const table = await q(`select to_regclass('public."QuotationTemplate"') as t`);
  console.log(`QuotationTemplate table on prod: ${table[0].t ? 'present' : 'MISSING (deploy the code first; Render creates it)'}`);
  if (!plan.length) { console.log('nothing to do'); await c.end(); return; }
  if (!APPLY) { console.log(`DRY RUN: ${plan.length} change(s), no write. Re-run with --apply.`); await c.end(); return; }
  await c.query('begin');
  for (const p of plan) {
    await c.query(`update "OrganizationUIConfig" set features = coalesce(features,'{}'::jsonb) || jsonb_build_object($2::text, true) where id = $1`, [p.uiId, KEY]);
    await c.query(`insert into "ActionLog"(id, "actorType", "actorId", "actorName", "organizationId", channel, action, resource, details, status)
       values (gen_random_uuid(), 'SYSTEM', 'system:wct-quotation-templates-on', 'System creation', $1, 'operator', 'UPDATE', 'organization-features', $2, 'SUCCESS')`,
      [p.org, JSON.stringify({ note: `${KEY}: ${JSON.stringify(p.before)} -> true (quotation templates, WCT group)` })]);
  }
  await c.query('commit');
  fs.writeFileSync(__dirname + '/wct-quotation-templates-on.log.json', JSON.stringify({ at: new Date().toISOString(), key: KEY, changed: plan.map((p) => ({ org: p.org, before: p.before })) }, null, 2));
  console.log(`APPLIED: ${plan.length} org(s)`);
  await c.end();
})().catch((e) => { console.error(e.message); process.exit(1); });
