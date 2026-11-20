jest.mock('../deliveries/quotation-to-delivery', () => ({ ensureQuotationOrder: jest.fn() }));
import { ensureQuotationOrder } from '../deliveries/quotation-to-delivery';
import { DocOrderRefService } from './doc-order-ref.service';
import { fillLinesOf, isAcceptedQuotation, isOpenRefOption, orderRefLabel, refDocKind } from './doc-order-ref';

// Round 39 (WCT group, Elroy 2026-11-20): the invoice / DO editors' Reference = order link.
const ORG = 'org';
const INV = '11111111-1111-4111-8111-111111111111';
const QO = '22222222-2222-4222-8222-222222222222';
const ORD = '33333333-3333-4333-8333-333333333333';
const CUST = '44444444-4444-4444-8444-444444444444';
const ON = { enableWctOrders: true, enableManualOrderFlow: true };

function make(opts: { features?: any; doc?: any; quotation?: any; order?: any; holders?: any[] } = {}) {
  const writes: any[] = [];
  const doc = opts.doc ?? { id: INV, name: 'INV202611-0031', type: 'INVOICE', status: 'draft', config: { customerId: CUST, customer: { id: CUST, name: 'TEST Client' } } };
  const quotation = opts.quotation ?? { id: QO, name: 'QO202611-0051', type: 'QUOTATION', status: 'confirmed', config: { customerId: CUST, customer: { id: CUST } } };
  let order: any = opts.order === undefined ? { id: ORD, orderNumber: 'ORDW202611-004', status: 'OPEN', linkedDocuments: {}, sourceQuotation: { id: QO, name: 'QO202611-0051' } } : opts.order;
  const prisma: any = {
    organizationUIConfig: { findUnique: jest.fn(async () => ({ features: opts.features ?? ON })) },
    document: {
      findFirst: jest.fn(async ({ where }: any) => (where.id === INV ? doc : where.id === QO ? quotation : null)),
      update: jest.fn(async (a: any) => {
        writes.push(['document.update', a.data.config]);
        doc.config = a.data.config;
      }),
      findMany: jest.fn(async () => []),
    },
    order: {
      findFirst: jest.fn(async ({ where }: any) => (where.sourceQuotationId ? order : where.id === order?.id ? order : null)),
      findMany: jest.fn(async () => (opts.holders ?? [])),
    },
    deliveryItem: { findMany: jest.fn(async () => []) },
    delivery: { findMany: jest.fn(async () => []) },
    customer: { findFirst: jest.fn(async () => ({ id: CUST, name: 'TEST Client', address: '1 Test Road', email: null, customerCode: 'T001', gstRegNo: null })) },
  };
  const orders: any = {
    linkImportedDocument: jest.fn(async () => {
      if (order) order.linkedDocuments = { invoice: [{ id: INV, name: doc.name, linked: { at: 'x' } }], do: [{ id: INV, name: doc.name, linked: { at: 'x' } }] };
      prisma.order.findMany = jest.fn(async () => (order ? [order] : []));
      return { type: 'INVOICE', id: INV };
    }),
    unlinkImportedDocument: jest.fn(async () => ({})),
    getById: jest.fn(),
  };
  return { svc: new DocOrderRefService(prisma, orders), prisma, orders, writes, doc, setOrder: (o: any) => (order = o) };
}

beforeEach(() => (ensureQuotationOrder as jest.Mock).mockReset());

describe('Reference = order link: helpers', () => {
  it('label, kinds, accepted, open', () => {
    expect(orderRefLabel('ORDW202611-004', 'QO202611-0051')).toBe('ORDW202611-004 · QO202611-0051');
    expect([refDocKind('INVOICE'), refDocKind('DO'), refDocKind('QUOTATION')]).toEqual(['INVOICE', 'DELIVERY_ORDER', null]);
    expect(isAcceptedQuotation({ type: 'QUOTATION', status: 'confirmed', config: {} })).toBe(true);
    expect(isAcceptedQuotation({ type: 'QUOTATION', status: 'unconfirmed', config: {} })).toBe(false);
    // An old ERP quotation still a Draft in the ERP is not accepted.
    expect(isAcceptedQuotation({ type: 'QUOTATION', status: 'confirmed', config: { date: '2026-11-01', erpImport: { source: 'wct-erp', status: 'Draft' } } }, '2026-11-20')).toBe(false);
    expect(isAcceptedQuotation({ type: 'QUOTATION', status: 'confirmed', config: { erpImport: { source: 'wct-erp', status: 'Accepted' } } })).toBe(true);
    expect(isOpenRefOption({ accepted: true, billedPct: 40, orderCancelled: false, noOrderPossible: false })).toBe(true);
    expect(isOpenRefOption({ accepted: true, billedPct: 100, orderCancelled: false, noOrderPossible: false })).toBe(false);
  });

  it('fill lines: what is left, else the whole quotation while nothing is billed', () => {
    const q = [{ description: 'Degreasing', quantity: 1, unitPrice: 500, amount: 500, priced: true }];
    expect(fillLinesOf([{ description: 'Degreasing', quantity: 1, unitPrice: 200, amount: 200, priced: true }], q, 300)).toEqual([{ description: 'Degreasing', quantity: 1, unitPrice: 200, amount: 200 }]);
    expect(fillLinesOf([], q, 0)).toEqual([{ description: 'Degreasing', quantity: 1, unitPrice: 500, amount: 500 }]);
    expect(fillLinesOf([], q, 500)).toEqual([]);
  });
});

describe('DocOrderRefService', () => {
  it('links a draft invoice to the quotation\'s order and its Reference reads "ORD… · QO…"', async () => {
    const { svc, orders, writes } = make();
    const out: any = await svc.link(ORG, { documentId: INV, quotationId: QO }, { id: 'u1', name: 'Amy' });
    expect(orders.linkImportedDocument).toHaveBeenCalledWith(ORD, ORG, { type: 'INVOICE', id: INV }, { id: 'u1', name: 'Amy' });
    expect(out).toMatchObject({ orderNumber: 'ORDW202611-004', label: 'ORDW202611-004 · QO202611-0051', reference: 'ORDW202611-004 · QO202611-0051', createdOrder: false, unlinkable: true });
    expect(writes.at(-1)[1].referenceNo).toBe('ORDW202611-004 · QO202611-0051');
    expect(ensureQuotationOrder).not.toHaveBeenCalled();
  });

  it('a confirmed invoice is linked only: no write to the document', async () => {
    const { svc, orders, writes } = make({ doc: { id: INV, name: 'INV202611-0020', type: 'INVOICE', status: 'confirmed', config: { customerId: CUST } } });
    const out: any = await svc.link(ORG, { documentId: INV, quotationId: QO }, {});
    expect(orders.linkImportedDocument).toHaveBeenCalled();
    expect(out.reference).toBeNull();
    expect(writes).toEqual([]);
  });

  it('makes the order when the quotation has none (the order flow\'s own creator)', async () => {
    const t = make({ order: null });
    (ensureQuotationOrder as jest.Mock).mockImplementation(async () => {
      t.setOrder({ id: ORD, orderNumber: 'ORDW202611-005', status: 'OPEN', linkedDocuments: {}, sourceQuotation: { id: QO, name: 'QO202611-0051' } });
      return { orderId: ORD, orderNumber: 'ORDW202611-005', created: true };
    });
    const out: any = await t.svc.link(ORG, { documentId: INV, quotationId: QO }, {});
    expect(ensureQuotationOrder).toHaveBeenCalledWith(t.prisma, ORG, expect.objectContaining({ id: QO }));
    expect(out).toMatchObject({ createdOrder: true, orderNumber: 'ORDW202611-005' });
  });

  it('a draft with no customer takes the quotation\'s customer', async () => {
    const { svc, writes } = make({ doc: { id: INV, name: 'INV202611-0032', type: 'INVOICE', status: 'draft', config: {} } });
    const out: any = await svc.link(ORG, { documentId: INV, quotationId: QO }, {});
    expect(out.customer).toMatchObject({ id: CUST, name: 'TEST Client' });
    expect(writes[0][1]).toMatchObject({ customerId: CUST, customer: { id: CUST, name: 'TEST Client' }, billTo: '1 Test Road' });
  });

  it('refuses before making any order: another customer, another order, a non-manual-flow invoice, an old ERP quotation with no order', async () => {
    const other = make({ quotation: { id: QO, name: 'QO1', type: 'QUOTATION', status: 'confirmed', config: { customerId: 'someone-else' } } });
    await expect(other.svc.link(ORG, { documentId: INV, quotationId: QO }, {})).rejects.toThrow(/another customer/);
    const held = make({ order: null, holders: [{ id: 'o9', orderNumber: 'ORDW202611-001', linkedDocuments: { invoice: [{ id: INV }] } }] });
    await expect(held.svc.link(ORG, { documentId: INV, quotationId: QO }, {})).rejects.toThrow(/already on order ORDW202611-001/);
    const racking = make({ features: { enableWctOrders: true } });
    await expect(racking.svc.link(ORG, { documentId: INV, quotationId: QO }, {})).rejects.toThrow(/linked invoices/);
    const erp = make({ order: null, features: { ...ON, enableImportedOrders: true }, quotation: { id: QO, name: 'Q-014000', type: 'QUOTATION', status: 'confirmed', config: { customerId: CUST, erpImport: { source: 'wct-erp', status: 'Accepted' } } } });
    await expect(erp.svc.link(ORG, { documentId: INV, quotationId: QO }, {})).rejects.toThrow(/old ERP/);
    expect(ensureQuotationOrder).not.toHaveBeenCalled();
    for (const t of [other, held, racking, erp]) expect(t.orders.linkImportedDocument).not.toHaveBeenCalled();
  });

  it('a DO links the same way (Racking too: DOs need no manual flow)', async () => {
    const { svc, orders } = make({ features: { enableWctOrders: true }, doc: { id: INV, name: 'DO202611030', type: 'DELIVERY_ORDER', status: 'draft', config: { customerId: CUST } } });
    await svc.link(ORG, { documentId: INV, quotationId: QO }, {});
    expect(orders.linkImportedDocument).toHaveBeenCalledWith(ORD, ORG, { type: 'DELIVERY_ORDER', id: INV }, {});
  });

  it('unlink: off the order, and a draft\'s Reference that only named the link is cleared', async () => {
    const t = make({ holders: [{ id: ORD, orderNumber: 'ORDW202611-004', linkedDocuments: { invoice: [{ id: INV }] } }] });
    t.doc.config = { ...t.doc.config, referenceNo: 'ORDW202611-004 · QO202611-0051' };
    t.setOrder({ id: ORD, orderNumber: 'ORDW202611-004', status: 'OPEN', linkedDocuments: { invoice: [{ id: INV }] }, sourceQuotation: { id: QO, name: 'QO202611-0051' } });
    const out: any = await t.svc.unlink(ORG, { documentId: INV }, {});
    expect(t.orders.unlinkImportedDocument).toHaveBeenCalledWith(ORD, ORG, { type: 'INVOICE', id: INV }, {});
    expect(out.clearedReference).toBe(true);
    expect(t.writes.at(-1)[1].referenceNo).toBe('');
  });

  it('other orgs unchanged: without WCT orders every call refuses and nothing is written', async () => {
    const t = make({ features: {} });
    await expect(t.svc.options(ORG, {})).rejects.toThrow(/Not available/);
    await expect(t.svc.link(ORG, { documentId: INV, quotationId: QO }, {})).rejects.toThrow(/Not available/);
    await expect(t.svc.unlink(ORG, { documentId: INV }, {})).rejects.toThrow(/Not available/);
    await expect(t.svc.docLink(ORG, INV)).rejects.toThrow(/Not available/);
    expect(t.writes).toEqual([]);
    expect(t.orders.linkImportedDocument).not.toHaveBeenCalled();
  });

  it('remaining lines for an empty invoice', async () => {
    const t = make();
    t.orders.getById.mockResolvedValue({ orderNumber: 'ORDW202611-004', summary: { billed: 0, remaining: { lines: [] } }, sourceQuotation: { id: QO } });
    t.prisma.document.findFirst = jest.fn(async () => ({ config: { items: [{ description: 'Hood cleaning', quantity: 2, unitPrice: 150 }, { isGroupHeader: true, description: 'Group' }] } }));
    const out = await t.svc.remainingLines(ORG, ORD);
    expect(out).toEqual({ orderNumber: 'ORDW202611-004', lines: [{ description: 'Hood cleaning', quantity: 2, unitPrice: 150, amount: 300 }] });
  });
});
