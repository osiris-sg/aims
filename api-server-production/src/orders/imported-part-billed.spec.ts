import { HttpException } from '@nestjs/common';
import { DocumentsService } from '../documents/documents.service';
import { OrdersService } from './orders.service';
import { IMPORTED_ORDER_SOURCE } from './imported-orders';

/** ORD-Q-014154 on prod (2026-11-19): Q-014154 2 x Maintenance agreement 1,200 (+ $0 lines) = 2,616; I-014521 1,308 paid. */
const ORG = 'org-wct';
const zero = (d: string) => ({ description: d, quantity: 1, unitPrice: 0, amount: 0 });
const MA = 'Maintenance agreement of 2 times per year package';
const QUOTE = {
  id: 'q1',
  name: 'Q-014154',
  config: {
    erpImport: { source: 'wct-erp', erpId: '14213' },
    customerId: 'c1', customerName: 'Bar Roque Grill', billTo: '165 Tanjong Pagar Road', subject: 'Y2026 Chemical Degreasing', attention: { name: 'Ms Isabelle' },
    gstPercent: 9, totalWithTax: 2616, nettTotal: 2616,
    items: [zero('G- Provide tools'), { description: MA, quantity: 2, unitPrice: 1200, amount: 2400 }, zero('S- Area cleaning')],
  },
};
const I014521 = { id: 'i1', name: 'I-014521', status: 'paid', config: { erpImport: { source: 'wct-erp' }, totalWithTax: 1308, outstandingBalance: 0, paidToDate: 1308, items: [zero('G- Provide tools'), { description: MA, quantity: 1, unitPrice: 1200, amount: 1200 }, zero('S- Area cleaning')] } };

function world(extra: { docs?: any[]; marker?: any } = {}) {
  const order: any = {
    id: 'o1',
    orderNumber: 'ORD-Q-014154',
    status: 'PART_BILLED',
    sourceQuotationId: 'q1',
    linkedDocuments: { invoice: [{ id: 'i1', name: 'I-014521', total: 1308 }], imported: { source: IMPORTED_ORDER_SOURCE, quoteTotal: 2616, credits: {}, partBilledRule: true, ...extra.marker } },
  };
  const docs = extra.docs ?? [I014521];
  const db: any = {
    organizationUIConfig: { findUnique: jest.fn(async () => ({ features: { enableImportedOrders: true, enableWctOrders: true } })) },
    order: {
      findFirst: jest.fn(async () => order),
      update: jest.fn(async ({ data }: any) => Object.assign(order, data)),
    },
    document: {
      findMany: jest.fn(async ({ where }: any) => docs.filter((d) => where.id.in.includes(d.id))),
      findFirst: jest.fn(async ({ where }: any) => (where.id === 'q1' ? QUOTE : null)),
    },
    organization: { findUnique: jest.fn(async () => ({ taxRate: 9 })) },
    accountingSetting: { findUnique: jest.fn(async () => ({ timeZone: 'Asia/Singapore' })) },
    $executeRawUnsafe: jest.fn(async () => 1),
  };
  db.$transaction = jest.fn(async (fn: any) => fn(db));
  const svc: any = Object.create(DocumentsService.prototype);
  svc.prisma = db;
  svc.resolveTemplateIdForType = jest.fn(async () => 'tpl-inv');
  svc.createBasicDocument = jest.fn(async (_t: string, type: string, _o: string, config: any) => ({ id: 'inv9', name: 'INV202611-0040', type, config, documentTemplateId: 'tpl-inv' }));
  svc.repostGlForDocument = jest.fn(async () => undefined);
  return { svc, order, db };
}

describe('imported part-billed order: Create invoice (native draft for what is left)', () => {
  it('ORD-Q-014154: a NATIVE draft for 1 x Maintenance agreement 1,200 + the $0 lines, header from the quotation, linked to the order', async () => {
    const { svc, order, db } = world();
    const inv = await svc.invoiceImportedOrderRemainder('o1', ORG);
    expect(inv).toMatchObject({ id: 'inv9', name: 'INV202611-0040', documentTemplateId: 'tpl-inv' });
    const [tpl, type, org, config] = svc.createBasicDocument.mock.calls[0];
    expect([tpl, type, org]).toEqual(['tpl-inv', 'INVOICE', ORG]);
    expect(config.items.map((l: any) => [l.description, l.quantity, l.unitPrice, l.amount])).toEqual([
      ['G- Provide tools', 1, 0, 0],
      [MA, 1, 1200, 1200],
      ['S- Area cleaning', 1, 0, 0],
    ]);
    expect(config).toMatchObject({ customerId: 'c1', customerName: 'Bar Roque Grill', billTo: '165 Tanjong Pagar Road', subject: 'Y2026 Chemical Degreasing', orderId: 'o1', orderNo: 'ORD-Q-014154', sourceDocumentId: 'q1', sourceDocumentType: 'QUOTATION', nettTotal: 1308, gstAmount: 108 });
    // Never the imported marker, numbers or money of the quotation; a fresh balance.
    expect(config.erpImport).toBeUndefined();
    expect(config).toMatchObject({ outstandingBalance: 1308, paidToDate: 0, totalWithTax: 1308 });
    // Linked on the order as a native invoice; GL per the normal rules; nothing written on the quotation / I-014521.
    expect(order.linkedDocuments.invoice).toEqual([{ id: 'i1', name: 'I-014521', total: 1308 }, { id: 'inv9', name: 'INV202611-0040', templateId: 'tpl-inv', total: 1308, native: true }]);
    expect(svc.repostGlForDocument).toHaveBeenCalledTimes(1);
    expect(db.document.update).toBeUndefined();
    // Still part billed while the new invoice is a draft.
    expect(order.status).toBe('PART_BILLED');
  });
  it('refused: an order billed in full, a completed order, an order with a draft already, a non-imported order', async () => {
    const full = world({ docs: [{ ...I014521, config: { ...I014521.config, totalWithTax: 2616, paidToDate: 2616 } }] });
    await expect(full.svc.invoiceImportedOrderRemainder('o1', ORG)).rejects.toThrow(/Nothing left to bill/);
    const done = world({ marker: { completed: { at: 'x', by: null, byName: null, reason: 'r', auto: true } } });
    await expect(done.svc.invoiceImportedOrderRemainder('o1', ORG)).rejects.toThrow(/marked complete/);
    const draft = world({ docs: [I014521, { id: 'inv9', name: 'INV202611-0040', status: 'unconfirmed', config: { totalWithTax: 1308 } }] });
    draft.order.linkedDocuments.invoice.push({ id: 'inv9', name: 'INV202611-0040', native: true });
    await expect(draft.svc.invoiceImportedOrderRemainder('o1', ORG)).rejects.toThrow(/already has a draft invoice \(INV202611-0040\)/);
    const native = world();
    native.order.linkedDocuments = { invoice: [] };
    await expect(native.svc.invoiceImportedOrderRemainder('o1', ORG)).rejects.toBeInstanceOf(HttpException);
    expect(full.svc.createBasicDocument).not.toHaveBeenCalled();
  });
});

describe('imported orders: Mark complete / Reopen', () => {
  const orders = (w: any) => {
    const s: any = Object.create(OrdersService.prototype);
    s.prisma = w.db;
    s.importedOrderView = jest.fn(async () => ({ id: 'o1', status: w.order.status }));
    return s;
  };
  it('a reason is required; the mark wins (Complete); Reopen reads the money again (Part billed)', async () => {
    const w = world();
    const s = orders(w);
    await expect(s.markImportedComplete('o1', ORG, { reason: '  ' }, { id: 'u1', name: 'Elroy' })).rejects.toThrow(/reason/);
    await s.markImportedComplete('o1', ORG, { reason: 'Customer cancelled the 2nd service' }, { id: 'u1', name: 'Elroy' });
    expect(w.order.linkedDocuments.imported.completed).toMatchObject({ by: 'u1', byName: 'Elroy', reason: 'Customer cancelled the 2nd service', auto: false });
    expect(w.order.status).toBe('COMPLETED');
    await s.reopenImported('o1', ORG);
    expect(w.order.linkedDocuments.imported.completed).toBeUndefined();
    expect(w.order.status).toBe('PART_BILLED');
    await expect(s.reopenImported('o1', ORG)).rejects.toThrow(/not marked complete/);
  });
  it('only imported orders', async () => {
    const w = world();
    w.order.linkedDocuments = { invoice: [] };
    await expect(orders(w).markImportedComplete('o1', ORG, { reason: 'x' }, {})).rejects.toThrow(/imported from the old ERP/);
  });
});

describe('Create invoice: typed number, edited lines (2026-11-19)', () => {
  it('I-014521-02 typed: the document is named so (nameOverride, the INV counter is not used); edited lines kept', async () => {
    const { svc } = world();
    await svc.invoiceImportedOrderRemainder('o1', ORG, { number: ' I-014521-02 ', lines: [{ description: 'Maintenance agreement, 2nd service', quantity: 1, unitPrice: 1200 }, { description: 'S- Area cleaning', quantity: 1, unitPrice: 0 }] });
    const call = svc.createBasicDocument.mock.calls[0];
    expect(call[6]).toBe('I-014521-02');
    expect(call[3]).toMatchObject({ documentNumber: 'I-014521-02', nettTotal: 1308 });
    expect(call[3].items.map((l: any) => [l.description, l.quantity, l.amount])).toEqual([['Maintenance agreement, 2nd service', 1, 1200], ['S- Area cleaning', 1, 0]]);
  });
  it('no number: the normal numbering (no override)', async () => {
    const { svc } = world();
    await svc.invoiceImportedOrderRemainder('o1', ORG, {});
    expect(svc.createBasicDocument.mock.calls[0][6]).toBeUndefined();
  });
  it('refused: a number already used, a bad number, $0-only lines', async () => {
    const used = world();
    used.db.document.findFirst = jest.fn(async ({ where }: any) => (where.id === 'q1' ? QUOTE : where.type === 'INVOICE' ? { name: 'I-014521-02' } : null));
    await expect(used.svc.invoiceImportedOrderRemainder('o1', ORG, { number: 'i-014521-02' })).rejects.toThrow(/I-014521-02 is already used/);
    await expect(world().svc.invoiceImportedOrderRemainder('o1', ORG, { number: 'I 014521/02 !' })).rejects.toThrow(/letters, digits/);
    await expect(world().svc.invoiceImportedOrderRemainder('o1', ORG, { lines: [{ description: 'x', quantity: 1, unitPrice: 0 }] })).rejects.toThrow(/every line is \$0/);
    expect(used.svc.createBasicDocument).not.toHaveBeenCalled();
  });
});

describe('order page helpers: steps, suggested number, DO-only orders', () => {
  const { billingSteps, suggestedInvoiceNumber, validInvoiceNumber } = require('./imported-remaining');
  const { importedOrderStatus, importedTracker } = require('./imported-orders');
  it('"1 of 2 Paid · 2 of 2 Draft"', () => {
    const q = [zero('G- Provide tools'), { description: MA, quantity: 2, unitPrice: 1200, amount: 2400 }];
    expect(billingSteps(q, [{ items: I014521.config.items, state: 'Paid' }, { items: [{ description: MA, quantity: 1, unitPrice: 1200, amount: 1200 }], state: 'Draft' }])).toEqual([{ label: '1 of 2', state: 'Paid' }, { label: '2 of 2', state: 'Draft' }]);
    expect(billingSteps([...q, { description: 'Other', quantity: 1, unitPrice: 5, amount: 5 }], [])).toEqual([]);
  });
  it('suggested number: base + -02 (next free); valid numbers', () => {
    expect(suggestedInvoiceNumber('I-014521', 1, new Set())).toBe('I-014521-02');
    expect(suggestedInvoiceNumber('I-014521', 1, new Set(['i-014521-02']))).toBe('I-014521-03');
    expect(suggestedInvoiceNumber('I-014521-01', 2, new Set())).toBe('I-014521-03');
    expect(validInvoiceNumber(' I-014521-02 ')).toBe('I-014521-02');
    expect(validInvoiceNumber('-x')).toBeNull();
  });
  it('an order made from an ERP DO (no invoice yet): DO draft / DO completed, invoice pending; Billed 0%', () => {
    expect(importedOrderStatus([], 2616, { dos: [{ erpStatus: 'Completed' }] })).toMatchObject({ status: 'DO_COMPLETED', label: 'DO completed, invoice pending', billedPct: 0 });
    expect(importedOrderStatus([], 2616, { dos: [{ erpStatus: 'Signed' }, { erpStatus: 'Draft' }] })).toMatchObject({ status: 'DO_DRAFT', label: 'DO draft' });
    const t = importedTracker({ dos: [{ name: 'DO012538', erpStatus: 'Completed' }] }, { status: 'DO_COMPLETED', label: 'DO completed, invoice pending' });
    expect(t.map((x: any) => [x.key, x.state, x.note ?? null])).toEqual([['quotation', 'done', null], ['invoice', 'todo', 'Invoice pending'], ['do', 'done', 'DO012538 (Completed)'], ['serviceReport', 'na', null]]);
  });
});

describe('imported ERP DOs carry a done flag (the ERP keeps no DO status, 2026-11-19)', () => {
  const { importedOrderStatus, importedTracker, importedDoDone } = require('./imported-orders');
  it('done: true = DO completed, invoice pending; false = DO draft; status text only when no flag', () => {
    expect(importedOrderStatus([], 2616, { dos: [{ erpStatus: 'Issued', done: true }] })).toMatchObject({ status: 'DO_COMPLETED' });
    expect(importedOrderStatus([], 2616, { dos: [{ erpStatus: 'Issued', done: true }, { erpStatus: 'Issued', done: false }] })).toMatchObject({ status: 'DO_DRAFT' });
    expect(importedDoDone({ erpStatus: 'Completed' })).toBe(true);
    expect(importedDoDone({ erpStatus: 'Issued' })).toBe(false);
    const t = importedTracker({ dos: [{ name: 'DO012528', erpStatus: 'Issued', done: true }] }, { status: 'DO_COMPLETED', label: 'DO completed, invoice pending' });
    expect(t.find((x: any) => x.key === 'do')).toMatchObject({ state: 'done', note: 'DO012528 (Completed)' });
  });
});
