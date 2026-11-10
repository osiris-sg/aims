import { allDayStart, bySchedule, dayEndOf, dueBy, formatSchedule, scheduleFields, ymdIn } from './all-day';

/** All-day jobs (2026-11-10): the day's 00:00 in the org zone, due until 23:59. */
const SG = 'Asia/Singapore';

describe('all-day schedule helpers', () => {
  it('stores 00:00 of the day in the org zone, from a date or any instant on that day', () => {
    expect(allDayStart('2026-11-11', SG).toISOString()).toBe('2026-11-10T16:00:00.000Z');
    expect(allDayStart('2026-11-11T09:30:00+08:00', SG).toISOString()).toBe('2026-11-10T16:00:00.000Z');
    // 23:30 SGT is still the 11th in Singapore even though it is the 11th 15:30 UTC.
    expect(allDayStart('2026-11-11T15:30:00Z', SG).toISOString()).toBe('2026-11-10T16:00:00.000Z');
    expect(allDayStart('2026-03-08', 'America/New_York').toISOString()).toBe('2026-03-08T05:00:00.000Z');
    expect(ymdIn(allDayStart('2026-11-11', SG), SG)).toBe('2026-11-11');
  });

  it('is due until 23:59 of its day: past only from 00:00 the next day', () => {
    const run = { scheduledFor: allDayStart('2026-11-11', SG), scheduledAllDay: true };
    expect(dayEndOf(run.scheduledFor, SG).toISOString()).toBe('2026-11-11T16:00:00.000Z');
    const due = dueBy(run, SG)!.getTime();
    expect(new Date('2026-11-11T15:59:00Z').getTime() < due).toBe(true); // 23:59 SGT: not past
    expect(new Date('2026-11-11T01:00:00Z').getTime() < due).toBe(true); // 09:00 on the day: not late
    expect(new Date('2026-11-11T16:00:00Z').getTime() >= due).toBe(true); // 00:00 next day: past
  });

  it('a timed job is unchanged: due at its start', () => {
    const run = { scheduledFor: new Date('2026-11-11T01:00:00Z'), scheduledAllDay: false };
    expect(dueBy(run, SG)?.toISOString()).toBe('2026-11-11T01:00:00.000Z');
    expect(scheduleFields('2026-11-11T09:00:00+08:00', false, SG)).toEqual({ scheduledFor: new Date('2026-11-11T01:00:00Z'), scheduledAllDay: false });
    expect(scheduleFields('2026-11-11T09:00:00+08:00', undefined, SG).scheduledAllDay).toBe(false);
  });

  it('sorts all-day jobs after the timed jobs of the same day, before the next day', () => {
    const rows = [
      { id: 'next-day-8am', scheduledFor: new Date('2026-11-12T00:00:00Z'), scheduledAllDay: false },
      { id: 'all-day', scheduledFor: allDayStart('2026-11-11', SG), scheduledAllDay: true },
      { id: 'late-evening', scheduledFor: new Date('2026-11-11T14:00:00Z'), scheduledAllDay: false }, // 22:00 SGT
      { id: 'morning', scheduledFor: new Date('2026-11-11T01:00:00Z'), scheduledAllDay: false },
      { id: 'no-date', scheduledFor: null, scheduledAllDay: false },
    ];
    expect([...rows].sort(bySchedule(SG)).map((r) => r.id)).toEqual(['morning', 'late-evening', 'all-day', 'next-day-8am', 'no-date']);
  });

  it('formats the date only for an all-day job', () => {
    expect(formatSchedule({ scheduledFor: allDayStart('2026-11-11', SG), scheduledAllDay: true }, SG)).toBe('Wed 11 Nov');
    expect(formatSchedule({ scheduledFor: new Date('2026-11-11T01:00:00Z'), scheduledAllDay: false }, SG)).toBe('Wed 11 Nov, 9:00 am');
  });
});
