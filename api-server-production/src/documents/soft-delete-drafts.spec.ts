jest.mock('../orders/wct-orders', () => ({ ...jest.requireActual('../orders/wct-orders'), refreshOrderStatus: jest.fn(async () => null) }));
import { DocumentsService } from './documents.service';
import { refreshOrderStatus } from '../orders/wct-orders';

// WCT group soft delete of drafts (enableSoftDeleteDrafts, Elroy 2026-11-19): hidden, number kept as a gap.
function world(opts: { flag?: boolean; doc?: any; sent?: number; links?: number; orders?: any[] } = {}) {
  const doc = opts.doc ?? { id: 'd1', name: 'INV202611-0030', type: 'INVOICE', status: 'unconfirmed', config: { orderId: 'o1', items: [{ description: 'x' }] } };
  const updates: any[] = [];
  const orderUpdates: any[] = [];
  const tx: any = {
    document: { update: jest.fn(async (a: any) => updates.push(a)) },
    order: { update: jest.fn(async (a: any) => orderUpdates.push(a)) },
    $queryRaw: jest.fn(async () => opts.orders ?? [{ id: 'o1', linkedDocuments: { invoice: [{ id: 'd1', name: 'INV202611-0030' }, { id: 'd2' }], do: [] } }]),
  };
  const prisma: any = {
    organizationUIConfig: { findUnique: jest.fn(async () => ({ features: { enableSoftDeleteDrafts: opts.flag ?? true } })) },
    document: { findFirst: jest.fn(async () => doc), delete: jest.fn(async () => doc) },
    payment: { count: jest.fn(async () => 0) },
    journalEntry: { count: jest.fn(async () => 0) },
    auditLog: { count: jest.fn(async () => opts.sent ?? 0) },
    documentSignLink: { count: jest.fn(async () => opts.links ?? 0) },
    $transaction: jest.fn(async (fn: any) => fn(tx)),
  };
  const svc: any = Object.create(DocumentsService.prototype);
  svc.prisma = prisma;
  svc.logDocumentEvent = jest.fn(async () => undefined);
  svc.journalAutoPost = { alreadyPostedForDocument: jest.fn(async () => null) };
  svc.journalService = { void: jest.fn() };
  svc.documentNumbering = { releaseNumberIfLatest: jest.fn(async () => true) };
  return { svc, prisma, updates, orderUpdates };
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
});
