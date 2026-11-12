// Today's calendar date in the org's time zone (AccountingSetting.timeZone,
// default Asia/Singapore), as YYYY-MM-DD. `new Date().toISOString()` is UTC:
// between 00:00 and 08:00 SGT it gave yesterday's date (2026-11-02).
/** A valid IANA zone, else Asia/Singapore (the default every org starts with). */
export function resolveTimeZone(timeZone?: string | null): string {
  if (timeZone) {
    try {
      new Intl.DateTimeFormat('en-GB', { timeZone }).format(0);
      return timeZone;
    } catch {
      // invalid zone: the default
    }
  }
  return 'Asia/Singapore';
}

export function orgToday(timeZone?: string | null, now: Date = new Date()): string {
  for (const tz of [timeZone, 'Asia/Singapore']) {
    if (!tz) continue;
    try {
      return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
    } catch {
      // invalid zone: try the default
    }
  }
  return now.toISOString().slice(0, 10);
}

type TzReader = { accountingSetting: { findUnique: (args: any) => Promise<{ timeZone?: string | null } | null> } };

/**
 * orgToday for an org, reading its Financial Settings time zone. Documents the
 * server creates (an order's invoice, a DO's invoice, a service report's
 * invoice…) are dated with this, as a date-only YYYY-MM-DD like the editor
 * writes — never `new Date().toISOString()` (a UTC timestamp: 01:52 SGT on
 * 2 Nov became "1 Nov").
 */
/** The org's time zone (Financial Settings), resolved; Asia/Singapore when unset or invalid. */
export async function orgTimeZoneFor(prisma: TzReader, organizationId: string): Promise<string> {
  const s = await prisma.accountingSetting.findUnique({ where: { organizationId }, select: { timeZone: true } }).catch(() => null);
  return resolveTimeZone(s?.timeZone);
}

export async function orgTodayFor(prisma: TzReader, organizationId: string, now: Date = new Date()): Promise<string> {
  const s = await prisma.accountingSetting.findUnique({ where: { organizationId }, select: { timeZone: true } }).catch(() => null);
  return orgToday(s?.timeZone, now);
}
