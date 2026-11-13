import { MaintenanceReportsService } from './maintenance-reports.service';

// The report page's "Back to order ORD…" (WCT orders, 2026-11-13): findById returns the report's order.
function make(row: any, orders: Record<string, any>, job: any = null) {
  const prisma: any = {
    maintenanceServiceReport: { findFirst: jest.fn(async () => row) },
    delivery: { findFirst: jest.fn(async () => job) },
    order: {
      findFirst: jest.fn(async ({ where }: any) => (where.id ? orders[where.id] ?? null : where.attachments ? orders.byAttachment ?? null : null)),
    },
  };
  const svc: any = Object.create(MaintenanceReportsService.prototype);
  Object.assign(svc, { prisma });
  return { svc: svc as MaintenanceReportsService, prisma };
}
const O1 = { id: 'o1', orderNumber: 'ORD202611-003' };

describe('a service report knows its order', () => {
  it('an uploaded / office report: from its own link', async () => {
    const { svc } = make({ id: 'r1', deliveryId: null, serviceData: { orderId: 'o1' } }, { o1: O1 });
    expect((await svc.findById('r1', 'org') as any).order).toEqual(O1);
  });
  it('a report written on a job: from the job', async () => {
    const { svc } = make({ id: 'r1', deliveryId: 'j1', serviceData: {} }, { o1: O1 }, { orderId: 'o1' });
    expect((await svc.findById('r1', 'org') as any).order).toEqual(O1);
  });
  it('a report linked to the order by hand: from the order attachments', async () => {
    const { svc, prisma } = make({ id: 'r1', deliveryId: null, serviceData: {} }, { byAttachment: O1 });
    expect((await svc.findById('r1', 'org') as any).order).toEqual(O1);
    expect(prisma.order.findFirst).toHaveBeenLastCalledWith(expect.objectContaining({ where: { organizationId: 'org', attachments: { array_contains: [{ reportId: 'r1' }] } } }));
  });
  it('no order: null (no Back to order link)', async () => {
    const { svc } = make({ id: 'r1', deliveryId: null, serviceData: {} }, {});
    expect((await svc.findById('r1', 'org') as any).order).toBeNull();
  });
});
