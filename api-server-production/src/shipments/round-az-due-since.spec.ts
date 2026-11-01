import { flaggable, stepState } from './trade-due';
import { TradeDueService } from './trade-due.service';
import { withFeatureStamps } from '../organizations/feature-stamps';

// Round AZ — due dates are only flagged from the day they were switched on (no backlog flood).
const step = (code: string, no: string, sortOrder: number, extra: Record<string, unknown> = {}) => ({ id: `${code}-${no}`, code, title: code, displayNo: no, sortOrder, status: 'NOT_STARTED', isOngoing: false, notApplicable: false, skipReason: null, completedAt: null, dueAt: null, dueSetByName: null, dueSetAt: null, ...extra });
const order = () => ({
  id: 'o1',
  orderNo: 14,
  status: 'OPEN',
  createdAt: '2026-09-01T00:00:00.000Z',
  customerId: 'c1',
  piDate: null,
  depositDueDays: 3,
  depositDueUnit: 'BUSINESS',
  steps: [step('CHECK_CONTRACT', '0', 0, { status: 'DONE' })],
  shipments: [
    {
      id: 's1',
      seqNo: 1,
      status: 'OPEN',
      etd: '2026-10-01T00:00:00.000Z',
      eta: '2026-11-05T00:00:00.000Z',
      tsPort: null,
      tsEta: null,
      tsEtd: null,
      actualArrivalDate: null,
      dischargeDate: null,
      // 3b due 8 Oct (before the switch-on) · 9 due 4 Nov · 10 due 8 Nov
      steps: [step('SHIPPING_DOCS', '3b', 2), step('AN_INSTRUCTIONS', '9', 9), step('IMPORT_PERMIT', '10', 10)],
    },
  ],
});
const svcWith = (features: Record<string, unknown>) =>
  new TradeDueService({
    organization: { findUnique: async () => ({ uiConfig: { features, updatedAt: '2026-10-20T03:00:00.000Z' } }) },
    tradeSetting: { findUnique: async () => ({ customerProfiles: {}, alertRules: {} }) },
    tradeOrder: { findMany: async () => [order()], findFirst: async () => order() },
    tradeGeneratedDoc: { findMany: async () => [] },
  } as any);

describe('round AZ — switch-on day', () => {
  it('a date before the switch-on day is never overdue', () => {
    expect(stepState({ status: 'NOT_STARTED' }, '2026-10-08', '2026-11-06', false, '2026-11-01')).toBe('upcoming');
    expect(stepState({ status: 'NOT_STARTED' }, '2026-11-04', '2026-11-06', false, '2026-11-01')).toBe('overdue');
    expect(stepState({ status: 'NOT_STARTED' }, '2026-11-01', '2026-11-06', false, '2026-11-01')).toBe('overdue');
    expect([flaggable('2026-10-31', '2026-11-01'), flaggable('2026-11-01', '2026-11-01'), flaggable(null, '2026-11-01')]).toEqual([false, true, false]);
  });
  const svc = svcWith({ enableStepDueDates: true, stepDueDatesSince: '2026-11-01' });
  it('Overall process: the old date shows without the badge; dates from the switch-on day are flagged', async () => {
    const p = await svc.orderProcess('org', 'o1', '2026-11-06');
    const cell = (no: string) => p.rows.find((r) => r.no === no)!.cells.s1;
    expect([cell('3b').due, cell('3b').state, cell('3b').flagged]).toEqual(['2026-10-08', 'current', false]);
    expect([cell('9').due, cell('9').state, cell('9').daysLate]).toEqual(['2026-11-04', 'overdue', 2]);
    expect([p.dueSince, p.overdue]).toEqual(['2026-11-01', 1]);
  });
  it('tasks and overdue badges skip the backlog', async () => {
    const t = await svc.tasks('org', 7, '2026-11-06');
    expect(t.map((x) => x.stepId)).toEqual(['AN_INSTRUCTIONS-9', 'IMPORT_PERMIT-10']);
    expect((await svc.overdueRecordIds('org', '2026-11-06')).has('s1')).toBe(true);
    expect((await svc.overdueRecordIds('org', '2026-11-03')).size).toBe(0);
  });
  it('flag on without a stamp falls back to the config’s last-saved day', async () => {
    expect(await svcWith({ enableStepDueDates: true }).dueConfig('org')).toEqual({ on: true, since: '2026-10-20' });
    expect(await svcWith({}).dueConfig('org')).toEqual({ on: false, since: null });
  });
  it('the save that turns the flag on stamps the day; later saves keep it', () => {
    const now = new Date('2026-11-01T01:00:00.000Z');
    expect(withFeatureStamps({ enableStepDueDates: false }, { enableStepDueDates: true }, now)).toEqual({ enableStepDueDates: true, stepDueDatesSince: '2026-11-01' });
    expect(withFeatureStamps({ enableStepDueDates: true, stepDueDatesSince: '2026-11-01' }, { enableStepDueDates: true, x: 1 }, new Date('2026-12-01'))).toEqual({ enableStepDueDates: true, x: 1, stepDueDatesSince: '2026-11-01' });
    expect(withFeatureStamps({ enableStepDueDates: false, stepDueDatesSince: '2026-11-01' }, { enableStepDueDates: true }, new Date('2026-12-01T01:00:00.000Z'))).toEqual({ enableStepDueDates: true, stepDueDatesSince: '2026-12-01' });
    expect(withFeatureStamps({}, { enableActionLog: true }, now)).toEqual({ enableActionLog: true });
  });
});
