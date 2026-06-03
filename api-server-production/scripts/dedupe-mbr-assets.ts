/**
 * Dedupe/normalize MBR / Membrane assets in Biofuel.
 *
 * Dry-run (default):
 *   npx dotenv -e .env -- npx ts-node scripts/dedupe-mbr-assets.ts
 * Apply:
 *   npx dotenv -e .env -- npx ts-node scripts/dedupe-mbr-assets.ts --apply
 *
 * Context: a prior dedup pass on 2026-05-25 already soft-deleted 11 of the 27
 * MBR/Membrane variants. This script finishes the job on the remaining live
 * rows — no cross-asset inventory moves are needed because each capacity now
 * has exactly one live asset (sometimes still in the wrong skuKey format).
 *
 * Rules:
 *   - Each capacity has ONE canonical asset with dash format: MBR-NN.
 *   - Canonical name format: "Membrane NN-Capacity".
 *   - Canonical category: Water Treatment.
 *   - Canonical isExternal=false.
 *   - Live non-capacity assets (MBR-4050 hybrid, MBR02 "Membrane-02",
 *     PDVFMEMBRANE typo) → soft-delete.
 *   - MBR-120150 hybrid kept as-is (per user).
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const ORG_ID = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
const WATER_TREATMENT_CATEGORY = '721cb6e1-6e70-40d2-aa0d-b7668393eaad';
const APPLY = process.argv.includes('--apply');

type CapacityPlan = {
  capacity: string;
  liveAssetId: string;
  canonicalSkuKey: string;
  canonicalName: string;
};

const CAPACITY_PLANS: CapacityPlan[] = [
  { capacity: '10',  liveAssetId: '9ec05e05-e257-415e-a779-9dfd2b1781ba', canonicalSkuKey: 'MBR-10',  canonicalName: 'Membrane 10-Capacity' },
  { capacity: '15',  liveAssetId: 'aed5a74e-f80c-44b1-ab22-5877511d9e9e', canonicalSkuKey: 'MBR-15',  canonicalName: 'Membrane 15-Capacity' },
  { capacity: '20',  liveAssetId: 'b50eb24e-7766-498f-b6ec-370ce86d0844', canonicalSkuKey: 'MBR-20',  canonicalName: 'Membrane 20-Capacity' },
  { capacity: '30',  liveAssetId: '7dacad13-8cc1-4317-aed3-4f048642f238', canonicalSkuKey: 'MBR-30',  canonicalName: 'Membrane 30-Capacity' },
  { capacity: '40',  liveAssetId: '432f7d53-ef62-4d25-bab5-a8efd4458ce6', canonicalSkuKey: 'MBR-40',  canonicalName: 'Membrane 40-Capacity' },
  { capacity: '50',  liveAssetId: '33bafc4c-d3be-4202-8a2b-ed6648b5d3fb', canonicalSkuKey: 'MBR-50',  canonicalName: 'Membrane 50-Capacity' },
  { capacity: '60',  liveAssetId: 'bac77780-e614-41ea-a478-ce9a587a2c00', canonicalSkuKey: 'MBR-60',  canonicalName: 'Membrane 60-Capacity' },
  { capacity: '100', liveAssetId: '4a5514ed-0081-42cb-ab2f-48cebc602e47', canonicalSkuKey: 'MBR-100', canonicalName: 'Membrane 100-Capacity' },
  { capacity: '120', liveAssetId: '6c283057-7830-40e0-950f-a3bb46411065', canonicalSkuKey: 'MBR-120', canonicalName: 'Membrane 120-Capacity' },
  { capacity: '150', liveAssetId: '4ee19e38-eadf-4b12-abdf-b531b4851bb4', canonicalSkuKey: 'MBR-150', canonicalName: 'Membrane 150-Capacity' },
];

const STANDALONE_DELETES = [
  { id: '56a7b357-a9b0-4b52-9baa-65056f100421', expectedSkuKey: 'MBR-4050',     reason: 'hybrid 40/50 with 0 inv — superseded by MBR-40 and MBR-50' },
  { id: '55c10722-3170-43ba-9dc9-2a585bbee37d', expectedSkuKey: 'MBR02',        reason: '"Membrane-02" — not a capacity (series/version label)' },
  { id: 'e71ac261-aefd-4f9b-ad96-16e96b5c8b27', expectedSkuKey: 'PDVFMEMBRANE', reason: 'typo of PVDF-MEMBRANE' },
];

async function main() {
  console.log(`\n=== MBR dedupe/normalize ${APPLY ? '(APPLY)' : '(DRY RUN)'} ===\n`);

  const allIds = [...CAPACITY_PLANS.map((p) => p.liveAssetId), ...STANDALONE_DELETES.map((s) => s.id)];
  const current = await prisma.asset.findMany({
    where: { id: { in: allIds } },
    select: {
      id: true, name: true, skuKey: true, categoryId: true, isExternal: true, deletedAt: true,
      _count: { select: { inventories: true, subAssets: true } },
    },
  });
  const byId = new Map(current.map((a) => [a.id, a]));

  type Action =
    | {
        kind: 'normalize';
        id: string;
        capacity: string;
        changes: { field: string; from: string; to: string }[];
        newSkuKey: string;
        newName: string;
      }
    | { kind: 'soft_delete'; id: string; skuKey: string; reason: string };
  const actions: Action[] = [];
  const warnings: string[] = [];

  for (const p of CAPACITY_PLANS) {
    const a = byId.get(p.liveAssetId);
    if (!a) {
      warnings.push(`capacity ${p.capacity}: id ${p.liveAssetId} not found`);
      continue;
    }
    if (a.deletedAt) {
      warnings.push(`capacity ${p.capacity}: ${a.skuKey} (${p.liveAssetId}) unexpectedly soft-deleted — skipping`);
      continue;
    }
    const changes: { field: string; from: string; to: string }[] = [];
    if (a.skuKey !== p.canonicalSkuKey) changes.push({ field: 'skuKey', from: a.skuKey, to: p.canonicalSkuKey });
    if (a.name.trim() !== p.canonicalName) changes.push({ field: 'name', from: a.name.trim(), to: p.canonicalName });
    if (a.categoryId !== WATER_TREATMENT_CATEGORY) changes.push({ field: 'category', from: a.categoryId.slice(0, 8), to: 'Water Treatment' });
    if (a.isExternal) changes.push({ field: 'isExternal', from: 'true', to: 'false' });
    if (changes.length === 0) continue;
    actions.push({
      kind: 'normalize',
      id: p.liveAssetId,
      capacity: p.capacity,
      changes,
      newSkuKey: p.canonicalSkuKey,
      newName: p.canonicalName,
    });
  }

  for (const s of STANDALONE_DELETES) {
    const a = byId.get(s.id);
    if (!a) {
      warnings.push(`standalone ${s.expectedSkuKey} (${s.id}) not found`);
      continue;
    }
    if (a.deletedAt) {
      warnings.push(`standalone ${s.expectedSkuKey} (${s.id}) already soft-deleted — skipping`);
      continue;
    }
    if (a._count.inventories > 0 || a._count.subAssets > 0) {
      warnings.push(
        `standalone ${a.skuKey} (${s.id}) has ${a._count.inventories} inventories and ${a._count.subAssets} sub-assets — NOT auto-deleting`,
      );
      continue;
    }
    actions.push({ kind: 'soft_delete', id: s.id, skuKey: a.skuKey, reason: s.reason });
  }

  console.log('=== ACTIONS PLANNED ===');
  for (const a of actions) {
    if (a.kind === 'normalize') {
      console.log(`  NORMALIZE   capacity ${a.capacity.padEnd(3)} (${a.id.slice(0, 8)}): ${a.changes.map((c) => `${c.field} ${c.from} → ${c.to}`).join(', ')}`);
    } else {
      console.log(`  SOFT_DELETE ${a.skuKey} (${a.id.slice(0, 8)}): ${a.reason}`);
    }
  }

  console.log('\n=== WARNINGS ===');
  if (warnings.length === 0) console.log('  (none)');
  for (const w of warnings) console.log(`  ${w}`);

  console.log('\n=== Live MBR set after apply ===');
  for (const p of CAPACITY_PLANS) {
    const a = byId.get(p.liveAssetId);
    console.log(`  MBR-${p.capacity.padEnd(3)} → ${a?.id.slice(0, 8)} (${a?._count.inventories ?? 0} inv)`);
  }
  console.log('  MBR-120150     → 1b668b1e (hybrid, 1 inv, untouched)');
  console.log('  MEMBRANE-RACK  → 3d50673b (only live, 0 inv)');
  console.log('  PVDF-MEMBRANE  → 9ac6bf7a (only canonical kept, 0 inv)');

  if (!APPLY) {
    console.log('\n[DRY RUN] No changes written. Re-run with --apply.');
    await prisma.$disconnect();
    return;
  }

  console.log('\n=== APPLYING ===');
  const applied = { normalized: 0, soft_deleted: 0 };
  await prisma.$transaction(
    async (tx) => {
      for (const a of actions) {
        if (a.kind === 'normalize') {
          await tx.asset.update({
            where: { id: a.id },
            data: { skuKey: a.newSkuKey, name: a.newName, categoryId: WATER_TREATMENT_CATEGORY, isExternal: false },
          });
          applied.normalized++;
        } else {
          await tx.asset.update({ where: { id: a.id }, data: { deletedAt: new Date() } });
          applied.soft_deleted++;
        }
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
