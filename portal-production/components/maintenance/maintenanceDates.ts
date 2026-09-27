/** Shared helpers for the Maintenance Dates pages. Dates are YYYY-MM-DD
 *  calendar dates (no time), so they are formatted in UTC to never shift. */

export const fmtDay = (ymd: string | null | undefined) =>
  ymd
    ? new Date(`${ymd}T00:00:00Z`).toLocaleDateString("en-GB", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" })
    : "";

/** Whole days from today (the server's Singapore date) to a date. */
export const daysUntil = (ymd: string, today: string) =>
  Math.round((new Date(`${ymd}T00:00:00Z`).getTime() - new Date(`${today}T00:00:00Z`).getTime()) / 86400000);
