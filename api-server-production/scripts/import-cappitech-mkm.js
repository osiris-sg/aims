require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const ORG_ID = '59802f75-262b-4f96-b8b2-09a9a071d882'; // Cappitech Engineering Pte. Ltd.

// Sheet 2: MKM-ZVMG — R32 iSmileEco Inverter MULTI-split.
// Flat catalog (no hierarchy): mix-and-match CU + indoor units.
// base price = List; "Discount Price" custom = Dealer column.
// Excluded: the "LESS POINTS ONLY" table, accessories (per decision).

const CU_DESC   = 'R32 iSmileEco Inverter Multi Condensing Unit (MKM-ZVMG)';
const WALL_DESC = 'R32 iSmileEco Inverter Multi — Wall-mounted Fan Coil Unit (CTKM-ZVMG)';
const CDKM_DESC = 'R32 iSmileEco Inverter Multi — Ducted Fan Coil Unit (CDKM-VVMG)';
const FDMF_W_DESC  = 'R32 iSmileEco Inverter Multi — Ducted Fan Coil Unit (FDMF-VVMG) — Wired Remote Controller (BRC1E63)';
const FDMF_WL_DESC = 'R32 iSmileEco Inverter Multi — Ducted Fan Coil Unit (FDMF-VVMG) — Wireless Controllers (BRC086A22 & BRC086AR1)';

// { sku, list, discount, cat: 'CU'|'FCU', desc }
const PRODUCTS = [
  // Condensing Units
  { sku: 'MKM50ZVMG',  list: 2364, discount: 1605, cat: 'CU', desc: CU_DESC },
  { sku: 'MKM75ZVMG',  list: 2632, discount: 1945, cat: 'CU', desc: CU_DESC },
  { sku: 'MKM85ZVMG',  list: 2855, discount: 2008, cat: 'CU', desc: CU_DESC },
  { sku: 'MKM100ZVMG', list: 3513, discount: 2502, cat: 'CU', desc: CU_DESC },

  // Indoor — Wall mounted (CTKM-ZVMG)
  { sku: 'CTKM25ZVMG', list: 519, discount: 412, cat: 'FCU', desc: WALL_DESC },
  { sku: 'CTKM35ZVMG', list: 586, discount: 466, cat: 'FCU', desc: WALL_DESC },
  { sku: 'CTKM50ZVMG', list: 684, discount: 543, cat: 'FCU', desc: WALL_DESC },
  { sku: 'CTKM60ZVMG', list: 753, discount: 599, cat: 'FCU', desc: WALL_DESC },
  { sku: 'CTKM71ZVMG', list: 809, discount: 644, cat: 'FCU', desc: WALL_DESC },

  // Indoor — Ducted (CDKM-VVMG)
  { sku: 'CDKM25VVMG', list: 838,  discount: 671,  cat: 'FCU', desc: CDKM_DESC },
  { sku: 'CDKM35VVMG', list: 1072, discount: 857,  cat: 'FCU', desc: CDKM_DESC },
  { sku: 'CDKM50VVMG', list: 1190, discount: 952,  cat: 'FCU', desc: CDKM_DESC },
  { sku: 'CDKM60VVMG', list: 1301, discount: 1041, cat: 'FCU', desc: CDKM_DESC },

  // Indoor — Ducted (FDMF-VVMG) — Wired (-W)
  { sku: 'FDMF50VVMG-W', list: 1515, discount: 1211, cat: 'FCU', desc: FDMF_W_DESC },
  { sku: 'FDMF60VVMG-W', list: 1749, discount: 1398, cat: 'FCU', desc: FDMF_W_DESC },
  { sku: 'FDMF71VVMG-W', list: 1866, discount: 1492, cat: 'FCU', desc: FDMF_W_DESC },

  // Indoor — Ducted (FDMF-VVMG) — Wireless (-WL)
  { sku: 'FDMF50VVMG-WL', list: 1605, discount: 1283, cat: 'FCU', desc: FDMF_WL_DESC },
  { sku: 'FDMF60VVMG-WL', list: 1839, discount: 1470, cat: 'FCU', desc: FDMF_WL_DESC },
  { sku: 'FDMF71VVMG-WL', list: 1956, discount: 1564, cat: 'FCU', desc: FDMF_WL_DESC },
];

async function getOrCreateCategory(name) {
  const existing = await prisma.category.findFirst({ where: { name, organizationId: ORG_ID } });
  if (existing) return existing;
  return prisma.category.create({ data: { name, organizationId: ORG_ID } });
}

(async () => {
  console.log('Org:', ORG_ID);
  const cuCat  = await getOrCreateCategory('Condensing Unit');
  const fcuCat = await getOrCreateCategory('Fan Coil Unit');
  const catId = { CU: cuCat.id, FCU: fcuCat.id };
  console.log('Condensing Unit cat:', cuCat.id, '| Fan Coil Unit cat:', fcuCat.id);

  const templates = await prisma.documentTemplate.findMany({
    where: { type: { in: ['DO', 'RDO'] }, organizationId: ORG_ID }, select: { id: true },
  });
  const doRdoTemplateIds = templates.map((t) => t.id);
  console.log(`DO/RDO templates to tag: ${doRdoTemplateIds.length}\n`);

  let created = 0, skipped = 0;
  for (const p of PRODUCTS) {
    const dupe = await prisma.asset.findFirst({ where: { skuKey: p.sku, organizationId: ORG_ID, deletedAt: null } });
    if (dupe) { console.log(`  SKIP (exists): ${p.sku}`); skipped++; continue; }
    const asset = await prisma.asset.create({
      data: {
        name: p.sku,
        skuKey: p.sku,
        description: p.desc,
        categoryId: catId[p.cat],
        organizationId: ORG_ID,
        uom: 'UNIT',
        isTracked: false,
        quantity: 0,
        price: p.list,
        customPrices: [{ label: 'Discount Price', value: p.discount }],
        parentAssetId: null,
      },
    });
    if (doRdoTemplateIds.length) {
      await prisma.assetTemplateTag.createMany({
        data: doRdoTemplateIds.map((templateId) => ({ assetId: asset.id, templateId })),
        skipDuplicates: true,
      });
    }
    console.log(`  CREATED [${p.cat}] ${p.sku}  list=${p.list}  discount=${p.discount}`);
    created++;
  }

  const total = await prisma.asset.count({ where: { organizationId: ORG_ID, deletedAt: null } });
  console.log(`\nDone. created=${created} skipped=${skipped}. Active assets for org now: ${total}`);
  await prisma.$disconnect();
})().catch(async (e) => {
  console.error('ERROR:', e.message);
  await prisma.$disconnect();
  process.exit(1);
});
