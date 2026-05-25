require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const ORG_ID = '59802f75-262b-4f96-b8b2-09a9a071d882'; // Cappitech Engineering Pte. Ltd.

// Sheet 2 (MKM-ZVMG) EXCEPTION bundles: configs whose sheet price is NOT reproducible
// by mixing-and-matching the atomic CU + indoor units (bundle/SET discounts).
// Stored as full SET SKUs priced at the sheet's SET List/Discount column.
//   - MKM50: list-only discount (dealer is additive) — captured here for exact list pricing.
//   - MKM85: genuine list+dealer bundle discount.
//   - MKM100 25+35+35: anomaly (premium vs sum, suspected sheet error) — included as-is per decision.
// price = SET List; customPrices = [{ "Discount Price": SET Dealer }].

// [ cuModel, config, setList, setDealer ]
const SETS = [
  ['MKM50ZVMG',  '25 + 25',      3239, 2429],
  ['MKM50ZVMG',  '25 + 35',      3303, 2483],
  ['MKM50ZVMG',  '25 + 50',      3396, 2560],
  ['MKM50ZVMG',  '35 + 35',      3367, 2537],
  ['MKM50ZVMG',  '35 + 50',      3460, 2614],
  ['MKM50ZVMG',  '25 + 25 + 25', 3733, 2841],
  ['MKM50ZVMG',  '25 + 25 + 35', 3797, 2895],
  ['MKM85ZVMG',  '25 + 50 + 71', 4634, 3562],
  ['MKM85ZVMG',  '35 + 50 + 71', 4698, 3616],
  ['MKM100ZVMG', '25 + 35 + 35', 4955, 4054], // anomaly, included as-is
];

async function getOrCreateCategory(name) {
  const existing = await prisma.category.findFirst({ where: { name, organizationId: ORG_ID } });
  if (existing) return existing;
  return prisma.category.create({ data: { name, organizationId: ORG_ID } });
}

(async () => {
  console.log('Org:', ORG_ID);
  const setCat = await getOrCreateCategory('Multi-split Set');
  console.log('Multi-split Set cat:', setCat.id);

  const templates = await prisma.documentTemplate.findMany({
    where: { type: { in: ['DO', 'RDO'] }, organizationId: ORG_ID }, select: { id: true },
  });
  const doRdoTemplateIds = templates.map((t) => t.id);
  console.log(`DO/RDO templates to tag: ${doRdoTemplateIds.length}\n`);

  let created = 0, skipped = 0;
  for (const [cu, cfg, setList, setDealer] of SETS) {
    const compact = cfg.replace(/\s+/g, '');           // "25 + 25" -> "25+25"
    const sku = `${cu}-SET-${compact}`;
    const desc = `${cu} R32 iSmileEco multi-split SET — outdoor condensing unit + indoor units ${cfg}. Bundle SET price (not reproducible by summing individual units).`;
    const dupe = await prisma.asset.findFirst({ where: { skuKey: sku, organizationId: ORG_ID, deletedAt: null } });
    if (dupe) { console.log(`  SKIP (exists): ${sku}`); skipped++; continue; }
    const asset = await prisma.asset.create({
      data: {
        name: sku,
        skuKey: sku,
        description: desc,
        categoryId: setCat.id,
        organizationId: ORG_ID,
        uom: 'SET',
        isTracked: false,
        quantity: 0,
        price: setList,
        customPrices: [{ label: 'Discount Price', value: setDealer }],
        parentAssetId: null,
      },
    });
    if (doRdoTemplateIds.length) {
      await prisma.assetTemplateTag.createMany({
        data: doRdoTemplateIds.map((templateId) => ({ assetId: asset.id, templateId })),
        skipDuplicates: true,
      });
    }
    console.log(`  CREATED ${sku.padEnd(24)} list=${setList} discount=${setDealer}`);
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
