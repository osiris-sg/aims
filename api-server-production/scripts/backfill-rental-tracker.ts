/**
 * Backfill Biofuel inventory from the Rental Tracker Excel.
 *
 * Dry-run (default):
 *   npx dotenv -e .env -- npx ts-node scripts/backfill-rental-tracker.ts
 * Apply:
 *   npx dotenv -e .env -- npx ts-node scripts/backfill-rental-tracker.ts --apply
 */

import { PrismaClient } from '@prisma/client';
import * as path from 'path';

// xlsx isn't a dep of api-server-production; reuse portal-production's copy.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const XLSX: any = require(path.resolve(
  __dirname,
  '..',
  '..',
  'portal-production',
  'node_modules',
  'xlsx',
));

const ORG_ID = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
const EQUIPMENT_CATEGORY_ID = 'eb4f91c0-d46b-44c1-b129-f1a899f9d2fa';
const EXCEL_PATH = path.resolve(__dirname, 'Rental Tracker.xlsx');
const APPLY = process.argv.includes('--apply');

type Norm = { skuKey: string; tracked: boolean };

function normalize(itemRaw: string): Norm | null {
  const s = (itemRaw || '').trim().replace(/\s+/g, ' ');
  if (!s) return null;
  if (/40,000 square feet/i.test(s)) return null;

  // Untracked product types — return tracked=false so caller can skip.
  if (/genset/i.test(s) && !/lion/i.test(s)) return { skuKey: 'GENSET', tracked: false };
  if (/MBR/i.test(s)) return { skuKey: 'MBR', tracked: false };
  if (/TSS/i.test(s) && !/SIDS/i.test(s)) return { skuKey: 'TSS', tracked: false };

  // Tracked product types — order matters: more-specific first.
  if (/600.?Amp.*DB/i.test(s)) return { skuKey: 'DBBOX600', tracked: true };
  if (/DB\s*Box/i.test(s)) return { skuKey: 'DBBOX', tracked: true };
  if (/LION\s*375/i.test(s)) return { skuKey: 'LION375', tracked: true };
  if (/LION\s*500/i.test(s)) return { skuKey: 'LION500', tracked: true };
  if (/AF.?100/i.test(s)) return { skuKey: 'AF100', tracked: true };
  if (/AF.?40/i.test(s)) return { skuKey: 'AF40', tracked: true };
  if (/AF.?60/i.test(s)) return { skuKey: 'AF60', tracked: true };
  if (/APF.?60/i.test(s)) return { skuKey: 'APF60', tracked: true };
  if (/APF.?90/i.test(s)) return { skuKey: 'APF90', tracked: true };
  if (/SIDS/i.test(s)) return { skuKey: 'SIDS', tracked: true };
  if (/ECM.?30/i.test(s)) return { skuKey: 'ECM30', tracked: true };
  if (/20.?Ton.*excavator/i.test(s)) return { skuKey: 'EXCAVATOR20T', tracked: true };
  if (/23.?T.*Excavator/i.test(s)) return { skuKey: 'EXCAVATOR23T', tracked: true };
  if (/ISO\s*Tank/i.test(s)) return { skuKey: 'ISOTANK', tracked: true };

  return null;
}

function parseSerials(raw: string): string[] {
  const s = String(raw || '').trim();
  if (!s) return [];
  // Pipe: take only first part — second is an untracked Genset serial.
  if (s.includes('|')) return [s.split('|')[0].trim()].filter(Boolean);
  // Newline, comma, ampersand: split into atomic serials.
  return s
    .split(/[\n\r,&]/)
    .map((x) => x.trim())
    .filter(Boolean);
}

function isSidsTssCombo(item: string): boolean {
  return /SIDS/i.test(item) && /TSS/i.test(item);
}

type Plan =
  | { kind: 'match'; rowIdx: number; serial: string; inventoryId: string; assetId: string; assetName: string }
  | { kind: 'create_inv'; rowIdx: number; serial: string; assetId: string; assetSkuKey: string; location: string }
  | { kind: 'create_asset_and_inv'; rowIdx: number; serial: string; skuKey: string; location: string }
  | {
      kind: 'reassign_inv';
      rowIdx: number;
      serial: string;
      inventoryId: string;
      sourceAssetName: string;
      sourceAssetSkuKey: string;
      targetSkuKey: string;
      targetAssetId: string | null; // null until resolved (or until apply creates it)
    }
  | { kind: 'skip'; rowIdx: number; reason: string; raw: string }
  | { kind: 'review'; rowIdx: number; reason: string; raw: string };

async function main() {
  const prisma = new PrismaClient();

  const wb = XLSX.readFile(EXCEL_PATH);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) as any[][];

  const tempCounter: Record<string, number> = {};
  const plannedSerials = new Set<string>(); // dedupe within this run
  const initial: Plan[] = [];
  let lastTrackedSkuKey: string | null = null; // for blank-item continuation rows

  for (let i = 1; i < rows.length; i++) {
    const itemRaw = String(rows[i][1] || '').trim();
    const snoRaw = String(rows[i][2] || '').trim();
    const projRaw = String(rows[i][3] || '').trim();

    if (!itemRaw && !snoRaw) {
      initial.push({ kind: 'skip', rowIdx: i, reason: 'placeholder row (no item, no serial)', raw: '' });
      continue;
    }
    if (/40,000 square feet/i.test(itemRaw)) {
      initial.push({ kind: 'skip', rowIdx: i, reason: '40,000 sqft yard rental', raw: itemRaw });
      continue;
    }

    const targetItem = isSidsTssCombo(itemRaw) ? 'SIDS' : itemRaw;
    const norm = itemRaw ? normalize(targetItem) : null;

    // Empty item + serial present: continuation row in Excel (label inherited
    // from the most recent tracked-item row above). Use the inherited type to
    // route the serial through the standard match-or-create pipeline.
    if (!itemRaw && snoRaw) {
      // Manual "old -> new" note in the serial cell — can't auto-process; skip entirely.
      if (/->/.test(snoRaw)) {
        initial.push({ kind: 'skip', rowIdx: i, reason: `serial cell contains 'old -> new' note`, raw: snoRaw });
        continue;
      }
      const inheritedSku = lastTrackedSkuKey;
      const serials = parseSerials(snoRaw);
      for (const serial of serials) {
        if (plannedSerials.has(serial)) {
          initial.push({ kind: 'skip', rowIdx: i, reason: `duplicate serial ${serial} within Excel`, raw: '' });
          continue;
        }
        plannedSerials.add(serial);
        initial.push({
          kind: 'create_inv',
          rowIdx: i,
          serial,
          assetId: '',
          // If no recent tracked item, fall back to __UNKNOWN__ (will resolve to MATCH if
          // the serial exists in DB, else REVIEW).
          assetSkuKey: inheritedSku ?? '__UNKNOWN__',
          location: projRaw,
        });
      }
      continue;
    }

    if (!norm) {
      initial.push({ kind: 'review', rowIdx: i, reason: 'unmapped item', raw: itemRaw });
      continue;
    }
    if (!norm.tracked) {
      initial.push({ kind: 'skip', rowIdx: i, reason: `untracked product (${norm.skuKey})`, raw: itemRaw });
      continue;
    }

    // Remember the last tracked sku for continuation rows below.
    lastTrackedSkuKey = norm.skuKey;

    let serials = parseSerials(snoRaw);
    if (serials.length === 0) {
      tempCounter[norm.skuKey] = (tempCounter[norm.skuKey] || 0) + 1;
      serials = [`TEMP-${norm.skuKey}-${String(tempCounter[norm.skuKey]).padStart(3, '0')}`];
    }

    for (const serial of serials) {
      if (plannedSerials.has(serial)) {
        initial.push({ kind: 'skip', rowIdx: i, reason: `duplicate serial ${serial} within Excel`, raw: itemRaw });
        continue;
      }
      plannedSerials.add(serial);
      initial.push({
        kind: 'create_inv',
        rowIdx: i,
        serial,
        assetId: '',
        assetSkuKey: norm.skuKey,
        location: projRaw,
      });
    }
  }

  // Resolve serials against existing Inventory.
  const allSerials = initial.filter((p) => p.kind === 'create_inv').map((p) => (p as any).serial);
  const existingInv = await prisma.inventory.findMany({
    where: { organizationId: ORG_ID, sku: { in: allSerials } },
    select: {
      id: true,
      sku: true,
      asset: { select: { id: true, name: true, skuKey: true } },
    },
  });
  const invBySku = new Map(existingInv.map((x) => [x.sku, x]));

  const requiredSkuKeys = new Set<string>();
  const assetsToFlag = new Set<string>(); // existing assetIds → isExternal=false (TARGET assets only)
  const newAssetSkus = new Set<string>(); // target skuKeys to create

  // Phase 1: resolve serials against existing Inventory.
  // Excel is source of truth — if DB has the serial under a different asset
  // than Excel expects, plan a REASSIGN. Source asset is left alone; target
  // asset is what gets flagged isExternal=false.
  const stage2: Plan[] = [];
  for (const p of initial) {
    if (p.kind !== 'create_inv') {
      stage2.push(p);
      continue;
    }
    const m = invBySku.get(p.serial);
    if (!m) {
      if (p.assetSkuKey === '__UNKNOWN__') {
        // No Excel item type AND serial not in DB — can't infer asset.
        stage2.push({
          kind: 'review',
          rowIdx: p.rowIdx,
          reason: `serial "${p.serial}" not in DB and no inherited item type`,
          raw: '',
        });
      } else {
        requiredSkuKeys.add(p.assetSkuKey);
        stage2.push(p);
      }
      continue;
    }

    // Serial in DB.
    if (p.assetSkuKey === '__UNKNOWN__' || p.assetSkuKey === m.asset.skuKey) {
      // Excel agrees with DB (or has nothing to say) — straight match.
      assetsToFlag.add(m.asset.id);
      stage2.push({
        kind: 'match',
        rowIdx: p.rowIdx,
        serial: p.serial,
        inventoryId: m.id,
        assetId: m.asset.id,
        assetName: m.asset.name,
      });
    } else {
      // Excel disagrees with DB → reassign to the Excel-expected asset.
      // Target asset gets flagged (resolved/added in phase 2); source is
      // intentionally left alone.
      requiredSkuKeys.add(p.assetSkuKey);
      stage2.push({
        kind: 'reassign_inv',
        rowIdx: p.rowIdx,
        serial: p.serial,
        inventoryId: m.id,
        sourceAssetName: m.asset.name.trim(),
        sourceAssetSkuKey: m.asset.skuKey,
        targetSkuKey: p.assetSkuKey,
        targetAssetId: null,
      });
    }
  }

  // Phase 2: resolve target assets we need but might not exist.
  const existingAssets = await prisma.asset.findMany({
    where: { organizationId: ORG_ID, skuKey: { in: [...requiredSkuKeys] } },
    select: { id: true, name: true, skuKey: true },
  });
  const assetBySku = new Map(existingAssets.map((a) => [a.skuKey, a]));

  const finalPlans: Plan[] = [];
  for (const p of stage2) {
    if (p.kind === 'create_inv') {
      const a = assetBySku.get(p.assetSkuKey);
      if (a) {
        assetsToFlag.add(a.id);
        finalPlans.push({ ...p, assetId: a.id });
      } else {
        newAssetSkus.add(p.assetSkuKey);
        finalPlans.push({
          kind: 'create_asset_and_inv',
          rowIdx: p.rowIdx,
          serial: p.serial,
          skuKey: p.assetSkuKey,
          location: p.location,
        });
      }
    } else if (p.kind === 'reassign_inv') {
      const a = assetBySku.get(p.targetSkuKey);
      if (a) {
        assetsToFlag.add(a.id);
        finalPlans.push({ ...p, targetAssetId: a.id });
      } else {
        newAssetSkus.add(p.targetSkuKey);
        finalPlans.push(p); // targetAssetId stays null; resolved at apply
      }
    } else {
      finalPlans.push(p);
    }
  }

  // Plan output
  const counts = { match: 0, reassign_inv: 0, create_inv: 0, create_asset_and_inv: 0, skip: 0, review: 0 };
  for (const p of finalPlans) (counts as any)[p.kind]++;

  console.log('\n=== Excel rows processed:', rows.length - 1, '===');
  console.log('\n=== PLAN SUMMARY ===');
  console.log(JSON.stringify(counts, null, 2));

  // Resolve ALL flagged assets for display (not just the skuKey-lookup set — also includes
  // assets matched via existing-inventory serial lookup, which may have skuKeys we never queried).
  const allFlaggedAssets = await prisma.asset.findMany({
    where: { id: { in: [...assetsToFlag] } },
    select: { id: true, name: true, skuKey: true, isExternal: true },
  });
  console.log('\n=== Assets flagged isExternal=false ===');
  for (const a of allFlaggedAssets) {
    const marker = a.isExternal === false ? ' [already internal]' : '';
    console.log(`  EXISTING: ${a.name.trim()} (skuKey=${a.skuKey}, id=${a.id})${marker}`);
  }
  for (const sku of newAssetSkus) {
    console.log(`  NEW:      ${sku}`);
  }

  console.log('\n=== Reassignments planned (Excel disagrees with DB; Excel wins) ===');
  const reassigns = finalPlans.filter((p): p is Extract<Plan, { kind: 'reassign_inv' }> => p.kind === 'reassign_inv');
  if (reassigns.length === 0) console.log('  (none)');
  for (const r of reassigns) {
    console.log(
      `  row ${r.rowIdx}: serial "${r.serial}" — moving inv from ${r.sourceAssetSkuKey} ("${r.sourceAssetName}") → ${r.targetSkuKey}`,
    );
  }

  console.log('\n=== Items requiring manual review ===');
  const reviews = finalPlans.filter((p) => p.kind === 'review');
  if (reviews.length === 0) console.log('  (none)');
  for (const r of reviews) {
    console.log(`  row ${r.rowIdx}: ${(r as any).reason}${(r as any).raw ? ` — raw="${(r as any).raw}"` : ''}`);
  }

  console.log('\n=== Full plan (per serial) ===');
  for (const p of finalPlans) {
    if (p.kind === 'match') {
      console.log(`row ${p.rowIdx}: MATCH    ${p.serial} → inv ${p.inventoryId} (asset ${p.assetName.trim()})`);
    } else if (p.kind === 'reassign_inv') {
      console.log(
        `row ${p.rowIdx}: REASSIGN ${p.serial} → inv ${p.inventoryId} from ${p.sourceAssetSkuKey} → ${p.targetSkuKey}`,
      );
    } else if (p.kind === 'create_inv') {
      console.log(`row ${p.rowIdx}: CREATE   ${p.serial} → new Inventory under ${p.assetSkuKey} (loc="${p.location}")`);
    } else if (p.kind === 'create_asset_and_inv') {
      console.log(`row ${p.rowIdx}: CREATE   ${p.serial} → new Asset ${p.skuKey} + new Inventory (loc="${p.location}")`);
    } else if (p.kind === 'skip') {
      console.log(`row ${p.rowIdx}: SKIP     ${p.reason}${p.raw ? ` — "${p.raw}"` : ''}`);
    } else if (p.kind === 'review') {
      console.log(`row ${p.rowIdx}: REVIEW   ${p.reason}${p.raw ? ` — "${p.raw}"` : ''}`);
    }
  }

  if (!APPLY) {
    console.log('\n[DRY RUN] No changes written. Re-run with --apply to commit changes.');
    await prisma.$disconnect();
    return;
  }

  // ============ APPLY ============
  console.log('\n=== APPLYING ===');
  const applied = { matched: 0, reassigned: 0, created_assets: 0, created_inv: 0, flagged_assets: 0 };

  await prisma.$transaction(
    async (tx) => {
      // Create new target assets first so we have IDs.
      const createdAssetBySku = new Map<string, string>();
      for (const sku of newAssetSkus) {
        const existing = await tx.asset.findFirst({
          where: { organizationId: ORG_ID, skuKey: sku, deletedAt: null },
          select: { id: true },
        });
        if (existing) {
          createdAssetBySku.set(sku, existing.id);
          assetsToFlag.add(existing.id);
          continue;
        }
        const a = await tx.asset.create({
          data: {
            name: sku,
            skuKey: sku,
            organizationId: ORG_ID,
            categoryId: EQUIPMENT_CATEGORY_ID,
            isTracked: true,
            isExternal: false,
          },
        });
        createdAssetBySku.set(sku, a.id);
        applied.created_assets++;
      }

      const resolveTargetId = (skuKey: string, fallback: string | null): string => {
        if (fallback) return fallback;
        const id = createdAssetBySku.get(skuKey);
        if (!id) throw new Error(`Target asset not resolved: ${skuKey}`);
        return id;
      };

      for (const p of finalPlans) {
        if (p.kind === 'match') {
          applied.matched++;
          continue;
        }
        if (p.kind === 'reassign_inv') {
          const targetId = resolveTargetId(p.targetSkuKey, p.targetAssetId);
          // Idempotent: if inventory already points at target, do nothing.
          const inv = await tx.inventory.findUnique({
            where: { id: p.inventoryId },
            select: { assetId: true },
          });
          if (!inv) continue;
          if (inv.assetId === targetId) continue;
          await tx.inventory.update({
            where: { id: p.inventoryId },
            data: { assetId: targetId },
          });
          applied.reassigned++;
          continue;
        }
        if (p.kind === 'create_inv' || p.kind === 'create_asset_and_inv') {
          const assetId =
            p.kind === 'create_inv' ? p.assetId : createdAssetBySku.get(p.skuKey)!;
          const exists = await tx.inventory.findFirst({
            where: { organizationId: ORG_ID, sku: p.serial },
            select: { id: true },
          });
          if (exists) continue; // idempotent
          await tx.inventory.create({
            data: {
              assetId,
              sku: p.serial,
              category: 'Equipment',
              status: 'rental',
              organizationId: ORG_ID,
              location: p.location || null,
            },
          });
          applied.created_inv++;
        }
      }

      if (assetsToFlag.size > 0) {
        const res = await tx.asset.updateMany({
          where: { id: { in: [...assetsToFlag] } },
          data: { isExternal: false },
        });
        applied.flagged_assets = res.count;
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
