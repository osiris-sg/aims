/**
 * ALL-DAY JOBS (2026-11-10, all orgs, opt-in per job): a run scheduled for a
 * DAY without a specific time. Stored as Delivery.scheduledAllDay = true with
 * scheduledFor = 00:00 of that day in the org's time zone, so every existing
 * date-range read (calendar, order jobs, SiteClock "today") still finds it on
 * the right day. A timed run (the default) is untouched by everything here.
 *
 * Rules that use these helpers:
 *  - it is due all day: anything that asks "is it past?" uses dueBy (the end
 *    of its day, i.e. after 23:59), never its 00:00;
 *  - in a time-ordered list it comes after the timed jobs of the same day
 *    (scheduleSortKey);
 *  - worker-facing text shows the date only (formatted by the callers).
 */

const DEFAULT_TZ = 'Asia/Singapore';
const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;

/** The zone's offset from UTC at `at`, in minutes (e.g. +480 for Singapore). */
function offsetMinutes(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at);
  const n = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute'), n('second'));
  return Math.round((asUtc - at.getTime()) / 60_000);
}

function zoneOrDefault(timeZone?: string | null): string {
  if (timeZone) {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone });
      return timeZone;
    } catch {
      // invalid zone: fall through to the default
    }
  }
  return DEFAULT_TZ;
}

/** yyyy-MM-dd of an instant in the zone. */
export function ymdIn(at: Date, timeZone?: string | null): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: zoneOrDefault(timeZone), year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
}

/** 00:00 of the calendar day `ymd` in the zone, as an instant. */
export function dayStartIn(ymd: string, timeZone?: string | null): Date {
  const m = YMD.exec(ymd);
  if (!m) throw new Error(`Not a date: ${ymd}`);
  const tz = zoneOrDefault(timeZone);
  const naive = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  // Two passes settle a zone whose offset differs either side of midnight.
  let at = new Date(naive - offsetMinutes(new Date(naive), tz) * 60_000);
  at = new Date(naive - offsetMinutes(at, tz) * 60_000);
  return at;
}

/**
 * The scheduledFor to store for an all-day job: the day's 00:00 in the zone.
 * Accepts the date as yyyy-MM-dd, or any ISO instant (its day in the zone is
 * taken, so a dialog that still sends "2026-11-11T09:00+08:00" lands on the 11th).
 */
export function allDayStart(input: string | Date, timeZone?: string | null): Date {
  if (typeof input === 'string' && YMD.test(input)) return dayStartIn(input, timeZone);
  const at = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(at.getTime())) throw new Error(`Not a date: ${String(input)}`);
  return dayStartIn(ymdIn(at, timeZone), timeZone);
}

/** The first instant AFTER the job's day: overdue from here (i.e. after 23:59). */
export function dayEndOf(start: Date, timeZone?: string | null): Date {
  const ymd = ymdIn(start, timeZone);
  const [y, mo, d] = ymd.split('-').map(Number);
  const next = new Date(Date.UTC(y, mo - 1, d + 1)).toISOString().slice(0, 10);
  return dayStartIn(next, timeZone);
}

type Scheduled = { scheduledFor: Date | string | null; scheduledAllDay?: boolean | null };

/** When the job stops being "on time": its start for a timed job, the end of its day for an all-day one. */
export function dueBy(run: Scheduled, timeZone?: string | null): Date | null {
  if (!run.scheduledFor) return null;
  const start = new Date(run.scheduledFor);
  return run.scheduledAllDay ? dayEndOf(start, timeZone) : start;
}

/**
 * Sort key for a time-ordered list: timed jobs by their start; an all-day job
 * at the END of its day (just before the next day's first job), so it follows
 * the timed jobs of the same day.
 */
export function scheduleSortKey(run: Scheduled, timeZone?: string | null): number {
  if (!run.scheduledFor) return Number.POSITIVE_INFINITY;
  const start = new Date(run.scheduledFor);
  return run.scheduledAllDay ? dayEndOf(start, timeZone).getTime() - 1 : start.getTime();
}

export const bySchedule = (timeZone?: string | null) => (a: Scheduled, b: Scheduled) =>
  scheduleSortKey(a, timeZone) - scheduleSortKey(b, timeZone);

/**
 * Normalise what a schedule form sent: { scheduledFor, allDay } → what to
 * store. Timed: the instant as given. All-day: the day's 00:00 in the zone.
 */
export function scheduleFields(
  scheduledFor: string | Date | null | undefined,
  allDay: unknown,
  timeZone?: string | null,
): { scheduledFor: Date | null; scheduledAllDay: boolean } {
  if (scheduledFor === null || scheduledFor === undefined || scheduledFor === '') return { scheduledFor: null, scheduledAllDay: false };
  if (allDay === true) return { scheduledFor: allDayStart(scheduledFor, timeZone), scheduledAllDay: true };
  return { scheduledFor: new Date(scheduledFor), scheduledAllDay: false };
}

/** "Wed 11 Nov" (all-day: the date only) or "Wed 11 Nov, 9:00 am" (timed), in the zone. */
export function formatSchedule(run: Scheduled, timeZone?: string | null): string | null {
  if (!run.scheduledFor) return null;
  const at = new Date(run.scheduledFor);
  const tz = zoneOrDefault(timeZone);
  const date = new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short' }).format(at).replace(',', '');
  if (run.scheduledAllDay) return date;
  const time = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true }).format(at);
  return `${date}, ${time}`;
}

/** The org's time zone (Financial Settings), default Singapore. */
export async function orgTimeZone(
  prisma: { accountingSetting: { findUnique: (args: any) => Promise<{ timeZone?: string | null } | null> } },
  organizationId: string,
): Promise<string> {
  const s = await prisma.accountingSetting.findUnique({ where: { organizationId }, select: { timeZone: true } }).catch(() => null);
  return zoneOrDefault(s?.timeZone);
}
