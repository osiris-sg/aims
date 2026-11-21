// Ported from siteclock backend/src/lib/time.ts @62b7d9d (unchanged).
import { DateTime } from 'luxon';

/** Local calendar date (yyyy-MM-dd) of a UTC instant in the given tz. */
export function localDate(utc: Date, tz: string): string {
  return DateTime.fromJSDate(utc, { zone: 'utc' }).setZone(tz).toFormat('yyyy-MM-dd');
}

/** UTC instant for local date + "HH:mm" in tz. */
export function localTimeToUtc(date: string, hhmm: string, tz: string): Date {
  return DateTime.fromFormat(`${date} ${hhmm}`, 'yyyy-MM-dd HH:mm', { zone: tz }).toUTC().toJSDate();
}

export function fmtLocal(utc: Date, tz: string): string {
  return DateTime.fromJSDate(utc, { zone: 'utc' }).setZone(tz).toFormat('yyyy-MM-dd HH:mm');
}

export function minutesBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 60000);
}

/** luxon weekday (1=Mon..7=Sun) for a local date string. */
export function weekdayOf(date: string): number {
  return DateTime.fromFormat(date, 'yyyy-MM-dd').weekday;
}

export function addDays(date: string, days: number): string {
  return DateTime.fromFormat(date, 'yyyy-MM-dd').plus({ days }).toFormat('yyyy-MM-dd');
}

export function todayIn(tz: string): string {
  return DateTime.now().setZone(tz).toFormat('yyyy-MM-dd');
}
