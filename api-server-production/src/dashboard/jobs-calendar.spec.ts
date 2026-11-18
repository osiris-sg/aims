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

  it('an all-day run (2026-11-10) is an all-day event on its Singapore day; a timed run is unchanged', () => {
    const [ev] = buildCalendarEvents([run({ scheduledAllDay: true, scheduledFor: new Date('2026-11-10T16:00:00Z') })], [], null);
    expect(ev).toMatchObject({ allDay: true, start: '2026-11-11', end: null, kind: 'delivery' });
    const [timed] = buildCalendarEvents([run()], [], null);
    expect(timed).toMatchObject({ allDay: false, start: '2026-11-03T02:00:00.000Z', end: '2026-11-03T03:00:00.000Z' });
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

  it('a SiteClock-assigned job shows once on every sync (listed twice, re-fetched); no order, read only (no AIMS page)', () => {
    const sc = [scJob({ id: 'm1' }), scJob({ id: 'm1' })];
    const first = buildCalendarEvents([], [], sc);
    const again = buildCalendarEvents([], [], sc);
    expect(first.map((e) => e.id)).toEqual(['sc:m1']);
    expect(again).toEqual(first);
    expect(first[0]).toMatchObject({ source: 'siteclock', href: null, deliveryNumber: null });
    expect(first[0].orderNumber).toBeUndefined();
  });

  it('jobs AIMS pushed to SiteClock never come back as SiteClock (misc) jobs, whatever their generation', () => {
    const links = [{ deliveryId: D1, workerName: 'Ali', durationMin: 60, externalRef: `aims-delivery:${D1}:3` }];
    const sc = [1, 2, 3].map((g) => scJob({ id: `g${g}`, source: 'external', externalRef: g === 1 ? `aims-delivery:${D1}` : `aims-delivery:${D1}:${g}` }));
    const ev = buildCalendarEvents([run({ order: { id: 'o1', orderNumber: 'ORD1' } })], links, sc);
    expect(ev.map((e) => e.id)).toEqual([`aims:${D1}`]);
    expect(ev[0].orderNumber).toBe('ORD1');
  });

  it("a run's DO: completed DO → Completed, voided DO → Cancelled, no DO → nothing", () => {
    const dl = (deliveryOrder: any) => buildCalendarEvents([run({ deliveryOrder })], [], null)[0];
    expect(dl({ id: 'd', name: 'DO202610007', status: 'delivered_installed', templateId: 't', cancelled: false })).toMatchObject({ doNumber: 'DO202610007', doTag: 'Completed' });
    expect(dl({ id: 'd', name: 'DO202610008', status: 'unconfirmed', templateId: 't', cancelled: true })).toMatchObject({ doNumber: 'DO202610008', doTag: 'Cancelled' });
    expect(dl(null)).toMatchObject({ doNumber: null, doTag: null, doHref: null });
  });

  it('a job of a WCT order: the order number leads the title and the popup links the order', () => {
    const [e] = buildCalendarEvents([run({ order: { id: 'o1', orderNumber: 'ORD202611-001' } })], [], null);
    expect(e.title.startsWith('ORD202611-001 · #')).toBe(true);
    expect(e).toMatchObject({ orderNumber: 'ORD202611-001', orderHref: '/portal/orders/o1' });
    const [plain] = buildCalendarEvents([run()], [], null);
    expect(plain.title.startsWith('#')).toBe(true);
    // A finished-but-unsigned order job reads "Done"; any other run "Delivered" (2026-11-03).
    expect(buildCalendarEvents([run({ status: 'delivered', order: { id: 'o1', orderNumber: 'ORD1' } })], [], null)[0].statusLabel).toBe('Done');
    expect(buildCalendarEvents([run({ status: 'delivered' })], [], null)[0].statusLabel).toBe('Delivered');
    expect(plain).not.toHaveProperty('orderNumber');
    expect(plain).not.toHaveProperty('verificationLabel');
    const [pending] = buildCalendarEvents([run({ status: 'completed', verificationState: 'pending' })], [], null);
    expect(pending.verificationLabel).toBe('Awaiting verification');
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
      deliveryItem: { findMany: jest.fn().mockResolvedValue([{ deliveryId: D1, documentId: 'doc1' }]) },
      document: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'doc1', name: 'DO202610007', status: 'unconfirmed', documentTemplateId: 'tpl1', config: {}, createdAt: new Date() },
        ]),
      },
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
    // The popup's DO block: number, tag, and the office DO page.
    const run = res.events.find((e) => e.source === 'aims')!;
    expect(run).toMatchObject({ doNumber: 'DO202610007', doTag: 'Pending', doHref: '/portal/documents/DELIVERY_ORDER/tpl1/doc1' });
    expect(res.events.find((e) => e.source === 'siteclock')).toMatchObject({ doNumber: null, doTag: null, doHref: null });
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

// WCT calendar add (enableWctOrders + enableJobsCalendar): the panel's Quotation link.
describe('jobs calendar quotation link (calendar add gate)', () => {
  const ORD = '44444444-4444-4444-8444-444444444444';
  const Q1 = '55555555-5555-4555-8555-555555555555';
  const Q2 = '66666666-6666-4666-8666-666666666666';
  const base = {
    deliveryNumber: 12,
    direction: 'OUTBOUND',
    status: 'scheduled',
    scheduledFor: new Date('2026-11-03T02:00:00Z'),
    riderUserId: null,
    riderName: null,
    siteAddress: '1 Tuas Ave',
    customer: { name: 'Acme' },
    project: null,
    items: [],
  };
  const rows = [
    // Order job: the order's quotation wins over the run's own pointer.
    { ...base, id: D1, order: { id: ORD, orderNumber: 'ORD202611-001', sourceQuotationId: Q1 }, sourceQuotationId: Q2 },
    // Quick job on an unsigned quotation: no order yet.
    { ...base, id: D2, deliveryNumber: 13, order: null, sourceQuotationId: Q2 },
    // Misc job: no order, no quotation.
    { ...base, id: D3, deliveryNumber: 14, order: null, sourceQuotationId: null },
  ];
  function setup(gateOn: boolean) {
    const docFind = jest.fn(async (args: any) =>
      args.where.type
        ? [{ id: 'doc1', name: 'DO202611001', status: 'unconfirmed', documentTemplateId: 'tplDO', config: {}, createdAt: new Date() }]
        : [
            { id: Q1, name: 'QO202611-001', type: 'QUOTATION', documentTemplateId: 'tplQ' },
            { id: Q2, name: 'QO202611-002', type: 'QUOTATION', documentTemplateId: 'tplQ' },
          ].filter((d) => args.where.id.in.includes(d.id)),
    );
    const prisma: any = {
      organizationUIConfig: { findUnique: jest.fn().mockResolvedValue({ features: { enableJobsCalendar: true } }) },
      delivery: { findMany: jest.fn().mockResolvedValue(rows.map((r) => ({ ...r }))) },
      deliverySiteClockJob: { findMany: jest.fn().mockResolvedValue([]) },
      deliveryItem: { findMany: jest.fn().mockResolvedValue([{ deliveryId: D1, documentId: 'doc1' }]) },
      document: { findMany: docFind },
    };
    const notes = { inRange: jest.fn().mockResolvedValue(gateOn ? [] : null) };
    const svc = new JobsCalendarService(prisma, { calendarJobs: async () => [scJob()] } as any, notes as any);
    return { svc, docFind };
  }
  const byId = (events: any[], id: string) => events.find((e) => e.id === id);

  it('gate on: order job gets its order quotation, an unsigned quick job its own, a misc and a SiteClock job none', async () => {
    const { svc } = setup(true);
    const res = await svc.get(WCT, '2026-11-01', '2026-11-30');
    expect(byId(res.events, `aims:${D1}`)).toMatchObject({
      orderNumber: 'ORD202611-001',
      orderHref: `/portal/orders/${ORD}`,
      quotationNumber: 'QO202611-001',
      quotationHref: `/portal/documents/QUOTATION/tplQ/${Q1}`,
      doNumber: 'DO202611001',
      doHref: '/portal/documents/DELIVERY_ORDER/tplDO/doc1',
    });
    const quick = byId(res.events, `aims:${D2}`);
    expect(quick).toMatchObject({ quotationNumber: 'QO202611-002', quotationHref: `/portal/documents/QUOTATION/tplQ/${Q2}`, untagged: true });
    expect(quick.orderNumber).toBeUndefined();
    const misc = byId(res.events, `aims:${D3}`);
    expect(misc.quotationNumber).toBeUndefined();
    expect(misc.orderNumber).toBeUndefined();
    expect(byId(res.events, 'sc:sc1').quotationNumber).toBeUndefined();
    // No internal pointers leak into the payload.
    expect(JSON.stringify(res.events)).not.toContain('quotationId');
    expect(JSON.stringify(res.events)).not.toContain('sourceQuotationId');
  });

  it('gate off: no quotation fields and no quotation query; events match the plain merge', async () => {
    const { svc, docFind } = setup(false);
    const res = await svc.get(WCT, '2026-11-01', '2026-11-30');
    for (const e of res.events) {
      expect(e.quotationNumber).toBeUndefined();
      expect(e.quotationHref).toBeUndefined();
    }
    expect(docFind).toHaveBeenCalledTimes(1); // the DO lookup only
    expect(docFind.mock.calls[0][0].where.type).toBeDefined();
    expect(JSON.stringify(res.events)).not.toContain('quotationId');
    expect(res.notes).toBeUndefined();
  });

  it('a quotation without a template shows its number with no link', () => {
    const [e] = buildCalendarEvents([run({ quotation: { id: Q1, name: 'QO1', type: 'QUOTATION', templateId: null } })], [], null);
    expect(e).toMatchObject({ quotationNumber: 'QO1', quotationHref: null });
    const [plain] = buildCalendarEvents([run()], [], null);
    expect('quotationNumber' in plain).toBe(false);
  });
});

describe('jobs calendar: job category (WCT group)', () => {
  it('a run with a category carries it to the event (panel + chip tooltip)', () => {
    const [e] = buildCalendarEvents([run({ category: 'Site visit' })], [], null);
    expect(e.category).toBe('Site visit');
  });
  it('orgs without categories: no category key on the event (as before)', () => {
    const [e] = buildCalendarEvents([run()], [], null);
    expect('category' in e).toBe(false);
  });
});

// Hide SiteClock jobs (hideSiteClockJobs, WCT group 2026-11-18): only jobs made in AIMS.
describe('jobs calendar: hide SiteClock jobs', () => {
  const OTHER = '99999999-9999-4999-8999-999999999999';
  const pushed = (over: Partial<CalendarSiteClockJob> = {}) =>
    scJob({ id: 'scA', source: 'external', externalRef: `aims-delivery:${D1}`, crew: [{ name: 'Ravi', arrivedAt: '2026-11-03T02:05:00.000Z', leftAt: null }], ...over });

  it('merge, aimsOnly: SiteClock-created jobs are left out; an AIMS-pushed job still merges its crew', () => {
    const jobs = [scJob(), scJob({ id: 'sc2', title: 'Other' }), pushed()];
    const off = buildCalendarEvents([run()], [], jobs);
    expect(off.map((e) => e.id).sort()).toEqual([`aims:${D1}`, 'sc:sc1', 'sc:sc2']);
    const on = buildCalendarEvents([run()], [], jobs, { aimsOnly: true });
    expect(on.map((e) => e.id)).toEqual([`aims:${D1}`]);
    expect(on[0].crew).toEqual([{ name: 'Ravi', arrivedAt: '2026-11-03T02:05:00.000Z', leftAt: null }]);
    expect(on.some((e) => e.source === 'siteclock')).toBe(false);
  });

  const row = (id: string, n: number) => ({
    id, deliveryNumber: n, direction: 'OUTBOUND', status: 'scheduled', scheduledFor: new Date('2026-11-03T02:00:00Z'),
    riderUserId: null, riderName: null, siteAddress: '1 Tuas Ave', customer: { name: 'Acme' }, project: null, items: [],
  });
  function setup(opts: { features: Record<string, Record<string, boolean>>; links?: any[]; sc?: () => Promise<any> }) {
    const prisma: any = {
      organizationUIConfig: { findUnique: jest.fn(async ({ where }: any) => ({ features: opts.features[where.organizationId] ?? {} })) },
      delivery: { findMany: jest.fn().mockResolvedValue([row(D1, 12)]) },
      deliverySiteClockJob: { findMany: jest.fn().mockResolvedValue(opts.links ?? []) },
      deliveryItem: { findMany: jest.fn().mockResolvedValue([]) },
      document: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const calendarJobs = jest.fn(opts.sc ?? (async () => [scJob(), pushed()]));
    return { svc: new JobsCalendarService(prisma, { calendarJobs } as any), calendarJobs };
  }
  const ON = { enableJobsCalendar: true, hideSiteClockJobs: true };

  it('flag on, no AIMS job pushed in range: the SiteClock feed is never fetched; AIMS jobs only', async () => {
    const { svc, calendarJobs } = setup({ features: { [WCT]: ON } });
    const res = await svc.get(WCT, '2026-11-01', '2026-11-30');
    expect(calendarJobs).not.toHaveBeenCalled();
    expect(res.events.map((e) => e.id)).toEqual([`aims:${D1}`]);
    expect(res.siteclock.state).toBe('off');
    expect(res.siteclockJobsHidden).toBe(true);
  });

  it('flag on, an AIMS job pushed to SiteClock: it is shown with its SiteClock crew; SiteClock-created jobs are hidden', async () => {
    const links = [{ deliveryId: D1, workerName: 'Ravi', durationMin: 90, externalRef: `aims-delivery:${D1}` }];
    const { svc, calendarJobs } = setup({ features: { [WCT]: ON }, links });
    const res = await svc.get(WCT, '2026-11-01', '2026-11-30');
    expect(calendarJobs).toHaveBeenCalledTimes(1);
    expect(res.events.map((e) => e.id)).toEqual([`aims:${D1}`]);
    expect(res.events[0].crew.map((c) => c.name)).toEqual(['Ravi']);
    expect(res.events.some((e) => e.source === 'siteclock')).toBe(false);
  });

  it('flag off: SiteClock jobs show as before and the feed is fetched', async () => {
    const { svc, calendarJobs } = setup({ features: { [WCT]: { enableJobsCalendar: true, hideSiteClockJobs: false } } });
    const res = await svc.get(WCT, '2026-11-01', '2026-11-30');
    expect(calendarJobs).toHaveBeenCalledTimes(1);
    expect(res.events.map((e) => e.id).sort()).toEqual([`aims:${D1}`, 'sc:sc1']);
    expect(res).not.toHaveProperty('siteclockJobsHidden');
  });

  it('another org without the key: unchanged (SiteClock jobs shown, feed fetched, no new field)', async () => {
    const { svc, calendarJobs } = setup({ features: { [WCT]: ON, [OTHER]: { enableJobsCalendar: true } } });
    const res = await svc.get(OTHER, '2026-11-01', '2026-11-30');
    expect(calendarJobs).toHaveBeenCalledWith(OTHER, '2026-11-01', '2026-11-30');
    expect(res.events.map((e) => e.id).sort()).toEqual([`aims:${D1}`, 'sc:sc1']);
    expect(res).not.toHaveProperty('siteclockJobsHidden');
  });

  it('flag on, SiteClock down while an AIMS job is pushed: AIMS jobs still come back', async () => {
    const links = [{ deliveryId: D1, workerName: 'Ravi', durationMin: 60, externalRef: `aims-delivery:${D1}` }];
    const { svc } = setup({ features: { [WCT]: ON }, links, sc: async () => { throw new Error('down'); } });
    const res = await svc.get(WCT, '2026-11-01', '2026-11-30');
    expect(res.events.map((e) => e.id)).toEqual([`aims:${D1}`]);
    expect(res.events[0].worker).toBe('Ravi');
  });
});
