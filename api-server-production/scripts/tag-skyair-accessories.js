require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const ORG = '59802f75-262b-4f96-b8b2-09a9a071d882';

// Default accessories to auto-add with each Sky Air FCU (panel + WIRED remote).
// Cassette = panel BYCQ125EAF-S + BRC1E63-S; Streamer = panel + BRC1H63W (white);
// Ceiling / Duct = wired remote only (no decoration panel).
(async () => {
  const accBy = {};
  for (const sku of ['BYCQ125EAF-S', 'BRC1E63-S', 'BRC1H63W']) {
    const a = await prisma.asset.findFirst({ where: { skuKey: sku, organizationId: ORG, deletedAt: null }, select: { id: true } });
    if (!a) throw new Error(`Accessory ${sku} not found`);
    accBy[sku] = a.id;
  }

  const accForFcu = (sku) => {
    if (/^FCTF/.test(sku)) return [accBy['BYCQ125EAF-S'], accBy['BRC1H63W']];     // streamer cassette
    if (/^FC/.test(sku))   return [accBy['BYCQ125EAF-S'], accBy['BRC1E63-S']];     // cassette FCF/FCFC/FCFV
    if (/^FH/.test(sku))   return [accBy['BRC1E63-S']];                            // ceiling suspended
    if (/^FB/.test(sku))   return [accBy['BRC1E63-S']];                            // ducted
    return null; // not a Sky Air FCU
  };

  const fcus = await prisma.asset.findMany({
    where: { organizationId: ORG, deletedAt: null, category: { name: 'Fan Coil Unit' } },
    select: { id: true, skuKey: true },
  });

  let tagged = 0;
  for (const f of fcus) {
    const acc = accForFcu(f.skuKey);
    if (!acc) continue; // skip RKM/MKM FCUs
    await prisma.asset.update({ where: { id: f.id }, data: { accessoryIds: acc } });
    tagged++;
    console.log(`  ${f.skuKey.padEnd(13)} -> [${acc.length} accessory(ies)]`);
  }
  console.log(`\nTagged ${tagged} Sky Air FCUs.`);
  await prisma.$disconnect();
})().catch(async (e) => { console.error('ERROR:', e.message); await prisma.$disconnect(); process.exit(1); });
