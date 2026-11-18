import { NotFoundException } from '@nestjs/common';
import { childOrgsOf, groupReadScope, memberOrgIds, ORG_GROUP_SHARED_FEATURES, GROUP_CALENDAR_FLAG } from './org-group';
import { JobsCalendarService } from '../dashboard/jobs-calendar.service';
import { CalendarNotesService } from '../dashboard/calendar-notes.service';
import { DeliveriesService } from '../deliveries/deliveries.service';
import { DEFAULT_ORG_FEATURES } from './default-features';

/**
 * Org groups (WCT 2026-11-17): the jobs calendar is the ONLY cross-org read, parent to children only,
 * behind the parent's enableGroupCalendar; gate off = today's calendar exactly.
 */

const P = 'parent';
const C1 = 'child-racking';
const C2 = 'child-bcair';
const X = 'other-org';

interface World {
  features: Record<string, Record<string, boolean>>;
  parentOf: Record<string, string>;
  names: Record<string, string>;
  runs: Record<string, any[]>;
  notes: Record<string, any[]>;
  siteclock: Record<string, any[] | null>;
  members: Array<{ userId: string; orgId: string; role: boolean }>;
}

const run = (id: string, org: string, extra: any = {}) => ({
  id,
  deliveryNumber: 1,
  direction: 'OUTBOUND',
  status: 'scheduled',
  scheduledFor: new Date('2026-11-18T02:00:00.000Z'),
  scheduledAllDay: false,
  riderUserId: null,
  riderName: null,
  siteAddress: `${org} site`,
  customer: { name: `${org} customer` },
  project: null,
  order: { id: `o-${id}`, orderNumber: `ORD-${id}`, sourceQuotationId: null },
  sourceQuotationId: null,
  verificationState: null,
  ptwStatus: null,
  ptwRemark: null,
  items: [],
  ...extra,
});

const scJob = (id: string) => ({
  id,
  source: 'siteclock',
  externalRef: null,
  externalStatus: null,
  title: `SC ${id}`,
  location: '',
  description: null,
  allDay: true,
  startAt: null,
  endAt: null,
  date: '2026-11-18',
  site: { name: 'Site', address: null },
  teams: [],
  progress: 'NOT_STARTED',
  crew: [],
  cancelledAt: null,
  webUrl: `https://sc/#/jobs/${id}`,
});

/** A fake prisma that answers per org and records every org a query names. */
function fakePrisma(w: World) {
  const touched = new Set<string>();
  const orgOf = (where: any): string[] => {
    const v = where?.organizationId;
    const ids = typeof v === 'string' ? [v] : Array.isArray(v?.in) ? v.in : [];
    ids.forEach((i: string) => touched.add(i));
    return ids;
  };
  const prisma: any = {
    touched,
    raw: jest.fn(),
    organizationUIConfig: { findUnique: jest.fn(async ({ where }: any) => (orgOf(where), { features: w.features[where.organizationId] ?? {} })) },
    organization: { findUnique: jest.fn(async ({ where }: any) => (touched.add(where.id), w.names[where.id] ? { id: where.id, name: w.names[where.id] } : null)) },
    $queryRawUnsafe: jest.fn(async (_sql: string, id: string) => {
      touched.add(id);
      prisma.raw(id);
      return Object.entries(w.parentOf)
        .filter(([, p]) => p === id)
        .map(([c]) => ({ id: c, name: w.names[c] }))
        .sort((a, b) => a.name.localeCompare(b.name));
    }),
    delivery: {
      findMany: jest.fn(async ({ where }: any) => orgOf(where).flatMap((o) => (w.runs[o] ?? []).map((r) => ({ ...r })))),
      findFirst: jest.fn(async ({ where }: any) => {
        const [o] = orgOf(where);
        const r = (w.runs[o] ?? []).find((x) => x.id === where.id);
        return r ? { id: r.id, status: 'scheduled', isDraft: false, scheduledAllDay: true, orderId: null } : null;
      }),
      update: jest.fn(),
    },
    deliveryItem: { findMany: jest.fn(async () => []) },
    document: { findMany: jest.fn(async ({ where }: any) => (orgOf(where), [])) },
    deliverySiteClockJob: { findMany: jest.fn(async ({ where }: any) => (orgOf(where), [])) },
    calendarNote: {
      findMany: jest.fn(async ({ where }: any) => orgOf(where).flatMap((o) => w.notes[o] ?? [])),
      findFirst: jest.fn(async ({ where }: any) => {
        const [o] = orgOf(where);
        return (w.notes[o] ?? []).find((n) => n.id === where.id) ?? null;
      }),
      update: jest.fn(),
      delete: jest.fn(),
    },
    userOrganization: {
      findMany: jest.fn(async ({ where }: any) => w.members.filter((m) => m.userId === where.userId && where.organizationId.in.includes(m.orgId)).map((m) => ({ organizationId: m.orgId }))),
    },
    userRole: {
      findMany: jest.fn(async ({ where }: any) => w.members.filter((m) => m.role && m.userId === where.userId && where.organizationId.in.includes(m.orgId)).map((m) => ({ organizationId: m.orgId }))),
    },
  };
  return prisma;
}

const note = (id: string, org: string) => ({ id, title: `${org} note`, type: 'LEAVE', staffId: null, staffName: null, startDate: '2026-11-18', endDate: '2026-11-18', allDay: true, startTime: null, endTime: null, remark: null });
const ON = { enableJobsCalendar: true, enableWctOrders: true };

function world(over: Partial<World> = {}): World {
  return {
    features: { [P]: { ...ON, [GROUP_CALENDAR_FLAG]: true }, [C1]: { ...ON, [GROUP_CALENDAR_FLAG]: true }, [C2]: { enableJobsCalendar: true }, [X]: { ...ON, [GROUP_CALENDAR_FLAG]: true } },
    parentOf: { [C1]: P, [C2]: P },
    names: { [P]: 'WCT (S)', [C1]: 'WCT Racking', [C2]: 'BC Air', [X]: 'CIEL' },
    runs: { [P]: [run('p1', P)], [C1]: [run('c1', C1, { scheduledAllDay: true })], [C2]: [run('c2', C2)], [X]: [run('x1', X)] },
    notes: { [P]: [note('np', P)], [C1]: [note('nc1', C1)], [C2]: [note('nc2', C2)], [X]: [note('nx', X)] },
    siteclock: { [P]: [scJob('scp')], [C1]: null, [C2]: [scJob('scc2')], [X]: null },
    members: [],
    ...over,
  };
}

function svcFor(w: World) {
  const prisma = fakePrisma(w);
  const siteclock = { calendarJobs: jest.fn(async (org: string) => w.siteclock[org] ?? null) };
  const svc = new JobsCalendarService(prisma, siteclock as any, new CalendarNotesService(prisma));
  return { svc, prisma, siteclock };
}

const FROM = '2026-11-16';
const TO = '2026-11-22';
const HREF_KEYS = ['href', 'orderHref', 'doHref', 'quotationHref', 'siteclockUrl'];

describe('org group scope', () => {
  it('only the jobs calendar is allowlisted, and the flag is off by default for new orgs', () => {
    expect([...ORG_GROUP_SHARED_FEATURES]).toEqual(['jobsCalendar']);
    expect(DEFAULT_ORG_FEATURES[GROUP_CALENDAR_FLAG]).toBe(false);
  });

  it('a feature outside the allowlist reads only the request org', async () => {
    const prisma = fakePrisma(world());
    expect(await groupReadScope(prisma, P, 'documents' as any)).toEqual({ group: false, orgs: [{ id: P, name: '' }] });
    expect(prisma.$queryRawUnsafe).not.toHaveBeenCalled();
  });

  it('gate off: no group lookup at all', async () => {
    const w = world();
    w.features[P][GROUP_CALENDAR_FLAG] = false;
    const prisma = fakePrisma(w);
    expect((await groupReadScope(prisma, P, 'jobsCalendar')).group).toBe(false);
    expect(prisma.$queryRawUnsafe).not.toHaveBeenCalled();
  });

  it('parent: itself first, then its children; children and unrelated orgs: themselves only', async () => {
    const prisma = fakePrisma(world());
    expect(await groupReadScope(prisma, P, 'jobsCalendar')).toEqual({ group: true, orgs: [{ id: P, name: 'WCT (S)' }, { id: C2, name: 'BC Air' }, { id: C1, name: 'WCT Racking' }] });
    expect((await groupReadScope(prisma, C1, 'jobsCalendar')).orgs.map((o) => o.id)).toEqual([C1]);
    expect((await groupReadScope(prisma, X, 'jobsCalendar')).orgs.map((o) => o.id)).toEqual([X]);
  });

  it('childOrgsOf never returns the org itself and answers [] when the column is missing', async () => {
    expect(await childOrgsOf({ $queryRawUnsafe: async () => [{ id: P, name: 'self' }, { id: C1, name: 'c' }] }, P)).toEqual([{ id: C1, name: 'c' }]);
    expect(await childOrgsOf({ $queryRawUnsafe: async () => { throw new Error('column "parentOrgId" does not exist'); } }, P)).toEqual([]);
    expect(await childOrgsOf({}, P)).toEqual([]);
  });

  it('membership needs an active UserOrganization AND an active UserRole in that org', async () => {
    const prisma = fakePrisma(world({ members: [{ userId: 'u', orgId: C1, role: true }, { userId: 'u', orgId: C2, role: false }] }));
    expect([...(await memberOrgIds(prisma, 'u', [C1, C2]))]).toEqual([C1]);
    expect([...(await memberOrgIds(prisma, null, [C1]))]).toEqual([]);
    const where = prisma.userOrganization.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ userId: 'u', isActive: true });
    expect(prisma.userRole.findMany.mock.calls[0][0].where).toMatchObject({ userId: 'u', isActive: true });
  });
});

describe('group jobs calendar', () => {
  it('gate off on a parent with children = exactly the calendar of an org with no group', async () => {
    const w = world();
    w.features[P][GROUP_CALENDAR_FLAG] = false;
    const a = await svcFor(w).svc.get(P, FROM, TO, { userId: 'u' });
    const lone = world({ parentOf: {} });
    lone.features[P][GROUP_CALENDAR_FLAG] = false;
    const b = await svcFor(lone).svc.get(P, FROM, TO, { userId: 'u' });
    const noClock = (x: any) => ({ ...x, siteclock: { ...x.siteclock, fetchedAt: 't' } });
    expect(noClock(a)).toEqual(noClock(b));
    expect(JSON.stringify(a)).not.toMatch(/orgId|orgName|foreign|viewOnly|"group"/);
    expect(a.events.map((e) => e.id).sort()).toEqual(['aims:p1', 'sc:scp']);
  });

  it('flag on but no children (a non-group org) = its own calendar exactly, nothing of the group', async () => {
    const w = world();
    const on = await svcFor(w).svc.get(X, FROM, TO, { userId: 'u' });
    w.features[X][GROUP_CALENDAR_FLAG] = false;
    const off = await svcFor(w).svc.get(X, FROM, TO, { userId: 'u' });
    expect({ ...on, siteclock: null }).toEqual({ ...off, siteclock: null });
    expect(on.events.map((e) => e.id)).toEqual(['aims:x1']);
    expect(on.notes!.map((n) => n.id)).toEqual(['nx']);
  });

  it('a child sees only its own: no parent, no sibling, and queries name only its own org', async () => {
    const { svc, prisma } = svcFor(world());
    const r = await svc.get(C1, FROM, TO, { userId: 'u' });
    expect(r.events.map((e) => e.id)).toEqual(['aims:c1']);
    expect(r.notes!.map((n) => n.id)).toEqual(['nc1']);
    expect(r.group).toBeUndefined();
    expect([...prisma.touched]).toEqual([C1]);
  });

  it('parent: own + children jobs and notes, each named; SiteClock only for an org with its own connection', async () => {
    const { svc, prisma, siteclock } = svcFor(world());
    const r = await svc.get(P, FROM, TO, { userId: 'u' });
    const by = Object.fromEntries(r.events.map((e) => [e.id, e]));
    expect(Object.keys(by).sort()).toEqual(['aims:c1', 'aims:c2', 'aims:p1', 'sc:scc2', 'sc:scp']);
    expect(by['aims:p1']).toMatchObject({ orgId: P, orgName: 'WCT (S)' });
    expect(by['aims:p1'].foreign).toBeUndefined();
    expect(by['aims:c1']).toMatchObject({ orgId: C1, orgName: 'WCT Racking', foreign: true });
    expect(by['sc:scc2']).toMatchObject({ orgId: C2, orgName: 'BC Air', foreign: true });
    expect(siteclock.calendarJobs.mock.calls.map((c) => c[0]).sort()).toEqual([C2, C1, P].sort());
    expect(r.notes!.map((n) => [n.id, n.orgName, n.foreign ?? false])).toEqual([
      ['np', 'WCT (S)', false],
      ['nc1', 'WCT Racking', true],
    ]);
    expect(r.group!.orgs.map((o) => o.name)).toEqual(['WCT (S)', 'BC Air', 'WCT Racking']);
    expect([...prisma.touched].sort()).toEqual([C1, C2, P].sort());
    expect(prisma.touched.has(X)).toBe(false);
  });

  it('non-member: a child org item is view only and carries no link at all', async () => {
    const r = await svcFor(world()).svc.get(P, FROM, TO, { userId: 'u' });
    for (const e of r.events.filter((x) => x.foreign)) {
      expect(e.viewOnly).toBe(true);
      for (const k of HREF_KEYS) if (k in e) expect((e as any)[k]).toBeNull();
      expect(e.href).toBeNull();
      expect(e.siteclockUrl).toBeNull();
    }
    const own = r.events.find((e) => e.id === 'aims:p1')!;
    expect(own.href).toBe('/portal/deliveries/p1');
    expect(own.orderHref).toBe('/portal/orders/o-p1');
    expect(own.viewOnly).toBeUndefined();
  });

  it('member of one child (membership + role): that child opens, the other stays view only', async () => {
    const r = await svcFor(world({ members: [{ userId: 'u', orgId: C1, role: true }, { userId: 'u', orgId: C2, role: false }] })).svc.get(P, FROM, TO, { userId: 'u' });
    const c1 = r.events.find((e) => e.id === 'aims:c1')!;
    expect(c1.viewOnly).toBeUndefined();
    expect(c1.href).toBe('/portal/deliveries/c1');
    expect(c1.orderHref).toBe('/portal/orders/o-c1');
    const c2 = r.events.find((e) => e.id === 'aims:c2')!;
    expect(c2.viewOnly).toBe(true);
    expect(c2.href).toBeNull();
  });

  it('a parent without calendar notes gets no notes from its children (no add buttons appear)', async () => {
    const w = world();
    w.features[P] = { enableJobsCalendar: true, [GROUP_CALENDAR_FLAG]: true };
    const r = await svcFor(w).svc.get(P, FROM, TO, { userId: 'u' });
    expect(r.notes).toBeUndefined();
    expect(r.events.some((e) => e.id === 'aims:c1')).toBe(true);
  });
});

describe('writes stay in the request org (cross-org ids are refused)', () => {
  it('calendar notes: a child note id from the parent org is not found, nothing written', async () => {
    const prisma = fakePrisma(world());
    const notes = new CalendarNotesService(prisma);
    await expect(notes.update(P, 'nc1', { title: 'x', type: 'LEAVE', startDate: '2026-11-18', endDate: '2026-11-18', allDay: true })).rejects.toBeInstanceOf(NotFoundException);
    await expect(notes.remove(P, 'nc1')).rejects.toBeInstanceOf(NotFoundException);
    // and upward: a child cannot touch the parent's note
    await expect(notes.remove(C1, 'np')).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.calendarNote.update).not.toHaveBeenCalled();
    expect(prisma.calendarNote.delete).not.toHaveBeenCalled();
  });

  it('reschedule (drag) and quick-job edit: a child job id from the parent org is not found, nothing written', async () => {
    const prisma = fakePrisma(world());
    const svc: any = Object.create(DeliveriesService.prototype);
    svc.prisma = prisma;
    await expect(svc.moveAllDayJob('c1', P, { date: '2026-11-19' })).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.updateQuickJob('c1', P, {})).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.moveAllDayJob('p1', C1, { date: '2026-11-19' })).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.delivery.update).not.toHaveBeenCalled();
  });
});

// Hide SiteClock jobs (hideSiteClockJobs, 2026-11-18): the viewing org's flag decides for its whole calendar.
describe('group jobs calendar: hide SiteClock jobs', () => {
  it('parent flag on: no SiteClock job from any org and no SiteClock fetch; group jobs and notes stay', async () => {
    const w = world();
    w.features[P].hideSiteClockJobs = true;
    const { svc, siteclock } = svcFor(w);
    const r = await svc.get(P, FROM, TO, { userId: 'u' });
    expect(siteclock.calendarJobs).not.toHaveBeenCalled();
    expect(r.events.some((e) => e.source === 'siteclock')).toBe(false);
    expect(r.events.map((e) => e.id).sort()).toEqual(['aims:c1', 'aims:c2', 'aims:p1']);
    const plain = await svcFor(world()).svc.get(P, FROM, TO, { userId: 'u' });
    expect(r.notes).toEqual(plain.notes);
    expect(r.events).toEqual(plain.events.filter((e) => e.source !== 'siteclock'));
    expect(r.siteclockJobsHidden).toBe(true);
  });

  it('flag off: SiteClock jobs of the parent and children show as before', async () => {
    const r = await svcFor(world()).svc.get(P, FROM, TO, { userId: 'u' });
    expect(r.events.filter((e) => e.source === 'siteclock').map((e) => e.id).sort()).toEqual(['sc:scc2', 'sc:scp']);
    expect(r).not.toHaveProperty('siteclockJobsHidden');
  });
});
