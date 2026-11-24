jest.mock('../orders/wct-orders', () => ({ ...jest.requireActual('../orders/wct-orders'), refreshOrderStatus: jest.fn(async () => null) }));
jest.mock('./planned-rider', () => ({ ...jest.requireActual('./planned-rider'), savePlannedRider: jest.fn(async () => undefined) }));
jest.mock('./job-style', () => ({ ...jest.requireActual('./job-style'), jobStyleValues: jest.fn(async () => new Map()), isCalendarStyleEnabled: jest.fn(async () => true) }));
import { DeliveriesService } from './deliveries.service';

// A DO's draft job given its date in the one job form is scheduled (2026-11-25), so Complete job can finish it.
describe('updateQuickJob: a DO job draft with a date is scheduled', () => {
  function make(run: any, items: Array<{ documentId: string | null }>) {
    const updates: any[] = [];
    const prisma: any = {
      delivery: { findFirst: jest.fn(async () => run), update: jest.fn(async (a: any) => (updates.push(a.data), a)) },
      deliveryItem: { findMany: jest.fn(async () => items) },
      organizationUIConfig: { findUnique: jest.fn(async () => ({ features: { enableCalendarStyle: true } })) },
    };
    const svc: any = Object.create(DeliveriesService.prototype);
    Object.assign(svc, {
      prisma,
      assertCalendarAdd: jest.fn(async () => undefined),
      quickJobFields: jest.fn(async () => ({ scheduledFor: new Date('2026-11-25T01:00:00Z'), scheduledAllDay: false, customerId: 'c1', crew: [] })),
      redateRunDo: jest.fn(async () => undefined),
      siteclock: null,
    });
    return { svc: svc as DeliveriesService, updates };
  }
  const run = { id: 'j1', status: 'scheduled', orderId: 'o1', customerId: 'c1', isDraft: true };
  it('promotes a draft whose lines are the DO\'s', async () => {
    const { svc, updates } = make(run, [{ documentId: 'd1' }, { documentId: 'd1' }]);
    await svc.updateQuickJob('j1', 'org', {});
    expect(updates.some((u) => u.isDraft === false)).toBe(true);
  });
  it('leaves other drafts (no DO behind the lines) and non-drafts alone', async () => {
    expect(make(run, [{ documentId: null }]).updates.length).toBe(0);
    const a = make(run, [{ documentId: null }]);
    await a.svc.updateQuickJob('j1', 'org', {});
    expect(a.updates.some((u) => u.isDraft === false)).toBe(false);
    const b = make({ ...run, isDraft: false }, [{ documentId: 'd1' }]);
    await b.svc.updateQuickJob('j1', 'org', {});
    expect(b.updates.some((u) => u.isDraft === false)).toBe(false);
  });
});
