require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const ORG = '59802f75-262b-4f96-b8b2-09a9a071d882';

// Per Sky Air FCU type: defaults (auto-added) + options (swappable, scoped picker).
const TYPES = {
  streamer: { def: ['BYCQ125EAF-S', 'BRC1H63W'], opt: ['BYCQ125EAK-S', 'BRC1H63K'] },
  cass5:    { def: ['BYCQ125EAF-S', 'BRC1E63-S'], opt: ['BYCQ125EAK-S'] },
  cass4:    { def: ['BYCQ125EAF-S', 'BRC1E63-S'], opt: ['BYCQ125EAK-S', 'BRC7M635F'] },
  ceil3:    { def: ['BRC7GA56'], opt: [] },
  ceil1:    { def: ['BRC1E63-S'], opt: ['BRC7M56'] },
  duct:     { def: ['BRC1E63-S'], opt: ['BRC4C66'] },
};
const typeOf = (sku) =>
  /^FCTF/.test(sku) ? 'streamer' :
  /^FCFV/.test(sku) ? 'cass5' :
  /^FCF/.test(sku)  ? 'cass4' :
  /^FHFC/.test(sku) ? 'ceil3' :
  /^FHA/.test(sku)  ? 'ceil1' :
  /^FB/.test(sku)   ? 'duct'  : null;

(async () => {
  // Resolve accessory SKUs -> ids
  const accSkus = ['BYCQ125EAF-S','BYCQ125EAK-S','BRC1E63-S','BRC7M635F','BRC1H63W','BRC1H63K','BRC7M56','BRC7GA56','BRC4C66'];
  const id = {};
  for (const sku of accSkus) {
    const a = await prisma.asset.findFirst({ where: { skuKey: sku, organizationId: ORG, deletedAt: null }, select: { id: true } });
    if (!a) throw new Error(`Accessory ${sku} not found`);
    id[sku] = a.id;
  }

  const fcus = await prisma.asset.findMany({
    where: { organizationId: ORG, deletedAt: null, category: { name: 'Fan Coil Unit' } },
    select: { id: true, skuKey: true },
  });

  let tagged = 0;
  for (const f of fcus) {
    const t = typeOf(f.skuKey);
    if (!t) continue; // RKM/MKM FCUs
    const def = TYPES[t].def.map((s) => id[s]);
    const opt = TYPES[t].opt.map((s) => id[s]);
    await prisma.asset.update({ where: { id: f.id }, data: { accessoryIds: def, accessoryOptionIds: opt } });
    tagged++;
    console.log(`  ${f.skuKey.padEnd(13)} [${t}]  default=[${TYPES[t].def.join(', ')}]  options=[${TYPES[t].opt.join(', ') || '-'}]`);
  }
  console.log(`\nRe-tagged ${tagged} Sky Air FCUs.`);
  await prisma.$disconnect();
})().catch(async (e) => { console.error('ERROR:', e.message); await prisma.$disconnect(); process.exit(1); });
