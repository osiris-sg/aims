// Round AY — READ-ONLY dry run on prod: what "Hoei ends at step 9" would change on Hoei's open orders / shipments
// (the app's own processImpact + naStepCodes from dist), and the shipment steps "moved to the order" that a profile
// save had switched back on (any customer). Nothing is written. Usage: node scripts/_ay-hoei-process-dry.js (after nest build)
const path = require('path');
const { PrismaClient } = require('@prisma/client');
const dist = (f) => require(path.join(__dirname, '..', 'dist', 'src', 'shipments', f));
const { processImpact, codesAfter } = dist('trade-process.js');
const { naStepCodes, profileFor, supplierProfileFor } = dist('trade-profile.js');
const p = new PrismaClient({ datasources: { db: { url: process.env.DBURL } } });
const ORG = '056ed6da-42d3-438e-895b-84bb4df47a4c';
const HOEI = '8ebdc67b-224a-4f30-ac5c-929b4f17fd78';
const ref = (o, s) => (s ? `#${o}-${s}` : `#${o}`);
(async () => {
  const set = await p.tradeSetting.findUnique({ where: { organizationId: ORG }, select: { customerProfiles: true, supplierProfiles: true } });
  const cur = profileFor(set.customerProfiles, HOEI);
  const skip = codesAfter('9');
  const next = { ...cur, skipSteps: skip };
  console.log(`Hoei (${cur.key}, ${cur.billingMode}) — process today: ${cur.skipSteps?.length ? cur.skipSteps.join(', ') : 'every step'}`);
  console.log(`Proposed: ends at step 9 → left out: ${skip.join(', ')}\n`);
  const STEPS = { select: { code: true, status: true, isOngoing: true, notApplicable: true, skipReason: true, displayNo: true, title: true }, orderBy: { sortOrder: 'asc' } };
  const orders = await p.tradeOrder.findMany({ where: { organizationId: ORG, customerId: HOEI }, orderBy: { orderNo: 'asc' }, select: { id: true, orderNo: true, status: true, isTest: true, supplierId: true, steps: STEPS, shipments: { select: { id: true, seqNo: true, status: true, steps: STEPS } } } });
  const recs = [];
  const sup = new Map();
  for (const o of orders) {
    recs.push({ kind: 'order', id: o.id, ref: ref(o.orderNo), status: o.status, steps: o.steps });
    sup.set(o.id, o.supplierId);
    for (const s of o.shipments) {
      recs.push({ kind: 'shipment', id: s.id, ref: ref(o.orderNo, s.seqNo), orderId: o.id, status: s.status, steps: s.steps });
      sup.set(s.id, o.supplierId);
    }
  }
  console.log('Hoei records:');
  for (const r of recs) {
    const open = r.steps.filter((s) => !s.isOngoing && !s.notApplicable && s.status !== 'DONE').map((s) => s.displayNo);
    console.log(`  ${r.ref.padEnd(7)} ${r.kind.padEnd(8)} ${r.status.padEnd(9)} not done: ${open.join(', ') || '—'}`);
  }
  const i = processImpact(recs, (r) => new Set(naStepCodes(next, r.kind === 'order' ? 'ORDER' : 'SHIPMENT', supplierProfileFor(set.supplierProfiles, sup.get(r.id)))));
  console.log(`\nImpact: ${i.openOrders} open order(s), ${i.openShipments} open shipment(s)`);
  console.log(`  hidden (not done, not deleted): ${i.hidden.map((h) => `${h.ref} ${h.step}`).join(' | ') || '—'}`);
  console.log(`  done steps that stay done:      ${i.doneKept.map((h) => `${h.ref} ${h.step}`).join(' | ') || '—'}`);
  console.log(`  would complete:                 ${i.completes.join(', ') || '—'}`);
  // Hoei's generated invoices (step 11 is left out — show what exists so the decision is informed)
  const inv = await p.tradeGeneratedDoc.findMany({ where: { organizationId: ORG, docType: { in: ['INVOICE_SINGLE', 'INVOICE_2'] }, OR: [{ order: { customerId: HOEI } }, { shipment: { order: { customerId: HOEI } } }] }, select: { docType: true, status: true, number: true, order: { select: { orderNo: true } }, shipment: { select: { seqNo: true, order: { select: { orderNo: true } } } } } });
  console.log(`  Hoei invoices in AIMS (step 11): ${inv.map((g) => `${g.number ?? g.docType} ${g.status} ${g.order ? ref(g.order.orderNo) : ref(g.shipment.order.orderNo, g.shipment.seqNo)}`).join(' | ') || 'none'}`);
  // Moved-to-the-order rows switched back on (any customer)
  const moved = await p.tradeStep.findMany({ where: { organizationId: ORG, skipReason: { startsWith: 'Moved to the order' }, notApplicable: false }, select: { id: true, code: true, status: true, shipment: { select: { seqNo: true, status: true, order: { select: { orderNo: true, customer: { select: { name: true } } } } } } } });
  console.log(`\nShipment steps "moved to the order" that are switched back on (would be set N/A again, nothing else): ${moved.length}`);
  for (const m of moved) console.log(`  ${ref(m.shipment.order.orderNo, m.shipment.seqNo).padEnd(7)} ${m.shipment.order.customer.name.slice(0, 22).padEnd(22)} shipment ${m.shipment.status.padEnd(9)} ${m.code} ${m.status}`);
  await p.$disconnect();
})().catch((e) => { console.error('ERR', e.message.slice(0, 300)); process.exit(1); });
