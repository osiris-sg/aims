// Jobs calendar (WCT 2026-10-30, enableJobsCalendar). Pure helpers: tested by
// helpers/jobsCalendar.test.mjs. The events come from GET /dashboard/jobs-calendar
// (api-server-production/src/dashboard/jobs-calendar.ts builds them).

export const CALENDAR_TZ = "Asia/Singapore";

export type EventKind = "delivery" | "return" | "service" | "siteclock";

export interface CalendarCrew {
  name: string;
  arrivedAt: string | null;
  leftAt: string | null;
}

export interface CalendarEvent {
  id: string;
  source: "aims" | "siteclock";
  kind: EventKind;
  title: string;
  start: string;
  end: string | null;
  allDay: boolean;
  status: string;
  statusLabel: string;
  completed: boolean;
  cancelled: boolean;
  address: string | null;
  site: string | null;
  worker: string | null;
  rider: string | null;
  crew: CalendarCrew[];
  href: string | null;
  siteclockUrl: string | null;
  deliveryNumber: number | null;
  /** AIMS runs with a DO: its number, Pending / Completed / Cancelled tag, and the office DO page. */
  doNumber?: string | null;
  doTag?: "Pending" | "Completed" | "Cancelled" | null;
  doHref?: string | null;
}

export interface CalendarPayload {
  from: string;
  to: string;
  timezone: string;
  events: CalendarEvent[];
  siteclock: { state: "ok" | "off" | "unavailable"; error?: string; fetchedAt?: string };
}

// Deliveries and returns blue, service runs orange, SiteClock's own jobs green;
// cancelled grey. Readable on both themes (white text on a mid-tone fill).
export const KIND_COLOR: Record<EventKind, string> = {
  delivery: "#1e88e5",
  return: "#1e88e5",
  service: "#ef6c00",
  siteclock: "#2e7d32",
};
export const CANCELLED_COLOR = "#9e9e9e";

export const KIND_LABEL: Record<EventKind, string> = {
  delivery: "Delivery",
  return: "Return",
  service: "Service run",
  siteclock: "SiteClock job",
};

const ymd = (s: string) => s.slice(0, 10);
const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/**
 * FullCalendar's visible range (start inclusive, end exclusive, both in the
 * calendar's zone) as the API's inclusive yyyy-MM-dd days.
 */
export function rangeOf(startStr: string, endStr: string): { from: string; to: string } {
  return { from: ymd(startStr), to: addDays(ymd(endStr), -1) };
}

/** What FullCalendar draws for each event; cancelled ones only when asked for. */
export function toCalendarInputs(events: CalendarEvent[], showCancelled: boolean) {
  return events
    .filter((e) => showCancelled || !e.cancelled)
    .map((e) => {
      const color = e.cancelled ? CANCELLED_COLOR : KIND_COLOR[e.kind];
      return {
        id: e.id,
        title: e.title,
        start: e.start,
        end: e.end ?? undefined,
        allDay: e.allDay,
        backgroundColor: color,
        borderColor: color,
        textColor: "#ffffff",
        classNames: ["aims-jc-event", ...(e.completed ? ["aims-jc-completed"] : []), ...(e.cancelled ? ["aims-jc-cancelled"] : [])],
        extendedProps: { event: e },
      };
    });
}

const timeFmt = (iso: string) =>
  new Intl.DateTimeFormat("en-SG", { timeZone: CALENDAR_TZ, hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(iso)).replace(/\s/g, " ").toLowerCase();
const dayFmt = (iso: string) => new Intl.DateTimeFormat("en-SG", { timeZone: CALENDAR_TZ, weekday: "short", day: "numeric", month: "short" }).format(new Date(iso));

/** "Tue, 3 Nov · 10:00 am – 11:30 am" (Singapore time), or "Tue, 3 Nov · All day". */
export function timeWindow(e: Pick<CalendarEvent, "start" | "end" | "allDay">): string {
  if (e.allDay) return `${dayFmt(`${ymd(e.start)}T12:00:00+08:00`)} · All day`;
  const start = `${dayFmt(e.start)} · ${timeFmt(e.start)}`;
  if (!e.end) return start;
  const sameDay = dayFmt(e.start) === dayFmt(e.end);
  return `${start} – ${sameDay ? "" : `${dayFmt(e.end)} · `}${timeFmt(e.end)}`;
}

/** "Ali · arrived 10:05 am · left 11:20 am" for the popup. */
export function crewLine(c: CalendarCrew): string {
  const parts = [c.name];
  if (c.arrivedAt) parts.push(`arrived ${timeFmt(c.arrivedAt)}`);
  if (c.leftAt) parts.push(`left ${timeFmt(c.leftAt)}`);
  return parts.join(" · ");
}

/** The banner above the calendar, or null. */
export function siteclockBanner(p: Pick<CalendarPayload, "siteclock"> | null | undefined): string | null {
  if (p?.siteclock?.state !== "unavailable") return null;
  return "SiteClock unavailable: showing AIMS jobs only. SiteClock jobs will appear when it answers again.";
}
