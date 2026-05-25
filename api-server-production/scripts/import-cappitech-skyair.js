require('dotenv').config();
const XLSX = require('xlsx');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const ORG_ID = '59802f75-262b-4f96-b8b2-09a9a071d882';
const FILE = '/Users/guru/Downloads/Price List 2026 sample (1).xlsx';

const num = (s) => (s == null ? null : (Number(String(s).replace(/[^0-9.]/g, '')) || null));
const clean = (s) => (s == null ? '' : String(s).replace(/\s+/g, ' ').trim());

const fcuDesc = (code) => {
  if (/^FCTF/.test(code)) return 'R32 Inverter Sky Air — BMC Streamer Cassette Fan Coil Unit';
  if (/^FC/.test(code)) return 'R32 Inverter Sky Air — BMC Cassette Fan Coil Unit';
  if (/^FH/.test(code)) return 'R32 Inverter Sky Air — Ceiling Suspended Fan Coil Unit';
  if (/^FB/.test(code)) return 'R32 Inverter Sky Air — Ducted (Middle Static) Fan Coil Unit';
  return 'R32 Inverter Sky Air Fan Coil Unit';
};

// Accessories (panel / remotes / drain pump). [sku, list, dealer|null, desc]
const ACCESSORIES = [
  ['BYCQ125EAF-S', 187, 150, 'Sky Air Decoration Panel'],
  ['BYCQ125EAK-S', 268, 215, 'Sky Air Black Decoration Panel'],
  ['BRC1E63-S', 165, 131, 'Wired Remote Controller'],
  ['BRC7M635F', 165, 131, 'Wireless Remote Controller'],
  ['BRC1H63W', 235, 186, 'Stylish Wired Remote Controller (White)'],
  ['BRC1H63K', 235, 186, 'Stylish Wired Remote Controller (Black)'],
  ['BRC7M56', 165, 131, 'Wireless Remote Controller'],
  ['BRC7GA56', 165, 131, 'Wireless Remote Controller (3-Phase)'],
  ['BRC4C66', 165, 131, 'Wireless Remote Controller'],
  ['BDU24AMD2', 96, null, 'Drain Pump'],
];

async function getOrCreateCategory(name) {
  const existing = await prisma.category.findFirst({ where: { name, organizationId: ORG_ID } });
  return existing || prisma.category.create({ data: { name, organizationId: ORG_ID } });
}

async function upsertAsset({ sku, name, description, categoryId, price, dealer, parentAssetId }) {
  const dupe = await prisma.asset.findFirst({ where: { skuKey: sku, organizationId: ORG_ID, deletedAt: null } });
  if (dupe) return { asset: dupe, created: false };
  const asset = await prisma.asset.create({
    data: {
      name: sku, skuKey: sku, description, categoryId, organizationId: ORG_ID,
      uom: 'UNIT', isTracked: false, quantity: 0, price,
      ...(dealer != null ? { customPrices: [{ label: 'Discount Price', value: dealer }] } : {}),
      parentAssetId: parentAssetId ?? null,
    },
  });
  return { asset, created: true };
}

(async () => {
  const cuCat = await getOrCreateCategory('Condensing Unit');
  const fcuCat = await getOrCreateCategory('Fan Coil Unit');
  const accCat = await getOrCreateCategory('Accessories');

  const wb = XLSX.readFile(FILE);
  const rows = XLSX.utils.sheet_to_json(wb.Sheets['SkyAir'], { header: 1, defval: null, raw: false });

  const cuIdByCode = {};
  let cuCreated = 0, fcuCreated = 0, fcuSkipped = 0;

  for (const r of rows) {
    const cuCode = clean(r[0]);
    const fcuCode = clean(r[1]);
    if (!/^RZ/.test(cuCode) || !/^F/.test(fcuCode)) continue; // data rows only

    const cuList = num(r[2]), cuDealer = num(r[7]);
    const fcuList = num(r[3]), fcuDealer = num(r[8]);

    // CU parent (create once per code)
    if (!cuIdByCode[cuCode]) {
      const { asset, created } = await upsertAsset({
        sku: cuCode, description: 'R32 Inverter Sky Air Condensing Unit',
        categoryId: cuCat.id, price: cuList, dealer: cuDealer, parentAssetId: null,
      });
      cuIdByCode[cuCode] = asset.id;
      if (created) { cuCreated++; console.log(`  CU   ${cuCode.padEnd(13)} list=${cuList} dealer=${cuDealer}`); }
    }

    // FCU child (skip if already created — first parent wins for shared FCUs)
    const dupe = await prisma.asset.findFirst({ where: { skuKey: fcuCode, organizationId: ORG_ID, deletedAt: null } });
    if (dupe) { fcuSkipped++; continue; }
    await upsertAsset({
      sku: fcuCode, description: fcuDesc(fcuCode), categoryId: fcuCat.id,
      price: fcuList, dealer: fcuDealer, parentAssetId: cuIdByCode[cuCode],
    });
    fcuCreated++;
    console.log(`    FCU ${fcuCode.padEnd(13)} -> parent ${cuCode.padEnd(12)} list=${fcuList} dealer=${fcuDealer}`);
  }

  console.log('\n  Accessories:');
  let accCreated = 0;
  for (const [sku, list, dealer, desc] of ACCESSORIES) {
    const { created } = await upsertAsset({ sku, description: desc, categoryId: accCat.id, price: list, dealer, parentAssetId: null });
    if (created) { accCreated++; console.log(`    ACC ${sku.padEnd(14)} list=${list} dealer=${dealer ?? '-'}`); }
  }

  const total = await prisma.asset.count({ where: { organizationId: ORG_ID, deletedAt: null } });
  console.log(`\nDone. CUs created=${cuCreated}, FCUs created=${fcuCreated} (skipped dup=${fcuSkipped}), accessories=${accCreated}. Org active assets now: ${total}`);
  await prisma.$disconnect();
})().catch(async (e) => { console.error('ERROR:', e.message); await prisma.$disconnect(); process.exit(1); });
