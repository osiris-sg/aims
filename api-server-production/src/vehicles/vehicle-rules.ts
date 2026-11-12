import { BadRequestException } from '@nestjs/common';

/**
 * WCT VEHICLES (enableWctVehicles, 2026-11-12): the pure rules, kept apart from
 * Prisma so they are tested directly.
 *
 * Mileage never blocks a save (a typo has to be fixable): a lower reading than
 * the last one known comes back as a warning. Dates do block: a usage cannot end
 * before it started.
 */

export const WCT_VEHICLES_FLAG = 'enableWctVehicles';

/** COE / lifespan reminders and the list's warning chip start this many days out. */
export const EXPIRY_WARN_DAYS = 90;
export const REMINDER_THRESHOLDS = [90, 30] as const;

/** 'YYYY-MM-DD' → UTC midnight; anything else is refused with the field's name. */
export function parseYmd(v: unknown, field: string, required = true): Date | null {
  if (v == null || v === '') {
    if (required) throw new BadRequestException(`${field} is required`);
    return null;
  }
  const s = String(v).trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  const d = m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null;
  if (!d || d.toISOString().slice(0, 10) !== s) throw new BadRequestException(`${field} must be a date (YYYY-MM-DD)`);
  return d;
}

export const ymd = (d: Date | null | undefined): string | null => (d ? d.toISOString().slice(0, 10) : null);

/** A whole, non-negative mileage. */
export function parseMileage(v: unknown, field: string, required = true): number | null {
  if (v == null || v === '') {
    if (required) throw new BadRequestException(`${field} is required`);
    return null;
  }
  const n = Number(String(v).replace(/[,\s]/g, ''));
  if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) throw new BadRequestException(`${field} must be a whole number of km`);
  if (n > 9_999_999) throw new BadRequestException(`${field} is too large`);
  return n;
}

/** "gbd 1126 u" → "GBD1126U": how the number is stored and compared. */
export function normalizeVehicleNo(v: unknown): string {
  const s = String(v ?? '').replace(/\s+/g, '').toUpperCase();
  if (!s) throw new BadRequestException('Vehicle / Lorry No. is required');
  if (s.length > 20) throw new BadRequestException('Vehicle / Lorry No. is too long');
  return s;
}

type UsageLike = { id?: string; startDate: Date; startMileage: number; endDate: Date | null; endMileage: number | null };

/** The highest mileage the log has recorded so far (ends, else starts), or null. */
export function lastKnownMileage(usages: UsageLike[], exceptId?: string): number | null {
  let best: number | null = null;
  for (const u of usages) {
    if (exceptId && u.id === exceptId) continue;
    for (const m of [u.startMileage, u.endMileage]) if (m != null && (best == null || m > best)) best = m;
  }
  return best;
}

/** The mileage shown on the list: the latest usage's end, else its start. */
export function currentMileage(usages: UsageLike[]): number | null {
  const latest = [...usages].sort((a, b) => b.startDate.getTime() - a.startDate.getTime())[0];
  return latest ? latest.endMileage ?? latest.startMileage : null;
}

/** Warnings for a start reading (never blocks). */
export function startWarnings(startMileage: number, otherUsages: UsageLike[]): string[] {
  const last = lastKnownMileage(otherUsages);
  return last != null && startMileage < last
    ? [`Mileage at start (${startMileage.toLocaleString('en-SG')} km) is lower than the last recorded ${last.toLocaleString('en-SG')} km. Check the reading.`]
    : [];
}

/** Checks for an end reading: a date before the start blocks, a lower mileage warns. */
export function endChecks(u: { startDate: Date; startMileage: number }, endDate: Date, endMileage: number): string[] {
  if (endDate.getTime() < u.startDate.getTime()) throw new BadRequestException('Usage end date cannot be before the start date');
  return endMileage < u.startMileage
    ? [`Mileage at end (${endMileage.toLocaleString('en-SG')} km) is lower than at start (${u.startMileage.toLocaleString('en-SG')} km). Check the reading.`]
    : [];
}

/** Whole days from `today` (YYYY-MM-DD) to an expiry date; negative = past. */
export function daysUntil(expiry: Date | null | undefined, todayYmd: string): number | null {
  if (!expiry) return null;
  const t = Date.parse(`${todayYmd}T00:00:00Z`);
  return Math.round((expiry.getTime() - t) / 86_400_000);
}

/** The reminder due today for an expiry: the tightest threshold reached, or null (none yet, or already past). */
export function reminderThreshold(days: number | null): (typeof REMINDER_THRESHOLDS)[number] | null {
  if (days == null || days < 0) return null;
  let hit: (typeof REMINDER_THRESHOLDS)[number] | null = null;
  for (const t of REMINDER_THRESHOLDS) if (days <= t) hit = t;
  return hit;
}

/** A trimmed free-text field, capped; '' → null. */
export function cleanText(v: unknown, max: number): string | null {
  const s = typeof v === 'string' ? v.trim() : '';
  return s ? s.slice(0, max) : null;
}
