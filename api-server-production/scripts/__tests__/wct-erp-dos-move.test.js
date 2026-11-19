// node --test scripts/__tests__/wct-erp-dos-move.test.js  (imported ERP DOs in the wrong org, 2026-11-19)
const test = require('node:test');
const assert = require('node:assert/strict');
const { planMoves, withoutDoLinks, movePatch, entryOf } = require('../wct-erp-dos-move');

const WCT = '5c700000-0000-4000-8000-5c7000000001';
const BC = '5c700000-0000-4000-8000-5c7000000004';
const cust = (id, org, name, code) => ({ id, organizationId: org, name, customerCode: code, address: '' });
const quote = (id, org, name, customerId, subject = 'Degreasing') => ({ id, organizationId: org, name, config: { customerId, subject, date: '2026-11-10', totalWithTax: 1090 } });
const inv = (id, org, name, doNo, customerId, subject = 'Degreasing', total = 1090) => ({ id, organizationId: org, name, config: { erpImport: { ourDoNo: doNo }, customerId, subject, totalWithTax: total } });
const importedDo = (id, org, name, qNo, customerId, extra = {}) => ({
  id, organizationId: org, name, documentTemplateId: org === WCT ? 'tpl-wct' : 'tpl-bc',
  config: { date: '2026-11-19', customerId, customerName: 'x', quotationNo: `Q${qNo}`, items: [{ description: 'S- Degreasing', quantity: 1 }], attention: { name: 'Ms A', phoneNumber: '1' }, ...(extra.config || {}), erpImport: { source: 'wct-erp', kind: 'DELIVERY_ORDER', erpId: '1', originalNumber: name, quotationNo: qNo, erpCustomer: extra.erpCustomer || 'Hong Li Eatery House Pte Ltd', done: true, ...(extra.erpImport || {}) } },
});
const base = (over = {}) => {
  const dos = over.importedDos || [];
  return {
    importedDos: dos,
    allDos: dos,
    quotations: [quote('q1', WCT, 'Q-014873', 'c1'), quote('q2', BC, 'Q-014872', 'b2', '(NG) Spicy')],
    invoices: [inv('i1', WCT, 'I-015300', 'DO012538', 'c1'), inv('i2', WCT, 'I-015298', 'DO012536', 'c9', '(NG) Spicy', 180)],
    orders: [],
    customersByOrg: new Map([[WCT, [cust('c1', WCT, 'Hong Li Eatery House Pte Ltd', 'CH180'), cust('c3', WCT, 'Coffee and Tea Holdings Pte Ltd', 'CC104')]], [BC, [cust('b1', BC, 'Hong Li Eatery House Pte Ltd', 'CH010'), cust('b2', BC, 'Spicy Chef Singapore Pte Ltd', 'CS084'), cust('b3', BC, 'Coffee and Tea Holdings Pte Ltd', 'CC049')]]]),
    customerMap: new Map(),
    templates: { [WCT]: 'tpl-wct', [BC]: 'tpl-bc' },
    company: {}, gstRegNo: {},
    erpQuoteSubjects: new Map([['Q-013548', '(NG) Degreasing']]),
    erpInvoiceSubjects: new Map(),
    forceOrg: new Map(),
    batch: 'wct-erp-dos-move-test', now: '2026-11-19T08:00:00.000Z', pullDay: '2026-11-19', doneRule: 'dated',
    ...over,
  };
};
const order = (id, org, number, quoteId, ld) => ({ id, organizationId: org, orderNumber: number, status: 'INVOICED', sourceQuotationId: quoteId, linkedDocuments: ld });

test('everything in its rule org: no moves; "(NG)" DO kept in WCT (S) by its invoice is REVIEW', () => {
  const dos = [
    importedDo('d38', WCT, 'DO012538', '-014873', 'c1', { config: { orderId: 'o1', orderNo: 'ORD-Q-014873' } }),
    importedDo('d36', BC, 'DO012536', '-014872', 'b2', { erpCustomer: 'SPICY CHEF SINGAPORE PTE. LTD.' }),
    importedDo('d37', WCT, 'DO012537', '-013548', 'c3', { erpCustomer: 'Coffee and Tea Holdings Pte Ltd' }),
  ];
  const r = planMoves(base({ importedDos: dos, invoices: [...base().invoices, inv('i3', WCT, 'I-015299', 'DO012537', 'c3', '(NG) Degreasing', 1500)] }));
  assert.equal(r.moves.length, 0);
  const by = Object.fromEntries(r.rows.map((x) => [x.do_no, x]));
  assert.deepEqual([by.DO012538.status, by.DO012538.placed_by, by.DO012538.notes], ['OK', 'quotation', '']);
  assert.deepEqual([by.DO012536.status, by.DO012536.placed_by, by.DO012536.rule_org], ['OK', 'quotation', 'BC Air']);
  assert.match(by.DO012536.notes, /org differs from invoice I-015298 \(WCT \(S\)\)/);
  assert.deepEqual([by.DO012537.status, by.DO012537.placed_by, by.DO012537.rule_org, by.DO012537.quotation_org, by.DO012537.ng_implies], ['REVIEW', 'invoice', 'WCT (S)', 'not in AIMS', 'BC Air']);
});

test('quotation now in BC Air: the DO moves there, off the WCT (S) order (kept: it has an invoice), onto a new DO-only order', () => {
  const d = importedDo('d38', WCT, 'DO012538', '-014873', 'c1', { config: { orderId: 'o1', orderNo: 'ORD-Q-014873' } });
  const o1 = order('o1', WCT, 'ORD-Q-014873', 'q1', { invoice: [{ id: 'i1' }], do: [{ id: 'd38', name: 'DO012538' }], imported: { source: 'erp-import', erpDoNumbers: ['DO012538'] } });
  const r = planMoves(base({ importedDos: [d], orders: [o1], quotations: [quote('q1', BC, 'Q-014873', 'b1')] }));
  assert.equal(r.rows[0].status, 'MOVE');
  assert.equal(r.moves.length, 1);
  const { p } = r.moves[0];
  assert.deepEqual([p.organizationId, p.templateId, p.customer.id, p.custHow], [BC, 'tpl-bc', 'b1', 'quotation']);
  assert.equal(r.newOrders.length, 1);
  assert.deepEqual([r.newOrders[0].organizationId, r.newOrders[0].orderNumber, r.newOrders[0].status], [BC, 'ORD-Q-014873', 'DO_COMPLETED']);
  assert.deepEqual(r.newOrders[0].dos.map((x) => [x.id, x.name, x.done, x.templateId]), [['d38', 'DO012538', true, 'tpl-bc']]);
  assert.deepEqual(r.orderChanges.map((x) => [x.order.id, x.off, x.remove]), [['o1', ['d38'], false]]);
  const { patch, drop } = movePatch(d, p, 'now', 'rule: quotation');
  assert.deepEqual([patch.customerId, patch.orderNo, patch.sourceDocumentId, drop], ['b1', 'ORD-Q-014873', 'q1', []]);
  assert.deepEqual(patch.erpImport.movedFrom, { organizationId: WCT, templateId: 'tpl-wct', customerId: 'c1', orderId: 'o1', orderNo: 'ORD-Q-014873', at: 'now', by: 'system:wct-erp-dos-move', reason: 'rule: quotation' });
  assert.equal(patch.erpImport.originalNumber, 'DO012538'); // the import marker is kept
});

test('target org already has the imported order naming the DO: linked there, the DO keeps its own id', () => {
  const d = importedDo('d38', WCT, 'DO012538', '-014873', 'c1');
  const bcOrder = order('ob', BC, 'ORD-Q-014873', 'q1', { invoice: [{ id: 'x' }], do: [], imported: { source: 'erp-import', erpDoNumbers: ['DO012538'] } });
  const r = planMoves(base({ importedDos: [d], orders: [bcOrder], quotations: [quote('q1', BC, 'Q-014873', 'b1')] }));
  assert.equal(r.newOrders.length, 0);
  assert.deepEqual(r.links.map((l) => [l.order.id, l.entry.id, l.entry.name]), [['ob', 'd38', 'DO012538']]);
  assert.equal(r.moves[0].p.linkHow, 'order erpDoNumbers');
});

test('a DO-only order this importer made, left empty, is removed; with an invoice or rows on it, it is kept', () => {
  const d = importedDo('d36', BC, 'DO012536', '-014872', 'b2', { erpCustomer: 'SPICY CHEF SINGAPORE PTE. LTD.', config: { orderId: 'od', orderNo: 'ORD-Q-014872' } });
  const ld = { po: [], invoice: [], do: [{ id: 'd36', name: 'DO012536' }], imported: { source: 'erp-import', batch: 'wct-erp-dos-2026-11-19', erpDoNumbers: ['DO012536'], doOnly: true } };
  const quotations = [quote('q2', WCT, 'Q-014872', 'c1', '(NG) Spicy')];
  let r = planMoves(base({ importedDos: [d], orders: [order('od', BC, 'ORD-Q-014872', 'q2', ld)], quotations }));
  assert.deepEqual(r.orderChanges.map((x) => [x.order.id, x.remove]), [['od', true]]);
  assert.deepEqual(r.newOrders.map((o) => [o.organizationId, o.orderNumber]), [[WCT, 'ORD-Q-014872']]);
  r = planMoves(base({ importedDos: [d], orders: [order('od', BC, 'ORD-Q-014872', 'q2', { ...ld, invoice: [{ id: 'i' }] })], quotations }));
  assert.deepEqual(r.orderChanges.map((x) => [x.remove, x.keepWhy]), [[false, 'it has an invoice now']]);
  r = planMoves(base({ importedDos: [d], orders: [order('od', BC, 'ORD-Q-014872', 'q2', ld)], quotations, orderDependents: new Map([['od', ['Delivery.orderId 1']]]) }));
  assert.deepEqual(r.orderChanges.map((x) => [x.remove, x.keepWhy]), [[false, 'rows depend on it: Delivery.orderId 1']]);
});

test('owner decision: --move moves against the rule; once applied it stays put (OK (decision))', () => {
  const d = importedDo('d37', WCT, 'DO012537', '-013548', 'c3', { erpCustomer: 'Coffee and Tea Holdings Pte Ltd' });
  const invoices = [inv('i3', WCT, 'I-015299', 'DO012537', 'c3', '(NG) Degreasing', 1500)];
  let r = planMoves(base({ importedDos: [d], invoices, forceOrg: new Map([['DO012537', BC]]) }));
  assert.equal(r.rows[0].status, 'MOVE (decision)');
  assert.deepEqual([r.moves[0].p.organizationId, r.moves[0].p.customer.id, r.moves[0].p.custHow, r.moves[0].p.order], [BC, 'b3', 'erp name', null]);
  const { drop } = movePatch(d, r.moves[0].p, 'now', 'owner decision');
  assert.deepEqual(drop, ['orderId', 'orderNo']);
  const moved = importedDo('d37', BC, 'DO012537', '-013548', 'b3', { erpCustomer: 'Coffee and Tea Holdings Pte Ltd', erpImport: { movedFrom: { reason: 'owner decision' } } });
  r = planMoves(base({ importedDos: [moved], invoices }));
  assert.deepEqual([r.rows[0].status, r.moves.length], ['OK (decision)', 0]);
});

test('needs a decision: no customer in the target org, or rows hang on the DO', () => {
  const d = importedDo('d37', WCT, 'DO012537', '-013548', 'c3', { erpCustomer: 'Nobody Pte Ltd' });
  let r = planMoves(base({ importedDos: [d], forceOrg: new Map([['DO012537', BC]]) }));
  assert.equal(r.moves.length, 0);
  assert.match(r.held[0].reason, /customer "Nobody Pte Ltd" not matched there/);
  const d2 = importedDo('d37', WCT, 'DO012537', '-013548', 'c3', { erpCustomer: 'Coffee and Tea Holdings Pte Ltd' });
  r = planMoves(base({ importedDos: [d2], forceOrg: new Map([['DO012537', BC]]), dependents: new Map([['d37', ['DocumentShareLink.documentId 1']]]) }));
  assert.equal(r.moves.length, 0);
  assert.match(r.held[0].reason, /DocumentShareLink/);
});

test('withoutDoLinks: entries off; a DO-only order also drops the DO numbers, an invoice-made order keeps them', () => {
  const ld = { invoice: [{ id: 'i' }], do: [{ id: 'a', name: 'DO1' }, { id: 'b', name: 'DO2' }], imported: { source: 'erp-import', erpDoNumbers: ['DO1', 'DO2'] } };
  assert.deepEqual(withoutDoLinks(ld, ['a'], ['DO1']), { ...ld, do: [{ id: 'b', name: 'DO2' }] });
  const only = { ...ld, invoice: [], imported: { ...ld.imported, doOnly: true } };
  assert.deepEqual(withoutDoLinks(only, ['a'], ['DO1']).imported.erpDoNumbers, ['DO2']);
});

test('entryOf rebuilds the importer entry from an imported DO', () => {
  const e = entryOf(importedDo('d', WCT, 'DO012538', '-014873', 'c1'));
  assert.deepEqual([e.do_no, e.contract_no, e.date, e.customer, e.lines.length, e.lines[0].qty], ['DO012538', '-014873', '2026-11-19', 'Hong Li Eatery House Pte Ltd', 1, '1']);
});
