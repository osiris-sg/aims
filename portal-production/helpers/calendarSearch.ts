// Jobs calendar search (WCT group, 2026-11-23): the result shape and its date line (components/Dashboard/jobs-calendar/CalendarSearch.tsx).

export interface CalendarSearchHit {
  kind: "job" | "note";
  id: string;
  orgId: string;
  orgName: string;
  date: string;
  time: string | null;
  at: string;
  customer: string | null;
  address: string | null;
  icons: string;
  label: string;
}

/** "Tue 24/11/2026 · 2pm" (all day when no time). */
export function hitWhen(h: Pick<CalendarSearchHit, "date" | "time">): string {
  const d = new Date(`${h.date}T12:00:00+08:00`);
  const wd = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Singapore", weekday: "short" }).format(d);
  return `${wd} ${h.date.slice(8, 10)}/${h.date.slice(5, 7)}/${h.date.slice(0, 4)} · ${h.time ?? "All day"}`;
}

export const SEARCH_DEBOUNCE_MS = 300;

