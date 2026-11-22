#!/usr/bin/env node
/**
 * WCT group quotations (2026-11-22): the quotation editor's left "Reference" box became "Customer Remarks"
 * (config.remarks, printed) and the right box "Internal remarks" (config.internalRemarks, never printed). A quotation
 * whose Reference held its own text (not the Subject, not the printed remarks) would no longer show it anywhere, so
 * this copies that text into Internal remarks. config.referenceNo is kept as it is (nothing is removed).
 *
 * Picks: WCT (S) and its child orgs, type QUOTATION, not voided / cancelled, referenceNo non-empty, referenceNo not
 * equal to the Subject (ERP imports stored the Subject there) nor to the remarks, and no Internal remarks yet.
 *
 *   node scripts/wct-qo-reference-to-internal.js --env prod            (dry run: counts + samples, writes nothing)
 *   node scripts/wct-qo-reference-to-internal.js --env prod --apply    (only after the owner's APPLY)
 *
 * Re-runnable: a quotation that has Internal remarks is never touched again.
 */
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const args = process.argv.slice(2);
const env = args.includes('--env') ? args[args.indexOf('--env') + 1] : 'dev';
const apply = args.includes('--apply');
const PARENT = '5c700000-0000-4000-8000-5c7000000001';

function dbUrl() {
  const key = env === 'prod' ? 'PROD_DATABASE_URL' : 'DATABASE_URL';
  if (process.env[key]) return process.env[key];
  const file = path.join(__dirname, '..', '.env');
  const line = fs.readFileSync(file, 'utf8').split('\n').find((l) => l.startsWith(`${key}=`));
  if (!line) throw new Error(`${key} not set`);
  return line.slice(key.length + 1).trim().replace(/^"|"$/g, '');
}

const T = (x) => `NULLIF(btrim(COALESCE(${x}, '')), '')`;
const REF = T(`d.config->>'referenceNo'`);
const REM = T(`d.config->>'remarks'`);
const SUBJ = T(`COALESCE(NULLIF(d.config->>'subject', ''), d.config->'documentInfo'->>'subject')`);
const INTERNAL = T(`d.config->>'internalRemarks'`);

(async () => {
  const c = new Client({ connectionString: dbUrl() });
  await c.connect();
  await c.query(apply ? 'BEGIN' : 'BEGIN TRANSACTION READ ONLY');
  try {
    const orgs = (await c.query(`SELECT id, name FROM "Organization" WHERE id = $1 OR "parentOrgId" = $1 ORDER BY name`, [PARENT])).rows;
    const rows = (
      await c.query(
        `SELECT d.id, o.name AS org, d.name, d.status, (d.config ? 'erpImport') AS erp, ${REF} AS reference, ${REM} AS remarks, ${SUBJ} AS subject
           FROM "Document" d JOIN "Organization" o ON o.id = d."organizationId"
          WHERE d."organizationId" = ANY($1::text[]) AND d.type = 'QUOTATION'
            AND COALESCE(d.config->>'voided', '') <> 'true' AND COALESCE(d.config->>'cancelled', '') <> 'true'
            AND ${REF} IS NOT NULL AND ${REF} IS DISTINCT FROM ${SUBJ} AND ${REF} IS DISTINCT FROM ${REM} AND ${INTERNAL} IS NULL
          ORDER BY o.name, d."createdAt"`,
        [orgs.map((o) => o.id)],
      )
    ).rows;
    console.log(`${apply ? 'APPLY' : 'DRY RUN'} (${env}): ${rows.length} quotation(s) get their Reference text as Internal remarks`);
    const byOrg = {};
    for (const r of rows) byOrg[r.org] = (byOrg[r.org] || 0) + 1;
    console.table(Object.entries(byOrg).map(([org, n]) => ({ org, quotations: n })));
    console.table(rows.slice(0, 20).map((r) => ({ org: r.org.slice(0, 20), quotation: r.name, status: r.status, erp: r.erp, reference: (r.reference || '').slice(0, 40), remarks: (r.remarks || '').slice(0, 30), subject: (r.subject || '').slice(0, 30) })));
    if (!apply) {
      console.log('Nothing written. Run again with --apply after the APPLY.');
      await c.query('ROLLBACK');
      return;
    }
    let n = 0;
    for (const r of rows) {
      const u = await c.query(
        `UPDATE "Document" d SET config = jsonb_set(d.config, '{internalRemarks}', to_jsonb($2::text)), "updatedAt" = now() WHERE d.id = $1 AND ${INTERNAL} IS NULL`,
        [r.id, r.reference],
      );
      n += u.rowCount;
    }
    await c.query('COMMIT');
    console.log(`Applied: ${n} quotation(s) updated (referenceNo kept).`);
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    await c.end();
  }
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
