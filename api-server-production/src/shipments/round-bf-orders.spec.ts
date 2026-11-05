import { ArgumentMetadata, BadRequestException, ValidationPipe } from '@nestjs/common';
import { ListOrdersQuery } from './dto/order.dto';
import { likeOrders, toHint } from './order-pi-hints';
import { orderBucketWhere, OrdersService, takenText } from './orders.service';

// Round BF (Sayaka, 2026-11-04): she cancelled #30, could not find it again ("#30" on Pending = nothing) and could
// not make a new #30 either. Cancelled orders now have their own tab, a search finds them on every tab, and the
// refusals name the order with [Open] / [Reopen] and the next free number.

const ORG = 'org-adh';

describe('round BF — Orders tabs', () => {
  it('Pending / Completed / Cancelled / All; a search adds cancelled orders to Pending and Completed', () => {
    expect(orderBucketWhere('pending', false)).toEqual({ status: 'OPEN' });
    expect(orderBucketWhere('completed', false)).toEqual({ status: 'COMPLETED' });
    expect(orderBucketWhere('cancelled', false)).toEqual({ status: 'CANCELLED' });
    expect(orderBucketWhere('all', false)).toEqual({});
    expect(orderBucketWhere(undefined, true)).toEqual({});
    expect(orderBucketWhere('pending', true)).toEqual({ status: { in: ['OPEN', 'CANCELLED'] } });
    expect(orderBucketWhere('completed', true)).toEqual({ status: { in: ['COMPLETED', 'CANCELLED'] } });
    expect(orderBucketWhere('cancelled', true)).toEqual({ status: 'CANCELLED' });
  });

  it('the query DTO takes the Cancelled tab', async () => {
    const pipe = new ValidationPipe({ transform: true, transformOptions: { enableImplicitConversion: true } });
    const run = (value: Record<string, string>) => pipe.transform(value, { type: 'query', metatype: ListOrdersQuery } as ArgumentMetadata);
    await expect(run({ bucket: 'cancelled', q: '#30' })).resolves.toBeDefined();
    await expect(run({ bucket: 'everything' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('list(): "#30" on Pending searches open + cancelled; counts have a cancelled count', async () => {
    const prisma: any = {
      tradeOrder: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(2), groupBy: jest.fn().mockResolvedValue([]) },
      tradeAlert: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const svc = new OrdersService(prisma, {} as any, {} as any);
    (svc as any).orderBars = jest.fn().mockResolvedValue(new Map());
    const r = await svc.list(ORG, { bucket: 'pending', q: '#30' } as any);
    const where = prisma.tradeOrder.findMany.mock.calls[0][0].where;
    expect(where.status).toEqual({ in: ['OPEN', 'CANCELLED'] });
    expect(where.OR).toEqual(expect.arrayContaining([{ orderNo: 30 }, { contract: { piNumber: { contains: '#30', mode: 'insensitive' } } }]));
    const statuses = prisma.tradeOrder.count.mock.calls.map((c: any) => c[0].where.status);
    expect(statuses).toEqual(expect.arrayContaining(['OPEN', 'COMPLETED', 'CANCELLED']));
    expect(r.counts).toEqual({ pending: 2, completed: 2, cancelled: 2 });
  });
});

describe('round BF — a PI no. in Search is not an order number', () => {
  it('"9331004393" searches the PI fields only (it overflowed the order no. and the list 500ed)', async () => {
    const prisma: any = {
      tradeOrder: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0), groupBy: jest.fn().mockResolvedValue([]) },
      tradeAlert: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const svc = new OrdersService(prisma, {} as any, {} as any);
    (svc as any).orderBars = jest.fn().mockResolvedValue(new Map());
    await svc.list(ORG, { bucket: 'pending', q: '9331004393' } as any);
    const or = prisma.tradeOrder.findMany.mock.calls[0][0].where.OR;
    expect(or.some((c: any) => 'orderNo' in c || 'previousOrderNos' in c)).toBe(false);
    expect(or).toContainEqual({ piNo: { contains: '9331004393', mode: 'insensitive' } });
    await svc.list(ORG, { q: '#30-1' } as any);
    expect(prisma.tradeOrder.findMany.mock.calls[1][0].where.OR).toContainEqual({ orderNo: 30 });
  });
});

describe('round BF — an order number in use', () => {
  it('a cancelled order: "belongs to a cancelled order", never reused, the next free number', () => {
    expect(takenText({ orderNo: 30, year: 2026, status: 'CANCELLED', isTest: false, history: false, what: 'SUS Co., Ltd. · 6005 · 100 t', nextFree: 33 })).toBe(
      "#30 (2026) belongs to a cancelled order (SUS Co., Ltd. · 6005 · 100 t). Open or reopen it instead; a cancelled order's number is not reused — the next free number is #33",
    );
    expect(takenText({ orderNo: 28, year: 2026, status: 'OPEN', isTest: true, history: false, what: 'SUS Co., Ltd. · 6063 · 300 t', nextFree: 33 })).toBe('#28 (2026) is taken by a hidden test order (SUS Co., Ltd. · 6063 · 300 t) — the next free number is #33');
  });

  it('takenBy(): a structured refusal the form can act on (code, order, next free number)', async () => {
    const db: any = {
      tradeOrder: {
        findFirst: jest.fn().mockImplementation(({ where }: any) =>
          Promise.resolve(where.orderNo === 30 ? { id: 'o30', isTest: false, status: 'CANCELLED', grade: '6005', qtyMt: 100, notes: null, customer: { name: 'SUS Co., Ltd.' } } : { orderNo: 32 }),
        ),
      },
    };
    const svc = new OrdersService(db, {} as any, {} as any);
    const t = await svc.takenBy(db, ORG, 2026, 30);
    expect(t).toMatchObject({ code: 'ORDER_NO_TAKEN', order: { id: 'o30', label: '#30', status: 'CANCELLED' }, nextFreeOrderNo: 33 });
    expect(t!.message).toContain('belongs to a cancelled order');
  });

  it('cancelledInfo(): who cancelled and when, from the Activity Log row of the cancel', async () => {
    const prisma: any = { actionLog: { findFirst: jest.fn().mockResolvedValue({ actorName: 'Sayaka Matsuki', createdAt: new Date('2026-11-04T05:43:32Z') }) } };
    const svc = new OrdersService(prisma, {} as any, {} as any);
    expect(await svc.cancelledInfo(ORG, 'o30')).toEqual({ byName: 'Sayaka Matsuki', at: '2026-11-04T05:43:32.000Z' });
    expect(prisma.actionLog.findFirst.mock.calls[0][0].where).toMatchObject({ organizationId: ORG, resourceId: 'o30' });
    const none: any = { actionLog: { findFirst: jest.fn().mockResolvedValue(null) } };
    expect(await new OrdersService(none, {} as any, {} as any).cancelledInfo(ORG, 'o30', new Date('2026-11-04T06:00:00Z'))).toEqual({ byName: null, at: '2026-11-04T06:00:00.000Z' });
  });
});

describe('round BF — PI hints for New order', () => {
  const row = (o: Partial<any>) => ({ id: 'x', orderNo: 1, year: 2026, status: 'OPEN', isTest: false, piNo: null, grade: '6005', qtyMt: 100, shipMonth: '2026-11', createdAt: '2026-11-02T10:22:24Z', createdById: 'u1', ...o });
  it("the SUS PI 9331004393 (6005 100 t + 6063 200 t, Nov) points at the cancelled #30 and the open #31", () => {
    const rows = [row({ id: 'o30', orderNo: 30, status: 'CANCELLED' }), row({ id: 'o31', orderNo: 31, grade: '6063', qtyMt: 200, shipMonth: null }), row({ id: 'o26', orderNo: 26, grade: '6063', shipMonth: '2026-10' }), row({ id: 't', orderNo: 9001, isTest: true })];
    const like = likeOrders(rows, { shipmentMonth: '2026-11', lines: [{ grade: '6005' }, { grade: '6063' }] });
    expect(like.map((o) => o.id)).toEqual(['o31', 'o30']);
    expect(toHint(like[1], new Map([['u1', 'Sayaka Matsuki']]))).toEqual({ id: 'o30', label: '#30', year: 2026, status: 'CANCELLED', grade: '6005', qtyMt: 100, shipMonth: '2026-11', createdAt: '2026-11-02T10:22:24.000Z', createdByName: 'Sayaka Matsuki' });
  });
  it('an order that already has a PI no. is not "like" it', () => {
    expect(likeOrders([row({ piNo: '9331004321' })], { shipmentMonth: '2026-11', lines: [{ grade: '6005' }] })).toEqual([]);
  });
});
