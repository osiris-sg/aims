/**
 * Backfill Biofuel MBR meter-reading hierarchy.
 *
 *   1. Create a "Meter Reading" child asset (skuKey METER-NN) under each
 *      MBR-NN canonical that ends up needing one.
 *   2. Move existing MBR-NN inventories down to their METER-NN child (they
 *      look like meter-reading device IDs anyway).
 *   3. Fix typo: DB sku `202151070` → Excel sku `2021051070` (Excel wins).
 *   4. Create new Inventories from Excel rows that aren't in DB yet
 *      (rows 70-73 specific-capacity with blank serials → TEMP-METER-NN-NNN).
 *   5. Flag for manual review: rows 11, 12 (serials with no resolvable capacity).
 *
 * Dry-run (default):
 *   npx dotenv -e .env -- npx ts-node scripts/backfill-mbr-meter-readings.ts
 * Apply:
 *   npx dotenv -e .env -- npx ts-node scripts/backfill-mbr-meter-readings.ts --apply
 */

import { PrismaClient } from '@prisma/client';
import * as path from 'path';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const XLSX: any = require(path.resolve(__dirname, '..', '..', 'portal-production', 'node_modules', 'xlsx'));

const ORG_ID = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
const WATER_TREATMENT_CATEGORY = '721cb6e1-6e70-40d2-aa0d-b7668393eaad';
const EXCEL_PATH = path.resolve(__dirname, 'Rental Tracker.xlsx');
const APPLY = process.argv.includes('--apply');

// Excel row 8 sku that's already in DB under a slightly typo'd form.
const TYPO_FIX = { fromSku: '202151070', toSku: '2021051070' };

const prisma = new PrismaClient();

function extractCapacity(item: string): string | null {
  // "MBR" alone → null. "1xMBR10" → "10". "MBR-30" → "30".
  // Plain "MBR" with no trailing digits is left for review.
  const m = item.match(/MBR-?(\d+)/i);
  return m ? m[1] : null;
}

function parseSerials(raw: string): string[] {
  const s = String(raw || '').trim();
  if (!s) return [];
  if (s.includes('|')) return [s.split('|')[0].trim()].filter(Boolean);
  return s.split(/[\n\r,&]/).map((x) => x.trim()).filter(Boolean);
}

type Plan =
  | { kind: 'create_meter'; capacity: string; parentId: string; childSku: string }
  | { kind: 'move_inv'; inventoryId: string; sku: string; fromAssetId: string; toAssetSku: string }
  | { kind: 'fix_typo'; inventoryId: string; fromSku: string; toSku: string }
  | { kind: 'create_inv'; capacity: string; sku: string; location: string; rowIdx: number; isTemp: boolean }
  | { kind: 'review'; rowIdx: number; reason: string; raw: string };

async function main() {
  console.log(`\n=== MBR meter-reading backfill ${APPLY ? '(APPLY)' : '(DRY RUN)'} ===\n`);

  // 1. Load canonical MBR parents (live, post-dedup).
  const parents = await prisma.asset.findMany({
    where: {
      organizationId: ORG_ID,
      deletedAt: null,
      skuKey: { startsWith: 'MBR-' },
    },
    select: { id: true, skuKey: true, name: true },
  });
  const parentBySku = new Map(parents.map((p) => [p.skuKey, p]));

  // 2. Load all existing inventories under those parents (these all migrate to METER children).
  const existingInv = await prisma.inventory.findMany({
    where: { organizationId: ORG_ID, asset: { skuKey: { startsWith: 'MBR-' }, deletedAt: null } },
    select: { id: true, sku: true, assetId: true, asset: { select: { skuKey: true } } },
  });

  // 3. Load existing METER-* children so we can be idempotent.
  const existingMeters = await prisma.asset.findMany({
    where: { organizationId: ORG_ID, deletedAt: null, skuKey: { startsWith: 'METER-' } },
    select: { id: true, skuKey: true, parentAssetId: true },
  });
  const meterBySku = new Map(existingMeters.map((m) => [m.skuKey, m]));

  // 4. Read Excel MBR rows.
  const wb = XLSX.readFile(EXCEL_PATH);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) as any[][];

  type ExcelMbr = { rowIdx: number; cust: string; item: string; serials: string[]; project: string; capacity: string | null };
  const excelMbrs: ExcelMbr[] = [];
  for (let i = 1; i < rows.length; i++) {
    const item = String(rows[i][1] || '').trim();
    if (!/MBR/i.test(item) || /Membrane/i.test(item)) continue;
    const cust = String(rows[i][0] || '').trim();
    const sno = String(rows[i][2] || '').trim();
    const project = String(rows[i][3] || '').trim();
    excelMbrs.push({ rowIdx: i, cust, item, serials: parseSerials(sno), project, capacity: extractCapacity(item) });
  }

  // 5. For generic MBR rows (no capacity), try to resolve via existing DB inventory.
  // For specific-capacity rows with blank serials, mint TEMP IDs.
  const plans: Plan[] = [];
  const tempCounter: Record<string, number> = {};
  const capacitiesNeedingMeter = new Set<string>(); // capacities where we'll create/use a METER child

  // First: every existing MBR-NN inventory implies its capacity needs a METER child.
  for (const inv of existingInv) {
    const cap = inv.asset.skuKey.replace('MBR-', '');
    capacitiesNeedingMeter.add(cap);
  }

  // Excel rows
  for (const row of excelMbrs) {
    if (row.capacity) {
      // Specific-capacity row.
      const parentSku = `MBR-${row.capacity}`;
      if (!parentBySku.has(parentSku)) {
        plans.push({ kind: 'review', rowIdx: row.rowIdx, reason: `no canonical ${parentSku} exists in DB`, raw: row.item });
        continue;
      }
      capacitiesNeedingMeter.add(row.capacity);

      if (row.serials.length === 0) {
        // Blank serial → TEMP ID.
        tempCounter[row.capacity] = (tempCounter[row.capacity] || 0) + 1;
        const sku = `TEMP-METER-${row.capacity}-${String(tempCounter[row.capacity]).padStart(3, '0')}`;
        plans.push({ kind: 'create_inv', capacity: row.capacity, sku, location: row.project, rowIdx: row.rowIdx, isTemp: true });
      } else {
        for (const sku of row.serials) {
          // If serial already exists in DB anywhere → it'll be migrated as part of step 2; nothing new to create.
          const existing = existingInv.find((i) => i.sku === sku);
          if (existing) continue; // will be migrated to METER child
          plans.push({ kind: 'create_inv', capacity: row.capacity, sku, location: row.project, rowIdx: row.rowIdx, isTemp: false });
        }
      }
    } else {
      // Generic "MBR" row — capacity must come from DB lookup on the serial.
      for (const sku of row.serials) {
        // Typo: Excel row 8 serial corresponds to a typo'd existing inv.
        if (sku === TYPO_FIX.toSku) {
          const typoInv = existingInv.find((i) => i.sku === TYPO_FIX.fromSku);
          if (typoInv) {
            plans.push({ kind: 'fix_typo', inventoryId: typoInv.id, fromSku: TYPO_FIX.fromSku, toSku: TYPO_FIX.toSku });
            // The typo'd inventory is already under MBR-NN (will migrate via the existing-inv loop).
            const cap = typoInv.asset.skuKey.replace('MBR-', '');
            capacitiesNeedingMeter.add(cap);
            continue;
          }
        }
        const dbHit = existingInv.find((i) => i.sku === sku);
        if (dbHit) {
          // Already in DB — capacity comes from the asset it currently sits under.
          // No new inventory to create; it'll migrate via the existing-inv loop.
          const cap = dbHit.asset.skuKey.replace('MBR-', '');
          capacitiesNeedingMeter.add(cap);
        } else {
          plans.push({
            kind: 'review',
            rowIdx: row.rowIdx,
            reason: `serial "${sku}" — no DB match and Excel item "MBR" has no capacity`,
            raw: `${row.cust} / ${row.project}`,
          });
        }
      }
    }
  }

  // 6. Plan METER child creations for every capacity that needs one (idempotent).
  for (const cap of capacitiesNeedingMeter) {
    const parentSku = `MBR-${cap}`;
    const parent = parentBySku.get(parentSku);
    if (!parent) continue;
    const childSku = `METER-${cap}`;
    if (meterBySku.has(childSku)) continue; // already exists
    plans.push({ kind: 'create_meter', capacity: cap, parentId: parent.id, childSku });
  }

  // 7. Plan inventory moves: every existing MBR-NN inv → its METER-NN child.
  for (const inv of existingInv) {
    const cap = inv.asset.skuKey.replace('MBR-', '');
    const childSku = `METER-${cap}`;
    // Skip if already under the child (re-run).
    const child = meterBySku.get(childSku);
    if (child && inv.assetId === child.id) continue;
    plans.push({
      kind: 'move_inv',
      inventoryId: inv.id,
      // SKU shown will be the post-fix value if this is the typo'd one.
      sku: inv.sku === TYPO_FIX.fromSku ? `${TYPO_FIX.toSku} (after typo fix)` : inv.sku,
      fromAssetId: inv.assetId,
      toAssetSku: childSku,
    });
  }

  // Print plans.
  console.log('=== ACTIONS PLANNED ===');
  const summary: Record<string, number> = {};
  for (const p of plans) summary[p.kind] = (summary[p.kind] || 0) + 1;
  console.log(JSON.stringify(summary, null, 2));

  console.log('\n--- create_meter ---');
  for (const p of plans.filter((x): x is Extract<Plan, { kind: 'create_meter' }> => x.kind === 'create_meter')) {
    console.log(`  ${p.childSku} under MBR-${p.capacity} (${p.parentId})`);
  }

  console.log('\n--- fix_typo ---');
  for (const p of plans.filter((x): x is Extract<Plan, { kind: 'fix_typo' }> => x.kind === 'fix_typo')) {
    console.log(`  inv ${p.inventoryId}: sku ${p.fromSku} → ${p.toSku}`);
  }

  console.log('\n--- move_inv ---');
  for (const p of plans.filter((x): x is Extract<Plan, { kind: 'move_inv' }> => x.kind === 'move_inv')) {
    console.log(`  ${p.sku} → ${p.toAssetSku} (inv ${p.inventoryId})`);
  }

  console.log('\n--- create_inv ---');
  for (const p of plans.filter((x): x is Extract<Plan, { kind: 'create_inv' }> => x.kind === 'create_inv')) {
    console.log(`  row ${p.rowIdx}: ${p.isTemp ? '[TEMP] ' : ''}${p.sku} → METER-${p.capacity} (loc="${p.location}")`);
  }

  console.log('\n--- review ---');
  for (const p of plans.filter((x): x is Extract<Plan, { kind: 'review' }> => x.kind === 'review')) {
    console.log(`  row ${p.rowIdx}: ${p.reason} — ${p.raw}`);
  }

  if (!APPLY) {
    console.log('\n[DRY RUN] No changes written. Re-run with --apply.');
    await prisma.$disconnect();
    return;
  }

  // ============ APPLY ============
  console.log('\n=== APPLYING ===');
  const applied = { meters_created: 0, typos_fixed: 0, inv_moved: 0, inv_created: 0 };

  await prisma.$transaction(
    async (tx) => {
      // 1. Create METER children first so we have IDs for the moves.
      const meterIdBySku = new Map(existingMeters.map((m) => [m.skuKey, m.id]));
      for (const p of plans.filter((x): x is Extract<Plan, { kind: 'create_meter' }> => x.kind === 'create_meter')) {
        // Re-check inside the txn for idempotency under retry.
        const existing = await tx.asset.findFirst({
          where: { organizationId: ORG_ID, skuKey: p.childSku, deletedAt: null },
          select: { id: true },
        });
        if (existing) {
          meterIdBySku.set(p.childSku, existing.id);
          continue;
        }
        const created = await tx.asset.create({
          data: {
            name: 'Meter Reading',
            skuKey: p.childSku,
            organizationId: ORG_ID,
            categoryId: WATER_TREATMENT_CATEGORY,
            parentAssetId: p.parentId,
            isTracked: true,
            isExternal: false,
            uom: 'PCS',
          },
          select: { id: true },
        });
        meterIdBySku.set(p.childSku, created.id);
        applied.meters_created++;
      }

      // 2. Fix typo SKU (before move, so we don't lose track of which inv it is).
      for (const p of plans.filter((x): x is Extract<Plan, { kind: 'fix_typo' }> => x.kind === 'fix_typo')) {
        const clash = await tx.inventory.findFirst({
          where: { organizationId: ORG_ID, sku: p.toSku, id: { not: p.inventoryId } },
          select: { id: true },
        });
        if (clash) {
          console.error(`  SKIP typo fix: another inventory already has sku ${p.toSku}`);
          continue;
        }
        await tx.inventory.update({ where: { id: p.inventoryId }, data: { sku: p.toSku } });
        applied.typos_fixed++;
      }

      // 3. Move existing inventories to METER children.
      for (const p of plans.filter((x): x is Extract<Plan, { kind: 'move_inv' }> => x.kind === 'move_inv')) {
        const toId = meterIdBySku.get(p.toAssetSku);
        if (!toId) throw new Error(`No METER asset for ${p.toAssetSku}`);
        const cur = await tx.inventory.findUnique({ where: { id: p.inventoryId }, select: { assetId: true } });
        if (!cur || cur.assetId === toId) continue;
        await tx.inventory.update({ where: { id: p.inventoryId }, data: { assetId: toId } });
        applied.inv_moved++;
      }

      // 4. Create new inventories from Excel.
      for (const p of plans.filter((x): x is Extract<Plan, { kind: 'create_inv' }> => x.kind === 'create_inv')) {
        const toId = meterIdBySku.get(`METER-${p.capacity}`);
        if (!toId) throw new Error(`No METER asset for METER-${p.capacity}`);
        const exists = await tx.inventory.findFirst({
          where: { organizationId: ORG_ID, sku: p.sku },
          select: { id: true },
        });
        if (exists) continue;
        await tx.inventory.create({
          data: {
            assetId: toId,
            sku: p.sku,
            category: 'Water Treatment',
            status: 'rental',
            organizationId: ORG_ID,
            location: p.location || null,
          },
        });
        applied.inv_created++;
      }
    },
    { timeout: 60_000 },
  );

  console.log('\nApplied:', JSON.stringify(applied, null, 2));
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
