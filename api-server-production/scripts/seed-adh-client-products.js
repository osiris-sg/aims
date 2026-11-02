/**
 * Round BA — seed ADH Clients › Products from what orders, contracts, PIs and
 * shipments already say. ADH only. Empty slots only: a company that already
 * has any product row (visible or hidden) is skipped, nothing is overwritten
 * or deleted, packing is never touched. Every write gets an ActionLog row.
 *
 *   node scripts/seed-adh-client-products.js                       # dry run (default)
 *   node scripts/seed-adh-client-products.js --apply --confirm-prod
 *
 * DB: DATABASE_URL (or DBURL). Values marked in toConfirm show "to confirm" on screen.
 */
const { PrismaClient } = require('@prisma/client');
const { randomUUID } = require('crypto');
const prisma = new PrismaClient({ datasources: { db: { url: process.env.DBURL || process.env.DATABASE_URL } } });
const ADH = '056ed6da-42d3-438e-895b-84bb4df47a4c';
const APPLY = process.argv.includes('--apply');
if (APPLY && !process.argv.includes('--confirm-prod')) { console.error('--apply needs --confirm-prod'); process.exit(1); }

const billet = (grade, d, l, extra) => ({ grade, form: 'BILLET', diameterMm: d, lengthMm: l, ...extra });
const CHEM = 'chemistry';
// Customer products (what they buy) — `match` finds the company by name.
const CUSTOMERS = [
  { match: /^SUS/i, products: [
    billet('6005', 203, 5800, { piecesPerBundle: 5, bundleWeightKg: 2550, tolerances: '±5% quantity, ±5% amount', priceBasis: 'LME + premium', source: 'contract 454003255 (Vedanta PI 9331004129: 6005V1-C 8 inch); packing lists ~2,550 kg / 5 pcs per bundle', toConfirm: [CHEM, 'standard', 'monthlyQtyMt'] }),
    billet('6063', 203, 5800, { piecesPerBundle: 5, bundleWeightKg: 2550, tolerances: '±5% quantity, ±5% amount', priceBasis: 'LME + premium', source: 'contract 454003422 (Vedanta PI 9331004128: 6063V1-C 8 inch), MIND ID AHS260527001P; packing lists ~2,550 kg / 5 pcs per bundle', toConfirm: [CHEM, 'standard', 'monthlyQtyMt'] }),
  ] },
  { match: /^Kato/i, products: [
    billet('6005', 203, 5800, { piecesPerBundle: 5, bundleWeightKg: 2535, tolerances: '±5% quantity, ±5% amount', priceBasis: 'LME + premium', source: 'contract 454003598 (Vedanta PI 9331004129, 50 t); shipments 2,517–2,553 kg / 5 pcs per bundle', toConfirm: [CHEM, 'standard', 'monthlyQtyMt'] }),
    billet('6063', 203, 5800, { piecesPerBundle: 5, priceBasis: 'LME + premium', source: 'contract 454003598 (6063 line, size not on the contract)', toConfirm: [CHEM, 'standard', 'bundleWeightKg', 'monthlyQtyMt', 'diameterMm'] }),
    billet('6063', 152, 5800, { piecesPerBundle: 6, bundleWeightKg: 1707, notes: 'HSB', priceBasis: 'LME + premium', source: 'orders #21, #1010; shipments 1,704–1,711 kg / 6 pcs per bundle', toConfirm: [CHEM, 'standard', 'monthlyQtyMt'] }),
    billet('1070', 203, 5800, { priceBasis: 'LME + premium', source: 'orders #1001, #1006', toConfirm: [CHEM, 'standard', 'piecesPerBundle', 'bundleWeightKg', 'monthlyQtyMt'] }),
    billet('6061', 203, 5800, { priceBasis: 'LME + premium', source: 'order #1004', toConfirm: [CHEM, 'standard', 'piecesPerBundle', 'bundleWeightKg', 'monthlyQtyMt'] }),
  ] },
  { match: /^Hou?ei/i, products: [
    { grade: 'P1020', form: 'INGOT', bundleWeightKg: 994, tolerances: '±2% quantity', priceBasis: 'LME + premium', source: 'contract 454003652 (150 t ±2%); order #14: 688 pcs / 152 bundles, ~994 kg per bundle', toConfirm: [CHEM, 'standard', 'piecesPerBundle', 'sizeText', 'monthlyQtyMt'] },
    { grade: 'P0507', form: 'INGOT', bundleWeightKg: 994, priceBasis: 'LME + premium', source: 'order #10 (was #1011): #10-1 100 bundles, 99.354 t net, ~994 kg per bundle', toConfirm: [CHEM, 'standard', 'piecesPerBundle', 'sizeText', 'tolerances', 'monthlyQtyMt'] },
  ] },
  { match: /^Sankyo/i, products: [
    { grade: '6063', form: 'REMELT_INGOT', tolerances: '±5%', source: 'order #24 from PT Sri Indah (sales contract 26100906: "Aluminium Alloy Ingot 6063", 50 t)', notes: 'Packing (geta / base ingots): no issue or photo on file yet.', toConfirm: [CHEM, 'standard', 'sizeText', 'piecesPerBundle', 'bundleWeightKg', 'priceBasis', 'monthlyQtyMt'] },
  ] },
];
const SUPPLIERS = [
  { match: /^Vedanta/i, products: [
    billet('6005', 203, 5800, { piecesPerBundle: 5, tolerances: '±5% quantity, ±5% amount', priceBasis: 'LME + premium', notes: 'Vedanta code 6005V1-C 8 inch', source: 'PIs 9331004129 (contracts 454003255, 454003598)', toConfirm: [CHEM, 'bundleWeightKg'] }),
    billet('6063', 203, 5800, { piecesPerBundle: 5, tolerances: '±5% quantity, ±5% amount', priceBasis: 'LME + premium', notes: 'Vedanta code 6063V1-C 8 inch', source: 'PI 9331004128 (contract 454003422)', toConfirm: [CHEM, 'bundleWeightKg'] }),
    billet('6063', 152, 5800, { piecesPerBundle: 6, priceBasis: 'LME + premium', notes: 'HSB', source: 'orders #21, #1010 (Kato)', toConfirm: [CHEM, 'tolerances', 'bundleWeightKg'] }),
    billet('1070', 203, 5800, { priceBasis: 'LME + premium', source: 'orders #1001, #1006 (Kato)', toConfirm: [CHEM, 'piecesPerBundle', 'bundleWeightKg', 'tolerances'] }),
    billet('6061', 203, 5800, { priceBasis: 'LME + premium', source: 'order #1004 (Kato)', toConfirm: [CHEM, 'piecesPerBundle', 'bundleWeightKg', 'tolerances'] }),
    { grade: 'P1020', form: 'INGOT', priceBasis: 'LME + premium', source: 'contract 454003652 (Hoei)', toConfirm: [CHEM, 'sizeText', 'piecesPerBundle', 'bundleWeightKg'] },
    { grade: 'P0507', form: 'INGOT', priceBasis: 'LME + premium', source: 'order #10 (was #1011, Hoei)', toConfirm: [CHEM, 'sizeText', 'piecesPerBundle', 'bundleWeightKg'] },
  ] },
  // No profile yet: a minimal one (the app's default supplier profile) is created with the product.
  { match: /^MIND ID/i, createProfile: true, products: [
    { grade: '6063', form: 'BILLET', priceBasis: 'Whole-month average LME + premium', notes: 'Producer: PT Indonesia Asahan Aluminium (Inalum), LME brand INALLET. Inalum COA CoA/0093/2026 (delivery order AO50000995) states producer grade "BILLET 6063-D7 INCH (B-3)" while order #9 says 203 MM X 5800 MM, so the size is left to confirm. Shipment #9-1: 8 bundles, 20.296 t net (no per-bundle figures on the documents).', source: 'order #9 / shipment #9-1 (SUS), Inalum COA CoA/0093/2026 (DO AO50000995), contract AHS260527001P', toConfirm: [CHEM, 'standard', 'diameterMm', 'sizeText', 'piecesPerBundle', 'bundleWeightKg', 'tolerances'] },
  ] },
  { match: /^PT Sri Indah/i, products: [
    { grade: '6063', form: 'REMELT_INGOT', tolerances: '±5%', priceBasis: 'Fixed USD/t (3,625 on PI SIAE_PI_26100906)', notes: 'Payment: 30% advance, 70% against B/L copy', source: 'sales contract 26100906 / PI SIAE_PI_26100906 (Sankyo order #24)', toConfirm: [CHEM, 'standard', 'sizeText', 'piecesPerBundle', 'bundleWeightKg'] },
  ] },
];

const size = (p) => (p.diameterMm && p.lengthMm ? `${p.diameterMm} × ${p.lengthMm}` : '');
async function seed(kind, list, companies) {
  const field = kind === 'customer' ? 'customerProfiles' : 'supplierProfiles';
  for (const c of list) {
    const hits = companies.filter((x) => c.match.test(x.name));
    if (hits.length !== 1) { console.log(`  !! ${kind} ${c.match}: ${hits.length} matches (${hits.map((h) => h.name).join(', ')}) — skipped`); continue; }
    const co = hits[0];
    const row = await prisma.tradeSetting.findUnique({ where: { organizationId: ADH }, select: { id: true, [field]: true } });
    const profiles = row?.[field] ?? {};
    const prof = profiles[co.id];
    if (!prof && !c.createProfile) { console.log(`  -- ${co.name}: no trade profile yet — skipped`); continue; }
    // The app's own default (trade-profile.ts defaultCustomerProfile / defaultSupplierProfile) — only for a company flagged createProfile.
    const base = prof ?? { supplierId: co.id, hasPI: true, shippingDocs: null };
    if (!prof) console.log(`  ${co.name}: creates its minimal ${kind} profile (app default, no other fields)`);
    if ((base.products ?? []).length) { console.log(`  -- ${co.name}: already has ${prof.products.length} product(s) — skipped`); continue; }
    const now = new Date().toISOString();
    const rows = c.products.map((p) => ({ id: randomUUID(), grade: null, form: null, diameterMm: null, lengthMm: null, sizeText: null, standard: null, chemistry: [], tolerances: null, piecesPerBundle: null, bundleWeightKg: null, monthlyQtyMt: null, priceBasis: null, notes: null, specFiles: [], packingImages: [], source: null, toConfirm: [], hidden: false, createdAt: now, updatedAt: now, ...p }));
    console.log(`  ${co.name} (${kind} ${co.id}) +${rows.length}`);
    for (const r of rows) console.log(`     ${r.grade} ${r.form} ${size(r) || '-'} | ${r.piecesPerBundle ?? '?'} pcs/bdl | ${r.bundleWeightKg ?? '?'} kg/bdl | ${r.tolerances ?? '-'} | ${r.priceBasis ?? '-'}\n       source: ${r.source}\n       to confirm: ${r.toConfirm.join(', ')}`);
    if (!APPLY) continue;
    await prisma.tradeSetting.update({ where: { organizationId: ADH }, data: { [field]: { ...profiles, [co.id]: { ...base, products: rows } } } });
    await prisma.actionLog.create({ data: { actorType: 'SYSTEM', actorId: 'system:round-ba-seed-products', actorName: 'System creation', organizationId: ADH, channel: 'operator', action: 'CREATE', resource: 'TradeClientProduct', resourceId: co.id, details: { note: `Round BA seed: ${rows.length} product(s) for ${kind} ${co.name}${prof ? '' : ' (minimal profile created)'}`, kind, profileCreated: !prof, productIds: rows.map((r) => r.id), labels: rows.map((r) => `${r.grade} ${r.form} ${size(r)}`.trim()) } } });
    console.log('     WRITTEN + logged');
  }
}
(async () => {
  console.log(APPLY ? 'APPLY' : 'DRY RUN (no writes)');
  const customers = await prisma.customer.findMany({ where: { organizationId: ADH }, select: { id: true, name: true } });
  const suppliers = await prisma.supplier.findMany({ where: { organizationId: ADH }, select: { id: true, name: true } });
  console.log('CUSTOMERS'); await seed('customer', CUSTOMERS, customers);
  console.log('SUPPLIERS'); await seed('supplier', SUPPLIERS, suppliers);
  await prisma.$disconnect();
})().catch(async (e) => { console.error('ERR', e.message); await prisma.$disconnect(); process.exit(1); });
