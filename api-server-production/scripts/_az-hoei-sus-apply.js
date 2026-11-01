// Round AZ — prod: (1) Hoei's process leaves out steps 10, 12 and 14 (11 and 13 stay); (2) the 9 SUS shipment
// INVOICE_2 steps "moved to the order" that a profile save switched back on are set N/A again. Dry run by default;
// --apply writes (only the listed rows; done steps never change; nothing is deleted) and logs every write to the
// Activity Log. Aborts if any record would complete. Usage (after nest build): DBURL=… node scripts/_az-hoei-sus-apply.js [--apply]
const path = require('path');
const { PrismaClient } = require('@prisma/client');
const dist = (f) => require(path.join(__dirname, '..', 'dist', 'src', 'shipments', f));
const { processImpact, cleanSkipSteps, PROCESS_SKIP_REASON } = dist('trade-process.js');
const { naStepCodes, profileFor, supplierProfileFor } = dist('trade-profile.js');
const p = new PrismaClient({ datasources: { db: { url: process.env.DBURL } } });
const APPLY = process.argv.includes('--apply');
const ORG = '056ed6da-42d3-438e-895b-84bb4df47a4c';
const HOEI = '8ebdc67b-224a-4f30-ac5c-929b4f17fd78';
const SKIP = cleanSkipSteps(['IMPORT_PERMIT', 'LOGISTICS_PAYMENT', 'DELIVERY_CHANGES'], (m) => { throw new Error(m); });
const SUS_REFS = ['12-1', '15-1', '16-1', '16-2', '18-1', '18-2', '18-3', '19-1', '19-2'];
const ACTOR = { organizationId: ORG, actorType: 'SYSTEM', actorId: 'system:round-az', actorName: 'System creation', channel: 'cron' };
const ref = (o, s) => (s ? `#${o}-${s}` : `#${o}`);
(async () => {
  const set = await p.tradeSetting.findUnique({ where: { organizationId: ORG }, select: { id: true, customerProfiles: true, supplierProfiles: true } });
  const cur = profileFor(set.customerProfiles, HOEI);
  const next = { ...cur, skipSteps: SKIP };
  console.log(`Hoei process today: ${cur.skipSteps?.length ? cur.skipSteps.join(', ') : 'every step'} → left out: ${SKIP.join(', ')}`);
  const STEPS = { select: { id: true, code: true, status: true, isOngoing: true, notApplicable: true, skipReason: true, displayNo: true, title: true }, orderBy: { sortOrder: 'asc' } };
  const orders = await p.tradeOrder.findMany({ where: { organizationId: ORG, customerId: HOEI, status: 'OPEN' }, orderBy: { orderNo: 'asc' }, select: { id: true, orderNo: true, status: true, supplierId: true, steps: STEPS, shipments: { select: { id: true, seqNo: true, status: true, steps: STEPS } } } });
  const recs = [];
  const sup = new Map();
  for (const o of orders) {
    recs.push({ kind: 'order', id: o.id, ref: ref(o.orderNo), status: o.status, steps: o.steps });
    sup.set(o.id, o.supplierId);
    for (const s of o.shipments) { recs.push({ kind: 'shipment', id: s.id, ref: ref(o.orderNo, s.seqNo), orderId: o.id, status: s.status, steps: s.steps }); sup.set(s.id, o.supplierId); }
  }
  const naOf = (r) => new Set(naStepCodes(next, r.kind === 'order' ? 'ORDER' : 'SHIPMENT', supplierProfileFor(set.supplierProfiles, sup.get(r.id))));
  const i = processImpact(recs, naOf);
  console.log(`Open Hoei records: ${recs.map((r) => `${r.ref} ${r.kind}`).join(' | ')}`);
  console.log(`  hidden:          ${i.hidden.map((h) => `${h.ref} ${h.step}`).join(' | ') || '—'}`);
  console.log(`  shown again:     ${i.shown.map((h) => `${h.ref} ${h.step}`).join(' | ') || '—'}`);
  console.log(`  done kept:       ${i.doneKept.map((h) => `${h.ref} ${h.step}`).join(' | ') || '—'}`);
  console.log(`  would complete:  ${i.completes.join(', ') || '—'}`);
  // The step rows to flip: not done, not N/A today, in SKIP.
  const flips = [];
  for (const r of recs) for (const s of r.steps) if (SKIP.includes(s.code) && s.status !== 'DONE' && !s.notApplicable) flips.push({ r, s });
  console.log(`  step rows to set N/A: ${flips.map((f) => `${f.r.ref} ${f.s.displayNo} ${f.s.code}`).join(' | ') || '—'}`);

  const moved = await p.tradeStep.findMany({ where: { organizationId: ORG, code: 'INVOICE_2', skipReason: { startsWith: 'Moved to the order' }, notApplicable: false, shipmentId: { not: null } }, select: { id: true, status: true, skipReason: true, shipment: { select: { id: true, seqNo: true, status: true, order: { select: { orderNo: true, customer: { select: { name: true } } } } } } } });
  const sus = moved.map((m) => ({ ...m, ref: `${m.shipment.order.orderNo}-${m.shipment.seqNo}` }));
  console.log(`\nSUS moved INVOICE_2 rows switched back on: ${sus.length} → ${sus.map((m) => `#${m.ref} ${m.status} (${m.shipment.order.customer.name.slice(0, 18)})`).join(' | ')}`);
  const okSet = sus.length === SUS_REFS.length && sus.every((m) => SUS_REFS.includes(m.ref) && m.status !== 'DONE');
  console.log(`  matches the 9 reported (#${SUS_REFS.join(', #')}), none done: ${okSet ? 'YES' : 'NO'}`);

  if (!APPLY) { console.log('\nDry run — nothing written.'); return p.$disconnect(); }
  if (i.completes.length) throw new Error(`would complete ${i.completes.join(', ')} — not applying`);
  if (i.shown.length) throw new Error('steps would be shown again — not applying');
  if (!okSet) throw new Error('SUS rows differ from the 9 reported — not applying');

  // (1) Hoei profile + steps
  const profiles = { ...(set.customerProfiles || {}) };
  const before = profiles[HOEI]?.skipSteps ?? null;
  profiles[HOEI] = { ...(profiles[HOEI] || {}), skipSteps: SKIP };
  await p.tradeSetting.update({ where: { id: set.id }, data: { customerProfiles: profiles } });
  await p.actionLog.create({ data: { ...ACTOR, action: 'UPDATE', resource: 'TradeSetting', resourceId: set.id, details: { change: 'Hoei process: steps left out', customerId: HOEI, skipSteps: { from: before, to: SKIP } } } });
  console.log(`WRITE TradeSetting.customerProfiles[Hoei].skipSteps ${JSON.stringify(before)} → ${JSON.stringify(SKIP)} (+ActionLog)`);
  for (const f of flips) {
    const n = await p.tradeStep.updateMany({ where: { id: f.s.id, organizationId: ORG, status: { not: 'DONE' }, notApplicable: false }, data: { notApplicable: true, skipReason: PROCESS_SKIP_REASON } });
    await p.actionLog.create({ data: { ...ACTOR, action: 'UPDATE', resource: 'TradeStep', resourceId: f.s.id, details: { change: "Not in this customer's process (Hoei)", ref: f.r.ref, step: f.s.displayNo, code: f.s.code, notApplicable: { from: false, to: true }, skipReason: { from: f.s.skipReason, to: PROCESS_SKIP_REASON } } } });
    console.log(`WRITE TradeStep ${f.r.ref} ${f.s.displayNo} ${f.s.code} N/A (${n.count} row, +ActionLog)`);
  }
  // (2) SUS
  for (const m of sus) {
    const n = await p.tradeStep.updateMany({ where: { id: m.id, organizationId: ORG, status: { not: 'DONE' }, notApplicable: false }, data: { notApplicable: true } });
    await p.actionLog.create({ data: { ...ACTOR, action: 'UPDATE', resource: 'TradeStep', resourceId: m.id, details: { change: 'Step moved to the order — set N/A again', ref: `#${m.ref}`, code: 'INVOICE_2', notApplicable: { from: false, to: true } } } });
    console.log(`WRITE TradeStep #${m.ref} INVOICE_2 N/A (${n.count} row, +ActionLog)`);
  }
  await p.$disconnect();
})().catch((e) => { console.error('ERR', e.message.slice(0, 300)); process.exit(1); });
