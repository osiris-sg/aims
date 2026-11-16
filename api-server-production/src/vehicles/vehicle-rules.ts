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

// ── Log book (2026-11-16) ───────────────────────────────────────────────────
// Every transaction of a vehicle is one log entry; start / end usage is gone.

export const LOG_TYPES = ['DRIVER', 'REPAIR', 'FUEL', 'RENEWAL', 'PARKING', 'OTHER'] as const;
export type LogType = (typeof LOG_TYPES)[number];

export const LOG_TYPE_LABEL: Record<LogType, string> = {
  DRIVER: 'Driver assigned',
  REPAIR: 'Repair / servicing',
  FUEL: 'Fuel',
  RENEWAL: 'Road tax / insurance / COE / inspection',
  PARKING: 'Parking / ERP / fines',
  OTHER: 'Other',
};

export const RENEWAL_KINDS = ['ROAD_TAX', 'INSURANCE', 'COE', 'INSPECTION'] as const;
export type RenewalKind = (typeof RENEWAL_KINDS)[number];
export const RENEWAL_LABEL: Record<RenewalKind, string> = { ROAD_TAX: 'Road tax', INSURANCE: 'Insurance', COE: 'COE', INSPECTION: 'Inspection' };
/** The Vehicle column a renewal's new expiry date updates. */
export const RENEWAL_FIELD: Record<RenewalKind, 'roadTaxExpiry' | 'insuranceExpiry' | 'coeExpiry' | 'inspectionExpiry'> = {
  ROAD_TAX: 'roadTaxExpiry',
  INSURANCE: 'insuranceExpiry',
  COE: 'coeExpiry',
  INSPECTION: 'inspectionExpiry',
};

export function parseLogType(v: unknown): LogType {
  const t = String(v ?? '').trim().toUpperCase();
  if (!(LOG_TYPES as readonly string[]).includes(t)) throw new BadRequestException('Pick the type of entry');
  return t as LogType;
}

export function parseRenewalKind(v: unknown): RenewalKind {
  const t = String(v ?? '').trim().toUpperCase();
  if (!(RENEWAL_KINDS as readonly string[]).includes(t)) throw new BadRequestException('Pick what was renewed: road tax, insurance, COE or inspection');
  return t as RenewalKind;
}

/** An optional SGD amount: 2 decimals, not negative, "1,234.50" accepted; '' → null. */
export function parseAmount(v: unknown, field = 'Amount'): number | null {
  if (v == null || v === '') return null;
  const n = Number(String(v).replace(/[,\s$]/g, ''));
  if (!Number.isFinite(n) || n < 0) throw new BadRequestException(`${field} must be an amount in SGD`);
  if (n > 9_999_999_999) throw new BadRequestException(`${field} is too large`);
  return Math.round(n * 100) / 100;
}

export type EntryLike = {
  id?: string;
  date: Date;
  createdAt?: Date;
  type: string;
  mileage: number | null;
  amount: number | null;
  driverName?: string | null;
  driverUserId?: string | null;
  deletedAt?: Date | null;
};

/** Newest first: by date, then by when it was entered. */
export const byNewest = (a: EntryLike, b: EntryLike) => b.date.getTime() - a.date.getTime() || (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0);

const live = <T extends EntryLike>(rows: T[]) => rows.filter((r) => !r.deletedAt);

/** The current driver: the latest "Driver assigned" entry. */
export function currentDriverOf<T extends EntryLike>(rows: T[]): T | null {
  return live(rows).filter((r) => r.type === 'DRIVER').sort(byNewest)[0] ?? null;
}

/** The latest mileage: the newest entry that has one. */
export function lastMileageOf(rows: EntryLike[], exceptId?: string): number | null {
  const withKm = live(rows).filter((r) => r.mileage != null && r.id !== exceptId).sort(byNewest);
  return withKm[0]?.mileage ?? null;
}

/** A reading lower than the latest known one warns (never blocks: typos stay fixable). */
export function mileageWarnings(mileage: number | null, rows: EntryLike[], exceptId?: string): string[] {
  if (mileage == null) return [];
  const last = lastMileageOf(rows, exceptId);
  return last != null && mileage < last
    ? [`Mileage (${mileage.toLocaleString('en-SG')} km) is lower than the latest recorded ${last.toLocaleString('en-SG')} km. Check the reading.`]
    : [];
}

export type MoneyPeriod = { total: number; byType: Record<LogType, number> };
export type MoneySummary = { month: MoneyPeriod; year: MoneyPeriod; all: MoneyPeriod };

const emptyPeriod = (): MoneyPeriod => ({ total: 0, byType: { DRIVER: 0, REPAIR: 0, FUEL: 0, RENEWAL: 0, PARKING: 0, OTHER: 0 } });
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Money spent on a vehicle: this month / this year (org's today, YYYY-MM-DD) / all time, split by type. */
export function moneySummary(rows: EntryLike[], todayYmd: string): MoneySummary {
  const out: MoneySummary = { month: emptyPeriod(), year: emptyPeriod(), all: emptyPeriod() };
  const ym = todayYmd.slice(0, 7);
  const y = todayYmd.slice(0, 4);
  for (const r of live(rows)) {
    if (r.amount == null) continue;
    const t = (LOG_TYPES as readonly string[]).includes(r.type) ? (r.type as LogType) : 'OTHER';
    const d = r.date.toISOString().slice(0, 10);
    const add = (p: MoneyPeriod) => {
      p.total = r2(p.total + r.amount!);
      p.byType[t] = r2(p.byType[t] + r.amount!);
    };
    add(out.all);
    if (d.slice(0, 4) === y) add(out.year);
    if (d.slice(0, 7) === ym) add(out.month);
  }
  return out;
}

/**
 * One old usage row as log entries (the one-off conversion): "Driver assigned"
 * on the start date with the start mileage; when it ended, an "Other" entry on
 * the end date with the end mileage (so the reading is kept); a logged repair
 * as a "Repair / servicing" entry with its approval and unlock history kept.
 */
export function planUsageConversion(u: {
  id: string;
  driverUserId: string | null;
  driverName: string;
  startDate: Date;
  startMileage: number;
  endDate: Date | null;
  endMileage: number | null;
  repairDetails: string | null;
  repairLoggedAt: Date | null;
  repairApprovedBy: string | null;
  repairApprovedById: string | null;
  repairApprovedAt: Date | null;
  repairUnlocks: unknown;
}) {
  const day = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const base = { sourceUsageId: u.id, driverUserId: u.driverUserId, driverName: u.driverName, amount: null as number | null };
  const out: Array<Record<string, any>> = [
    { ...base, type: 'DRIVER', date: day(u.startDate), mileage: u.startMileage, description: 'Usage started (converted from the usage form)' },
  ];
  if (u.endDate) {
    out.push({ ...base, type: 'OTHER', date: day(u.endDate), mileage: u.endMileage, description: `Usage ended: vehicle returned by ${u.driverName} (converted from the usage form)` });
  }
  if (u.repairDetails) {
    out.push({
      ...base,
      type: 'REPAIR',
      date: day(u.repairLoggedAt ?? u.startDate),
      mileage: null,
      description: u.repairDetails,
      repairApprovedBy: u.repairApprovedBy,
      repairApprovedById: u.repairApprovedById,
      repairApprovedAt: u.repairApprovedAt,
      repairUnlocks: Array.isArray(u.repairUnlocks) ? u.repairUnlocks : null,
    });
  }
  return out;
}
