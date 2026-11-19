import { BadRequestException } from '@nestjs/common';
import { dayStartIn } from './all-day';

/**
 * Calendar panel actions (WCT group, 2026-11-20, enableCalendarStyle): Postpone / Reschedule's target.
 * Pure helpers; deliveries.service.ts (rescheduleJob) does the reads and writes.
 */

export interface RescheduleTarget {
  /** yyyy-MM-dd */
  date: string;
  /** HH:mm (24 h), or null = all day. */
  time: string | null;
}

/** { date: 'yyyy-MM-dd', time?: 'HH:mm' | null } from the panel's Postpone / Reschedule dialog. */
export function parseRescheduleTarget(body: any): RescheduleTarget {
  const date = typeof body?.date === 'string' ? body.date.trim() : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`)) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) {
    throw new BadRequestException('Pick a date, or On hold');
  }
  const raw = typeof body?.time === 'string' ? body.time.trim() : '';
  if (!raw) return { date, time: null };
  const m = /^(\d{1,2}):(\d{2})$/.exec(raw);
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) throw new BadRequestException('Pick a valid time');
  return { date, time: `${m[1].padStart(2, '0')}:${m[2]}` };
}

/** The instant of a local day + clock time in the zone (the org's, default Singapore). */
export function zonedInstant(date: string, time: string, timeZone?: string | null): Date {
  const [h, m] = time.split(':').map(Number);
  return new Date(dayStartIn(date, timeZone).getTime() + (h * 60 + m) * 60_000);
}
