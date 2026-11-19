// node --test scripts/__tests__/wct-erp-dos.test.js  (old-ERP DO import plan, 2026-11-19)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { planErpDos, placeErpDo, customerByName, loadErpSubjects, newOrderLinked, withDoLinks, doNumbersIn } = require('../wct-erp-dos');

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

test('a DO unlinked in the app (imported.unlinked) is never linked back by a re-run', () => {
  const ld = { do: [], imported: { source: 'erp-import', unlinked: [{ id: 'd1', type: 'DELIVERY_ORDER' }] } };
  assert.deepEqual(withDoLinks(ld, [{ id: 'd1' }, { id: 'd2' }]).do.map((x) => x.id), ['d2']);
});

// ── Org rule (Elroy, 19 Nov): the linked quotation's org, else the linked invoice's; "(NG)" only with no link ──
const inv = (id, org, name, doNo, extra = {}) => ({ id, organizationId: org, name, config: { erpImport: { ourDoNo: doNo }, customerId: 'c2', subject: 'Degreasing', ...extra } });

test('placeErpDo: quotation first, then invoice, "(NG)" only when there is no link', () => {
  const qBc = { id: 'q', organizationId: BC, name: 'Q-014867', config: { subject: '(NG) Booster fan' } };
  // (NG) quotation in BC Air + its $1 (NG) placeholder invoice in WCT (S): BC Air, the invoice noted.
  let p = placeErpDo({ quote: qBc, invoices: [inv('i', WCT, 'I-015289', 'DO012528', { subject: '(NG) Booster fan' })] });
  assert.deepEqual([p.org, p.by, p.ng], [BC, 'quotation', true]);
  assert.deepEqual(p.notes, ['invoice I-015289 is in WCT (S)']);
  // No quotation in AIMS, invoice in WCT (S) with "(NG)": WCT (S) by the invoice (the link wins), noted.
  p = placeErpDo({ invoices: [inv('i', WCT, 'I-015299', 'DO012537', { subject: '(NG) Degreasing' })], erpSubjects: ['(NG) Degreasing'] });
  assert.deepEqual([p.org, p.by, p.ng], [WCT, 'invoice', true]);
  assert.match(p.notes.join(), /"\(NG\)" in the ERP subject, WCT \(S\) by the invoice/);
  // No link at all: "(NG)" in the ERP subject = BC Air, else WCT (S).
  assert.deepEqual([placeErpDo({ erpSubjects: ['(NG) Degreasing'] }).org, placeErpDo({ erpSubjects: ['(NG) Degreasing'] }).by], [BC, '(NG) subject']);
  assert.deepEqual([placeErpDo({ erpSubjects: ['Degreasing'] }).org, placeErpDo({}).by], [WCT, 'no link']);
  // Invoices in both orgs: cannot place. An owner decision overrides everything.
  assert.equal(placeErpDo({ invoices: [inv('a', WCT, 'I-1', 'DO1'), inv('b', BC, 'I-2', 'DO1')] }).org, null);
  p = placeErpDo({ invoices: [inv('i', WCT, 'I-015299', 'DO012537')], force: BC });
  assert.deepEqual([p.org, p.by], [BC, 'decision']);
  assert.deepEqual(p.notes, ['invoice I-015299 is in WCT (S)', 'no "(NG)" in the ERP subject, BC Air by the decision']);
});

test('quotation not in AIMS, invoice carries the DO number: the invoice\'s org and customer', () => {
  const invoices = [inv('i9', WCT, 'I-015299', 'DO012537', { subject: '(NG) Degreasing' })];
  const p = planErpDos(base({ dos: [erpDo('7', 'DO012537', '-013548', { customer: 'Coffee and Tea Holdings Pte Ltd' })], invoices, erpQuoteSubjects: new Map([['Q-013548', '(NG) Degreasing']]) }));
  assert.equal(p.docs.length, 1);
  assert.equal(p.docs[0].organizationId, WCT);
  assert.equal(p.docs[0].place.by, 'invoice');
  assert.equal(p.docs[0].custHow, 'invoice');
  assert.equal(p.docs[0].config.customerId, 'c2');
  assert.deepEqual(p.docs[0].config.erpImport.invoices, ['I-015299']);
  assert.match(p.docs[0].flags.join('; '), /"\(NG\)" in the ERP subject, WCT \(S\) by the invoice; quotation Q-013548 not in AIMS/);
});

test('no link and "(NG)" in the ERP quotation subject: BC Air, customer by name there, BC Air template', () => {
  const dos = [erpDo('8', 'DO012600', '-013548', { customer: 'Mala Stall Pte. Ltd.' })];
  let p = planErpDos(base({ dos, erpQuoteSubjects: new Map([['Q-013548', '(NG) Degreasing']]) }));
  assert.equal(p.docs[0].organizationId, BC);
  assert.equal(p.docs[0].templateId, 'tpl-bc');
  assert.equal(p.docs[0].place.by, '(NG) subject');
  assert.equal(p.docs[0].config.customerId, 'b1'); // normalised name "Mala Stall"
  assert.equal(p.docs[0].order, null);
  // The ERP invoice carrying the DO number counts as the ERP subject too.
  p = planErpDos(base({ dos, erpInvoiceSubjects: new Map([['DO012600', [{ invoice_no: 'I-015400', subject: '(NG) x' }]]]) }));
  assert.equal(p.docs[0].organizationId, BC);
  // Without "(NG)": WCT (S), where no customer has that name: held.
  p = planErpDos(base({ dos }));
  assert.equal(p.docs.length, 0);
  assert.match(p.held[0].reason, /not in WCT \(S\) and customer "Mala Stall Pte. Ltd." not matched there/);
});

test('owner decision (forceOrg): the DO leaves its quotation\'s org, no quotation link, customer by name', () => {
  const p = planErpDos(base({ dos: [erpDo('9', 'DO012601', '-013000', { customer: 'Mala Stall' })], forceOrg: new Map([['DO012601', BC]]) }));
  assert.equal(p.docs[0].organizationId, BC);
  assert.equal(p.docs[0].quote, null);
  assert.equal(p.docs[0].config.sourceDocumentId, '');
  assert.equal(p.docs[0].config.quotationNo, 'Q-013000');
  assert.equal(p.docs[0].config.customerId, 'b1');
  assert.equal(p.orders.length, 0); // no DO-only order away from the quotation
  assert.match(p.docs[0].flags.join(), /quotation Q-013000 is in WCT \(S\)/);
});

test('customerByName: reviewed map only inside the org, one exact or normalised name, several = none', () => {
  const pool = [cust('b1', BC, 'Coffee and Tea Holdings Pte Ltd', 'CC049'), cust('b2', BC, 'Twin Co', 'CT001'), cust('b3', BC, 'Twin Co.', 'CT002')];
  const map = new Map([['Coffee and Tea Holdings Pte Ltd', { match: 'exact', aims_customer_id: 'wct-id' }]]);
  assert.equal(customerByName(pool, 'Coffee and Tea Holdings Pte Ltd', map).id, 'b1');
  assert.equal(customerByName(pool, 'Coffee & Tea Holdings Pte. Ltd.', map).id, 'b1');
  assert.equal(customerByName(pool, 'Twin Co', new Map()), null); // "Twin Co" and "Twin Co." are the same name: ambiguous
  assert.equal(customerByName(pool, 'TWIN CO PTE LTD', new Map()), null);
  assert.equal(customerByName(pool.slice(0, 2), 'TWIN CO PTE LTD', new Map()).id, 'b2'); // normalised name, one hit
  assert.equal(customerByName(pool, 'Nobody', new Map()), null);
});

test('loadErpSubjects: quotation subjects and ERP invoices by DO number, later pulls win', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wct-erp-dos-'));
  fs.mkdirSync(path.join(dir, 'erp'));
  fs.mkdirSync(path.join(dir, 'erp-catchup', '2026-11-19'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'erp', 'wct-quotes-full.csv'), 'quotation_no,subject\n-013548,Old subject\n-013557,"(NG) Degreasing, 10 stalls"\n');
  fs.writeFileSync(path.join(dir, 'erp-catchup', '2026-11-19', 'erp-quotation-list.csv'), '﻿list,quotation_no,subject\nquotation:new,-013548,(NG) New subject\n');
  fs.writeFileSync(path.join(dir, 'erp-catchup', '2026-11-19', 'wct-invoices-full.csv'), 'invoice_no,our_do_no,subject\nI-015299,DO012537,(NG) Degreasing\nI-015300,DO 12538 / DO012539,Plain\n');
  const s = loadErpSubjects(dir);
  assert.equal(s.erpQuoteSubjects.get('Q-013548'), '(NG) New subject');
  assert.equal(s.erpQuoteSubjects.get('Q-013557'), '(NG) Degreasing, 10 stalls');
  assert.deepEqual(s.erpInvoiceSubjects.get('DO012537'), [{ invoice_no: 'I-015299', subject: '(NG) Degreasing' }]);
  assert.deepEqual(s.erpInvoiceSubjects.get('DO012539'), [{ invoice_no: 'I-015300', subject: 'Plain' }]);
  fs.rmSync(dir, { recursive: true });
});
