import { HttpException } from '@nestjs/common';
import { DocumentsService } from '../documents/documents.service';
import { PaymentsService } from '../payments/payments.service';

/**
 * Invoices voided with a cancelled order (manual order flow, 2026-11-17):
 * out of the default document list, the only rows under "Voided", and no
 * payment on them. Orgs with none (every org on prod today): the list query is
 * exactly as before. Plus: the draft made at signing sends no staff notice.
 */
function listSvc(voidedIds: string[]) {
  const findMany = jest.fn(async () => []);
  const prisma: any = {
    $queryRaw: jest.fn(async () => voidedIds.map((id) => ({ id }))),
    document: { findMany, count: jest.fn(async () => 0) },
    customer: { findMany: jest.fn(async () => []) },
  };
  const svc: any = Object.create(DocumentsService.prototype);
  Object.assign(svc, { prisma });
  return { svc: svc as DocumentsService, findMany };
}
const whereOf = (m: jest.Mock) => (m.mock.calls[0] as any)[0].where;

describe('document list: voided-with-order invoices', () => {
  it('no such invoices: the query is exactly as before (no extra filter)', async () => {
    const { svc, findMany } = listSvc([]);
    await svc.getDocumentsPaginated('org', { documentTypes: ['INVOICE'], status: 'unconfirmed' });
    expect(whereOf(findMany)).toEqual({ organizationId: 'org', type: { in: ['INVOICE'] }, status: 'unconfirmed' });
    const plain = listSvc([]);
    await plain.svc.getDocumentsPaginated('org', { documentTypes: ['INVOICE'] });
    expect(whereOf(plain.findMany)).toEqual({ organizationId: 'org', type: { in: ['INVOICE'] } });
  });

  it('hidden from the default list', async () => {
    const { svc, findMany } = listSvc(['v1', 'v2']);
    await svc.getDocumentsPaginated('org', { documentTypes: ['INVOICE'] });
    expect(whereOf(findMany)).toEqual({ organizationId: 'org', type: { in: ['INVOICE'] }, AND: [{ id: { notIn: ['v1', 'v2'] } }] });
  });

  it('the "Voided" status filter lists only them (no stored status of that name)', async () => {
    const { svc, findMany } = listSvc(['v1']);
    await svc.getDocumentsPaginated('org', { documentTypes: ['INVOICE'], status: 'voided' });
    expect(whereOf(findMany)).toEqual({ organizationId: 'org', type: { in: ['INVOICE'] }, AND: [{ id: { in: ['v1'] } }] });
  });
});

describe('no payment on a voided invoice', () => {
  it('refused before anything is written', async () => {
    const prisma: any = {
      document: { findFirst: jest.fn(async () => ({ id: 'i1', name: 'INV202611-0020', type: 'INVOICE', status: 'unconfirmed', config: { voided: true, cancelledWithOrder: true } })) },
      $transaction: jest.fn(),
    };
    const svc: any = Object.create(PaymentsService.prototype);
    Object.assign(svc, { prisma });
    await expect(svc.create({ documentId: 'i1', amount: 10 } as any, 'org', 'u1')).rejects.toThrow('voided with its cancelled order');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe('draft invoice made at signing: no staff notice', () => {
  it('invoiceOrderFromQuotation (signing and Create invoice) never emits a notification or WhatsApp', async () => {
    const order = { id: 'o1', orderNumber: 'ORD202611-020', status: 'QUOTATION_SIGNED', sourceQuotationId: 'q1', linkedDocuments: { invoice: [] }, invoiceDocumentId: null };
    const qo = { id: 'q1', name: 'QO202611-0040', config: { gstPercent: 9, items: [{ description: 'Degrease', quantity: 1, unitPrice: 100, amount: 100 }] } };
    const tx: any = {
      $executeRawUnsafe: jest.fn(async () => 0),
      order: { findFirst: jest.fn(async () => order), update: jest.fn(async () => order) },
      document: { findFirst: jest.fn(async () => qo) },
    };
    const known: any = {
      organizationUIConfig: { findUnique: jest.fn(async () => ({ features: { enableWctOrders: true, enableManualOrderFlow: true, enableWctOrderInvoice: true, postInvoicesOnConfirm: true } })) },
      order: { findFirst: jest.fn(async () => order), update: jest.fn(async () => order) },
      document: { findMany: jest.fn(async () => []) },
      organization: { findUnique: jest.fn(async () => ({ timezone: 'Asia/Singapore' })) },
      $transaction: jest.fn(async (fn: any) => fn(tx)),
    };
    // Any other model read on the way (org settings, status refresh): empty.
    const empty = new Proxy({}, { get: () => jest.fn(async () => null) });
    const prisma: any = new Proxy(known, { get: (t, k: string) => (k in t ? t[k] : empty) });
    const notifications = { emit: jest.fn() };
    const staffWhatsApp = { push: jest.fn() };
    const svc: any = Object.create(DocumentsService.prototype);
    Object.assign(svc, {
      prisma,
      notifications,
      staffWhatsApp,
      deliveriesService: { orderDos: jest.fn(async () => []) },
      resolveTemplateIdForType: jest.fn(async () => 't1'),
      createBasicDocument: jest.fn(async () => ({ id: 'inv1', name: 'INV202611-0020', type: 'INVOICE' })),
      repostGlForDocument: jest.fn(async () => undefined),
    });
    expect(await svc.autoInvoiceAtSigning('o1', 'org')).toEqual({ id: 'inv1', name: 'INV202611-0020' });
    expect(svc.createBasicDocument).toHaveBeenCalledTimes(1);
    expect(notifications.emit).not.toHaveBeenCalled();
    expect(staffWhatsApp.push).not.toHaveBeenCalled();
  });
});
