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
  /** WCT orders (enableWctOrders): the job's order number and the order page. */
  orderNumber?: string | null;
  orderHref?: string | null;
  /** WCT finish modes: the office check of a stamped-DO / paper finish. */
  verificationLabel?: string | null;
  /** Custom job fields (enableJobFields): the icons drawn on the event. */
  badges?: CalendarBadge[];
  /** WCT calendar add: PTW badge (only when needed) and the "Untagged" mark (no order yet). */
  ptw?: { status: string; label: string; remark: string | null };
  untagged?: boolean;
}

export interface CalendarBadge {
  fieldId: string;
  label: string;
  icon: string;
  colour: string;
  text: string;
}

export interface CalendarLegendEntry {
  fieldId: string;
  label: string;
  icon: string;
  colours: { value: string; colour: string }[];
}

export interface CalendarPayload {
  from: string;
  to: string;
  timezone: string;
  events: CalendarEvent[];
  siteclock: { state: "ok" | "off" | "unavailable"; error?: string; fetchedAt?: string };
  /** Custom job fields (enableJobFields): what the event icons mean. */
  legend?: CalendarLegendEntry[];
  /** WCT calendar add (enableWctOrders + enableJobsCalendar): notes in range; absent for every other org. */
  notes?: import("@/helpers/calendarAdd").CalendarNote[];
}

/** "Permit approved: Yes" — an event icon's tooltip. */
export const badgeTitle = (b: CalendarBadge) => `${b.label}: ${b.text}`;

/** "Yes = green, No = red" — a legend entry's tooltip (colour names for the six picker colours). */
export function legendTitle(l: CalendarLegendEntry): string {
  const name = (c: string) => ({ "#2e7d32": "green", "#ef6c00": "orange", "#c62828": "red", "#1565c0": "blue", "#6a1b9a": "purple", "#546e7a": "grey" } as Record<string, string>)[c.toLowerCase()] || c;
  return `${l.label}: ${l.colours.map((c) => (c.value === "set" ? `${name(c.colour)} when filled in` : `${name(c.colour)} = ${c.value}`)).join(", ")}`;
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

// WCT (jobWords, 2026-11-16): colours by PTW and order, not by source. A job of
// an order is "Job" blue; a job with no order (a quick job not linked yet, or a
// job made / assigned in SiteClock) is "Misc job" purple; a job whose PTW is
// still needed (required or submitted) is amber, an approved PTW green: the PTW
// colours win. Notes are one neutral slim chip (calendarAdd.ts).
export type PtwState = "job" | "misc" | "needed" | "approved";
export const PTW_STATE_COLOR: Record<PtwState, string> = { job: "#1e88e5", misc: "#8e24aa", needed: "#f9a825", approved: "#2e7d32" };
export const NOTE_CHIP_COLOR = "#cfd8dc";

/** A job's PTW state from its PTW status (the field that replaced the permit job fields); no PTW data = a plain job. */
export function ptwStateOf(e: Pick<CalendarEvent, "ptw">): Exclude<PtwState, "misc"> {
  const s = String(e.ptw?.status ?? "").toUpperCase();
  if (s === "APPROVED") return "approved";
  if (s === "REQUIRED" || s === "SUBMITTED") return "needed";
  return "job";
}

/** WCT: a job with no order linked (every SiteClock job counts: AIMS's own SiteClock jobs are merged onto their AIMS job). */
export const isMiscJob = (e: Pick<CalendarEvent, "source" | "orderNumber">): boolean => e.source === "siteclock" || !e.orderNumber;

/** WCT colour state: PTW first, then Misc job (no order), else Job. */
export function wctStateOf(e: Pick<CalendarEvent, "ptw" | "source" | "orderNumber">): PtwState {
  const p = ptwStateOf(e);
  return p !== "job" ? p : isMiscJob(e) ? "misc" : "job";
}

/** An event's colour: grey when cancelled; WCT by PTW / order, everyone else by source / kind. */
export function eventColor(e: Pick<CalendarEvent, "cancelled" | "kind" | "ptw" | "source" | "orderNumber">, byPtw = false): string {
  if (e.cancelled) return CANCELLED_COLOR;
  return byPtw ? PTW_STATE_COLOR[wctStateOf(e)] : KIND_COLOR[e.kind];
}

export const KIND_LABEL: Record<EventKind, string> = {
  delivery: "Delivery",
  return: "Return",
  service: "Service run",
  siteclock: "SiteClock job",
};

/** An event's kind as the org reads it: WCT (enableWctOrders) calls deliveries and returns "Job". */
export function kindLabel(kind: EventKind, jobWords: boolean): string {
  return jobWords && (kind === "delivery" || kind === "return") ? "Job" : KIND_LABEL[kind];
}

/** The WCT panel's kind line: "Misc job" for a job with no order, else the kind as above. */
export function wctKindLabel(e: Pick<CalendarEvent, "kind" | "source" | "orderNumber">): string {
  return isMiscJob(e) ? (e.source === "siteclock" ? "Misc job (SiteClock)" : "Misc job") : kindLabel(e.kind, true);
}

/** The calendar's colour legend. WCT (jobWords): Job · Misc job · PTW needed · PTW approved · Note (Show cancelled is the checkbox). */
export function calendarLegendItems(jobWords: boolean): Array<{ label: string; color: string }> {
  if (jobWords) {
    return [
      { label: "Job", color: PTW_STATE_COLOR.job },
      { label: "Misc job", color: PTW_STATE_COLOR.misc },
      { label: "PTW needed", color: PTW_STATE_COLOR.needed },
      { label: "PTW approved", color: PTW_STATE_COLOR.approved },
      { label: "Note", color: NOTE_CHIP_COLOR },
    ];
  }
  return [
    { label: jobWords ? "Job" : "Delivery / return", color: KIND_COLOR.delivery },
    { label: "Service run", color: KIND_COLOR.service },
    { label: "SiteClock job", color: KIND_COLOR.siteclock },
    { label: "Cancelled", color: CANCELLED_COLOR },
  ];
}

const ymd = (s: string) => s.slice(0, 10);
/** "2026-11-11" from a FullCalendar date string (its own zone, so the first 10 characters are the day). */
export const ymdOf = ymd;
const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/**
 * FullCalendar's visible range (start inclusive, end exclusive, both in the
 * calendar's zone) as the API's inclusive yyyy-MM-dd days.
 */
export function rangeOf(startStr: string, endStr: string): { from: string; to: string } {
  return { from: ymd(startStr), to: addDays(ymd(endStr), -1) };
}

/**
 * All-day jobs (2026-11-10): an AIMS job with no specific time that is still
 * scheduled can be dragged to another day. Timed jobs are not draggable.
 */
export function isMovable(e: Pick<CalendarEvent, "source" | "allDay" | "status" | "cancelled">): boolean {
  return e.source === "aims" && e.allDay && e.status === "scheduled" && !e.cancelled;
}

/** The run id behind an AIMS event ("aims:<deliveryId>"), or null. */
export const runIdOf = (eventId: string): string | null => (eventId.startsWith("aims:") ? eventId.slice(5) : null);

/** What FullCalendar draws for each event; cancelled ones only when asked for. `movable` = drag is on; `byPtw` = WCT colours. */
export function toCalendarInputs(events: CalendarEvent[], showCancelled: boolean, movable = false, byPtw = false) {
  return events
    .filter((e) => showCancelled || !e.cancelled)
    .map((e) => {
      const color = eventColor(e, byPtw);
      return {
        id: e.id,
        title: e.title,
        start: e.start,
        end: e.end ?? undefined,
        allDay: e.allDay,
        ...(movable && isMovable(e) ? { startEditable: true, durationEditable: false } : {}),
        backgroundColor: color,
        borderColor: color,
        textColor: byPtw && !e.cancelled && wctStateOf(e) === "needed" ? "#3e2723" : "#ffffff",
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

/**
 * WCT: where a click on an event goes. An AIMS job opens its order (else its
 * DO, else the job); a SiteClock job opens in SiteClock (new tab). null = none.
 */
export function eventClickTarget(e: Pick<CalendarEvent, "source" | "orderHref" | "doHref" | "href" | "siteclockUrl">): { href: string; external: boolean } | null {
  if (e.source === "siteclock") return e.siteclockUrl ? { href: e.siteclockUrl, external: true } : null;
  const href = e.orderHref || e.doHref || e.href;
  return href ? { href, external: false } : null;
}

/**
 * WCT details panel: the links in order, order > DO > job; a SiteClock job
 * opens in SiteClock (read only in AIMS).
 */
export function panelLinks(e: Pick<CalendarEvent, "source" | "orderHref" | "doHref" | "href" | "siteclockUrl">): Array<{ label: string; href: string; external: boolean }> {
  if (e.source === "siteclock") return e.siteclockUrl ? [{ label: "Open in SiteClock", href: e.siteclockUrl, external: true }] : [];
  return [
    ...(e.orderHref ? [{ label: "Open order", href: e.orderHref, external: false }] : []),
    ...(e.doHref ? [{ label: "View DO", href: e.doHref, external: false }] : []),
    ...(e.href ? [{ label: "Open job", href: e.href, external: false }] : []),
  ];
}

/** The Singapore day (yyyy-MM-dd) of an instant, e.g. the date FullCalendar hands a "+n more" click. */
export const dayOfInstant = (d: Date): string => new Intl.DateTimeFormat("en-CA", { timeZone: CALENDAR_TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

/**
 * "+n more" (WCT): the day's jobs for the panel, from FullCalendar's segments
 * (notes left out, each job once, in the calendar's order).
 */
export function dayJobsOf(segs: Array<{ event: { extendedProps?: Record<string, any> } }>): CalendarEvent[] {
  const seen = new Set<string>();
  const out: CalendarEvent[] = [];
  for (const s of segs) {
    const e = s.event.extendedProps?.event as CalendarEvent | undefined;
    if (!e || seen.has(e.id)) continue;
    seen.add(e.id);
    out.push(e);
  }
  return out;
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
