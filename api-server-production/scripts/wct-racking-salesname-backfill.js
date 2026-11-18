/**
 * WR-QO202611-0001 (WCT Racking, 2026-11-18): its salesperson is stored as a bare user id with no name.
 * Fill config.salesPersonName (empty only) with the name the salesman list shows for that user
 * ("Nee Meng WCTR", am@racking.com.sg: picking that salesman in the editor stores this same id, seen on
 * the TEST quotation of 18 Nov). Unconfirmed quotation only. Dry run by default.
 *
 *   DBURL=<url> node scripts/wct-racking-salesname-backfill.js [--apply --confirm-prod]
 */
require('dotenv').config({ path: __dirname + '/../.env' });
const { Client } = require('pg');
const fs = require('fs');

const RK = '5c700000-0000-4000-8000-5c7000000002';
const DOC = '926f17fe-b512-45cb-80d1-105fe8552edf';
const USER = 'user_3Ld8L6i0KO2BXMybjx5mYkWUdoh';
const NAME = 'Nee Meng WCTR';
const APPLY = process.argv.includes('--apply');

(async () => {
  const url = process.env.DBURL || '';
  if (!url) throw new Error('Pass the database URL inline as DBURL');
  const prodHost = process.env.PROD_DATABASE_URL ? new URL(process.env.PROD_DATABASE_URL.replace(/["\r]/g, '')).host.replace('-pooler', '') : '';
  if (APPLY && new URL(url).host.replace('-pooler', '') === prodHost && !process.argv.includes('--confirm-prod')) throw new Error('Applying to prod needs --confirm-prod');
  const c = new Client({ connectionString: url });
  await c.connect();
  const d = (await c.query(`select id, name, status, config from "Document" where id=$1 and "organizationId"=$2`, [DOC, RK])).rows[0];
  if (!d) throw new Error('document not found');
  const cfg = d.config || {};
  console.log(`${d.name} (${d.status}): salesPerson ${JSON.stringify(cfg.salesPerson)}, salesPersonName ${JSON.stringify(cfg.salesPersonName)}`);
  if (cfg.salesPerson !== USER) throw new Error('salesPerson is not the expected user id; nothing done');
  if (!['unconfirmed', 'draft'].includes(String(d.status).toLowerCase())) throw new Error('not an unconfirmed quotation; nothing done');
  if (cfg.salesPersonName) { console.log('already has a name; nothing to do'); await c.end(); return; }
  console.log(`  config.salesPersonName: (none) -> ${JSON.stringify(NAME)}`);
  if (!APPLY) { console.log('DRY RUN: no write. Re-run with --apply --confirm-prod.'); await c.end(); return; }
  await c.query('begin');
  await c.query(`update "Document" set config = jsonb_set(config, '{salesPersonName}', to_jsonb($2::text)) where id=$1 and not (config ? 'salesPersonName')`, [DOC, NAME]);
  await c.query(
    `insert into "ActionLog"(id, "actorType", "actorId", "actorName", "organizationId", channel, action, resource, "resourceId", details, status)
     values (gen_random_uuid(), 'SYSTEM', 'system:wct-racking-salesname', 'System creation', $1, 'operator', 'UPDATE', 'document', $2, $3, 'SUCCESS')`,
    [RK, DOC, JSON.stringify({ note: `${d.name}: salesPersonName filled "${NAME}" (salesperson was a bare user id)` })],
  );
  await c.query('commit');
  fs.writeFileSync(__dirname + '/wct-racking-salesname-backfill.log.json', JSON.stringify({ at: new Date().toISOString(), doc: DOC, name: d.name, before: { salesPersonName: cfg.salesPersonName ?? null }, after: { salesPersonName: NAME } }, null, 2));
  console.log('APPLIED');
  await c.end();
})().catch((e) => { console.error(e.message); process.exit(1); });
