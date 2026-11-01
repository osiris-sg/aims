// Today's calendar date in the org's time zone (AccountingSetting.timeZone,
// default Asia/Singapore), as YYYY-MM-DD. `new Date().toISOString()` is UTC:
// between 00:00 and 08:00 SGT it gave yesterday's date (2026-11-02).
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
