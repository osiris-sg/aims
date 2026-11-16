import { HttpException } from '@nestjs/common';
import { deriveManualOrderStatusFromUnits, MANUAL_ORDER_STATUS_LABEL } from './manual-order-flow';
import { orderInvoiceIdsOf } from './wct-orders';
import { DocumentsService } from '../documents/documents.service';

/**
 * Invoice and DO in either order (WCT manual order flow, 2026-11-16; WCT
 * usually invoices first, then delivers).
 */
const U = (state: any, invoiceId: string | null = null) => ({ state, invoiceId });
const ORG = 'org-wct';
const MANUAL = { features: { enableWctOrders: true, enableManualOrderFlow: true, enableWctOrderInvoice: true } };

describe('order status, invoice first', () => {
  it('walks: signed → invoice draft → invoiced → DO done → ready for service report → paid → sent', () => {
    expect(deriveManualOrderStatusFromUnits([U('draft')])).toBe('DO_DRAFT');
    expect(deriveManualOrderStatusFromUnits([U('draft')], { invoiceStatuses: ['draft'] })).toBe('INVOICE_DRAFT_DO_PENDING');
    expect(deriveManualOrderStatusFromUnits([U('scheduled')], { invoiceStatuses: ['pending_payment'] })).toBe('INVOICED_DO_PENDING');
    expect(deriveManualOrderStatusFromUnits([U('awaiting')], { invoiceStatuses: ['paid'] })).toBe('INVOICED_DO_PENDING');
    // The DO completes; until the auto run links it (same request), it reads as "invoice pending".
    expect(deriveManualOrderStatusFromUnits([U('done')], { invoiceStatuses: ['pending_payment'] })).toBe('DO_COMPLETED');
    expect(deriveManualOrderStatusFromUnits([U('done', 'i1')], { invoiceStatuses: ['pending_payment'] })).toBe('READY_FOR_SERVICE_REPORT');
    expect(deriveManualOrderStatusFromUnits([U('done', 'i1')], { invoiceStatuses: ['paid'] })).toBe('PAID');
    expect(deriveManualOrderStatusFromUnits([U('done', 'i1')], { invoiceStatuses: ['paid'], serviceReportSent: true })).toBe('SERVICE_REPORT_SENT');
  });

  it('a report sent while the DO is pending does not finish the order', () => {
    expect(deriveManualOrderStatusFromUnits([U('scheduled')], { invoiceStatuses: ['pending_payment'], serviceReportSent: true })).toBe('INVOICED_DO_PENDING');
  });

  it('an order with no DO but an invoice reads invoiced, DO pending', () => {
    expect(deriveManualOrderStatusFromUnits([], { invoiceStatuses: ['draft'] })).toBe('INVOICE_DRAFT_DO_PENDING');
    expect(deriveManualOrderStatusFromUnits([])).toBe('QUOTATION_SIGNED');
  });
});

describe('order status, DO first (as before)', () => {
  it('walks: DO draft → scheduled → completed (invoice pending) → invoice draft → ready → paid → sent', () => {
    expect(deriveManualOrderStatusFromUnits([U('draft')])).toBe('DO_DRAFT');
    expect(deriveManualOrderStatusFromUnits([U('scheduled')])).toBe('DO_SCHEDULED');
    expect(deriveManualOrderStatusFromUnits([U('awaiting')])).toBe('AWAITING_VERIFICATION');
    expect(deriveManualOrderStatusFromUnits([U('done')])).toBe('DO_COMPLETED');
    expect(deriveManualOrderStatusFromUnits([U('done', 'i1')], { invoiceStatuses: ['unconfirmed'] })).toBe('INVOICE_DRAFT');
    expect(deriveManualOrderStatusFromUnits([U('done', 'i1')], { invoiceStatuses: ['pending_payment'] })).toBe('READY_FOR_SERVICE_REPORT');
    expect(deriveManualOrderStatusFromUnits([U('done', 'i1')], { invoiceStatuses: ['paid'] })).toBe('PAID');
    expect(deriveManualOrderStatusFromUnits([U('done', 'i1')], { invoiceStatuses: ['paid'], serviceReportSent: true })).toBe('SERVICE_REPORT_SENT');
  });

  it('a second DO still open after the first was invoiced: invoiced, DO pending', () => {
    expect(deriveManualOrderStatusFromUnits([U('done', 'i1'), U('draft')], { invoiceStatuses: ['pending_payment'] })).toBe('INVOICED_DO_PENDING');
  });

  it('labels', () => {
    expect(MANUAL_ORDER_STATUS_LABEL.DO_COMPLETED).toBe('DO completed, invoice pending');
    expect(MANUAL_ORDER_STATUS_LABEL.INVOICED_DO_PENDING).toBe('Invoiced, DO pending');
    expect(MANUAL_ORDER_STATUS_LABEL.READY_FOR_SERVICE_REPORT).toBe('Ready for service report');
    // Stored before the change: still has a label.
    expect(MANUAL_ORDER_STATUS_LABEL.INVOICED).toBe('Invoiced');
  });
});

describe('orderInvoiceIdsOf', () => {
  it('reads linkedDocuments.invoice and invoiceDocumentId, deduped', () => {
    expect(orderInvoiceIdsOf({ linkedDocuments: { invoice: [{ id: 'a' }, { id: 'b' }, {}] }, invoiceDocumentId: 'a' })).toEqual(['a', 'b']);
    expect(orderInvoiceIdsOf({ linkedDocuments: null, invoiceDocumentId: null })).toEqual([]);
    expect(orderInvoiceIdsOf(null)).toEqual([]);
  });
});

/** A DocumentsService with an in-memory order, quotation and DO. */
function world(opts: { existingInvoice?: boolean; features?: any; claim?: any } = {}) {
  const order: any = {
    id: 'o1',
    orderNumber: 'ORD202611-020',
    status: 'DO_DRAFT',
    sourceQuotationId: 'q1',
    invoiceDocumentId: opts.existingInvoice ? 'inv0' : null,
    linkedDocuments: { po: [], do: [], invoice: opts.existingInvoice ? [{ id: 'inv0', name: 'INV202611-0010' }] : [], salesOrder: [], ...(opts.claim ? { invoiceClaim: opts.claim } : {}) },
  };
  const quotation = {
    id: 'q1',
    name: 'QO202611-0030',
    config: { items: [{ description: 'Chemical degreasing of hood', quantity: 1, unitPrice: 800, amount: 800 }], gstPercent: 9, taxApplicable: 'Y', customerName: 'TEST Client' },
  };
  const draftDo = { id: 'd1', name: 'DO202611030', status: 'unconfirmed', config: { orderId: 'o1', customerName: 'TEST Client', billTo: '1 Test Road', documentNumber: 'DO202611030', items: [{ description: 'Chemical degreasing of hood', quantity: 1 }] } };
  const db: any = {
    organizationUIConfig: { findUnique: jest.fn(async () => opts.features ?? MANUAL) },
    order: {
      findFirst: jest.fn(async () => order),
      update: jest.fn(async ({ data }: any) => Object.assign(order, data)),
    },
    document: {
      findFirst: jest.fn(async ({ where }: any) => {
        if (where.id === 'q1') return quotation;
        if (where.type === 'INVOICE' && where.id?.in?.includes('inv0') && opts.existingInvoice) return { name: 'INV202611-0010' };
        return null;
      }),
      findMany: jest.fn(async () => []),
    },
    organization: { findUnique: jest.fn(async () => ({ taxRate: 9, taxApplicable: true })) },
    accountingSetting: { findUnique: jest.fn(async () => ({ timeZone: 'Asia/Singapore' })) },
    delivery: { findMany: jest.fn(async () => []) },
    $executeRawUnsafe: jest.fn(async () => 1),
  };
  db.$transaction = jest.fn(async (fn: any) => fn(db));
  const svc: any = Object.create(DocumentsService.prototype);
  svc.prisma = db;
  svc.deliveriesService = { orderDos: jest.fn(async () => [draftDo]), jobsOnDo: jest.fn(async () => []) };
  svc.resolveTemplateIdForType = jest.fn(async () => 'tpl-inv');
  svc.createBasicDocument = jest.fn(async (_t: string, type: string, _o: string, config: any) => ({ id: 'inv1', name: 'INV202611-0013', type, config }));
  svc.repostGlForDocument = jest.fn(async () => undefined);
  return { svc, order, db };
}

describe('Create invoice from the quotation (invoice first)', () => {
  it('bills the quotation once, header from the order DO, recorded on the order and not on the DO', async () => {
    const { svc, order } = world();
    const inv = await svc.invoiceOrderFromQuotation('o1', ORG);
    expect(inv).toMatchObject({ id: 'inv1', name: 'INV202611-0013' });
    const [, type, org, config] = svc.createBasicDocument.mock.calls[0];
    expect(type).toBe('INVOICE');
    expect(org).toBe(ORG);
    expect(config.items).toHaveLength(1);
    expect(config.items[0]).toMatchObject({ description: 'Chemical degreasing of hood', fromQuotation: true });
    expect(config).toMatchObject({ orderId: 'o1', orderNo: 'ORD202611-020', orderBillsQuote: true, orderInvoicedFirst: true, sourceDocumentId: 'q1', customerName: 'TEST Client', billTo: '1 Test Road' });
    expect(config.documentNumber).toBeUndefined(); // the DO's own number is not copied
    expect(config.grandTotal ?? config.nettTotal).toBeGreaterThan(800); // GST on top
    expect(order.invoiceDocumentId).toBe('inv1');
    expect(order.linkedDocuments.invoice).toEqual([{ id: 'inv1', name: 'INV202611-0013', jobIds: [], fromQuotation: true }]);
    expect(order.linkedDocuments.invoiceClaim).toBeUndefined(); // the claim is released
    expect(svc.repostGlForDocument).toHaveBeenCalled(); // posting rules (postInvoicesOnConfirm) apply inside, unchanged
  });

  it('refuses when the order already has an invoice (billed once)', async () => {
    const { svc } = world({ existingInvoice: true });
    await expect(svc.invoiceOrderFromQuotation('o1', ORG)).rejects.toThrow(/already has an invoice \(INV202611-0010\)/);
    expect(svc.createBasicDocument).not.toHaveBeenCalled();
  });

  it('refuses while another click is creating it', async () => {
    const { svc } = world({ claim: { id: 'x', at: new Date().toISOString() } });
    await expect(svc.invoiceOrderFromQuotation('o1', ORG)).rejects.toThrow(/being created/);
    expect(svc.createBasicDocument).not.toHaveBeenCalled();
  });

  it('a failed create drops the claim so the next click can retry', async () => {
    const { svc, order } = world();
    svc.createBasicDocument.mockRejectedValueOnce(new Error('numbering down'));
    await expect(svc.invoiceOrderFromQuotation('o1', ORG)).rejects.toThrow(/numbering down/);
    expect(order.linkedDocuments.invoiceClaim).toBeUndefined();
    expect(order.invoiceDocumentId).toBeNull();
  });

  it('only on the manual order flow', async () => {
    const { svc } = world({ features: { features: { enableWctOrders: true } } });
    await expect(svc.invoiceOrderFromQuotation('o1', ORG)).rejects.toBeInstanceOf(HttpException);
    expect(svc.createBasicDocument).not.toHaveBeenCalled();
  });

  it('"Invoice now" with nothing completed bills the quotation (manual flow only)', async () => {
    const { svc } = world();
    svc.invoiceOrderFromQuotation = jest.fn(async () => ({ id: 'inv1' }));
    svc.billableJoblessDos = jest.fn(async () => []);
    await expect(svc.invoiceOrder('o1', ORG, { trigger: 'now' })).resolves.toEqual({ id: 'inv1' });
    // The automatic run never invoices from the quotation.
    await expect(svc.invoiceOrder('o1', ORG, { trigger: 'auto' })).resolves.toBeNull();
    expect(svc.invoiceOrderFromQuotation).toHaveBeenCalledTimes(1);
  });
});

describe('the DO completes after the invoice: linked, no second invoice', () => {
  it('maybeInvoiceOrder covers the DO with the invoice made first', async () => {
    const { svc, order, db } = world({ existingInvoice: true });
    order.linkedDocuments.invoice = [{ id: 'inv0', name: 'INV202611-0010', fromQuotation: true }];
    const done = { id: 'd1', name: 'DO202611030', status: 'delivered_installed', config: { orderId: 'o1', items: [{ description: 'Chemical degreasing of hood', quantity: 1 }] } };
    svc.deliveriesService.orderDos = jest.fn(async () => [done]);
    const docWrites: any[] = [];
    db.document.findMany = jest.fn(async ({ where }: any) => {
      if (where.type === 'INVOICE') return [{ id: 'inv0', name: 'INV202611-0010' }];
      if (where.id?.in?.includes('d1')) return [{ ...done, type: 'DELIVERY_ORDER' }];
      return [];
    });
    db.document.update = jest.fn(async (a: any) => {
      docWrites.push(a);
      Object.assign(done, { config: a.data.config });
    });
    db.document.findFirst = jest.fn(async ({ where }: any) => (where.id === 'q1' ? { name: 'QO202611-0030', config: { items: [{ description: 'Chemical degreasing of hood', quantity: 1, unitPrice: 800 }] } } : null));
    db.deliveryItem = { findMany: jest.fn(async () => []) };
    db.delivery.updateMany = jest.fn(async () => ({ count: 0 }));
    db.asset = { findMany: jest.fn(async () => []) };
    const out: any = await svc.maybeInvoiceOrder('o1', ORG);
    expect(out).toMatchObject({ id: 'inv0', covered: true });
    expect(svc.createBasicDocument).not.toHaveBeenCalled();
    expect(done.config).toMatchObject({ orderInvoiceId: 'inv0' });
    expect(docWrites.length).toBeGreaterThan(0);
  });
});
