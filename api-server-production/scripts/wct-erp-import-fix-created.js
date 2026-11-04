/**
 * WCT ERP import, createdAt correction (2026-11-05). scripts/wct-erp-import.js passed JS Dates to
 * node-pg, which wrote them as Singapore wall-clock time into "timestamp without time zone"
 * (UTC by Prisma's convention), so every imported row's createdAt / updatedAt sits 8 h late.
 * The same goes for the 3 customers it created. This moves them back 8 h. updatedAt moves only where it still equals createdAt (a row touched
 * since, e.g. by a payment, keeps its real updatedAt). The rule that imported rows sort before
 * WCT's own AIMS documents is checked before anything is written.
 *
 *   DBURL=… node scripts/wct-erp-import-fix-created.js            dry run: counts + samples
 *   DBURL=… node scripts/wct-erp-import-fix-created.js --apply    one transaction, logged
 */
const { Client, types } = require('pg');
const fs = require('fs');
const path = require('path');

types.setTypeParser(1114, (v) => `${v.replace(' ', 'T')}Z`); // keep timestamps as UTC text
const WCT = '5c700000-0000-4000-8000-5c7000000001';
const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const BATCH = args.includes('--batch') ? args[args.indexOf('--batch') + 1] : 'wct-erp-2026-11-05';

(async () => {
  const c = new Client({ connectionString: process.env.DBURL });
  await c.connect();
  const q = async (sql, p) => (await c.query(sql, p)).rows;
  await c.query(APPLY ? 'BEGIN' : 'BEGIN READ ONLY');
  try {
    const scope = `"organizationId" = $1 and config->'erpImport'->>'batch' = $2`;
    const counts = (await q(`select count(*)::int n, count(*) filter (where "updatedAt" = "createdAt")::int untouched, min("createdAt") min_c, max("createdAt") max_c from "Document" where ${scope}`, [WCT, BATCH]))[0];
    const native = (await q(`select min("createdAt") min_c, count(*)::int n from "Document" where "organizationId" = $1 and not (config ? 'erpImport')`, [WCT]))[0];
    const samples = await q(
      `select name, config->>'date' date, "createdAt", "createdAt" - interval '8 hours' as fixed, "updatedAt" = "createdAt" as untouched
       from "Document" where ${scope} and name in ('I-009470','I-015032','I-015239','I-015128','Q-003093-2','I-001233') order by name`,
      [WCT, BATCH],
    );
    const newMax = (await q(`select max("createdAt" - interval '8 hours') m from "Document" where ${scope}`, [WCT, BATCH]))[0].m;
    console.log(`batch ${BATCH}: ${counts.n} documents (${counts.untouched} untouched since import, ${counts.n - counts.untouched} updated since: those keep their updatedAt)`);
    console.log(`createdAt now ${counts.min_c} .. ${counts.max_c}  ->  after ${new Date(Date.parse(counts.min_c) - 8 * 3600e3).toISOString()} .. ${newMax}`);
    console.log(`WCT's own documents: ${native.n}, first created ${native.min_c} · imported still before them: ${newMax < native.min_c}`);
    console.table(samples);
    // The 3 customers the import created have the same 8 h offset.
    const custScope = `"organizationId" = $1 and "externalRef" = $2`;
    const custs = await q(`select "customerCode", name, "createdAt", "createdAt" - interval '8 hours' as fixed, "updatedAt" = "createdAt" as untouched from "Customer" where ${custScope} order by 1`, [WCT, `erp-import:${BATCH}`]);
    console.table(custs);
    if (!(newMax < native.min_c)) throw new Error('imported rows would no longer sort before WCT\'s own documents');
    if (!APPLY) { await c.query('ROLLBACK'); await c.end(); return; }
    const u1 = await c.query(`update "Document" set "createdAt" = "createdAt" - interval '8 hours', "updatedAt" = "updatedAt" - interval '8 hours' where ${scope} and "updatedAt" = "createdAt"`, [WCT, BATCH]);
    const u2 = await c.query(`update "Document" set "createdAt" = "createdAt" - interval '8 hours' where ${scope} and "updatedAt" <> "createdAt"`, [WCT, BATCH]);
    if (u1.rowCount + u2.rowCount !== counts.n) throw new Error(`updated ${u1.rowCount + u2.rowCount}, expected ${counts.n}`);
    const c1 = await c.query(`update "Customer" set "createdAt" = "createdAt" - interval '8 hours', "updatedAt" = "updatedAt" - interval '8 hours' where ${custScope} and "updatedAt" = "createdAt"`, [WCT, `erp-import:${BATCH}`]);
    const c2 = await c.query(`update "Customer" set "createdAt" = "createdAt" - interval '8 hours' where ${custScope} and "updatedAt" <> "createdAt"`, [WCT, `erp-import:${BATCH}`]);
    if (c1.rowCount + c2.rowCount !== custs.length) throw new Error(`customers updated ${c1.rowCount + c2.rowCount}, expected ${custs.length}`);
    const after = (await q(`select min("createdAt") min_c, max("createdAt") max_c from "Document" where ${scope}`, [WCT, BATCH]))[0];
    await c.query('COMMIT');
    const log = { at: new Date().toISOString(), batch: BATCH, shiftedBoth: u1.rowCount, shiftedCreatedOnly: u2.rowCount, customersShifted: c1.rowCount + c2.rowCount, before: { min: counts.min_c, max: counts.max_c }, after };
    fs.writeFileSync(path.resolve(__dirname, `wct-erp-import-fix-created.${BATCH}.log.json`), JSON.stringify(log, null, 1));
    console.log(`applied: ${u1.rowCount} (createdAt + updatedAt) + ${u2.rowCount} (createdAt only) · customers ${c1.rowCount + c2.rowCount} · now ${after.min_c} .. ${after.max_c}`);
    await c.end();
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  }
})().catch((e) => {
  console.error('ERROR', e.message);
  process.exit(1);
});
