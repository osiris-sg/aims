require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const ORG_ID = '59802f75-262b-4f96-b8b2-09a9a071d882'; // Cappitech Engineering Pte. Ltd.

// Sheet 1: RKM-ZVMG — R32 Inverter Single Split.
// base price = List price; "Discount Price" custom = Dealer column.
// Each CU is a root asset; its paired FCU is a child (parentAssetId = CU).
const PAIRS = [
  { cu: 'RKM25ZVMG', cuList: 451,  cuDealer: 361, fcu: 'FTKM25ZVMG', fcuList: 381, fcuDealer: 304 },
  { cu: 'RKM35ZVMG', cuList: 507,  cuDealer: 405, fcu: 'FTKM35ZVMG', fcuList: 452, fcuDealer: 361 },
  { cu: 'RKM50ZVMG', cuList: 972,  cuDealer: 778, fcu: 'FTKM50ZVMG', fcuList: 602, fcuDealer: 481 },
  { cu: 'RKM60ZVMG', cuList: 1231, cuDealer: 866, fcu: 'FTKM60ZVMG', fcuList: 726, fcuDealer: 510 },
  { cu: 'RKM71ZVMG', cuList: 1283, cuDealer: 969, fcu: 'FTKM71ZVMG', fcuList: 777, fcuDealer: 587 },
];

const CU_DESC  = 'R32 Inverter Single Split (RKM-ZVM Series) — Condensing Unit';
const FCU_DESC = 'R32 Inverter Single Split (RKM-ZVM Series) — Fan Coil Unit';

async function getOrCreateCategory(name) {
  const existing = await prisma.category.findFirst({ where: { name, organizationId: ORG_ID } });
  if (existing) return existing;
  return prisma.category.create({ data: { name, organizationId: ORG_ID } });
}

async function createAsset({ skuKey, name, description, categoryId, price, discount, parentAssetId }) {
  const dupe = await prisma.asset.findFirst({ where: { skuKey, organizationId: ORG_ID, deletedAt: null } });
  if (dupe) {
    console.log(`  SKIP (exists): ${skuKey}`);
    return dupe;
  }
  const asset = await prisma.asset.create({
    data: {
      name,
      skuKey,
      description,
      categoryId,
      organizationId: ORG_ID,
      uom: 'UNIT',
      isTracked: false,
      quantity: 0,
      price,
      customPrices: [{ label: 'Discount Price', value: discount }],
      parentAssetId: parentAssetId ?? null,
    },
  });
  // Mirror the API createAssets flow: tag new asset to DO/RDO templates if present.
  if (doRdoTemplateIds.length) {
    await prisma.assetTemplateTag.createMany({
      data: doRdoTemplateIds.map((templateId) => ({ assetId: asset.id, templateId })),
      skipDuplicates: true,
    });
  }
  console.log(`  CREATED ${parentAssetId ? 'child ' : 'root  '} ${skuKey}  price=${price}  discount=${discount}`);
  return asset;
}

let doRdoTemplateIds = [];

(async () => {
  console.log('Org:', ORG_ID);

  const cuCat  = await getOrCreateCategory('Condensing Unit');
  const fcuCat = await getOrCreateCategory('Fan Coil Unit');
  console.log('Category "Condensing Unit":', cuCat.id);
  console.log('Category "Fan Coil Unit":  ', fcuCat.id);

  const templates = await prisma.documentTemplate.findMany({
    where: { type: { in: ['DO', 'RDO'] }, organizationId: ORG_ID },
    select: { id: true },
  });
  doRdoTemplateIds = templates.map((t) => t.id);
  console.log(`DO/RDO templates to tag: ${doRdoTemplateIds.length}`);

  for (const p of PAIRS) {
    console.log(`\nPair ${p.cu} / ${p.fcu}`);
    const cu = await createAsset({
      skuKey: p.cu, name: p.cu, description: CU_DESC, categoryId: cuCat.id,
      price: p.cuList, discount: p.cuDealer, parentAssetId: null,
    });
    await createAsset({
      skuKey: p.fcu, name: p.fcu, description: FCU_DESC, categoryId: fcuCat.id,
      price: p.fcuList, discount: p.fcuDealer, parentAssetId: cu.id,
    });
  }

  const total = await prisma.asset.count({ where: { organizationId: ORG_ID, deletedAt: null } });
  console.log(`\nDone. Active assets for org now: ${total}`);
  await prisma.$disconnect();
})().catch(async (e) => {
  console.error('ERROR:', e.message);
  await prisma.$disconnect();
  process.exit(1);
});
