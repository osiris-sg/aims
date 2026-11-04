/**
 * WCT jobs calendar (2026-11-04): move the "Permit required" / "Permit approved"
 * job fields onto Delivery.ptwStatus, then hide the two fields (isActive=false,
 * never deleted; their values stay in CustomFieldValue).
 *
 *   approved = true            → APPROVED
 *   required = true (only)     → REQUIRED
 *   anything else              → left alone (null = not needed)
 * A job that already has a ptwStatus is never overwritten.
 *
 * Dry run by default (read-only transaction, prints what it would do).
 *   DBURL=… node scripts/ptw-from-job-fields.js [--org <id>] [--apply] [--search-path org_wct,platform]
 * (--search-path only for the dev DB's per-org schemas; prod is the public schema.)
 * --apply writes in ONE transaction and logs every write to
 * scripts/ptw-from-job-fields.log.json.
 */
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const WCT = '5c700000-0000-4000-8000-5c7000000001';
const args = process.argv.slice(2);
const apply = args.includes('--apply');
const org = args.includes('--org') ? args[args.indexOf('--org') + 1] : WCT;
const searchPath = args.includes('--search-path') ? args[args.indexOf('--search-path') + 1] : null;
const FIELDS = { permit_required: 'REQUIRED', permit_approved: 'APPROVED' };

const truthy = (v) => v === true || v === 'true' || v === 1 || v === '1' || v === 'yes';

(async () => {
  const c = new Client({ connectionString: process.env.DBURL });
  await c.connect();
  if (searchPath) await c.query(`SET search_path TO ${searchPath.split(',').map((x) => `"${x.replace(/"/g, '')}"`).join(', ')}`);
  await c.query(apply ? 'BEGIN' : 'BEGIN READ ONLY');
  try {
    const fields = (
      await c.query(`select id, "fieldName", "displayLabel", "isActive" from "CustomField" where "organizationId" = $1 and "entityType" = 'Delivery' and "fieldName" = any($2)`, [org, Object.keys(FIELDS)])
    ).rows;
    console.log(`org ${org}: ${fields.length} permit field(s)`);
    for (const f of fields) console.log(`  ${f.fieldName} "${f.displayLabel}" isActive=${f.isActive}`);
    const byId = new Map(fields.map((f) => [f.id, f.fieldName]));
    const values = fields.length
      ? (await c.query(`select "customFieldId", "entityId", value from "CustomFieldValue" where "customFieldId" = any($1) and "entityType" = 'Delivery'`, [fields.map((f) => f.id)])).rows
      : [];
    const perJob = new Map();
    for (const v of values) {
      const j = perJob.get(v.entityId) || {};
      j[byId.get(v.customFieldId)] = truthy(v.value);
      perJob.set(v.entityId, j);
    }
    const jobs = perJob.size
      ? (await c.query(`select id, "deliveryNumber", "ptwStatus" from "Delivery" where "organizationId" = $1 and id::text = any($2)`, [org, [...perJob.keys()]])).rows
      : [];
    const plan = [];
    let skipped = 0;
    for (const job of jobs) {
      const v = perJob.get(job.id);
      const target = v.permit_approved ? 'APPROVED' : v.permit_required ? 'REQUIRED' : null;
      if (!target || job.ptwStatus) {
        skipped++;
        continue;
      }
      plan.push({ deliveryId: job.id, deliveryNumber: job.deliveryNumber, from: v, ptwStatus: target });
    }
    const counts = plan.reduce((a, p) => ((a[p.ptwStatus] = (a[p.ptwStatus] || 0) + 1), a), {});
    console.log(`values: ${values.length} on ${perJob.size} job(s); to set: ${plan.length} ${JSON.stringify(counts)}; left alone: ${skipped}`);
    for (const p of plan) console.log(`  #${p.deliveryNumber} ${p.deliveryId} → ${p.ptwStatus}`);
    const toHide = fields.filter((f) => f.isActive);
    console.log(`fields to hide (isActive=false): ${toHide.map((f) => f.fieldName).join(', ') || 'none'}`);

    if (!apply) {
      console.log('DRY RUN: nothing written. Re-run with --apply.');
      await c.query('ROLLBACK');
      return;
    }
    const log = [];
    for (const p of plan) {
      const r = await c.query(`update "Delivery" set "ptwStatus" = $1, "updatedAt" = now() where id::text = $2 and "organizationId" = $3 and "ptwStatus" is null`, [p.ptwStatus, p.deliveryId, org]);
      log.push({ table: 'Delivery', id: p.deliveryId, set: { ptwStatus: p.ptwStatus }, rows: r.rowCount });
    }
    for (const f of toHide) {
      const r = await c.query(`update "CustomField" set "isActive" = false, "updatedAt" = now() where id = $1 and "organizationId" = $2`, [f.id, org]);
      log.push({ table: 'CustomField', id: f.id, fieldName: f.fieldName, set: { isActive: false }, rows: r.rowCount });
    }
    await c.query('COMMIT');
    const file = path.join(__dirname, 'ptw-from-job-fields.log.json');
    fs.writeFileSync(file, JSON.stringify({ at: new Date().toISOString(), org, writes: log }, null, 2));
    console.log(`APPLIED: ${log.length} write(s), logged to ${file}`);
    for (const l of log) console.log(`  ${l.table} ${l.id} ${JSON.stringify(l.set)} rows=${l.rows}`);
  } catch (e) {
    await c.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    await c.end();
  }
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
