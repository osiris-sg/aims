/**
 * A WCT-group DO's date (UAT 2026-11-25, DO202611050). "Add DO" on an order made a draft DO with NO date: the
 * editor showed today (its own default), but the sign page, the signed PDF and the order page's DO row printed a
 * blank Date and the DO list showed the UTC created day (24/11 for a DO made at 04:20 SGT on 25/11).
 *  - a new DO (createNumberedDeliveryOrder) with no date gets today in the org's time zone (config.date, the key
 *    the DO editor and buildScheduledDoConfig use);
 *  - a DO still without one shows its created day in the org's time zone (never UTC) on the print, the sign
 *    page, the order page and the list.
 * WCT group only (DO_DATE_FLAG); every other org unchanged.
 */
import { orgToday } from '../common/org-today';

export const DO_DATE_FLAG = 'enableWctDocNav';

const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** The date the document carries (documentInfo.date, then config.date), or ''. */
export function ownDocDate(config: any): string {
  return text(config?.documentInfo?.date) || text(config?.date);
}

/** A new DO's config: today's date (org time zone) when it carries none. Never overwrites a date. */
export function withDoDate(config: any, today: string): any {
  const c = config || {};
  return ownDocDate(c) ? c : { ...c, date: today };
}

/** The DO's date, else its created day in the org's time zone (YYYY-MM-DD); null without either. */
export function doDateOrCreated(config: any, createdAt: Date | string | null | undefined, timeZone?: string | null): string | null {
  const own = ownDocDate(config);
  if (own) return own;
  if (!createdAt) return null;
  const d = new Date(createdAt);
  return isNaN(d.getTime()) ? null : orgToday(timeZone, d);
}
