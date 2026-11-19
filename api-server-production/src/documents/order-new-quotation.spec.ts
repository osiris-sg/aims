import { DocumentsService } from './documents.service';
import { PENDING_ORDER_LINK_KEY } from '../orders/order-list-add';

// Round 38 (WCT orders): the Orders list "+" Quotation. A new draft quotation, prefilled with the order's customer and
// site, carries a pending link; its first save makes it the order's quotation.
const ORDER_ID = '0f6c1d2e-3b4a-4c5d-8e9f-0a1b2c3d4e5f';
const customer = { id: 'c1', name: 'TEST Client', customerCode: 'T001', address: '1 Test Road', email: 'x@y.z', phone: null, gstRegNo: null };

function make(order: any, features: Record<string, unknown> = { enableWctOrders: true }) {
  const writes: any[] = [];
  const created: any[] = [];
  const prisma: any = {
    organizationUIConfig: { findUnique: jest.fn(async () => ({ features })) },
    order: {
      findFirst: jest.fn(async () => order),
      updateMany: jest.fn(async (a: any) => {
        writes.push(a);
        if (a.data.sourceQuotationId) return { count: order && !order.sourceQuotationId ? 1 : 0 };
        return { count: 1 };
      }),
    },
    document: { findFirst: jest.fn(async () => null) },
  };
  const svc: any = Object.create(DocumentsService.prototype);
  Object.assign(svc, {
    prisma,
    resolveTemplateIdForType: jest.fn(async () => 'tq'),
    createBasicDocument: jest.fn(async (templateId: string, type: string, org: string, config: any) => {
      created.push({ templateId, type, org, config });
      return { id: 'q9', name: 'QO202611-0050', documentTemplateId: 'tq' };
    }),
    logDocumentEvent: jest.fn(async () => undefined),
  });
  return { svc, writes, created };
}

describe('Orders list "+" Quotation', () => {
  const order = { id: ORDER_ID, orderNumber: 'ORDW202611-001', status: 'DO_DRAFT', sourceQuotationId: null, customerId: 'c1', linkedDocuments: {}, customer, deliveries: [{ siteAddress: '5 Site Lane', deliveryNumber: 3 }] };

  it("makes a draft quotation with the order's customer, site and the pending link, the way Sales makes one", async () => {
    const { svc, created } = make(order);
    const out = await svc.newQuotationForOrder(ORDER_ID, 'org', { id: 'u1' });
    expect(out).toEqual({ id: 'q9', name: 'QO202611-0050', type: 'QUOTATION', orderNumber: 'ORDW202611-001', href: `/portal/documents/QUOTATION/tq/q9` });
    expect(created[0]).toMatchObject({ templateId: 'tq', type: 'QUOTATION', org: 'org' });
    expect(created[0].config).toMatchObject({ customerId: 'c1', customerName: 'TEST Client', customerAddress: '1 Test Road', location: '5 Site Lane', customer: { id: 'c1', name: 'TEST Client' } });
    expect(created[0].config[PENDING_ORDER_LINK_KEY]).toMatchObject({ orderId: ORDER_ID, orderNumber: 'ORDW202611-001' });
  });

  it('refuses an order with a quotation, a cancelled or imported order, and orgs without WCT orders', async () => {
    await expect(make({ ...order, sourceQuotationId: 'q1' }).svc.newQuotationForOrder(ORDER_ID, 'org')).rejects.toThrow(/already has a quotation/);
    await expect(make({ ...order, linkedDocuments: { quotation: [{ id: 'q2' }] } }).svc.newQuotationForOrder(ORDER_ID, 'org')).rejects.toThrow(/already has a quotation/);
    await expect(make({ ...order, status: 'CANCELLED' }).svc.newQuotationForOrder(ORDER_ID, 'org')).rejects.toThrow(/cancelled/);
    await expect(make({ ...order, linkedDocuments: { imported: { source: 'erp-import' } } }).svc.newQuotationForOrder(ORDER_ID, 'org')).rejects.toThrow(/imported order/);
    const other = make(order, {});
    await expect(other.svc.newQuotationForOrder(ORDER_ID, 'org')).rejects.toThrow(/not on/);
    expect(other.created).toEqual([]);
  });

  it("the first save links it as the order's quotation (only while the order has none)", async () => {
    const { svc, writes } = make(order);
    const no = await svc.linkPendingQuotation(ORDER_ID, 'org', { id: 'q9', name: 'QO202611-0050', config: { customerId: 'c1' } });
    expect(no).toBe('ORDW202611-001');
    expect(writes[0]).toEqual({ where: { id: ORDER_ID, organizationId: 'org', sourceQuotationId: null }, data: { sourceQuotationId: 'q9' } });
    const taken = make({ ...order, sourceQuotationId: 'q1' });
    expect(await taken.svc.linkPendingQuotation(ORDER_ID, 'org', { id: 'q9', name: null, config: {} })).toBeNull();
    expect(taken.writes).toEqual([]);
  });
});
