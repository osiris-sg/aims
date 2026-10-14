/**
 * Deposit due on a contract: N business days (Japanese bank days, as for
 * 請求書 due dates) or N calendar days after the PI date. Vedanta's PI terms
 * are "10% Adv with 3 business days", hence the default.
 */
import { addBusinessDays } from './trade-invoice';

export type DepositDueUnit = 'BUSINESS' | 'CALENDAR';
export const DEPOSIT_DUE_UNITS: DepositDueUnit[] = ['BUSINESS', 'CALENDAR'];
export const DEFAULT_DEPOSIT_DUE = { days: 3, unit: 'BUSINESS' as DepositDueUnit };

/**
 * "within 5 business days", "3 Business Days", "within 7 days", "10 calendar
 * days" → { days, unit }; anything else (a date, "on B/L", blank) → null.
 */
export function parseDepositDue(note: string | null | undefined): { days: number; unit: DepositDueUnit } | null {
  const m = /(\d{1,3})\s*(business|working|banking|calendar)?\s*days?\b/i.exec(note ?? '');
  if (!m) return null;
  const days = Number(m[1]);
  if (!Number.isInteger(days) || days < 0 || days > 365) return null;
  return { days, unit: m[2] && !/calendar/i.test(m[2]) ? 'BUSINESS' : 'CALENDAR' };
}

/** YYYY-MM-DD of a stored calendar date (UTC midnight, or the PI date as stored). */
const isoDay = (d: Date | string) => (typeof d === 'string' ? d.slice(0, 10) : d.toISOString().slice(0, 10));

/** The deposit due date, or null when the PI date or the term is missing. */
export function depositDueDate(piDate: Date | string | null | undefined, days: number | null | undefined, unit: string | null | undefined): string | null {
  if (!piDate || days === null || days === undefined || !Number.isFinite(days) || days < 0) return null;
  const start = isoDay(piDate);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) return null;
  if (unit === 'BUSINESS') return addBusinessDays(start, days);
  const d = new Date(`${start}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** "3 business days" / "1 calendar day" — the term in words (also kept in depositDueNote for old readers). */
export function depositDueText(days: number | null | undefined, unit: string | null | undefined): string | null {
  if (days === null || days === undefined) return null;
  return `${days} ${unit === 'BUSINESS' ? 'business' : 'calendar'} day${days === 1 ? '' : 's'}`;
}
