import { BadRequestException } from '@nestjs/common';
import { parseNoteSave, tsvEvent, TSV_NOTE } from './calendar-note-types';
import { CalendarNotesService } from './calendar-notes.service';
import { CalendarStyleService } from './calendar-style.service';
import { JobsCalendarService } from './jobs-calendar.service';
import { forNewJobs } from '../deliveries/job-category';

/** Note types (WCT group, calendar style orgs, 2026-11-24): General / Site visit / Technician Site Visit. */
const CUST = '11111111-2222-4333-8444-555555555555';
const tsvBody = (over: any = {}) => ({
  type: 'TECH_SITE_VISIT',
  startDate: '2026-12-09',
  startTime: '10:00',
  durationMin: 90,
  customerId: CUST,
  shopName: '',
  siteAddress: ' 1 Jalan Besar ',
  workers: [{ id: 'w1', name: 'Ali' }, { id: 'w2', name: 'Bala' }],
  team: ' Team A ',
  salesperson: { id: 'u-amy', name: 'Amy' },
  remark: ' Check the hood ',
  ...over,
});

describe('note types: parse', () => {
  it('old types parse exactly as before, styled or not', () => {
    const old = { title: ' Ali on leave ', type: 'leave', startDate: '2026-11-10', endDate: '2026-11-12', staffId: 'w1', staffName: 'Ali' };
    const plain = parseNoteSave(old, false);
    expect(parseNoteSave(old, true)).toEqual(plain);
    expect(plain).toEqual({ title: 'Ali on leave', type: 'LEAVE', staffId: 'w1', staffName: 'Ali', startDate: '2026-11-10', endDate: '2026-11-12', allDay: true, startTime: null, endTime: null, remark: null, details: null });
    for (const t of ['PTW', 'BLOCKAGE', 'OTHER']) expect(parseNoteSave({ ...old, type: t }, false).type).toBe(t);
  });
  it('Site visit and Technician Site Visit: calendar style orgs only', () => {
    expect(() => parseNoteSave({ title: 'x', type: 'SITE_VISIT', startDate: '2026-11-10' }, false)).toThrow(BadRequestException);
    expect(() => parseNoteSave(tsvBody(), false)).toThrow(/LEAVE, PTW, BLOCKAGE, OTHER/);
    expect(() => parseNoteSave({ title: 'x', type: 'HOLIDAY', startDate: '2026-11-10' }, true)).toThrow(BadRequestException);
  });
  it('Site visit is a plain note (title, dates, staff)', () => {
    expect(parseNoteSave({ title: 'Visit Domino', type: 'site_visit', startDate: '2026-11-10' }, true)).toMatchObject({ title: 'Visit Domino', type: 'SITE_VISIT', endDate: '2026-11-10' });
  });
  it('2026-11-25: a Technician Site Visit has the General fields (title, staff, dates / times, remark); details untouched', () => {
    const n = parseNoteSave({ type: 'TECH_SITE_VISIT', title: ' Visit Domino ', staffId: 'w1', staffName: 'Ali', startDate: '2026-12-09', endDate: '2026-12-10', allDay: false, startTime: '10:00', endTime: '11:30', remark: ' Check the hood ' }, true);
    expect(n).toEqual({ title: 'Visit Domino', type: TSV_NOTE, staffId: 'w1', staffName: 'Ali', startDate: '2026-12-09', endDate: '2026-12-10', allDay: false, startTime: '10:00', endTime: '11:30', remark: 'Check the hood' });
    expect(n).not.toHaveProperty('details');
    // The old job-like fields are ignored (no customer / shop needed, nothing stored from them).
    expect(parseNoteSave(tsvBody({ title: 'x', endTime: '11:00' }), true)).not.toHaveProperty('details');
    expect(() => parseNoteSave({ type: 'TECH_SITE_VISIT', title: '', startDate: '2026-12-09' }, true)).toThrow(BadRequestException);
    expect(parseNoteSave({ type: 'SITE_VISIT', title: 'x', startDate: '2026-12-09' }, true)).not.toHaveProperty('details');
  });
});

describe('note types: a Technician Site Visit as a calendar event', () => {
  const note = {
    id: 'n1',
    title: 'Domino',
    type: TSV_NOTE,
    staffId: 'w1',
    staffName: 'Ali',
    startDate: '2026-12-09',
    endDate: '2026-12-09',
    allDay: false,
    startTime: '10:00',
    endTime: '11:30',
    remark: 'Check the hood',
    details: { customerId: CUST, customerName: 'Domino Pizza', shopName: null, address: '1 Jalan Besar', durationMin: 90, workers: [{ id: 'w1', name: 'Ali' }], team: 'Team A', salesperson: { id: 'u-amy', name: 'Amy' } },
  };
  it('shaped like an AIMS job card (time + title); the old details are not shown', () => {
    const e = tsvEvent(note);
    expect(e).toMatchObject({
      id: 'tsv:n1',
      source: 'aims',
      kind: 'service',
      title: 'Domino',
      start: '2026-12-09T02:00:00.000Z',
      end: '2026-12-09T03:30:00.000Z',
      allDay: false,
      href: null,
      customer: null,
      address: null,
      site: null,
      remarks: 'Check the hood',
      team: null,
      worker: 'Ali',
      crew: [],
      salesperson: null,
      chipLabel: 'Domino',
      noteId: 'n1',
      noteKind: 'technician_site_visit',
      category: 'Technician Site Visit',
    });
    expect(e).not.toHaveProperty('shopName');
    expect(e.status).not.toBe('scheduled'); // never draggable as a job
    expect(e.note).toEqual({ id: 'n1', title: 'Domino', type: TSV_NOTE, staffId: 'w1', staffName: 'Ali', startDate: '2026-12-09', endDate: '2026-12-09', allDay: false, startTime: '10:00', endTime: '11:30', remark: 'Check the hood' });
    expect(JSON.stringify(e)).not.toMatch(/Jalan Besar|Team A|Domino Pizza/);
    expect(tsvEvent({ ...note, allDay: true, startTime: null })).toMatchObject({ start: '2026-12-09', end: null, allDay: true });
    expect(tsvEvent({ ...note, allDay: true, startTime: null, endDate: '2026-12-11' })).toMatchObject({ start: '2026-12-09', end: '2026-12-12', allDay: true });
    // A note made since 2026-11-25 (no details): its own end time.
    expect(tsvEvent({ ...note, details: null, endTime: '17:00' })).toMatchObject({ end: '2026-12-09T09:00:00.000Z' });
    expect(tsvEvent({ ...note, title: '' }).chipLabel).toBe('Technician Site Visit');
  });
});

describe('note types: Site visit left the Job category list for new jobs', () => {
  const def = { id: 'f1', options: ['Service order', 'Delivery', 'Site visit', 'Others', 'Meeting'], defaultValue: 'Service order' };
  it('new jobs: no Site visit; a job that has it keeps it; the default moves when it was Site visit', () => {
    expect(forNewJobs(def).options).toEqual(['Service order', 'Delivery', 'Others', 'Meeting']);
    expect(forNewJobs(def, 'site visit').options).toEqual(def.options);
    expect(forNewJobs(def, 'Delivery').options).not.toContain('Site visit');
    expect(forNewJobs({ ...def, defaultValue: 'Site visit' }).defaultValue).toBe('Service order');
    expect(forNewJobs({ id: 'f', options: ['Site visit'], defaultValue: 'Site visit' }).options).toEqual(['Site visit']);
  });
});

// ── Service level: the notes API and the calendar ───────────────────────────
const ORG = 'org-wct';
const OTHER = 'org-other';

function fakePrisma(features: Record<string, any>, notes: Record<string, any[]>) {
  const org = (where: any): string => (typeof where?.organizationId === 'string' ? where.organizationId : '');
  const created: any[] = [];
  const prisma: any = {
    created,
    organizationUIConfig: { findUnique: jest.fn(async ({ where }: any) => ({ features: features[where.organizationId] ?? {} })) },
    organization: { findUnique: jest.fn(async ({ where }: any) => ({ id: where.id, name: where.id })) },
    $queryRawUnsafe: jest.fn(async () => []),
    delivery: { findMany: jest.fn(async () => []) },
    deliveryItem: { findMany: jest.fn(async () => []) },
    document: { findMany: jest.fn(async () => []) },
    deliverySiteClockJob: { findMany: jest.fn(async () => []) },
    order: { findMany: jest.fn(async () => []) },
    fieldPublicHoliday: { findMany: jest.fn(async () => []) },
    customer: { findFirst: jest.fn(async ({ where }: any) => (where.id === CUST && where.organizationId === ORG ? { name: 'Domino Pizza' } : null)) },
    calendarNote: {
      findMany: jest.fn(async ({ where, distinct }: any) => {
        const list = (notes[org(where)] ?? []).filter((n: any) => (where.id?.in ? where.id.in.includes(n.id) : true)).filter((n: any) => (where.createdById ? !!n.createdById : true));
        if (distinct) return [...new Set(list.map((n: any) => n.createdById))].map((createdById) => ({ createdById }));
        return list.map((n: any) => ({ ...n }));
      }),
      findFirst: jest.fn(async ({ where }: any) => (notes[org(where)] ?? []).find((n: any) => n.id === where.id) ?? null),
      create: jest.fn(async ({ data }: any) => {
        created.push(data);
        return { id: 'new', ...data };
      }),
      update: jest.fn(async ({ data }: any) => ({ id: 'n1', ...data })),
    },
    customField: { findMany: jest.fn(async () => []), findFirst: jest.fn(async () => null) },
    customFieldValue: { findMany: jest.fn(async () => []) },
    userOrganization: {
      findMany: jest.fn(async ({ where }: any) => (where.userId ? [] : org(where) === ORG ? [{ userId: 'u-amy', salesmanCode: null, settings: { calendar: { fill: '#8e24aa' } } }] : [])),
    },
    userRole: { findMany: jest.fn(async ({ where }: any) => (where.userId ? [] : org(where) === ORG ? [{ userId: 'u-amy', role: { name: 'Sales' } }] : [])) },
  };
  return prisma;
}

const ON = { enableJobsCalendar: true, enableWctOrders: true };
const leave = { id: 'n-leave', title: 'Ali on leave', type: 'LEAVE', staffId: 'w1', staffName: 'Ali', startDate: '2026-12-08', endDate: '2026-12-10', allDay: true, startTime: null, endTime: null, remark: null, details: null, createdById: null };
const tsvRow = {
  id: 'n-tsv',
  title: 'Domino Pizza',
  type: TSV_NOTE,
  staffId: 'w1',
  staffName: 'Ali',
  startDate: '2026-12-09',
  endDate: '2026-12-09',
  allDay: false,
  startTime: '10:00',
  endTime: '11:30',
  remark: 'Check the hood',
  details: { customerId: CUST, customerName: 'Domino Pizza', shopName: null, address: '1 Jalan Besar', durationMin: 90, workers: [{ id: 'w1', name: 'Ali' }], team: 'Team A', salesperson: { id: 'u-amy', name: 'Amy' } },
  createdById: 'u-amy',
};
const clerk = { toClerkUsers: jest.fn(async (ids: Iterable<string>) => new Map([...ids].filter((i) => i === 'u-amy').map((i) => [i, { firstName: 'Amy', lastName: 'Yap', emailAddresses: [] }]))) };

function calendar(prisma: any) {
  return new JobsCalendarService(prisma, { calendarJobs: async () => null } as any, new CalendarNotesService(prisma), new CalendarStyleService(prisma, clerk as any));
}

describe('note types: the notes API', () => {
  it('2026-11-25: a Technician Site Visit saves like a General note; an edit never writes (so never clears) details', async () => {
    const prisma = fakePrisma({ [ORG]: { ...ON, enableCalendarStyle: true } }, { [ORG]: [tsvRow] });
    await new CalendarNotesService(prisma).create(ORG, 'u-amy', { type: 'TECH_SITE_VISIT', title: 'Visit Domino', startDate: '2026-12-09' });
    expect(prisma.created[0]).toMatchObject({ organizationId: ORG, type: TSV_NOTE, title: 'Visit Domino', createdById: 'u-amy' });
    expect(prisma.created[0]).not.toHaveProperty('details');
    await new CalendarNotesService(prisma).update(ORG, 'n-tsv', { type: 'TECH_SITE_VISIT', title: 'Domino again', startDate: '2026-12-09' });
    await new CalendarNotesService(prisma).update(ORG, 'n-tsv', { type: 'OTHER', title: 'Now general', startDate: '2026-12-09' });
    for (const [arg] of prisma.calendarNote.update.mock.calls) expect(arg.data).not.toHaveProperty('details');
  });
  it('another org: an old-type note is written exactly as before (no details key), the new types are refused', async () => {
    const prisma = fakePrisma({ [OTHER]: ON }, {});
    const out: any = await new CalendarNotesService(prisma).create(OTHER, null, { title: 'Road closed', type: 'BLOCKAGE', startDate: '2026-12-09' });
    expect(prisma.created[0]).not.toHaveProperty('details');
    expect(out).not.toHaveProperty('details');
    await expect(new CalendarNotesService(prisma).create(OTHER, null, tsvBody())).rejects.toThrow(BadRequestException);
  });
});

describe('note types: the calendar', () => {
  it('calendar style org: a Technician Site Visit comes back as a styled job event, not a note', async () => {
    const prisma = fakePrisma({ [ORG]: { ...ON, enableCalendarStyle: true } }, { [ORG]: [leave, tsvRow] });
    const res: any = await calendar(prisma).get(ORG, '2026-12-07', '2026-12-13', { userId: 'u-amy' });
    expect(res.notes.map((n: any) => n.id)).toEqual(['n-leave']);
    expect(res.notes[0]).not.toHaveProperty('details');
    const e = res.events.find((x: any) => x.id === 'tsv:n-tsv');
    expect(e).toMatchObject({ source: 'aims', noteId: 'n-tsv', noteKind: 'technician_site_visit', title: 'Domino Pizza', customer: null, salesperson: null, createdBy: { id: 'u-amy', name: 'Amy Yap' } });
    // The old (hidden) salesperson's colour, exactly as a job of theirs gets it.
    expect(e.style.fill).toBe('#8e24aa');
    expect(e.note).toMatchObject({ id: 'n-tsv' });
    expect(e.note).not.toHaveProperty('details');
  });
  it('another org (no calendar style): notes and events as before', async () => {
    const prisma = fakePrisma({ [OTHER]: ON }, { [OTHER]: [leave] });
    const res: any = await calendar(prisma).get(OTHER, '2026-12-07', '2026-12-13', { userId: 'x' });
    expect(res.events).toEqual([]);
    expect(res.notes).toEqual([{ id: 'n-leave', title: 'Ali on leave', type: 'LEAVE', staffId: 'w1', staffName: 'Ali', startDate: '2026-12-08', endDate: '2026-12-10', allDay: true, startTime: null, endTime: null, remark: null, createdById: null }]);
    expect(JSON.stringify(res)).not.toMatch(/tsv:|noteKind|"style"/);
  });
});
