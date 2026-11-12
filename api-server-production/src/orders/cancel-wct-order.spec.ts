import { OrdersService } from './orders.service';

// WCT orders hub (2026-11-13): "Cancel order" only for an order that has not started.
function make(jobs: any[], status = 'DO_DRAFT') {
  const updates: any[] = [];
  const tx: any = {
    document: { findFirst: jest.fn(async ({ where }: any) => ({ id: where.id, config: { remarks: 'x' } })), update: jest.fn(async (a: any) => updates.push(['doc', a])) },
    maintenanceServiceReport: { deleteMany: jest.fn(async (a: any) => updates.push(['report', a])) },
    delivery: { update: jest.fn(async (a: any) => updates.push(['job', a])) },
    order: { update: jest.fn(async (a: any) => updates.push(['order', a])) },
  };
  const prisma: any = {
    organizationUIConfig: { findUnique: jest.fn(async () => ({ features: { enableWctOrders: true } })) },
    order: { findFirst: jest.fn(async () => ({ id: 'o1', orderNumber: 'ORD1', status, attachments: [], statusDates: {} })) },
    delivery: { findMany: jest.fn(async () => jobs) },
    $transaction: jest.fn(async (fn: any) => fn(tx)),
  };
  return { svc: new OrdersService(prisma, {} as any, {} as any), updates };
}
const item = (over: any = {}) => ({ documentId: 'do1', deliveringAt: null, deliveredAt: null, completedAt: null, ...over });

describe('cancelWctOrder', () => {
  it('cancels draft / scheduled jobs, tags their DOs Cancelled (number kept) and the order', async () => {
    const { svc, updates } = make([
      { id: 'j1', deliveryNumber: 8, status: 'scheduled', isDraft: true, orderInvoiceId: null, items: [item()] },
      { id: 'j2', deliveryNumber: 9, status: 'scheduled', isDraft: false, orderInvoiceId: null, items: [item({ documentId: 'do2' })] },
    ]);
    const out = await svc.cancelWctOrder('o1', 'org');
    expect(out).toEqual({ id: 'o1', status: 'CANCELLED', jobsCancelled: 2 });
    const docs = updates.filter((u) => u[0] === 'doc').map((u) => u[1]);
    expect(docs.map((d) => d.where.id)).toEqual(['do1', 'do2']);
    expect(docs[0].data.config).toMatchObject({ cancelled: true, cancelledReason: 'Delivery #8 was cancelled', remarks: 'x' });
    expect(updates.filter((u) => u[0] === 'job').map((u) => u[1].data.status)).toEqual(['cancelled', 'cancelled']);
    const order = updates.find((u) => u[0] === 'order')[1];
    expect(order.data.status).toBe('CANCELLED');
    expect(order.data.statusDates.CANCELLED).toBeTruthy();
  });

  it('refuses an order with a started, finished or invoiced job', async () => {
    for (const j of [
      { status: 'in_progress', isDraft: false, orderInvoiceId: null, items: [item()] },
      { status: 'completed', isDraft: false, orderInvoiceId: null, items: [item()] },
      { status: 'scheduled', isDraft: false, orderInvoiceId: 'inv1', items: [item()] },
      { status: 'scheduled', isDraft: false, orderInvoiceId: null, items: [item({ deliveredAt: new Date() })] },
    ]) {
      const { svc, updates } = make([{ id: 'j', deliveryNumber: 3, ...j }]);
      await expect(svc.cancelWctOrder('o1', 'org')).rejects.toThrow(/has not started/);
      expect(updates).toHaveLength(0);
    }
  });
});
