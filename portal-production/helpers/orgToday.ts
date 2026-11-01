// Default dates in the ORG's time zone (2026-11-02). `new Date().toISOString()`
// is UTC: between 00:00 and 08:00 in Singapore it gave yesterday's date to
// every new quotation / invoice / receipt. The zone is the org's Financial
// Settings time zone (AccountingSetting.timeZone, default Asia/Singapore),
// loaded once per org by useOrgTimeZoneLoader in the portal layout.

const DEFAULT_TZ = "Asia/Singapore";
let orgTz = DEFAULT_TZ;

const validTz = (tz: string) => {
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

export function setOrgTimeZone(tz: string | null | undefined) {
  orgTz = tz && validTz(tz) ? tz : DEFAULT_TZ;
}

export const orgTimeZone = () => orgTz;

/** YYYY-MM-DD of `now` in the org's time zone (or the given one). */
export function todayIso(now: Date = new Date(), tz: string = orgTz): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
