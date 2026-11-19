import { HttpException } from '@nestjs/common';
import { DocumentsService } from '../documents/documents.service';
import { OrdersService } from './orders.service';
import { nativeOrderSummary, nativeRemainderOf } from './order-page-summary';
import { remainderInvoiceIdsOf } from './wct-orders';

/**
 * Round 36 (WCT group, 2026-11-19), item 1: "Invoicing until fully billed".
 *   - An AIMS order whose counted invoices (not draft, not voided, credit notes taken off) bill less than the quotation
 *     total keeps "Create invoice": the remaining lines prefilled, editable (the imported order's reading).
 *   - Every order invoice takes the org's next INV number, claimed in the transaction that writes it (lockedNumber).
 *   - Other orgs: createBasicDocument without the option is the unchanged path; an AIMS order of an org without
 *     invoicing per order never takes the remainder path.
 */
const ORG = 'org-wct';
const QUOTE = {
  id: 'q1',
  name: 'QO202611-0026',
  config: {
    gstPercent: 9,
    taxApplicable: 'Y',
    totalWithTax: 1744,
    nettTotal: 1744,
    customerName: 'Ajiya Okonomiyaki Restaurant',
    items: [{ description: 'Kitchen exhaust hood and ducting cleaning', quantity: 2, unitPrice: 800, amount: 1600, itemCode: 'SVC-HOOD', accountCode: '4000' }, { description: 'S- Area cleaning', quantity: 1, unitPrice: 0, amount: 0 }],
  },
};
const inv = (id: string, extra: any = {}) => ({
  id,
  name: `INV202611-00${id.slice(-1)}2`,
  status: 'pending_payment',
  type: 'INVOICE',
  documentTemplateId: 'tpl-inv',
  createdAt: new Date('2026-11-11T00:00:00Z'),
  ...extra,
  config: { totalWithTax: 872, nettTotal: 872, outstandingBalance: 872, paidToDate: 0, items: [{ description: 'Kitchen exhaust hood and ducting cleaning', quantity: 1, unitPrice: 800, amount: 800 }], ...(extra.config ?? {}) },
});

describe('nativeRemainderOf / nativeOrderSummary (pure)', () => {
  const summaryOf = (invoices: any[], credits?: Map<string, number>) => nativeOrderSummary({ quotation: QUOTE, invoices, credits });
  const remainderOf = (invoices: any[], extra: any = {}) =>
    nativeRemainderOf({ invoicing: true, cancelled: false, hasQuotation: true, invoices, summary: summaryOf(invoices, extra.credits), quoteItems: QUOTE.config.items, ...extra });

  it('1 of 2 billed: Create invoice stays, the remaining line (and the $0 line) prefilled', () => {
    const r = remainderOf([inv('i1')]);
    expect(r.canInvoiceRemaining).toBe(true);
    expect(r.invoiceLines.map((l) => [l.description, l.quantity, l.unitPrice])).toEqual([
      ['Kitchen exhaust hood and ducting cleaning', 1, 800],
      ['S- Area cleaning', 1, 0],
    ]);
  });
  it('billed in full: no more Create invoice', () => {
    const full = inv('i1', { config: { totalWithTax: 1744, items: [{ description: 'Kitchen exhaust hood and ducting cleaning', quantity: 2, unitPrice: 800, amount: 1600 }] } });
    expect(remainderOf([full]).canInvoiceRemaining).toBe(false);
  });
  it('a draft on the order: it opens instead (one at a time); voided and credited invoices do not count as billed', () => {
    const r = remainderOf([inv('i1'), inv('i2', { status: 'unconfirmed' })]);
    expect(r).toMatchObject({ canInvoiceRemaining: false, draftInvoice: { id: 'i2' } });
    const voided = remainderOf([inv('i1', { config: { voided: true } })]);
    expect(voided.canInvoiceRemaining).toBe(true);
    expect(voided.invoiceLines[0]).toMatchObject({ quantity: 2, unitPrice: 800 });
    const credited = remainderOf([inv('i1')], { credits: new Map([['i1', 872]]) });
    expect(credited.canInvoiceRemaining).toBe(true);
    expect(summaryOf([inv('i1')], new Map([['i1', 872]]))).toMatchObject({ billed: 0, remaining: { remainingGross: 1744 } });
  });
  it('never before the first invoice, on a cancelled order, without invoicing per order or a quotation', () => {
    expect(remainderOf([]).canInvoiceRemaining).toBe(false);
    expect(remainderOf([inv('i1')], { cancelled: true }).canInvoiceRemaining).toBe(false);
    expect(remainderOf([inv('i1')], { invoicing: false }).canInvoiceRemaining).toBe(false);
    expect(remainderOf([inv('i1')], { hasQuotation: false }).canInvoiceRemaining).toBe(false);
  });
  it('no credits passed: the summary reads exactly as before', () => {
    expect(nativeOrderSummary({ quotation: QUOTE, invoices: [inv('i1')] })).toEqual(nativeOrderSummary({ quotation: QUOTE, invoices: [inv('i1')], credits: new Map() }));
  });
  it('remainderInvoiceIdsOf: only the invoices made for what is left', () => {
    expect(remainderInvoiceIdsOf({ linkedDocuments: { invoice: [{ id: 'a' }, { id: 'b', remainder: true }, { id: 'b', remainder: true }] } })).toEqual(['b']);
    expect(remainderInvoiceIdsOf(null)).toEqual([]);
  });
});

describe('order page (OrdersService.wctBilling): Create invoice for what is left', () => {
  function orders(docs: any[], creditNotes: any[] = [], features: any = { enableWctOrders: true, enableWctOrderInvoice: true }) {
    const svc: any = Object.create(OrdersService.prototype);
    svc.prisma = {
      organizationUIConfig: { findUnique: jest.fn(async () => ({ features })) },
      document: {
        findMany: jest.fn(async ({ where }: any) => (where.type?.in?.includes('CREDIT_NOTE') ? creditNotes : docs.filter((d) => where.id?.in?.includes(d.id)))),
      },
      auditLog: { findMany: jest.fn(async () => []) },
    };
    return svc;
  }
  it('Racking-style order (no manual flow), 1 of 2 billed: canInvoiceRemaining + lines; a credit note on it counts', async () => {
    const out = await orders([inv('i1')]).wctBilling(ORG, [{ deliveryNumber: 7, orderInvoiceId: 'i1', status: 'completed', verificationState: 'verified' }], [], QUOTE, { id: 'o1', status: 'INVOICED', linkedDocuments: {} }, []);
    expect(out.canInvoiceRemaining).toBe(true);
    expect(out.invoiceLines[0]).toMatchObject({ description: 'Kitchen exhaust hood and ducting cleaning', quantity: 1, unitPrice: 800 });
    expect(out.summary).toMatchObject({ billed: 872, remaining: { remainingGross: 872 } });
    const cn = { config: { sourceDocumentId: 'i1', totalWithTax: 872 } };
    const credited = await orders([inv('i1')], [cn]).wctBilling(ORG, [], ['i1'], QUOTE, { id: 'o1', status: 'INVOICED' }, []);
    expect(credited.summary).toMatchObject({ billed: 0, remaining: { remainingGross: 1744 } });
  });
  it('invoicing per order off: never offered', async () => {
    const out = await orders([inv('i1')], [], { enableWctOrders: true }).wctBilling(ORG, [], ['i1'], QUOTE, { id: 'o1', status: 'INVOICED' }, []);
    expect(out.canInvoiceRemaining).toBe(false);
    expect(out.invoiceLines).toEqual([]);
  });
});

/** A DocumentsService over an in-memory AIMS order (manual flow or not). */
function world(opts: { features?: any; plan?: any; linkedDocuments?: any; status?: string } = {}) {
  const order: any = {
    id: 'o1',
    orderNumber: 'ORD202611-021',
    status: opts.status ?? 'INVOICED',
    sourceQuotationId: 'q1',
    invoiceDocumentId: 'i1',
    linkedDocuments: opts.linkedDocuments ?? { po: [], do: [], invoice: [{ id: 'i1', name: 'INV202611-0012', jobIds: [] }], salesOrder: [] },
  };
  const db: any = {
    organizationUIConfig: { findUnique: jest.fn(async () => ({ features: opts.features ?? { enableWctOrders: true, enableWctOrderInvoice: true, enableManualOrderFlow: true } })) },
    order: { findFirst: jest.fn(async () => order), update: jest.fn(async ({ data }: any) => Object.assign(order, data)) },
    document: { findFirst: jest.fn(async ({ where }: any) => (where.id === 'q1' ? QUOTE : null)), findMany: jest.fn(async () => []) },
    organization: { findUnique: jest.fn(async () => ({ taxRate: 9, taxApplicable: true })) },
    accountingSetting: { findUnique: jest.fn(async () => ({ timeZone: 'Asia/Singapore' })) },
    delivery: { findMany: jest.fn(async () => []) },
    $executeRawUnsafe: jest.fn(async () => 1),
  };
  db.$transaction = jest.fn(async (fn: any) => fn(db));
  const svc: any = Object.create(DocumentsService.prototype);
  svc.prisma = db;
  svc.deliveriesService = { orderDos: jest.fn(async () => [{ id: 'd1', name: 'DO202611021', config: { orderId: 'o1', billTo: '1 Test Road', customerName: 'Ajiya Okonomiyaki Restaurant', documentNumber: 'DO202611021' } }]) };
  svc.ordersService = {
    nativeInvoiceRemainder: jest.fn(async () => ({
      canInvoiceRemaining: true,
      invoiceLines: [
        { description: 'Kitchen exhaust hood and ducting cleaning', quantity: 1, unitPrice: 800, amount: 800, priced: true },
        { description: 'S- Area cleaning', quantity: 1, unitPrice: 0, amount: 0, priced: false },
      ],
      draft: null,
      summary: { remaining: { remainingGross: 872, matched: true } },
      ...(opts.plan ?? {}),
    })),
  };
  svc.resolveTemplateIdForType = jest.fn(async () => 'tpl-inv');
  svc.createBasicDocument = jest.fn(async (_t: string, type: string, _o: string, config: any) => ({ id: 'inv2', name: 'INV202611-0025', type, config, documentTemplateId: 'tpl-inv' }));
  svc.repostGlForDocument = jest.fn(async () => undefined);
  return { svc, order, db };
}

describe('Create invoice for what is left on an AIMS order (POST /orders/:id/invoice-remaining)', () => {
  it('a draft for the remaining lines, header from the DO, the org next INV number (lockedNumber), linked as remainder', async () => {
    const { svc, order } = world();
    const out = await svc.invoiceImportedOrderRemainder('o1', ORG, { number: 'I-999-02' });
    expect(out).toMatchObject({ id: 'inv2', name: 'INV202611-0025' });
    const [tpl, type, org, config, , , override, flags] = svc.createBasicDocument.mock.calls[0];
    expect([tpl, type, org, override, flags]).toEqual(['tpl-inv', 'INVOICE', ORG, undefined, { lockedNumber: true }]);
    expect(config.documentNumber).toBeUndefined();
    expect(config.items.map((l: any) => [l.description, l.quantity, l.unitPrice, l.amount])).toEqual([
      ['Kitchen exhaust hood and ducting cleaning', 1, 800, 800],
      ['S- Area cleaning', 1, 0, 0],
    ]);
    // The quotation line's item code and account come with it.
    expect(config.items[0]).toMatchObject({ itemCode: 'SVC-HOOD', accountCode: '4000' });
    expect(config).toMatchObject({ orderId: 'o1', orderNo: 'ORD202611-021', sourceDocumentId: 'q1', billTo: '1 Test Road', nettTotal: 872, totalWithTax: 872, outstandingBalance: 872, paidToDate: 0 });
    expect(order.linkedDocuments.invoice).toEqual([{ id: 'i1', name: 'INV202611-0012', jobIds: [] }, { id: 'inv2', name: 'INV202611-0025', jobIds: [], remainder: true }]);
    expect(order.invoiceDocumentId).toBe('inv2');
    expect(order.linkedDocuments.invoiceClaim).toBeUndefined();
    expect(svc.repostGlForDocument).toHaveBeenCalledTimes(1);
  });
  it('edited lines are billed as the office gave them', async () => {
    const { svc } = world();
    await svc.invoiceImportedOrderRemainder('o1', ORG, { lines: [{ description: 'Hood cleaning, 2nd visit', quantity: 1, unitPrice: 750 }] });
    expect(svc.createBasicDocument.mock.calls[0][3].items.map((l: any) => [l.description, l.amount])).toEqual([['Hood cleaning, 2nd visit', 750]]);
  });
  it('refused: billed in full, a draft open on the order, a cancelled order, another run creating one; the claim is always released', async () => {
    const full = world({ plan: { canInvoiceRemaining: false, invoiceLines: [] } });
    await expect(full.svc.invoiceImportedOrderRemainder('o1', ORG)).rejects.toThrow(/Nothing left to bill/);
    expect(full.order.linkedDocuments.invoiceClaim).toBeUndefined();
    const draft = world({ plan: { canInvoiceRemaining: false, draft: { id: 'i9', name: 'INV202611-0024' } } });
    await expect(draft.svc.invoiceImportedOrderRemainder('o1', ORG)).rejects.toThrow(/already has a draft invoice \(INV202611-0024\)/);
    await expect(world({ status: 'CANCELLED' }).svc.invoiceImportedOrderRemainder('o1', ORG)).rejects.toThrow(/cancelled/);
    const busy = world({ linkedDocuments: { invoice: [], invoiceClaim: { id: 'x', at: new Date().toISOString() } } });
    await expect(busy.svc.invoiceImportedOrderRemainder('o1', ORG)).rejects.toThrow(/being created/);
    for (const w of [full, draft, busy]) expect(w.svc.createBasicDocument).not.toHaveBeenCalled();
  });
  it('another org (an AIMS order without invoicing per order): never the AIMS remainder path', async () => {
    const other = world({ features: { enableImportedOrders: true } });
    await expect(other.svc.invoiceImportedOrderRemainder('o1', ORG)).rejects.toBeInstanceOf(HttpException);
    expect(other.svc.ordersService.nativeInvoiceRemainder).not.toHaveBeenCalled();
    const none = world({ features: {} });
    await expect(none.svc.invoiceImportedOrderRemainder('o1', ORG)).rejects.toThrow(/Order not found/);
    expect(none.svc.createBasicDocument).not.toHaveBeenCalled();
  });
});

describe('every order invoice takes the org next INV number (createOrderInvoice)', () => {
  it('invoice from the quotation (manual flow): lockedNumber, the DO number never carried', async () => {
    const { svc, order } = world({ linkedDocuments: { po: [], do: [], invoice: [], salesOrder: [] } });
    order.invoiceDocumentId = null;
    await svc.invoiceOrderFromQuotation('o1', ORG);
    const call = svc.createBasicDocument.mock.calls[0];
    expect(call[7]).toEqual({ lockedNumber: true });
    expect(call[3].documentNumber).toBeUndefined();
  });
  it('createOrderInvoice drops a carried documentNumber (top level and documentInfo) and returns the template id', async () => {
    const { svc } = world();
    svc.createBasicDocument = jest.fn(async (_t: string, _type: string, _o: string, config: any) => ({ id: 'x', name: 'INV202611-0026', config }));
    const out = await svc.createOrderInvoice(ORG, { documentNumber: 'DO1', documentInfo: { documentNumber: 'DO1', referenceNo: 'R' }, items: [] });
    expect(out.documentTemplateId).toBe('tpl-inv');
    const cfg = svc.createBasicDocument.mock.calls[0][3];
    expect(cfg.documentNumber).toBeUndefined();
    expect(cfg.documentInfo).toEqual({ referenceNo: 'R' });
  });
});

describe('createBasicDocument: the unchanged path vs lockedNumber', () => {
  function basic() {
    const tx: any = { $executeRawUnsafe: jest.fn(async () => 1), document: { findMany: jest.fn(async () => []), create: jest.fn(async ({ data }: any) => ({ id: 'n1', ...data })) } };
    const db: any = {
      organization: { findUnique: jest.fn(async () => ({ customDocumentTypes: null, taxRate: 9, taxApplicable: true })) },
      documentTemplate: { findUnique: jest.fn(async () => ({ templateVariant: 'INV', config: {} })) },
      document: { findMany: jest.fn(async () => [{ name: 'INV202611-004' }]), create: jest.fn(async ({ data }: any) => ({ id: 'n0', ...data })) },
      $transaction: jest.fn(async (fn: any) => fn(tx)),
    };
    const svc: any = Object.create(DocumentsService.prototype);
    svc.prisma = db;
    svc.documentNumbering = {
      generateNumber: jest.fn(async () => 'INV202611-0025'),
      issueNumberLocked: jest.fn(async (_o: string, _t: string, _f: any, _w: any, t: any) => (t === tx ? 'INV202611-0026' : null)),
      releaseNumberIfLatest: jest.fn(async () => false),
    };
    svc.syncDocumentItems = jest.fn(async () => undefined);
    svc.logDocumentEvent = jest.fn(async () => undefined);
    return { svc, db, tx };
  }
  it('no option (every other caller, every other org): generateNumber then a plain create, no transaction', async () => {
    const { svc, db, tx } = basic();
    const doc = await svc.createBasicDocument('tpl', 'INVOICE', 'org-other', { items: [] });
    expect(doc.name).toBe('INV202611-0025');
    expect(svc.documentNumbering.generateNumber).toHaveBeenCalledTimes(1);
    expect(db.document.create).toHaveBeenCalledTimes(1);
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(tx.document.create).not.toHaveBeenCalled();
  });
  it('lockedNumber: the number is claimed in the transaction that writes the row (generateNumber never called)', async () => {
    const { svc, db, tx } = basic();
    const doc = await svc.createBasicDocument('tpl', 'INVOICE', ORG, { items: [] }, undefined, undefined, undefined, { lockedNumber: true });
    expect(doc.name).toBe('INV202611-0026');
    expect(svc.documentNumbering.generateNumber).not.toHaveBeenCalled();
    expect(db.document.create).not.toHaveBeenCalled();
    expect(tx.document.create).toHaveBeenCalledTimes(1);
    expect(svc.logDocumentEvent.mock.calls[0][0]).toMatchObject({ detail: 'INV202611-0026 created', documentName: 'INV202611-0026' });
  });
  it('lockedNumber with no number format: the legacy INV<yyyymm>-NNN read inside the transaction', async () => {
    const { svc, tx } = basic();
    svc.documentNumbering.issueNumberLocked = jest.fn(async () => null);
    tx.document.findMany = jest.fn(async () => [{ name: 'INV202611-007' }]);
    const doc = await svc.createBasicDocument('tpl', 'INVOICE', ORG, {}, undefined, undefined, undefined, { lockedNumber: true });
    expect(doc.name).toMatch(/^INV\d{6}-\d{3}$/);
  });
  it('lockedNumber but a typed number or a name override: those win, as before', async () => {
    const { svc, db } = basic();
    const a = await svc.createBasicDocument('tpl', 'INVOICE', ORG, { documentNumber: 'X-1' }, undefined, undefined, undefined, { lockedNumber: true });
    expect(a.name).toBe('X-1');
    const b = await svc.createBasicDocument('tpl', 'INVOICE', ORG, {}, undefined, undefined, 'DO-PENDING-01', { lockedNumber: true });
    expect(b.name).toBe('DO-PENDING-01');
    expect(db.$transaction).not.toHaveBeenCalled();
  });
});
