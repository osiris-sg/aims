import { CalendarSeriesService, occurrenceId, parseOccurrenceId } from './calendar-series.service';

/** Repeating jobs and notes (WCT group, 2026-11-25): series writes on an in-memory database. */
const ORG = 'org-wct';
const OTHER = 'org-other';

function match(row: any, where: any): boolean {
  for (const [k, v] of Object.entries(where ?? {})) {
    if (k === 'customField') continue;
    const x = row[k];
    if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)) {
      const o: any = v;
      if ('in' in o && !o.in.includes(x)) return false;
      if ('gte' in o && !(x >= o.gte)) return false;
      if ('not' in o && x === o.not) return false;
    } else if (x !== v) return false;
  }
  return true;
}

function table(rows: any[] = []) {
  return {
    rows,
    findMany: jest.fn(async ({ where }: any = {}) => rows.filter((r) => match(r, where)).map((r) => ({ ...r }))),
    findFirst: jest.fn(async ({ where, orderBy }: any = {}) => {
      let list = rows.filter((r) => match(r, where));
      if (orderBy?.deliveryNumber === 'desc') list = [...list].sort((a, b) => b.deliveryNumber - a.deliveryNumber);
      return list[0] ? { ...list[0] } : null;
    }),
    findUnique: jest.fn(async ({ where }: any) => rows.find((r) => match(r, where)) ?? null),
    count: jest.fn(async ({ where }: any) => rows.filter((r) => match(r, where)).length),
    create: jest.fn(async ({ data }: any) => {
      const row = { id: data.id ?? `id-${rows.length + 1}-${Math.random().toString(36).slice(2, 7)}`, ...data };
      rows.push(row);
      return { ...row };
    }),
    update: jest.fn(async ({ where, data }: any) => {
      const r = rows.find((x) => match(x, where));
      Object.assign(r, data);
      return { ...r };
    }),
    updateMany: jest.fn(async ({ where, data }: any) => {
      const list = rows.filter((x) => match(x, where));
      list.forEach((r) => Object.assign(r, data));
      return { count: list.length };
    }),
    delete: jest.fn(async ({ where }: any) => {
      const i = rows.findIndex((x) => match(x, where));
      return rows.splice(i, 1)[0];
    }),
    deleteMany: jest.fn(async ({ where }: any) => {
      const keep = rows.filter((x) => !match(x, where));
      const n = rows.length - keep.length;
      rows.splice(0, rows.length, ...keep);
      return { count: n };
    }),
  };
}

function db() {
  const on = { enableJobsCalendar: true, enableWctOrders: true, enableCalendarStyle: true };
  return {
    organizationUIConfig: { findUnique: jest.fn(async ({ where }: any) => ({ features: where.organizationId === ORG ? on : {} })) },
    delivery: table([
      { id: 'job-1', organizationId: ORG, deliveryNumber: 7, status: 'scheduled', isDraft: false, scheduledFor: new Date('2026-11-04T02:00:00.000Z'), scheduledAllDay: false, customerId: 'c1', siteAddress: '1 Road', notes: 'bring ladder', ptwStatus: 'REQUIRED', orderId: 'o1' },
    ]),
    deliveryItem: table([]),
    deliverySiteClockJob: table([{ deliveryId: 'job-1', workerId: 'sc-w1', workerName: 'Mani', durationMin: 90 }]),
    customFieldValue: table([{ customFieldId: 'f-style', entityId: 'job-1', entityType: 'Delivery', value: { salespersonId: 'u-amy', cod: true } }]),
    calendarNote: table([{ id: 'note-1', organizationId: ORG, title: 'Blockage', type: 'BLOCKAGE', startDate: '2026-11-02', endDate: '2026-11-03', allDay: true, startTime: null, endTime: null }]),
    calendarSeries: table([]),
    calendarSeriesException: table([]),
  };
}

const svcOf = (d: any) => {
  const sc = { onScheduleSaved: jest.fn(async () => undefined) };
  return { svc: new CalendarSeriesService(d as any, sc as any), sc };
};

describe('calendar series: create, materialize, split, skip, end', () => {
  it('occurrence ids round-trip', () => {
    expect(occurrenceId('job-1', '2026-11-18')).toBe('job-1~20261118');
    expect(parseOccurrenceId('job-1~20261118')).toEqual({ templateId: 'job-1', date: '2026-11-18' });
    expect(parseOccurrenceId('job-1')).toBeNull();
  });

  it('a job made to repeat becomes the hidden template (a draft, its SiteClock job cancelled by the next sync)', async () => {
    const d = db();
    const { svc, sc } = svcOf(d);
    const s = await svc.create(ORG, 'u-1', { kind: 'JOB', recordId: 'job-1', rrule: 'RRULE:FREQ=WEEKLY;BYDAY=WE' });
    expect(s).toMatchObject({ kind: 'JOB', templateId: 'job-1', rrule: 'FREQ=WEEKLY;BYDAY=WE', startDate: '2026-11-04', startTime: '10:00', durationMin: 90 });
    expect(d.delivery.rows[0].isDraft).toBe(true);
    expect(sc.onScheduleSaved).toHaveBeenCalledWith(ORG, 'job-1');
    await expect(svc.create(ORG, null, { kind: 'JOB', recordId: 'job-1', rrule: 'FREQ=DAILY' })).rejects.toThrow('already repeats');
    await expect(svc.create(ORG, null, { kind: 'JOB', recordId: 'x', rrule: 'FREQ=SECONDLY' })).rejects.toThrow();
  });

  it('completing one occurrence: it becomes its own job (copied, own number, worker sent), the rest stay virtual', async () => {
    const d = db();
    const { svc, sc } = svcOf(d);
    const s = await svc.create(ORG, null, { kind: 'JOB', recordId: 'job-1', rrule: 'FREQ=WEEKLY' });
    const m = await svc.materialize(ORG, s.id, { date: '2026-11-18' });
    const job = d.delivery.rows.find((r: any) => r.id === m.id);
    expect(job).toMatchObject({ deliveryNumber: 8, isDraft: false, status: 'scheduled', customerId: 'c1', notes: 'bring ladder', ptwStatus: 'REQUIRED', orderId: 'o1', scheduledFor: new Date('2026-11-18T02:00:00.000Z') });
    expect(d.customFieldValue.rows.filter((v: any) => v.entityId === m.id).map((v: any) => v.value)).toEqual([{ salespersonId: 'u-amy', cod: true }]);
    expect(sc.onScheduleSaved).toHaveBeenLastCalledWith(ORG, m.id, { workerId: 'sc-w1', workerName: 'Mani', durationMin: 90 });
    expect(d.calendarSeriesException.rows).toEqual([expect.objectContaining({ seriesId: s.id, originalDate: '2026-11-18', recordId: m.id })]);
    // The same click again: the same job (no second one).
    expect((await svc.materialize(ORG, s.id, { date: '2026-11-18' })).id).toBe(m.id);
    // Not a day of the series.
    await expect(svc.materialize(ORG, s.id, { date: '2026-11-19' })).rejects.toThrow('no occurrence');
    // The template is untouched.
    expect(d.delivery.rows.find((r: any) => r.id === 'job-1')).toMatchObject({ isDraft: true, scheduledFor: new Date('2026-11-04T02:00:00.000Z') });
  });

  it('"this and following": the old series ends the day before, a new one takes the rest with its exceptions', async () => {
    const d = db();
    const { svc } = svcOf(d);
    const s = await svc.create(ORG, null, { kind: 'JOB', recordId: 'job-1', rrule: 'FREQ=WEEKLY;COUNT=6' });
    const later = await svc.materialize(ORG, s.id, { date: '2026-12-02' });
    const r = await svc.split(ORG, s.id, { date: '2026-11-18' });
    expect(r.seriesId).not.toBe(s.id);
    const old = d.calendarSeries.rows.find((x: any) => x.id === s.id);
    const next = d.calendarSeries.rows.find((x: any) => x.id === r.seriesId);
    expect(old.rrule).toBe('FREQ=WEEKLY;UNTIL=20261111');
    expect(next).toMatchObject({ rrule: 'FREQ=WEEKLY;COUNT=4', startDate: '2026-11-18', templateId: r.templateId });
    expect(d.delivery.rows.find((x: any) => x.id === r.templateId)).toMatchObject({ isDraft: true, scheduledFor: new Date('2026-11-18T02:00:00.000Z') });
    expect(d.calendarSeriesException.rows.find((x: any) => x.recordId === later.id).seriesId).toBe(r.seriesId);
  });

  it('delete this (EXDATE), this and following (UNTIL), all (series + template; made jobs stay)', async () => {
    const d = db();
    const { svc } = svcOf(d);
    const s = await svc.create(ORG, null, { kind: 'JOB', recordId: 'job-1', rrule: 'FREQ=WEEKLY' });
    await svc.skip(ORG, s.id, { date: '2026-11-11' });
    expect(d.calendarSeries.rows[0].exdates).toEqual(['2026-11-11']);
    const made = await svc.materialize(ORG, s.id, { date: '2026-11-18' });
    await svc.end(ORG, s.id, { date: '2026-11-25' });
    expect(d.calendarSeries.rows[0].rrule).toBe('FREQ=WEEKLY;UNTIL=20261118');
    await svc.remove(ORG, s.id);
    expect(d.calendarSeries.rows).toEqual([]);
    expect(d.delivery.rows.map((r: any) => r.id)).toEqual([made.id]);
  });

  it('a repeating note: materialised with its span', async () => {
    const d = db();
    const { svc } = svcOf(d);
    const s = await svc.create(ORG, null, { kind: 'NOTE', recordId: 'note-1', rrule: 'FREQ=WEEKLY' });
    const m = await svc.materialize(ORG, s.id, { date: '2026-11-16' });
    expect(d.calendarNote.rows.find((n: any) => n.id === m.id)).toMatchObject({ title: 'Blockage', startDate: '2026-11-16', endDate: '2026-11-17' });
  });

  it('other orgs: refused (flags off)', async () => {
    const d = db();
    const { svc } = svcOf(d);
    await expect(svc.create(OTHER, null, { kind: 'JOB', recordId: 'job-1', rrule: 'FREQ=WEEKLY' })).rejects.toThrow('not enabled');
    expect(await svc.forRecord(OTHER, 'job-1')).toBeNull();
  });
});
