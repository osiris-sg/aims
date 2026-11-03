import { checkOrderJobFilters, orderJobState, orderJobsWhere, orderJobWorker } from './order-jobs';
import { deliveredLabel, runNoun } from './job-wording';
import { jobTitle, planSync } from '../siteclock/siteclock-plan';

// WCT Orders → Jobs + "Job" wording (2026-11-03).
describe('order jobs list', () => {
  const ORG = 'wct';
  it('only this org, only jobs that belong to an order (drafts included)', () => {
    const w = orderJobsWhere(ORG, {});
    expect(w).toEqual({ AND: [{ organizationId: ORG }, { orderId: { not: null } }] });
    expect(JSON.stringify(w)).not.toMatch(/isDraft/);
  });

  it('search: a number matches the job no.; text matches order no., customer, site', () => {
    const num = orderJobsWhere(ORG, { q: '#12' }).AND[2].OR;
    expect(num[0]).toEqual({ deliveryNumber: 12 });
    const txt = orderJobsWhere(ORG, { q: 'ORD2026' }).AND[2].OR;
    expect(txt.map((x: any) => Object.keys(x)[0])).toEqual(['order', 'customer', 'siteAddress']);
  });

  it('dates are Singapore days on the scheduled time; one end alone is that one day', () => {
    const r = orderJobsWhere(ORG, { from: '2026-11-03', to: '2026-11-04' }).AND[2].scheduledFor;
    expect(r.gte.toISOString()).toBe('2026-11-02T16:00:00.000Z');
    expect(r.lt.toISOString()).toBe('2026-11-04T16:00:00.000Z');
    const one = orderJobsWhere(ORG, { from: '2026-11-03' }).AND[2].scheduledFor;
    expect(one.lt.toISOString()).toBe('2026-11-03T16:00:00.000Z');
  });

  it('status filter and the status a row reads agree', () => {
    const cases: Array<[any, string]> = [
      [{ status: 'scheduled', isDraft: true }, 'draft'],
      [{ status: 'scheduled', isDraft: false }, 'scheduled'],
      [{ status: 'delivered' }, 'done'],
      [{ status: 'completed', verificationState: 'pending' }, 'to_verify'],
      [{ status: 'completed', verificationState: 'rejected' }, 'rejected'],
      [{ status: 'completed', verificationState: 'verified' }, 'completed'],
      [{ status: 'cancelled' }, 'cancelled'],
    ];
    for (const [row, state] of cases) expect(orderJobState(row)).toBe(state);
    expect(orderJobsWhere(ORG, { state: 'to_verify' }).AND[2]).toEqual({ status: 'completed', verificationState: 'pending' });
    expect(checkOrderJobFilters({ state: 'nope' })).toBe('Unknown status');
    expect(checkOrderJobFilters({ from: '2026-02-30' })).toBe('Invalid date');
    expect(checkOrderJobFilters({ from: '2026-01-01', to: '2026-12-31' })).toBeNull(); // long ranges are fine for a list
  });

  it('worker: planned worker, rider or the SiteClock worker', () => {
    const w = orderJobsWhere(ORG, { worker: 'Azad' }, ['d1']).AND[2].OR;
    expect(w).toEqual([{ plannedRiderName: 'Azad' }, { riderName: 'Azad' }, { id: { in: ['d1'] } }]);
    expect(orderJobWorker({ plannedRiderName: 'P', riderName: 'R' }, 'SC')).toBe('SC');
    expect(orderJobWorker({ plannedRiderName: 'P', riderName: 'R' }, null)).toBe('P');
    expect(orderJobWorker({ riderName: 'R' })).toBe('R');
  });
});

describe('"Job" wording on the server', () => {
  it('an order job is a Job; everything else stays a Delivery', () => {
    expect(runNoun({ orderId: 'o1' })).toBe('Job');
    expect(runNoun({ order: { orderNumber: 'ORD1' } })).toBe('Job');
    expect(runNoun({ orderNumber: 'ORD1' })).toBe('Job');
    expect(runNoun({ orderId: null })).toBe('Delivery');
    expect(runNoun(null)).toBe('Delivery');
    expect(deliveredLabel(true)).toBe('Done');
    expect(deliveredLabel(false)).toBe('Delivered');
  });

  it('SiteClock: the title fallback and the cancel reasons say Job for an order job, Delivery otherwise', () => {
    const base: any = { deliveryNumber: 12, items: [], status: 'cancelled', isDraft: false, scheduledFor: new Date(), siteAddress: 'x' };
    expect(jobTitle({ ...base, orderNumber: 'ORD1' })).toBe('ORD1 · #12 Job');
    expect(jobTitle(base)).toBe('#12 Delivery');
    const live = { workerId: 'w', lastPushedStatus: 'SCHEDULED' } as any;
    expect((planSync({ ...base, orderNumber: 'ORD1' }, live, 'd').steps[0] as any).reason).toBe('Job cancelled in AIMS');
    expect((planSync(base, live, 'd').steps[0] as any).reason).toBe('Delivery cancelled in AIMS');
  });
});
