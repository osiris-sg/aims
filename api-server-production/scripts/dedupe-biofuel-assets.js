/**
 * Dedupe Biofuel duplicate assets — SAFE groups only.
 *
 * Merges duplicate Asset records that share a normalized SKU and clearly
 * represent the same product, consolidating every reference onto ONE survivor:
 *   - DocumentItem.itemId            (invoice line links)
 *   - Document.config.items[].inventoryItemId  (asset id stored in form JSON)
 *   - ImportInvoice.lineItems[].selectedAssetId (asset id in import staging)
 *   - Assignment.assetId             (deployment/job links)
 *   - Inventory.assetId              (serial-tracked units)
 * then soft-deletes the loser records (deletedAt = now(), reversible).
 *
 * Survivor rule: record with the MOST distinct invoice references wins.
 * Tie-break: has inventory > has price > oldest createdAt.
 *
 * Ambiguous SKUs (HOLDINGTANK, AF100, APF40, WEBACCESS) are intentionally
 * EXCLUDED — they may be different products sharing a SKU.
 *
 * Usage:
 *   DATABASE_URL=... node scripts/dedupe-biofuel-assets.js           # dry run (default)
 *   DATABASE_URL=... node scripts/dedupe-biofuel-assets.js --commit  # apply in a transaction
 */
const { Client } = require('pg');

const COMMIT = process.argv.includes('--commit');
const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

// Clearly-safe duplicate families (normalized SKU). Ambiguous ones omitted.
const SAFE_SKUS = new Set([
  'mbr10', 'mbr15', 'mbr20', 'mbr30', 'mbr50', 'mbr60',
  'membranerack', 'boltnut', 'roadroller', 'apf90',
]);

async function main() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  const org = (await client.query(
    `SELECT id, name FROM "Organization" WHERE name ILIKE '%biofuel%' LIMIT 1`,
  )).rows[0];
  if (!org) throw new Error('Biofuel org not found');

  const assets = (await client.query(
    `SELECT a.id, a.name, a."skuKey" sku, c.name cat, a.price, a."costPrice" cost, a."createdAt" created
       FROM "Asset" a LEFT JOIN "Category" c ON c.id = a."categoryId"
      WHERE a."organizationId" = $1 AND a."deletedAt" IS NULL`, [org.id])).rows;

  // Target category for standardized membrane survivors
  const wtCat = (await client.query(
    `SELECT id FROM "Category" WHERE "organizationId" = $1 AND name ILIKE 'Water Treatment' LIMIT 1`, [org.id])).rows[0];
  const wtCatId = wtCat ? wtCat.id : null;
  if (!wtCatId) console.log('⚠ No "Water Treatment" category found — membrane category will be left unchanged.');

  const m = {};
  assets.forEach((a) => (m[a.id] = { ...a, invoices: new Set(), inv: 0, assign: 0 }));

  (await client.query(
    `SELECT di."itemId" id, d.id doc FROM "DocumentItem" di
       JOIN "Document" d ON d.id = di."documentId" WHERE d."organizationId" = $1`, [org.id]))
    .rows.forEach((r) => m[r.id] && m[r.id].invoices.add(r.doc));
  (await client.query(
    `SELECT "assetId" id, count(*)::int n FROM "Inventory" WHERE "organizationId" = $1 GROUP BY "assetId"`, [org.id]))
    .rows.forEach((r) => m[r.id] && (m[r.id].inv = r.n));
  (await client.query(
    `SELECT "assetId" id, count(*)::int n FROM "Assignment" WHERE "assetId" = ANY($1::uuid[]) GROUP BY "assetId"`,
    [assets.map((a) => a.id)]))
    .rows.forEach((r) => m[r.id] && (m[r.id].assign = r.n));

  // Build safe groups
  const groups = {};
  assets.forEach((a) => {
    const k = norm(a.sku);
    if (!SAFE_SKUS.has(k)) return;
    (groups[k] = groups[k] || []).push(a.id);
  });

  const plan = [];
  Object.entries(groups).forEach(([k, ids]) => {
    if (ids.length < 2) return;
    const recs = ids.map((id) => m[id]).sort((x, y) =>
      y.invoices.size - x.invoices.size ||
      y.inv - x.inv ||
      (y.price != null) - (x.price != null) ||
      new Date(x.created) - new Date(y.created));
    const survivor = recs[0];
    const losers = recs.slice(1);
    // price/cost to backfill onto survivor if it lacks them
    const priceFill = survivor.price == null ? (losers.find((l) => l.price != null) || {}).price ?? null : null;
    const costFill = survivor.cost == null ? (losers.find((l) => l.cost != null) || {}).cost ?? null : null;
    // Standardize membrane survivors: "Membrane N-Capacity" + Water Treatment category
    let rename = null;
    const cap = k.match(/^mbr(\d+)$/);
    if (cap) {
      const newName = `Membrane ${cap[1]}-Capacity`;
      const newCat = wtCatId && survivor.cat !== 'Water Treatment' ? wtCatId : null;
      if (survivor.name !== newName || newCat) rename = { name: newName, categoryId: newCat };
    }
    plan.push({ k, survivor, losers, priceFill, costFill, rename });
  });

  // ---- Report ----
  console.log(`\n=== Dedupe plan for ${org.name} ===`);
  console.log(COMMIT ? '*** COMMIT MODE — changes WILL be written ***' : '--- DRY RUN (no changes) ---');
  let totals = { invoices: 0, assign: 0, inv: 0, losers: 0, docs: new Set(), imports: 0 };

  for (const p of plan) {
    const loserIds = p.losers.map((l) => l.id);
    console.log(`\n■ ${p.survivor.name} [${p.survivor.sku}]  (SKU group ${p.k})`);
    console.log(`   KEEP  ${p.survivor.id}  📄${p.survivor.invoices.size} 📦${p.survivor.inv} 🔗${p.survivor.assign}  [${p.survivor.cat}]` +
      (p.priceFill != null || p.costFill != null ? `  (backfill price=${p.priceFill} cost=${p.costFill})` : ''));
    if (p.rename) console.log(`   RENAME -> "${p.rename.name}"${p.rename.categoryId ? '  category -> Water Treatment' : ''}`);
    for (const l of p.losers) {
      console.log(`   DROP  ${l.id}  📄${l.invoices.size} 📦${l.inv} 🔗${l.assign}  [${l.cat}]`);
      totals.invoices += l.invoices.size; totals.assign += l.assign; totals.inv += l.inv; totals.losers++;
      l.invoices.forEach((d) => totals.docs.add(d));
    }

    // collision pre-checks (report only)
    const diColl = (await client.query(
      `SELECT count(*)::int n FROM "DocumentItem" di
        WHERE di."itemId" = ANY($1::uuid[])
          AND EXISTS (SELECT 1 FROM "DocumentItem" s WHERE s."itemId" = $2
                        AND s."documentId" = di."documentId" AND s."lineNumber" IS NOT DISTINCT FROM di."lineNumber")`,
      [loserIds, p.survivor.id])).rows[0].n;
    const asColl = (await client.query(
      `SELECT count(*)::int n FROM "Assignment" a
        WHERE a."assetId" = ANY($1::uuid[])
          AND EXISTS (SELECT 1 FROM "Assignment" s WHERE s."assetId" = $2
                        AND s."projectId" = a."projectId" AND s."documentId" IS NOT DISTINCT FROM a."documentId")`,
      [loserIds, p.survivor.id])).rows[0].n;
    if (diColl) console.log(`     ⚠ ${diColl} DocumentItem row(s) collide with survivor (same doc+line) — will be de-duped`);
    if (asColl) console.log(`     ⚠ ${asColl} Assignment row(s) collide with survivor — will be de-duped`);

    const imp = (await client.query(
      `SELECT count(*)::int n FROM "ImportInvoice" WHERE "organizationId" = $1
         AND ${loserIds.map((_, i) => `"lineItems"::text LIKE '%' || $${i + 2} || '%'`).join(' OR ')}`,
      [org.id, ...loserIds])).rows[0].n;
    totals.imports += imp;
  }

  console.log(`\n--- TOTALS ---`);
  console.log(`Groups merged: ${plan.length}   Records soft-deleted: ${totals.losers}`);
  console.log(`Re-point: invoices(DocumentItem)=${totals.invoices}  assignments=${totals.assign}  inventory(serials)=${totals.inv}`);
  console.log(`Documents whose config JSON will be rewritten: ${totals.docs.size}`);
  console.log(`ImportInvoice rows whose lineItems JSON will be rewritten: ${totals.imports}`);

  if (!COMMIT) {
    console.log(`\nDry run only. Re-run with --commit to apply.`);
    await client.end();
    return;
  }

  // ---- Apply in one transaction ----
  await client.query('BEGIN');
  let delSeq = 0; // distinct deletedAt offsets to satisfy @@unique([skuKey, organizationId, deletedAt])
  try {
    for (const p of plan) {
      const surv = p.survivor.id;
      for (const l of p.losers) {
        // 1) DocumentItem: drop colliding loser rows, then re-point
        await client.query(
          `DELETE FROM "DocumentItem" di WHERE di."itemId" = $1
             AND EXISTS (SELECT 1 FROM "DocumentItem" s WHERE s."itemId" = $2
                           AND s."documentId" = di."documentId" AND s."lineNumber" IS NOT DISTINCT FROM di."lineNumber")`,
          [l.id, surv]);
        await client.query(`UPDATE "DocumentItem" SET "itemId" = $2 WHERE "itemId" = $1`, [l.id, surv]);

        // 2) Assignment: drop colliding loser rows, then re-point
        await client.query(
          `DELETE FROM "Assignment" a WHERE a."assetId" = $1
             AND EXISTS (SELECT 1 FROM "Assignment" s WHERE s."assetId" = $2
                           AND s."projectId" = a."projectId" AND s."documentId" IS NOT DISTINCT FROM a."documentId")`,
          [l.id, surv]);
        await client.query(`UPDATE "Assignment" SET "assetId" = $2 WHERE "assetId" = $1`, [l.id, surv]);

        // 3) Inventory: move serial-tracked units
        await client.query(`UPDATE "Inventory" SET "assetId" = $2 WHERE "assetId" = $1`, [l.id, surv]);

        // 4) Document.config JSON: rewrite asset id (loser -> survivor)
        await client.query(
          `UPDATE "Document" SET config = replace(config::text, $1, $2)::jsonb
            WHERE "organizationId" = $3 AND config::text LIKE '%' || $1 || '%'`,
          [l.id, surv, org.id]);

        // 5) ImportInvoice.lineItems JSON: rewrite selectedAssetId (loser -> survivor)
        await client.query(
          `UPDATE "ImportInvoice" SET "lineItems" = replace("lineItems"::text, $1, $2)::jsonb
            WHERE "organizationId" = $3 AND "lineItems"::text LIKE '%' || $1 || '%'`,
          [l.id, surv, org.id]);
      }

      // 6) backfill price/cost onto survivor if missing
      if (p.priceFill != null) await client.query(`UPDATE "Asset" SET price = $2 WHERE id = $1 AND price IS NULL`, [surv, p.priceFill]);
      if (p.costFill != null) await client.query(`UPDATE "Asset" SET "costPrice" = $2 WHERE id = $1 AND "costPrice" IS NULL`, [surv, p.costFill]);

      // 6b) standardize survivor name/category
      if (p.rename) {
        await client.query(`UPDATE "Asset" SET name = $2 WHERE id = $1`, [surv, p.rename.name]);
        if (p.rename.categoryId) await client.query(`UPDATE "Asset" SET "categoryId" = $2 WHERE id = $1`, [surv, p.rename.categoryId]);
      }

      // 7) soft-delete losers — distinct deletedAt per row so same-skuKey dups don't collide
      for (const l of p.losers) {
        await client.query(
          `UPDATE "Asset" SET "deletedAt" = now() + make_interval(secs => $2) WHERE id = $1`,
          [l.id, delSeq++ * 0.001]);
      }
    }
    await client.query('COMMIT');
    console.log('\n✅ Committed.');
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('\n❌ Rolled back:', e.message);
    process.exitCode = 1;
  }
  await client.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
