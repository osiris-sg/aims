require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const ORG = '59802f75-262b-4f96-b8b2-09a9a071d882'; // Cappitech Engineering Pte. Ltd.

// Points per asset (1 point = $1). From the "Points Update: Multi & Single" sheet.
// Single-split: the pair shares one value -> stored on the CU (RKM parent); the
// FTKM child stays 0 so the paired/combined line counts it once.
const POINTS = {
  RKM25ZVMG: 20, RKM35ZVMG: 20, RKM50ZVMG: 20, RKM60ZVMG: 20, RKM71ZVMG: 20,
  CTKM25ZVMG: 60, CTKM35ZVMG: 60, CTKM50ZVMG: 60, CTKM60ZVMG: 60, CTKM71ZVMG: 60,
  MKM50ZVMG: 700, MKM75ZVMG: 700, MKM85ZVMG: 700, MKM100ZVMG: 700,
};

(async () => {
  // 1) Enable the enableAssetPoints feature flag (lives in OrganizationUIConfig.features).
  const cfg = await prisma.organizationUIConfig.findUnique({ where: { organizationId: ORG } });
  const features = { ...((cfg && cfg.features) || {}), enableAssetPoints: true };
  await prisma.organizationUIConfig.upsert({
    where: { organizationId: ORG },
    update: { features },
    create: { organizationId: ORG, features },
  });
  console.log(`enableAssetPoints = true (uiConfig ${cfg ? 'updated' : 'created'})`);
  console.log('features now:', JSON.stringify(features));

  // 2) Set points on the listed assets.
  console.log('\nSetting points:');
  let total = 0;
  for (const [sku, pts] of Object.entries(POINTS)) {
    const r = await prisma.asset.updateMany({
      where: { skuKey: sku, organizationId: ORG, deletedAt: null },
      data: { points: pts },
    });
    console.log(`  ${sku.padEnd(12)} -> ${String(pts).padStart(3)}  (${r.count === 1 ? 'ok' : 'NOT FOUND'})`);
    total += r.count;
  }
  console.log(`\nUpdated ${total}/${Object.keys(POINTS).length} assets.`);

  // 3) Report assets WITHOUT points (CDKM/FDMF/SET — not on the sheet).
  const noPts = await prisma.asset.findMany({
    where: { organizationId: ORG, deletedAt: null, OR: [{ points: null }, { points: 0 }] },
    select: { skuKey: true }, orderBy: { skuKey: 'asc' },
  });
  console.log(`\nAssets still without points (${noPts.length}): ${noPts.map(a => a.skuKey).join(', ')}`);
  await prisma.$disconnect();
})().catch(async (e) => { console.error('ERROR:', e.message); await prisma.$disconnect(); process.exit(1); });
