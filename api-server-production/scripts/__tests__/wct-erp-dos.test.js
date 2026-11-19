// node --test scripts/__tests__/wct-erp-dos.test.js  (old-ERP DO import plan, 2026-11-19)
const test = require('node:test');
const assert = require('node:assert/strict');
const { planErpDos, newOrderLinked, withDoLinks, doNumbersIn } = require('../wct-erp-dos');

const WCT = '5c700000-0000-4000-8000-5c7000000001';
const BC = '5c700000-0000-4000-8000-5c7000000004';
const cust = (id, org, name, code) => ({ id, organizationId: org, name, customerCode: code, address: 'addr' });
const quote = (id, org, name, customerId, extra = {}) => ({ id, organizationId: org, name, config: { customerId, date: '2026-10-20', subject: 'Degreasing', totalWithTax: 1090, erpImport: { source: 'wct-erp', clientSite: 'Site A' }, ...extra } });
const erpDo = (erpId, doNo, contract, extra = {}) => ({
  erp_id: erpId, do_no: doNo, date: '2026-11-04', contract_no: contract, engagement_id: '1', customer: 'Ah Yat Seafood', term: '0',
  parsed: { quotation_no: contract, pdf_date: '2026-11-04', sold_to: 'Ah Yat Seafood', sold_to_address: '19 Sims Way\nSingapore 388831', attention: 'Ivy Hong', attention_phone: '97430318', ship_to: 'Ah Yat Seafood', ship_to_address: '19 Sims Way\nSingapore 388831' },
  lines: [{ line_no: '1', description: 'S- Chemical degreasing', qty: '1.00', remark: '' }, { line_no: '2', description: 'S- Area cleaning', qty: '2.00', remark: '' }],
  ...extra,
});
const base = (over = {}) => ({
  dos: [],
  quotations: [quote('q1', WCT, 'Q-012920', 'c1'), quote('q2', BC, 'Q-014867', 'b1', { subject: '(NG) Booster fan' }), quote('q3', WCT, 'Q-013000', 'c1')],
  invoices: [{ id: 'i1', organizationId: WCT, name: 'I-015200', config: { erpImport: { ourDoNo: 'DO012360' } } }],
  orders: [{ id: 'o1', organizationId: WCT, orderNumber: 'ORD-Q-012920', status: 'PAID', sourceQuotationId: 'q1', linkedDocuments: { po: [], do: [], invoice: [{ id: 'i1' }], creditNote: [], imported: { source: 'erp-import', erpDoNumbers: ['DO012360'] } } }],
  nativeDos: [],
  customersByOrg: new Map([[WCT, [cust('c1', WCT, 'Ah Yat Seafood', 'CA001'), cust('c2', WCT, 'Billion Food Point Pte Ltd', 'CB010')]], [BC, [cust('b1', BC, 'Mala Stall', 'CM001')]]]),
  customerMap: new Map([['Billion Food Point Pte Ltd', { erp_customer: 'Billion Food Point Pte Ltd', match: 'exact', aims_customer_id: 'c2' }]]),
  templates: { [WCT]: 'tpl-wct', [BC]: 'tpl-bc' },
  company: { [WCT]: { name: 'WCT (S) Systems Pte Ltd' } },
  gstRegNo: { [WCT]: '201724603K' },
  existingDoErpIds: new Set(),
  takenNames: new Set(),
  batch: 'wct-erp-dos-test',
  now: '2026-11-19T07:00:00.000Z',
  pullDay: '2026-11-19',
  ...over,
});

test('DO numbers in a free-text field', () => {
  assert.deepEqual(doNumbersIn('DO012360'), ['DO012360']);
  assert.deepEqual(doNumbersIn('do 12360 / DO012361'), ['DO012360', 'DO012361']);
  assert.deepEqual(doNumbersIn(''), []);
});

test('a DO on an existing imported order (the ERP link): linked, read-only marker, history createdAt', () => {
  const p = planErpDos(base({ dos: [erpDo('12394', 'DO012360', '-012920')] }));
  assert.equal(p.docs.length, 1);
  const d = p.docs[0];
  assert.equal(d.organizationId, WCT);
  assert.equal(d.templateId, 'tpl-wct');
  assert.equal(d.name, 'DO012360');
  assert.equal(d.status, 'delivered_installed');
  assert.equal(d.linkHow, 'order erpDoNumbers');
  assert.equal(d.config.orderId, 'o1');
  assert.equal(d.config.customerId, 'c1');
  assert.equal(d.config.sourceDocumentId, 'q1');
  assert.equal(d.config.deliveryTo, '19 Sims Way, Singapore 388831');
  assert.deepEqual(d.config.items.map((i) => [i.description, i.quantity, i.isService, i.amount]), [['S- Chemical degreasing', 1, true, 0], ['S- Area cleaning', 2, true, 0]]);
  assert.deepEqual({ source: d.config.erpImport.source, erpId: d.config.erpImport.erpId, originalNumber: d.config.erpImport.originalNumber, status: d.config.erpImport.status, done: d.config.erpImport.done }, { source: 'wct-erp', erpId: '12394', originalNumber: 'DO012360', status: 'Issued', done: true });
  assert.ok(d.createdAt < new Date('2026-11-02T00:00:00+08:00'), 'createdAt capped before WCT\'s first AIMS document');
  assert.deepEqual(p.links.map((l) => [l.order.id, l.entry.name, l.entry.imported, l.entry.erpStatus, l.entry.date]), [['o1', 'DO012360', true, 'Issued', '2026-11-04']]);
  assert.equal(p.orders.length, 0);
});

test('quotation without an order: one DO-only order per quotation, status from its DOs', () => {
  const dos = [erpDo('1', 'DO012500', '-013000'), erpDo('2', 'DO012501', '-013000', { date: '2026-11-20' })];
  let p = planErpDos(base({ dos }));
  assert.equal(p.orders.length, 1);
  assert.equal(p.orders[0].orderNumber, 'ORD-Q-013000');
  assert.equal(p.orders[0].status, 'DO_DRAFT'); // DO012501 is dated after the pull day: not done
  assert.deepEqual(p.docs.map((d) => d.config.orderId), [p.orders[0].id, p.orders[0].id]);
  p = planErpDos(base({ dos: [dos[0]] }));
  assert.equal(p.orders[0].status, 'DO_COMPLETED');
  const ld = newOrderLinked(p.orders[0], 'b', 'now');
  assert.deepEqual(Object.keys(ld).sort(), ['creditNote', 'do', 'imported', 'invoice', 'po', 'salesOrder']);
  assert.deepEqual(ld.imported, { source: 'erp-import', batch: 'b', quotationNo: 'Q-013000', linkSources: {}, erpDoNumbers: ['DO012500'], at: 'now', quoteTotal: 1090, subject: 'Degreasing', site: 'Site A', credits: {}, doOnly: true });
  assert.deepEqual(Object.keys(ld.do[0]).sort(), ['date', 'done', 'erpStatus', 'id', 'imported', 'name', 'templateId']);
  // --done-rule invoiced: no invoice carries the DO number, so the DO is not done.
  p = planErpDos(base({ dos: [dos[0]], doneRule: 'invoiced' }));
  assert.equal(p.orders[0].status, 'DO_DRAFT');
  assert.equal(p.docs[0].status, 'confirmed');
});

test('"(NG)" quotation in BC Air: the DO goes to BC Air with the quotation\'s customer and BC Air template', () => {
  const p = planErpDos(base({ dos: [erpDo('3', 'DO012528', '-014867', { customer: 'Mala Stall' })] }));
  assert.equal(p.docs[0].organizationId, BC);
  assert.equal(p.docs[0].templateId, 'tpl-bc');
  assert.equal(p.docs[0].config.customerId, 'b1');
  assert.equal(p.orders[0].organizationId, BC);
});

test('quotation not in AIMS: WCT (S), customer by the reviewed map, unlinked; unknown customer is held', () => {
  let p = planErpDos(base({ dos: [erpDo('4', 'DO012514', '-013557', { customer: 'Billion Food Point Pte Ltd' })] }));
  assert.equal(p.docs[0].organizationId, WCT);
  assert.equal(p.docs[0].config.customerId, 'c2');
  assert.equal(p.docs[0].order, null);
  assert.equal(p.orders.length, 0);
  p = planErpDos(base({ dos: [erpDo('5', 'DO012515', '-013558', { customer: 'Nobody Pte Ltd' })] }));
  assert.equal(p.docs.length, 0);
  assert.match(p.held[0].reason, /not matched/);
});

test('idempotent, number clash, native look-alike, native order', () => {
  const one = [erpDo('12394', 'DO012360', '-012920')];
  assert.equal(planErpDos(base({ dos: one, existingDoErpIds: new Set(['12394']) })).docs.length, 0);
  assert.match(planErpDos(base({ dos: one, takenNames: new Set([`${WCT}|DO012360`]) })).held[0].reason, /already used/);
  const native = { id: 'n1', organizationId: WCT, name: 'DO202611023', status: 'delivered_installed', config: { customerId: 'c1', date: '2026-11-04', quotationNo: 'QO202611-0001', items: [{ description: 'S- Chemical degreasing' }, { description: 'S- Area cleaning' }] } };
  let p = planErpDos(base({ dos: one, nativeDos: [native] }));
  assert.equal(p.docs.length, 0);
  assert.equal(p.dupes[0].matches[0].by, 'customer + date + lines');
  p = planErpDos(base({ dos: one, nativeDos: [native], includeDuplicates: true }));
  assert.equal(p.docs.length, 1);
  // A quotation that already has a NATIVE order is never linked or given a second order.
  p = planErpDos(base({ dos: [erpDo('6', 'DO012600', '-013000')], orders: [{ id: 'n-ord', organizationId: WCT, orderNumber: 'ORD202611-011', sourceQuotationId: 'q3', linkedDocuments: { do: [] } }] }));
  assert.equal(p.docs[0].order, null);
  assert.equal(p.orders.length, 0);
  assert.match(p.docs[0].flags.join(), /native order ORD202611-011/);
  // ORD-<quotation> already taken: no order made, flagged.
  p = planErpDos(base({ dos: [erpDo('6', 'DO012600', '-013000')], orders: [{ id: 'x', organizationId: WCT, orderNumber: 'ORD-Q-013000', sourceQuotationId: null, linkedDocuments: {} }] }));
  assert.equal(p.orders.length, 0);
  assert.match(p.docs[0].flags.join(), /already used/);
});

test('adding DO links changes only the do array: no repeats, marker and invoices kept as read', () => {
  const ld = { invoice: [{ id: 'i1' }], do: [{ id: 'd0', name: 'DO000001' }], imported: { source: 'erp-import', erpDoNumbers: ['DO012360'], partBilledRule: true, completed: { auto: true } } };
  const next = withDoLinks(ld, [{ id: 'd0', name: 'DO000001' }, { id: 'd1', name: 'DO012360' }, { id: 'd2', name: 'DO012361' }]);
  assert.deepEqual(next.do.map((x) => x.id), ['d0', 'd1', 'd2']);
  assert.deepEqual({ ...next, do: undefined }, { ...ld, do: undefined });
  assert.equal(next.imported, ld.imported);
  assert.deepEqual(withDoLinks(null, [{ id: 'd1' }]), { do: [{ id: 'd1' }] });
});
