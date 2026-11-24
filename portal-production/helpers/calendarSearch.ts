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


// ── Schedule view filter (2026-11-25): the search box filters the Schedule list live, in the browser ─────────────

type SearchableEvent = {
  title?: string | null;
  customer?: string | null;
  shopName?: string | null;
  chipLabel?: string | null;
  site?: string | null;
  address?: string | null;
  subject?: string | null;
  jobTitle?: string | null;
  remarks?: string | null;
  team?: string | null;
  worker?: string | null;
  crew?: Array<{ name: string }> | null;
  quotationNumber?: string | null;
  orderNumber?: string | null;
  doNumber?: string | null;
  deliveryNumber?: string | number | null;
  salesperson?: { name: string | null } | null;
  createdBy?: { name: string | null } | null;
  orgName?: string | null;
};
type SearchableNote = { title?: string | null; staffName?: string | null; remark?: string | null; orgName?: string | null };

const fold = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

/** Every word of the query is somewhere in the text (any case, any order); an empty query matches everything. */
export function matchesQuery(text: string, q: string): boolean {
  const words = fold(q).split(" ").filter(Boolean);
  if (!words.length) return true;
  const t = fold(text);
  return words.every((w) => t.includes(w));
}

/** What a job is found by: names, place, subject / title, remarks, team / workers, numbers, salesperson, company. */
export const eventSearchText = (e: SearchableEvent): string =>
  [
    e.title, e.customer, e.shopName, e.chipLabel, e.site, e.address, e.subject, e.jobTitle, e.remarks, e.team, e.worker,
    ...(e.crew ?? []).map((c) => c.name),
    e.quotationNumber, e.orderNumber, e.doNumber, e.deliveryNumber, e.salesperson?.name, e.createdBy?.name, e.orgName,
  ]
    .filter(Boolean)
    .join(" ");

export const noteSearchText = (n: SearchableNote): string => [n.title, n.staffName, n.remark, n.orgName].filter(Boolean).join(" ");

/** The Schedule list's jobs and notes that match (the same arrays when the query is empty). */
export function filterSchedule<E extends SearchableEvent, N extends SearchableNote>(events: E[], notes: N[] | undefined, q: string): { events: E[]; notes: N[] | undefined } {
  if (!fold(q)) return { events, notes };
  return { events: events.filter((e) => matchesQuery(eventSearchText(e), q)), notes: notes?.filter((n) => matchesQuery(noteSearchText(n), q)) };
}
