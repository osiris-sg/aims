import { DEFAULT_DUE_RULES, dueOf, ruleFor, stepState, daysLate } from './trade-due';
import { TradeDueService } from './trade-due.service';
import { PROCESS_SKIP_REASON } from './trade-process';

// Round AY part 2 — due dates per step and the Overall process.
describe('round AY — due date rules', () => {
  const ship = { etd: '2026-10-01T00:00:00.000Z', eta: '2026-11-02T00:00:00.000Z' };
  it('shipment steps hang off ETD / ETA', () => {
    expect(dueOf('BL_DRAFT_APPROVAL', ship).due).toBe('2026-09-29');
    expect(dueOf('SHIPPING_DOCS', ship).due).toBe('2026-10-08');
    expect(dueOf('SEND_DOCS_SCHEDULE', ship).due).toBe('2026-10-23');
    expect(dueOf('TAX_FUNDS', ship).due).toBe('2026-10-19');
    expect(dueOf('AN_INSTRUCTIONS', ship).due).toBe('2026-11-01');
    expect(dueOf('IMPORT_PERMIT', ship).due).toBe('2026-11-05');
  });
  it('a new ETA moves the rule dates; a hand-set date stays', () => {
    const later = { ...ship, eta: '2026-11-12' };
    expect(dueOf('AN_INSTRUCTIONS', later).due).toBe('2026-11-11');
    expect(dueOf('AN_INSTRUCTIONS', later, '2026-11-03T00:00:00.000Z')).toEqual({ due: '2026-11-03', source: 'manual', why: DEFAULT_DUE_RULES.AN_INSTRUCTIONS.why });
  });
  it('business days skip weekends (CI payment 3 bank days after a Friday ETD → Wednesday)', () => {
    expect(dueOf('CI_PAYMENT', { etd: '2026-10-02' }).due).toBe('2026-10-07');
  });
  it('order steps: entered + 2 business days, PI date + deposit term, first ETD / last ETA', () => {
    expect(dueOf('CHECK_CONTRACT', { orderCreatedAt: '2026-10-30T09:00:00.000Z' }).due).toBe('2026-11-04'); // Fri → Tue (3 Nov is a holiday)
    expect(dueOf('PI_PAYMENT', { piDate: '2026-10-05', depositDueDays: 5, depositDueUnit: 'CALENDAR' }).due).toBe('2026-10-10');
    expect(dueOf('INVOICE_2', { lastEta: '2026-11-02' }).due).toBe('2026-11-16');
    expect(dueOf('XERO_HANDOFF', { lastEta: '2026-11-02' }).due).toBe('2026-12-17');
  });
  it('single billing: the invoice goes out after the B/L (first ETD + 5 business days)', () => {
    expect(ruleFor('INVOICE_2', 'SINGLE')!.anchor).toBe('FIRST_ETD');
    expect(dueOf('INVOICE_2', { firstEtd: '2026-10-01', billingMode: 'SINGLE' }).due).toBe('2026-10-08');
  });
  it('step 8 follows the tax-funding reminder setting', () => {
    expect(dueOf('TAX_FUNDS', { eta: '2026-11-02', taxFundingDaysBefore: 10 }).due).toBe('2026-10-23');
  });
  it('no schedule date yet → no due date (never a wrong one); no rule for the ongoing step 14', () => {
    expect(dueOf('AN_INSTRUCTIONS', {}).due).toBeNull();
    expect(dueOf('DELIVERY_CHANGES', ship)).toEqual({ due: null, source: null, why: null });
  });
  it('state: done / N/A first, then overdue (past due), else now / upcoming; days late', () => {
    expect(stepState({ status: 'DONE' }, '2026-01-01', '2026-10-31', false)).toBe('done');
    expect(stepState({ status: 'NOT_STARTED', notApplicable: true }, '2026-01-01', '2026-10-31', false)).toBe('na');
    expect(stepState({ status: 'IN_PROGRESS' }, '2026-10-28', '2026-10-31', true)).toBe('overdue');
    expect(stepState({ status: 'NOT_STARTED' }, '2026-10-31', '2026-10-31', true)).toBe('current');
    expect(stepState({ status: 'NOT_STARTED' }, null, '2026-10-31', false)).toBe('upcoming');
    expect(daysLate('2026-10-28', '2026-10-31')).toBe(3);
  });
});

const step = (code: string, no: string, sortOrder: number, extra: Record<string, unknown> = {}) => ({ id: `${code}-${no}`, code, title: code, displayNo: no, sortOrder, status: 'NOT_STARTED', isOngoing: code === 'DELIVERY_CHANGES', notApplicable: false, skipReason: null, completedAt: null, dueAt: null, dueSetByName: null, dueSetAt: null, ...extra });
const order = (over: Record<string, unknown> = {}) => ({
  id: 'o1',
  orderNo: 14,
  status: 'OPEN',
  createdAt: '2026-09-01T00:00:00.000Z',
  customerId: 'c1',
  piDate: '2026-09-02',
  depositDueDays: 3,
  depositDueUnit: 'BUSINESS',
  steps: [step('CHECK_CONTRACT', '0', 0, { status: 'DONE', completedAt: '2026-09-02T03:00:00.000Z' }), step('INVOICE_2', '11', 110), step('XERO_HANDOFF', '13', 130, { notApplicable: true, skipReason: PROCESS_SKIP_REASON })],
  shipments: [
    {
      id: 's1',
      seqNo: 1,
      status: 'OPEN',
      etd: '2026-10-01T00:00:00.000Z',
      eta: '2026-10-25T00:00:00.000Z',
      tsPort: 'Singapore',
      tsEta: '2026-10-06T00:00:00.000Z',
      tsEtd: '2026-10-09T00:00:00.000Z',
      actualArrivalDate: null,
      dischargeDate: null,
      steps: [step('SHIPPING_DOCS', '3b', 31, { status: 'DONE' }), step('AN_INSTRUCTIONS', '9', 90, { status: 'IN_PROGRESS' }), step('IMPORT_PERMIT', '10', 100), step('INVOICE_2', '11', 110, { skipReason: 'Moved to the order (round H)' }), step('DELIVERY_CHANGES', '14', 140)],
    },
  ],
  ...over,
});

describe('round AY — due service', () => {
  const svc = new TradeDueService({} as any);
  const set = { profiles: { c1: { billingMode: 'TWO_STAGE', truckCapacityT: 20, docVariants: {} } }, taxDays: 14 };
  const items = svc.itemsOf([order()], set, '2026-10-31');
  it('one item per applicable step: N/A (left out) and moved-to-the-order rows are not there', () => {
    expect(items.map((i) => `${i.ref} ${i.no}`)).toEqual(['#14 0', '#14 11', '#14-1 3b', '#14-1 9', '#14-1 10', '#14-1 14']);
  });
  it('the current step past its due date is overdue (A/N due 24 Oct → 7 days late); ongoing 14 has no date', () => {
    const an = items.find((i) => i.code === 'AN_INSTRUCTIONS')!;
    expect([an.state, an.due, an.daysLate, an.dueSource]).toEqual(['overdue', '2026-10-24', 7, 'rule']);
    expect(items.find((i) => i.code === 'DELIVERY_CHANGES')!.due).toBeNull();
    expect(items.find((i) => i.code === 'CHECK_CONTRACT')!).toMatchObject({ state: 'done', doneAt: '2026-09-02' });
  });
  it('a hand-set date wins and says who set it', () => {
    const o = order();
    (o.shipments[0].steps[1] as any).dueAt = '2026-11-05T00:00:00.000Z';
    (o.shipments[0].steps[1] as any).dueSetByName = 'Take';
    const an = svc.itemsOf([o], set, '2026-10-31').find((i) => i.code === 'AN_INSTRUCTIONS')!;
    expect([an.state, an.due, an.dueSource, an.dueSetByName]).toEqual(['current', '2026-11-05', 'manual', 'Take']);
  });
  it('tasks: due within the window or overdue, shaped like reminders, linking to the order', async () => {
    const prisma: any = {
      organization: { findUnique: async () => ({ uiConfig: { features: { enableStepDueDates: true } } }) },
      tradeSetting: { findUnique: async () => ({ customerProfiles: set.profiles, alertRules: {} }) },
      tradeOrder: { findMany: async () => [order()], findFirst: async () => order() },
      tradeGeneratedDoc: { findMany: async () => [{ shipmentId: 's1', rows: [{ deliveryDate: '2026-10-30' }, { deliveryDate: '2026-10-28' }] }] },
    };
    const t = await new TradeDueService(prisma).tasks('org', 3, '2026-10-31');
    expect(t.map((x) => x.title)).toEqual(['#14-1: step 9 AN_INSTRUCTIONS — 7 days overdue', '#14-1: step 10 IMPORT_PERMIT — 3 days overdue']);
    expect(t[0]).toMatchObject({ kind: 'STEP_DUE', status: 'DUE', linkUrl: '/portal/shipments/orders/o1?shipment=s1', overdue: true });
    expect([...(await new TradeDueService(prisma).overdueRecordIds('org', '2026-10-31'))].sort()).toEqual(['o1', 's1']);
  });
  it('setDue: a date or null only, stamped with who / when', async () => {
    const updates: any[] = [];
    const prisma: any = { organization: { findUnique: async () => ({ uiConfig: { features: { enableStepDueDates: true } } }) }, tradeStep: { findFirst: async () => ({ id: 'st', dueAt: null, code: 'X', orderId: 'o1', shipmentId: null, shipment: null }), update: async (a: any) => updates.push(a) } };
    const s = new TradeDueService(prisma);
    await expect(s.setDue('org', 'st', '31/10/2026', { id: 'u', name: 'Take' })).rejects.toThrow('YYYY-MM-DD');
    await s.setDue('org', 'st', '2026-11-05', { id: 'u', name: 'Take' });
    expect(updates[0].data).toMatchObject({ dueAt: new Date('2026-11-05T00:00:00Z'), dueSetById: 'u', dueSetByName: 'Take' });
    await s.setDue('org', 'st', null, { id: 'u', name: 'Take' });
    expect(updates[1].data).toEqual({ dueAt: null, dueSetById: null, dueSetByName: null, dueSetAt: null });
  });
  it('Overall process: the order + each shipment, the schedule (T/S, delivery dates), rows in process order', async () => {
    const prisma: any = {
      organization: { findUnique: async () => ({ uiConfig: { features: { enableStepDueDates: true } } }) },
      tradeSetting: { findUnique: async () => ({ customerProfiles: set.profiles, alertRules: {} }) },
      tradeOrder: { findFirst: async () => order() },
      tradeGeneratedDoc: { findMany: async () => [{ shipmentId: 's1', rows: [{ deliveryDate: '2026-10-30' }, { deliveryDate: '2026-10-28' }] }] },
    };
    const p = await new TradeDueService(prisma).orderProcess('org', 'o1', '2026-10-31');
    expect(p.columns.map((c) => c.ref)).toEqual(['#14', '#14-1']);
    expect(p.columns[1].schedule).toEqual({ etd: '2026-10-01', tsPort: 'Singapore', tsEta: '2026-10-06', tsEtd: '2026-10-09', eta: '2026-10-25', arrived: null, deliveries: ['2026-10-28', '2026-10-30'] });
    expect(p.rows.map((r) => r.no)).toEqual(['0', '3b', '9', '10', '11', '14']);
    expect(p.rows.find((r) => r.no === '11')!.cells).toHaveProperty('o1');
    expect(p.rows.find((r) => r.no === '11')!.cells).not.toHaveProperty('s1'); // the moved-to-the-order row
    expect([p.dueDates, p.overdue]).toEqual([true, 2]);
  });
});

describe('round AY — flag off (enableStepDueDates, the default)', () => {
  const prisma: any = {
    organization: { findUnique: async () => ({ uiConfig: { features: {} } }) },
    tradeSetting: { findUnique: async () => ({ customerProfiles: {}, alertRules: {} }) },
    tradeOrder: { findMany: async () => [order()], findFirst: async () => order() },
    tradeGeneratedDoc: { findMany: async () => [] },
    tradeStep: { findFirst: async () => ({ id: 'st' }), update: jest.fn() },
  };
  const svc = new TradeDueService(prisma);
  it('no tasks, no overdue, no badge data', async () => {
    expect(await svc.tasks('org', 3, '2026-10-31')).toEqual([]);
    expect((await svc.overdueRecordIds('org', '2026-10-31')).size).toBe(0);
  });
  it('the Overall process still shows the steps and the schedule, without due dates', async () => {
    const p = await svc.orderProcess('org', 'o1', '2026-10-31');
    const cells = p.rows.flatMap((r) => Object.values(r.cells));
    expect(p.dueDates).toBe(false);
    expect(cells.every((c) => c.due === null && c.state !== 'overdue')).toBe(true);
    expect(cells.find((c) => c.code === 'AN_INSTRUCTIONS')!.state).toBe('current');
  });
  it('setting a due date is refused', async () => {
    await expect(svc.setDue('org', 'st', '2026-11-05', { id: 'u', name: 'X' })).rejects.toThrow('not switched on');
    expect(prisma.tradeStep.update).not.toHaveBeenCalled();
  });
});
