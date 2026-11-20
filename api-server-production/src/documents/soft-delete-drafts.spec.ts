jest.mock('../orders/wct-orders', () => ({ ...jest.requireActual('../orders/wct-orders'), refreshOrderStatus: jest.fn(async () => null) }));
import { DocumentsService } from './documents.service';
import { refreshOrderStatus } from '../orders/wct-orders';

// WCT group soft delete of drafts (enableSoftDeleteDrafts, Elroy 2026-11-19): hidden, number kept as a gap.
function world(opts: { flag?: boolean; doc?: any; sent?: number; links?: number; orders?: any[]; heads?: any[]; jobs?: any[]; dos?: any[]; jobItem?: any } = {}) {
  const doc = opts.doc ?? { id: 'd1', name: 'INV202611-0030', type: 'INVOICE', status: 'unconfirmed', config: { orderId: 'o1', items: [{ description: 'x' }] } };
  const updates: any[] = [];
  const orderUpdates: any[] = [];
  const writes: any[] = [];
  const tx: any = {
    document: { update: jest.fn(async (a: any) => updates.push(a)), findMany: jest.fn(async () => opts.dos ?? []) },
    order: {
      update: jest.fn(async (a: any) => orderUpdates.push(a)),
      findMany: jest.fn(async () => opts.heads ?? []),
      updateMany: jest.fn(async (a: any) => (writes.push(['order', a]), { count: 1 })),
    },
    delivery: { findMany: jest.fn(async () => opts.jobs ?? []), updateMany: jest.fn(async (a: any) => (writes.push(['delivery', a]), { count: 1 })) },
    $queryRaw: jest.fn(async () => opts.orders ?? [{ id: 'o1', linkedDocuments: { invoice: [{ id: 'd1', name: 'INV202611-0030' }, { id: 'd2' }], do: [] } }]),
  };
  const prisma: any = {
    // The lock-date guard (common/period-lock.ts) reads these on every dated write.
    accountingSetting: { findUnique: jest.fn(async () => null) },
    userRole: { findMany: jest.fn(async () => []), findFirst: jest.fn(async () => null) },
    organizationUIConfig: { findUnique: jest.fn(async () => ({ features: { enableSoftDeleteDrafts: opts.flag ?? true } })) },
    document: { findFirst: jest.fn(async () => doc), delete: jest.fn(async () => doc) },
    payment: { count: jest.fn(async () => 0) },
    journalEntry: { count: jest.fn(async () => 0) },
    auditLog: { count: jest.fn(async () => opts.sent ?? 0) },
    documentSignLink: { count: jest.fn(async () => opts.links ?? 0) },
    deliveryItem: { findFirst: jest.fn(async () => opts.jobItem ?? null) },
    $transaction: jest.fn(async (fn: any) => fn(tx)),
  };
  const svc: any = Object.create(DocumentsService.prototype);
  svc.prisma = prisma;
  svc.logDocumentEvent = jest.fn(async () => undefined);
  svc.journalAutoPost = { alreadyPostedForDocument: jest.fn(async () => null) };
  svc.journalService = { void: jest.fn() };
  svc.documentNumbering = { releaseNumberIfLatest: jest.fn(async () => true) };
  return { svc, prisma, tx, updates, orderUpdates, writes };
}

describe('soft delete of drafts (WCT group)', () => {
  it('hides the draft (type DELETED, softDeleted kept), keeps the number, takes it off its order and re-reads the order', async () => {
    const w = world();
    const r = await w.svc.deleteDocument('d1', 'org', { id: 'u1', name: 'Joyna' });
    expect(r).toMatchObject({ id: 'd1', deleted: true, soft: true });
    expect(w.prisma.document.delete).not.toHaveBeenCalled();
    expect(w.svc.documentNumbering.releaseNumberIfLatest).not.toHaveBeenCalled();
    expect(w.updates[0].data.type).toBe('DELETED');
    expect(w.updates[0].data.config.softDeleted).toMatchObject({ type: 'INVOICE', name: 'INV202611-0030', by: 'u1', byName: 'Joyna' });
    expect(w.orderUpdates[0].data.linkedDocuments.invoice).toEqual([{ id: 'd2' }]);
    expect(refreshOrderStatus).toHaveBeenCalledWith(w.prisma, 'org', 'o1');
    expect(w.svc.logDocumentEvent).toHaveBeenCalledWith(expect.objectContaining({ action: 'DELETED' }));
  });
  it('refused: sent (email or sign link), imported; confirmed / paid / posted as before', async () => {
    await expect(world({ sent: 1 }).svc.deleteDocument('d1', 'org')).rejects.toThrow(/was sent to the customer/);
    await expect(world({ links: 1 }).svc.deleteDocument('d1', 'org')).rejects.toThrow(/was sent to the customer/);
    await expect(world({ doc: { id: 'd1', name: 'Q-1', type: 'QUOTATION', status: 'unconfirmed', config: { erpImport: { source: 'wct-erp' } } } }).svc.deleteDocument('d1', 'org')).rejects.toThrow(/imported from the old ERP/);
    await expect(world({ doc: { id: 'd1', name: 'I-1', type: 'INVOICE', status: 'pending_payment', config: {} } }).svc.deleteDocument('d1', 'org')).rejects.toThrow(/never deleted/);
  });
  it("the editor's discard of an untouched empty draft stays a real delete (number given back)", async () => {
    const w = world();
    await w.svc.deleteDocument('d1', 'org', undefined, { untouched: true });
    expect(w.prisma.document.delete).toHaveBeenCalled();
    expect(w.svc.documentNumbering.releaseNumberIfLatest).toHaveBeenCalled();
    expect(w.updates).toEqual([]);
  });
  it('flag off (every other org): the real delete exactly as before, sent or not', async () => {
    const w = world({ flag: false, sent: 1 });
    await w.svc.deleteDocument('d1', 'org');
    expect(w.prisma.document.delete).toHaveBeenCalled();
    expect(w.updates).toEqual([]);
  });

  it('an invoice leaves no stale id: order invoice, jobs and DOs billed on it are cleared (only where equal) and every order is re-read', async () => {
    (refreshOrderStatus as jest.Mock).mockClear();
    const w = world({
      orders: [],
      heads: [{ id: 'o2' }],
      jobs: [{ id: 'j1', orderId: 'o3' }],
      dos: [
        { id: 'do1', config: { orderId: 'o4', orderInvoiceId: 'd1', items: [] } },
        { id: 'do2', config: { orderId: 'o5', orderInvoiceId: 'other' } },
      ],
    });
    await w.svc.deleteDocument('d1', 'org');
    expect(w.tx.order.updateMany).toHaveBeenCalledWith({ where: { organizationId: 'org', invoiceDocumentId: 'd1' }, data: { invoiceDocumentId: null } });
    expect(w.tx.delivery.updateMany).toHaveBeenCalledWith({ where: { organizationId: 'org', orderInvoiceId: 'd1' }, data: { orderInvoiceId: null } });
    expect(w.tx.document.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { organizationId: 'org', type: { in: ['DELIVERY_ORDER', 'DO'] }, config: { path: ['orderInvoiceId'], equals: 'd1' } } }));
    // The DO billed on it loses only that key; a DO pointing elsewhere is not written.
    expect(w.updates.filter((u) => u.where.id !== 'd1')).toEqual([{ where: { id: 'do1' }, data: { config: { orderId: 'o4', items: [] } } }]);
    expect((refreshOrderStatus as jest.Mock).mock.calls.map((c) => c[2]).sort()).toEqual(['o2', 'o3', 'o4']);
  });

  it('a DO: off its order by the link lists only (no invoice ids touched); refused while a live job carries it', async () => {
    const doDoc = { id: 'd1', name: 'DO202611024', type: 'DELIVERY_ORDER', status: 'draft', config: { orderId: 'o1', items: [] } };
    const w = world({ doc: doDoc, orders: [{ id: 'o1', linkedDocuments: { do: [{ id: 'd1' }] } }] });
    await w.svc.deleteDocument('d1', 'org');
    expect(w.updates[0].data.type).toBe('DELETED');
    expect(w.tx.order.updateMany).not.toHaveBeenCalled();
    expect(w.tx.delivery.updateMany).not.toHaveBeenCalled();
    expect(w.prisma.deliveryItem.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { documentId: 'd1', delivery: { organizationId: 'org', status: { not: 'cancelled' } } } }));
    const busy = world({ doc: doDoc, jobItem: { delivery: { deliveryNumber: 12 } } });
    await expect(busy.svc.deleteDocument('d1', 'org')).rejects.toThrow('DO202611024 is the DO of job #12: cancel the job first.');
    expect(busy.updates).toEqual([]);
  });

  it('flag off: none of the soft-delete clean-up runs (the real delete as before)', async () => {
    const w = world({ flag: false, heads: [{ id: 'o2' }], jobs: [{ id: 'j1', orderId: 'o3' }] });
    await w.svc.deleteDocument('d1', 'org');
    expect(w.prisma.document.delete).toHaveBeenCalled();
    expect(w.prisma.$transaction).not.toHaveBeenCalled();
    expect(w.prisma.deliveryItem.findFirst).not.toHaveBeenCalled();
  });
});
