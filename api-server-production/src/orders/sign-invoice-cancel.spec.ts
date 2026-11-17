import { DocumentsService } from '../documents/documents.service';
import { OrdersService } from './orders.service';
import { cancelBlockingInvoice, isVoidedWithOrder, voidedWithOrderConfig } from './order-cancel';

/**
 * Manual order flow (2026-11-17):
 *  - signing makes the order's DRAFT invoice at once (as "Create invoice"); other orgs: no;
 *  - "Create invoice" later opens that invoice, never a second one;
 *  - an order whose invoices are all drafts can be cancelled (the drafts are voided, kept);
 *    a sent / paid / posted one blocks; without the manual flow (Racking, others) as before.
 */
const MANUAL = { enableWctOrders: true, enableManualOrderFlow: true, enableWctOrderInvoice: true, postInvoicesOnConfirm: true };

function docsSvc(features: any, order: any, invoices: any[] = []) {
  const prisma: any = {
    organizationUIConfig: { findUnique: jest.fn(async () => ({ features })) },
    order: { findFirst: jest.fn(async () => order) },
    document: { findMany: jest.fn(async () => invoices) },
  };
  const svc: any = Object.create(DocumentsService.prototype);
  const fromQuotation = jest.fn(async () => ({ id: 'inv-new', name: 'INV202611-0020' }));
  const deliveriesService = { prepareManualOrderDo: jest.fn(async () => ({ doId: 'do1', doName: 'DO202611040' })) };
  Object.assign(svc, { prisma, deliveriesService, invoiceOrderFromQuotation: fromQuotation });
  return { svc: svc as DocumentsService, fromQuotation, deliveriesService };
}
const ORDER = { id: 'o1', status: 'QUOTATION_SIGNED', linkedDocuments: { invoice: [] }, invoiceDocumentId: null };

describe('draft invoice at signing', () => {
  it('manual flow: signing (prepareManualOrderDo) makes the DO, then the draft invoice', async () => {
    const { svc, fromQuotation, deliveriesService } = docsSvc(MANUAL, ORDER);
    expect(await svc.prepareManualOrderDo('o1', 'org')).toEqual({ doId: 'do1', doName: 'DO202611040' });
    expect(deliveriesService.prepareManualOrderDo).toHaveBeenCalledWith('o1', 'org');
    expect(fromQuotation).toHaveBeenCalledWith('o1', 'org');
  });

  it.each([
    ['WCT Racking (orders, no manual flow)', { enableWctOrders: true, enableWctOrderInvoice: true, postInvoicesOnConfirm: true }],
    ['manual flow without invoicing per order', { enableWctOrders: true, enableManualOrderFlow: true }],
    ['any other org', {}],
  ])('%s: no invoice at signing', async (_n, features) => {
    const { svc, fromQuotation } = docsSvc(features, ORDER);
    expect(await svc.autoInvoiceAtSigning('o1', 'org')).toBeNull();
    expect(fromQuotation).not.toHaveBeenCalled();
  });

  it('never a second invoice: an order that already has one is skipped', async () => {
    const { svc, fromQuotation } = docsSvc(MANUAL, { ...ORDER, linkedDocuments: { invoice: [{ id: 'inv1' }] } }, [{ id: 'inv1', name: 'INV1', type: 'INVOICE', documentTemplateId: 't', config: {} }]);
    expect(await svc.autoInvoiceAtSigning('o1', 'org')).toBeNull();
    expect(fromQuotation).not.toHaveBeenCalled();
  });

  it('best-effort: a failure never fails the signing', async () => {
    const { svc, fromQuotation } = docsSvc(MANUAL, ORDER);
    fromQuotation.mockRejectedValueOnce(new Error('no lines'));
    expect(await svc.autoInvoiceAtSigning('o1', 'org')).toBeNull();
  });

  it('"Create invoice" later opens the existing invoice', async () => {
    const prisma: any = {
      organizationUIConfig: { findUnique: jest.fn(async () => ({ features: MANUAL })) },
      order: { findFirst: jest.fn(async () => ({ id: 'o1', orderNumber: 'ORD1', sourceQuotationId: 'q1', linkedDocuments: { invoice: [{ id: 'inv1' }] }, invoiceDocumentId: 'inv1' })) },
      delivery: { findMany: jest.fn(async () => []) },
      document: { findMany: jest.fn(async () => [{ id: 'inv1', name: 'INV202611-0020', type: 'INVOICE', documentTemplateId: 't', config: {} }]) },
    };
    const svc: any = Object.create(DocumentsService.prototype);
    const fromQuotation = jest.fn();
    Object.assign(svc, { prisma, invoiceOrderFromQuotation: fromQuotation, billableJoblessDos: jest.fn(async () => []) });
    const out = await svc.invoiceOrder('o1', 'org', { trigger: 'now' });
    expect(out).toEqual({ id: 'inv1', name: 'INV202611-0020', type: 'INVOICE', documentTemplateId: 't', existing: true });
    expect(fromQuotation).not.toHaveBeenCalled();
  });
});

describe('cancel an order with draft invoices', () => {
  function make(features: any, invoices: any[], opts: { payments?: boolean; journal?: boolean } = {}) {
    const updates: any[] = [];
    const tx: any = {
      document: { findFirst: jest.fn(), update: jest.fn(async (a: any) => updates.push(['doc', a])) },
      maintenanceServiceReport: { deleteMany: jest.fn() },
      delivery: { update: jest.fn() },
      order: { update: jest.fn(async (a: any) => updates.push(['order', a])) },
    };
    const prisma: any = {
      organizationUIConfig: { findUnique: jest.fn(async () => ({ features })) },
      order: { findFirst: jest.fn(async () => ({ id: 'o1', orderNumber: 'ORD202611-020', status: 'INVOICE_DRAFT_DO_PENDING', attachments: [], statusDates: {}, linkedDocuments: { invoice: invoices.map((i) => ({ id: i.id })) }, invoiceDocumentId: null })) },
      delivery: { findMany: jest.fn(async () => []) },
      document: {
        findMany: jest.fn(async ({ where }: any) => (where.type?.in?.includes('INVOICE') ? invoices.filter((i) => where.id.in.includes(i.id)) : where.id?.in ? invoices.filter((i) => where.id.in.includes(i.id)) : [])),
        findFirst: jest.fn(async () => (invoices.length ? { name: invoices[0].name } : null)),
      },
      payment: { findFirst: jest.fn(async () => (opts.payments ? { documentId: invoices[0].id } : null)) },
      journalEntry: { findFirst: jest.fn(async () => (opts.journal ? { sourceDocumentId: invoices[0].id } : null)) },
      $transaction: jest.fn(async (fn: any) => fn(tx)),
    };
    const audit = { logAction: jest.fn(async () => undefined) };
    return { svc: new OrdersService(prisma, {} as any, {} as any, undefined, audit as any), updates, audit };
  }
  const draft = (id: string, name: string, config: any = {}) => ({ id, name, type: 'INVOICE', status: 'unconfirmed', config });

  it('manual flow, all drafts (incl. split parts): cancels and voids them, numbers kept', async () => {
    const inv = [draft('i1', 'INV202611-0020-1', { invoiceSplit: { groupId: 'i1', part: 1, of: 2, partIds: ['i1', 'i2'] } }), draft('i2', 'INV202611-0020-2', { invoiceSplit: { groupId: 'i1', part: 2, of: 2 } })];
    const { svc, updates, audit } = make(MANUAL, [inv[0], inv[1]].slice(0, 1).concat(inv[1]));
    const out: any = await svc.cancelWctOrder('o1', 'org');
    expect(out.status).toBe('CANCELLED');
    expect(out.invoicesVoided).toEqual(['INV202611-0020-1', 'INV202611-0020-2']);
    const docs = updates.filter((u) => u[0] === 'doc').map((u) => u[1]);
    expect(docs.map((d) => d.where.id)).toEqual(['i1', 'i2']);
    expect(docs[0].data.config).toMatchObject({ voided: true, cancelledWithOrder: true, cancelledReason: 'Order ORD202611-020 was cancelled', invoiceSplit: { part: 1 } });
    expect(audit.logAction).toHaveBeenCalledTimes(2);
    expect(updates.find((u) => u[0] === 'order')[1].data.status).toBe('CANCELLED');
  });

  it.each([
    ['sent', [{ ...draft('i1', 'INV1'), status: 'pending_payment' }], {}],
    ['paid', [draft('i1', 'INV1')], { payments: true }],
    ['in the ledger', [draft('i1', 'INV1')], { journal: true }],
  ])('a %s invoice blocks the cancel, nothing written', async (_n, inv, opts) => {
    const { svc, updates } = make(MANUAL, inv as any, opts as any);
    await expect(svc.cancelWctOrder('o1', 'org')).rejects.toThrow(/all drafts can be cancelled \(INV1/);
    expect(updates).toHaveLength(0);
  });

  it('without the manual flow (WCT Racking, others): any invoice blocks, as before', async () => {
    const { svc, updates } = make({ enableWctOrders: true }, [draft('i1', 'INV1')]);
    await expect(svc.cancelWctOrder('o1', 'org')).rejects.toThrow("has not started can be cancelled (INV1 is already made on it)");
    expect(updates).toHaveLength(0);
  });

  it('helpers', async () => {
    expect(isVoidedWithOrder(voidedWithOrderConfig({ a: 1 }, 'ORD1', 'now'))).toBe(true);
    expect(isVoidedWithOrder({ voided: true })).toBe(false); // other "voided" docs (ADH etc.) are not these
    expect(await cancelBlockingInvoice({} as any, 'org', [])).toBeNull();
  });
});
