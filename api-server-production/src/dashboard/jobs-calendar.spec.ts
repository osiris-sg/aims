import { NotFoundException, BadRequestException } from '@nestjs/common';
import { buildCalendarEvents, CalendarRun, CalendarSiteClockJob, checkRange, deliveryIdOfRef, rangeInstants } from './jobs-calendar';
import { JobsCalendarService } from './jobs-calendar.service';

const WCT = '5c700000-0000-4000-8000-5c7000000001';
const D1 = '11111111-1111-4111-8111-111111111111';
const D2 = '22222222-2222-4222-8222-222222222222';
const D3 = '33333333-3333-4333-8333-333333333333';

const run = (over: Partial<CalendarRun> = {}): CalendarRun => ({
  id: D1,
  deliveryNumber: 12,
  direction: 'OUTBOUND',
  status: 'scheduled',
  scheduledFor: new Date('2026-11-03T02:00:00Z'), // 10:00 SGT
  riderUserId: null,
  riderName: null,
  siteAddress: '1 Tuas Ave 018989',
  customerName: 'Acme',
  projectName: null,
  service: false,
  ...over,
});

const scJob = (over: Partial<CalendarSiteClockJob> = {}): CalendarSiteClockJob => ({
  id: 'sc1',
  source: 'siteclock',
  externalRef: null,
  externalStatus: null,
  title: 'Aircon PM',
  location: 'Jurong Point',
  description: null,
  allDay: false,
  startAt: '2026-11-03T01:00:00.000Z',
  endAt: '2026-11-03T02:00:00.000Z',
  date: '2026-11-03',
  site: { name: 'Jurong Point', address: '1 Jurong West' },
  teams: [{ name: 'Team A' }],
  progress: 'NOT_STARTED',
  crew: [{ name: 'Ali', arrivedAt: null, leftAt: null }],
  cancelledAt: null,
  webUrl: 'https://siteclock.osiris.sg/#/jobs',
  ...over,
});

describe('jobs calendar merge', () => {
  it('a run without a SiteClock link lasts 60 minutes and links to its delivery page', () => {
    const [e] = buildCalendarEvents([run()], [], null);
    expect(e).toMatchObject({
      id: `aims:${D1}`,
      source: 'aims',
      kind: 'delivery',
      title: '#12 Acme',
      start: '2026-11-03T02:00:00.000Z',
      end: '2026-11-03T03:00:00.000Z',
      allDay: false,
      statusLabel: 'Scheduled',
      href: `/portal/deliveries/${D1}`,
      siteclockUrl: null,
      worker: null,
      rider: null,
    });
  });

  it('service runs and returns get their own kind; the return is labelled', () => {
    const ev = buildCalendarEvents([run({ id: D1, service: true }), run({ id: D2, direction: 'RETURN', deliveryNumber: 13 })], [], null);
    expect(ev.find((e) => e.id === `aims:${D1}`)?.kind).toBe('service');
    const ret = ev.find((e) => e.id === `aims:${D2}`)!;
    expect(ret.kind).toBe('return');
    expect(ret.title).toBe('Return #13 Acme');
  });

  it('a linked run lasts the link duration, shows the planned worker, and the rider only once claimed', () => {
    const links = [{ deliveryId: D1, workerName: 'Ali', durationMin: 90, externalRef: `aims-delivery:${D1}` }];
    const [unclaimed] = buildCalendarEvents([run({ riderName: 'Stale name' })], links, null);
    expect(unclaimed.end).toBe('2026-11-03T03:30:00.000Z');
    expect(unclaimed.worker).toBe('Ali');
    expect(unclaimed.rider).toBeNull();
    const [claimed] = buildCalendarEvents([run({ status: 'in_progress', riderUserId: 'user_1', riderName: 'Bala' })], links, null);
    expect(claimed.rider).toBe('Bala');
    expect(claimed.statusLabel).toBe('In progress');
  });

  it('an AIMS-created SiteClock job never shows twice: its crew and arrive / leave merge onto the run', () => {
    const links = [{ deliveryId: D1, workerName: 'Ali (old name)', durationMin: 60, externalRef: `aims-delivery:${D1}` }];
    const sc = [
      scJob({ id: 'own' }),
      scJob({
        id: 'aimsjob',
        source: 'external',
        externalRef: `aims-delivery:${D1}`,
        externalStatus: 'IN_PROGRESS',
        crew: [{ name: 'Ali', arrivedAt: '2026-11-03T02:05:00.000Z', leftAt: null }],
      }),
      // A SiteClock job for a run outside this range / deleted: dropped too.
      scJob({ id: 'orphan', source: 'external', externalRef: `aims-delivery:${D3}` }),
    ];
    const ev = buildCalendarEvents([run()], links, sc);
    expect(ev.map((e) => e.id).sort()).toEqual([`aims:${D1}`, 'sc:own'].sort());
    const aims = ev.find((e) => e.id === `aims:${D1}`)!;
    expect(aims.crew).toEqual([{ name: 'Ali', arrivedAt: '2026-11-03T02:05:00.000Z', leftAt: null }]);
    expect(aims.worker).toBe('Ali');
  });

  it("prefers the link's current generation over an older cancelled job", () => {
    const links = [{ deliveryId: D1, workerName: 'Bala', durationMin: 60, externalRef: `aims-delivery:${D1}:2` }];
    const sc = [
      scJob({ id: 'g1', source: 'external', externalRef: `aims-delivery:${D1}`, externalStatus: 'CANCELLED', cancelledAt: '2026-11-01T00:00:00Z', crew: [{ name: 'Ali', arrivedAt: null, leftAt: null }] }),
      scJob({ id: 'g2', source: 'external', externalRef: `aims-delivery:${D1}:2`, externalStatus: 'SCHEDULED', crew: [{ name: 'Bala', arrivedAt: null, leftAt: null }] }),
    ];
    const [e] = buildCalendarEvents([run()], links, sc);
    expect(e.crew[0].name).toBe('Bala');
  });

  it('SiteClock-native jobs: green kind, team labels, Open in SiteClock, no AIMS link; all-day jobs by date', () => {
    const ev = buildCalendarEvents([], [], [scJob(), scJob({ id: 'day', allDay: true, startAt: null, endAt: null, progress: 'DONE' })]);
    const timed = ev.find((e) => e.id === 'sc:sc1')!;
    expect(timed).toMatchObject({ source: 'siteclock', kind: 'siteclock', start: '2026-11-03T01:00:00.000Z', worker: 'Team A', href: null, siteclockUrl: 'https://siteclock.osiris.sg/#/jobs', statusLabel: 'Not started' });
    const day = ev.find((e) => e.id === 'sc:day')!;
    expect(day).toMatchObject({ allDay: true, start: '2026-11-03', end: null, completed: true, statusLabel: 'Done' });
  });

  it('completed and cancelled runs are flagged for fading / hiding', () => {
    const ev = buildCalendarEvents([run({ id: D1, status: 'completed' }), run({ id: D2, status: 'cancelled' })], [], null);
    expect(ev.find((e) => e.id === `aims:${D1}`)).toMatchObject({ completed: true, cancelled: false });
    expect(ev.find((e) => e.id === `aims:${D2}`)).toMatchObject({ completed: false, cancelled: true, statusLabel: 'Cancelled' });
  });

  it('reads the delivery id out of AIMS refs only', () => {
    expect(deliveryIdOfRef(`aims-delivery:${D1}`)).toBe(D1);
    expect(deliveryIdOfRef(`aims-delivery:${D1}:3`)).toBe(D1);
    expect(deliveryIdOfRef('something-else')).toBeNull();
    expect(deliveryIdOfRef(null)).toBeNull();
  });

  it('checks the range: dates required, order, at most 62 days', () => {
    expect(checkRange('2026-11-01', '2026-11-30')).toBeNull();
    expect(checkRange('2026-11-01', '2027-01-01')).toBeNull(); // 62 days
    expect(checkRange('2026-11-01', '2027-01-02')).toMatch(/62/);
    expect(checkRange('2026-11-04', '2026-11-03')).toMatch(/after/);
    expect(checkRange('2026-02-30', '2026-03-01')).toMatch(/Invalid/);
    expect(checkRange(undefined, '2026-11-01')).toMatch(/required/);
  });

  it('queries whole Singapore days', () => {
    expect(rangeInstants('2026-11-03', '2026-11-04')).toEqual({ gte: new Date('2026-11-02T16:00:00Z'), lt: new Date('2026-11-04T16:00:00Z') });
  });
});

describe('JobsCalendarService', () => {
  const deliveryRow = {
    id: D1,
    deliveryNumber: 12,
    direction: 'OUTBOUND',
    status: 'scheduled',
    scheduledFor: new Date('2026-11-03T02:00:00Z'),
    riderUserId: null,
    riderName: null,
    siteAddress: '1 Tuas Ave',
    customer: { name: 'Acme' },
    project: null,
    items: [{ id: 'svc' }],
  };
  function setup(opts: { flag?: boolean; sc?: () => Promise<any> } = {}) {
    const deliveryFind = jest.fn().mockResolvedValue([deliveryRow]);
    const prisma: any = {
      organizationUIConfig: { findUnique: jest.fn().mockResolvedValue({ features: { enableJobsCalendar: opts.flag ?? true } }) },
      delivery: { findMany: deliveryFind },
      deliverySiteClockJob: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const calendarJobs = jest.fn(opts.sc ?? (async () => [scJob()]));
    const svc = new JobsCalendarService(prisma, { calendarJobs } as any);
    return { svc, prisma, calendarJobs, deliveryFind };
  }

  it('orgs without the flag get a 404 and no queries', async () => {
    const { svc, deliveryFind, calendarJobs } = setup({ flag: false });
    await expect(svc.get(WCT, '2026-11-01', '2026-11-30')).rejects.toBeInstanceOf(NotFoundException);
    expect(deliveryFind).not.toHaveBeenCalled();
    expect(calendarJobs).not.toHaveBeenCalled();
  });

  it('a bad range is a 400', async () => {
    const { svc } = setup();
    await expect(svc.get(WCT, '2026-11-01', '2027-02-01')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('merges both sources; drafts are excluded in the query; the service line makes it a service run', async () => {
    const { svc, deliveryFind } = setup();
    const res = await svc.get(WCT, '2026-11-01', '2026-11-30');
    expect(deliveryFind.mock.calls[0][0].where).toMatchObject({ organizationId: WCT, isDraft: false });
    expect(res.siteclock.state).toBe('ok');
    expect(res.timezone).toBe('Asia/Singapore');
    expect(res.events.map((e) => e.kind).sort()).toEqual(['service', 'siteclock']);
  });

  it('caches the SiteClock feed for 60 s per org + range', async () => {
    const { svc, calendarJobs } = setup();
    await svc.get(WCT, '2026-11-01', '2026-11-30');
    await svc.get(WCT, '2026-11-01', '2026-11-30');
    expect(calendarJobs).toHaveBeenCalledTimes(1);
    await svc.get(WCT, '2026-12-01', '2026-12-31');
    expect(calendarJobs).toHaveBeenCalledTimes(2);
    const now = Date.now();
    const spy = jest.spyOn(Date, 'now').mockReturnValue(now + 61_000);
    await svc.get(WCT, '2026-11-01', '2026-11-30');
    spy.mockRestore();
    expect(calendarJobs).toHaveBeenCalledTimes(3);
  });

  it('SiteClock down: AIMS events still come back with state unavailable, and the failure is not cached', async () => {
    const { svc, calendarJobs } = setup({ sc: async () => { throw new Error('SiteClock unreachable: timed out after 10s'); } });
    const res = await svc.get(WCT, '2026-11-01', '2026-11-30');
    expect(res.siteclock).toMatchObject({ state: 'unavailable' });
    expect(res.events.map((e) => e.source)).toEqual(['aims']);
    await svc.get(WCT, '2026-11-01', '2026-11-30');
    expect(calendarJobs).toHaveBeenCalledTimes(2);
  });

  it('no SiteClock connection: state off, AIMS events only', async () => {
    const { svc } = setup({ sc: async () => null });
    const res = await svc.get(WCT, '2026-11-01', '2026-11-30');
    expect(res.siteclock.state).toBe('off');
    expect(res.events).toHaveLength(1);
  });
});
