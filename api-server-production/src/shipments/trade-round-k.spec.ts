/**
 * Round K: the flat Orders list (sort + Ship month filter) and its segmented progress bars
 * (N/A hidden, overdue from past-due alerts, multi-shipment = one segment per step, per-shipment bars).
 */
import { progressBar, stepBarLabel } from './trade-dashboard';
import { OrdersService } from './orders.service';

const ORG = '222c6494-96ae-42d0-9283-1b5eabf47b42';
let sort = 0;
const st = (displayNo: string, status: 'DONE' | 'IN_PROGRESS' | 'NOT_STARTED', o: { na?: boolean; ongoing?: boolean; title?: string; code?: string } = {}) => ({
  code: o.code ?? `S${displayNo}`,
  title: o.title ?? `Step ${displayNo}`,
  displayNo,
  sortOrder: sort++,
  status,
  isOngoing: !!o.ongoing,
  notApplicable: !!o.na,
});

describe('progress bar segments', () => {
  it('one segment per applicable step, in step order (3a before 3b before 4, 10 after 9); N/A and ongoing hidden', () => {
    const steps = [
      st('10', 'NOT_STARTED'),
      st('3b', 'DONE'),
      st('2', 'DONE', { na: true }),
      st('3a', 'DONE'),
      st('4', 'IN_PROGRESS'),
      st('9', 'NOT_STARTED'),
      st('', 'NOT_STARTED', { ongoing: true, code: 'NOTES' }),
    ].map((s) => ({
      ...s,
      recordId: 'sh1',
    }));
    const b = progressBar(steps, new Set());
    expect(b.segments.map((s) => s.no)).toEqual(['3a', '3b', '4', '9', '10']);
    expect(b.segments.map((s) => s.state)).toEqual(['done', 'done', 'in_progress', 'not_started', 'not_started']);
    expect(b).toMatchObject({ done: 2, total: 5 });
  });
  it('overdue: the step in progress on a record with a past-due alert', () => {
    const b = progressBar(
      [
        { ...st('7', 'IN_PROGRESS'), recordId: 'sh1' },
        { ...st('8', 'NOT_STARTED'), recordId: 'sh1' },
      ],
      new Set(['sh1']),
    );
    expect(b.segments.map((s) => s.state)).toEqual(['overdue', 'not_started']);
  });
  it('multi-shipment: a step on #19-1 and #19-2 is one segment — done only when both are', () => {
    const steps = [
      { ...st('0', 'DONE'), recordId: 'o' },
      { ...st('5', 'DONE'), recordId: 's1' },
      { ...st('5', 'NOT_STARTED'), recordId: 's2' },
      { ...st('6', 'DONE'), recordId: 's1' },
      { ...st('6', 'DONE'), recordId: 's2' },
      { ...st('6', 'DONE', { na: true }), recordId: 's3' },
    ];
    const b = progressBar(steps, new Set());
    expect(b.segments.map((s) => `${s.no}:${s.state}`)).toEqual(['0:done', '5:in_progress', '6:done']);
    expect(b).toMatchObject({ done: 2, total: 3 });
  });
  it('a step N/A everywhere disappears; empty → total 0', () => {
    expect(progressBar([{ ...st('2', 'NOT_STARTED', { na: true }), recordId: 'o' }], new Set())).toEqual({ segments: [], done: 0, total: 0 });
  });
  it('label "Step 7 · Customs documents & tax estimate"', () => {
    expect(stepBarLabel({ displayNo: '7', title: 'Customs documents & tax estimate' })).toBe('Step 7 · Customs documents & tax estimate');
    expect(stepBarLabel({ displayNo: null, title: 'Awaiting shipment' })).toBe('Awaiting shipment');
    expect(stepBarLabel(null)).toBeNull();
  });
});

describe('Orders list (flat)', () => {
  const ship = (id: string, seqNo: number, steps: any[], status = 'OPEN') => ({ id, seqNo, blNumber: null, vessel: null, voyageNo: null, eta: null, status, netWeightMt: null, steps });
  const order = (o: any) => ({
    id: o.id,
    year: 2026,
    orderNo: o.orderNo,
    shipMonth: o.shipMonth ?? null,
    deliveryMonth: null,
    status: 'OPEN',
    customer: null,
    supplier: null,
    contract: null,
    grade: null,
    size: null,
    qtyMt: null,
    product: null,
    steps: o.steps ?? [],
    shipments: o.shipments ?? [],
  });
  const svc = (rows: any[], alerts: any[] = []) => {
    const prisma: any = {
      tradeOrder: {
        findMany: jest.fn().mockResolvedValue(rows),
        count: jest.fn().mockResolvedValue(rows.length),
        groupBy: jest.fn().mockResolvedValue([
          { shipMonth: '2026-10', _count: { _all: 2 }, _sum: { qtyMt: 80 } },
          { shipMonth: null, _count: { _all: 1 }, _sum: { qtyMt: null } },
          { shipMonth: '2026-11', _count: { _all: 1 }, _sum: { qtyMt: 40 } },
        ]),
      },
      tradeAlert: { findMany: jest.fn().mockResolvedValue(alerts) },
    };
    return { prisma, s: new OrdersService(prisma, {} as any, {} as any) };
  };

  it('sorted by ship month newest first (no month last), then year and order no. newest first — no month header rows', async () => {
    const { prisma, s } = svc([order({ id: 'a', orderNo: 25, shipMonth: '2026-11' })]);
    const r = await s.list(ORG, { bucket: 'pending' } as any);
    expect(prisma.tradeOrder.findMany.mock.calls[0][0].orderBy).toEqual([{ shipMonth: { sort: 'desc', nulls: 'last' } }, { year: 'desc' }, { orderNo: 'desc' }]);
    expect(r.items.map((x: any) => x.label)).toEqual(['#25']);
    expect(r.items.every((x: any) => !('kind' in x))).toBe(true);
    // Ship month filter options: newest first, "none" last.
    expect(r.months.map((m: any) => m.month)).toEqual(['2026-11', '2026-10', null]);
  });

  it('Ship month filter: "2026-10" / "none"; the options ignore that filter', async () => {
    const { prisma, s } = svc([]);
    await s.list(ORG, { bucket: 'pending', shipMonth: '2026-10' } as any);
    expect(prisma.tradeOrder.findMany.mock.calls[0][0].where).toMatchObject({ status: 'OPEN', shipMonth: '2026-10' });
    expect(prisma.tradeOrder.groupBy.mock.calls[0][0].where.shipMonth).toBeUndefined();
    const b = svc([]);
    await b.s.list(ORG, { shipMonth: 'none' } as any);
    expect(b.prisma.tradeOrder.findMany.mock.calls[0][0].where.shipMonth).toBeNull();
  });

  it('each order carries its overall bar + label; each shipment its own bar (hover: #19-1 3/4, #19-2 1/4)', async () => {
    sort = 0;
    const own = [st('0', 'DONE'), st('1', 'DONE'), st('2', 'DONE', { na: true }), st('11', 'NOT_STARTED')];
    const s1 = [st('3a', 'DONE'), st('3b', 'DONE'), st('7', 'IN_PROGRESS', { title: 'Customs documents & tax estimate' }), st('8', 'NOT_STARTED')];
    sort = 2;
    const s2 = [st('3a', 'DONE'), st('3b', 'IN_PROGRESS', { title: 'Receive shipping documents' }), st('7', 'NOT_STARTED'), st('8', 'NOT_STARTED')];
    const cancelled = [st('3a', 'NOT_STARTED')];
    const { s } = svc(
      [order({ id: 'o19', orderNo: 19, shipMonth: '2026-10', steps: own, shipments: [ship('sh1', 1, s1), ship('sh2', 2, s2), ship('sh3', 3, cancelled, 'CANCELLED')] })],
      [{ orderId: null, shipmentId: 'sh1' }],
    );
    const r = await s.list(ORG, {} as any);
    const o: any = r.items[0];
    // 0, 1, 3a, 3b, 7, 8, 11 — step 2 N/A hidden, the cancelled shipment left out.
    expect(o.bar.segments.map((x: any) => `${x.no}:${x.state}`)).toEqual(['0:done', '1:done', '3a:done', '3b:in_progress', '7:overdue', '8:not_started', '11:not_started']);
    expect(o.bar).toMatchObject({ done: 3, total: 7 });
    // The label is the order's current step as before (round H: the first open shipment's — #19-1's step 7).
    expect(o.bar.label).toBe('Step 7 · Customs documents & tax estimate');
    expect(o.shipments[0].ref).toBe('#19-1');
    expect(o.shipments[0].bar).toMatchObject({ done: 2, total: 4, label: 'Step 7 · Customs documents & tax estimate' });
    expect(o.shipments[0].bar.segments[2].state).toBe('overdue');
    expect(o.shipments[1].bar).toMatchObject({ done: 1, total: 4 });
  });
});
