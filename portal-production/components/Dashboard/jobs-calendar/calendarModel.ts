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
  /** Repeating jobs (WCT group, 2026-11-25): the series line ("Weekly on Wed, never ends"); occurrence = not a job yet. */
  repeat?: { seriesId: string; date: string; rrule: string; text: string; anchorDate: string; exception?: true };
  occurrence?: true;
  /** Technician Site Visit (a note drawn as a job, 2026-11-24): opens the Note dialog. */
  noteId?: string;
  noteKind?: "technician_site_visit";
  note?: import("@/helpers/calendarAdd").CalendarNote;
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
  /** WCT calendar add: the job's quotation (the order's, else a quick job's own unsigned one) and its document page. */
  quotationNumber?: string | null;
  quotationHref?: string | null;
  /** Job category (WCT group): blank jobs read as the default; absent for every other org. */
  category?: string | null;
  /** Group calendar (enableGroupCalendar, parent org only): the item's org; absent for every other calendar. */
  orgId?: string;
  orgName?: string;
  /** Group calendar: a child org's item (read only here). */
  foreign?: boolean;
  /** Group calendar: a child org's item the viewer is not a member of (the server sent no links). */
  viewOnly?: boolean;
  /** Calendar style (enableCalendarStyle, WCT group; absent for every other org): fill, PTW bar, icons, greyed. */
  style?: EventStyle;
  /** Calendar style: the job's salesperson and PTW applicant, COD, postponed, live DOs. */
  salesperson?: { id: string; name: string | null } | null;
  /** inList false: the job's applicant is not on the org's PTW applicants list (kept, shown marked). */
  ptwApplicant?: { id: string; name: string | null; inList?: false } | null;
  cod?: boolean;
  postponed?: boolean;
  doCount?: number;
  /** Calendar style: "Generate sticker" ticked (📌 is in style.icons). */
  sticker?: boolean;
  /** Calendar style (2026-11-19): the chip text, customer only (else site address, else the title). */
  chipLabel?: string;
  /** Calendar style: who made the job; null = not recorded (the people list's "Unknown"). */
  createdBy?: { id: string; name: string | null } | null;
  /** Round 36 (2026-11-20, calendar style): the panel and the WhatsApp list (calendarPanel.ts). */
  customer?: string | null;
  /** Shop name (2026-11-24, WCT group): shown instead of the customer everywhere when filled. */
  shopName?: string | null;
  /** Job title (2026-11-24, calendar style). */
  jobTitle?: string | null;
  /** Postpone keeps the old event (2026-11-24): the other job of the pair (id + date); recordOnly = the old one. */
  postponedTo?: { id: string; date: string } | null;
  postponedFrom?: { id: string; date: string } | null;
  recordOnly?: boolean;
  subject?: string | null;
  remarks?: string | null;
  team?: string | null;
  /** Round 39 B4 (Workers & Teams): the picked teams / workers (team = picks + free text); teamText = the free text. */
  crewPicks?: Array<{ kind: "team" | "worker"; id: string; name: string }>;
  teamText?: string | null;
  /** The stored PTW status (NOT_NEEDED when none), for the panel's pills. */
  ptwStatus?: string;
  quotationStatus?: string | null;
  /** Round 39: the quotation's real status as the side panel shows it (Confirmed / Unconfirmed · ERP draft / Declined…). */
  quotationStatusLabel?: string | null;
  /** Cancelled from the calendar panel: Undo is offered. */
  calendarCancelled?: boolean;
}

/** Calendar style (server: api-server-production/src/dashboard/calendar-style.ts). */
export interface EventStyle {
  fill: string;
  text: string;
  /** The PTW applicant's bar; null = no PTW needed. */
  bar: string | null;
  icons: Array<{ icon: string; label: string }>;
  /** Cancelled or postponed: greyed out, never hidden. */
  greyed: boolean;
  /** "(SV)" / "(M)" / "(CC)" before the title. */
  prefix: string | null;
  /** Round 36: the PTW applicant as a colour circle (🔴 / 🟡 / 🟢), when a PTW is needed. */
  applicantIcon?: string | null;
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
  notes?: Array<import("@/helpers/calendarAdd").CalendarNote & GroupTag & { createdBy?: { id: string; name: string | null } | null }>;
  /** Group calendar: the orgs shown, own org first (absent otherwise). */
  group?: { orgs: Array<{ id: string; name: string }> };
  /** Singapore public holidays in the range (2026-11-24, calendar style orgs; absent otherwise). */
  holidays?: import("@/helpers/publicHolidays").PublicHoliday[];
  /** Calendar style (enableCalendarStyle): present = styled chips and the icon legend. */
  /** stripes (2026-11-25): the PTW stripe colours set per status in Org Settings > Calendar colours (absent when none). */
  style?: { legend: Array<{ icon: string; label: string }>; stripes?: Array<{ label: string; colour: string }> };
  /** hideSiteClockJobs (WCT group): the server left SiteClock-created jobs out (absent otherwise). */
  siteclockJobsHidden?: boolean;
  /** calendarHqView (WCT group): sent by the server; the Salesperson filter it offered was removed 2026-11-19 (people list instead). */
  hqView?: boolean;
  /** Calendar style (WCT group, 2026-11-19): the people list beside the calendar (absent otherwise). */
  people?: PanelPerson[];
}

/** One person of the people list: their salesperson colour, or an automatic one (auto) until they pick one. */
export interface PanelPerson {
  id: string;
  name: string;
  colour: string;
  auto: boolean;
}


/**
 * hideSiteClockJobs (WCT group 2026-11-18): only jobs made in AIMS. Drops every SiteClock-created
 * event (AIMS jobs pushed to SiteClock are AIMS events, so they stay) and marks the payload hidden.
 * The server already leaves them out; this keeps the screen right if an old API answers.
 */
export function withoutSiteClockJobs<T extends Pick<CalendarPayload, "events" | "siteclockJobsHidden">>(p: T, hide: boolean): T {
  if (!hide && !p.siteclockJobsHidden) return p;
  return { ...p, events: p.events.filter((e) => e.source !== "siteclock"), siteclockJobsHidden: true };
}

/** Group calendar: which org an item belongs to (set only when the group view is on). */
export interface GroupTag {
  orgId?: string;
  orgName?: string;
  foreign?: boolean;
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
export function calendarLegendItems(jobWords: boolean, hideSiteClock = false): Array<{ label: string; color: string }> {
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
    ...(hideSiteClock ? [] : [{ label: "SiteClock job", color: KIND_COLOR.siteclock }]),
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
export function isMovable(e: Pick<CalendarEvent, "source" | "allDay" | "status" | "cancelled" | "foreign">): boolean {
  return e.source === "aims" && e.allDay && e.status === "scheduled" && !e.cancelled && !e.foreign;
}

/** The run id behind an AIMS event ("aims:<deliveryId>"), or null. */
export const runIdOf = (eventId: string): string | null => (eventId.startsWith("aims:") ? eventId.slice(5) : null);

/**
 * What FullCalendar draws for each event; cancelled ones only when asked for. `movable` = drag is on; `byPtw` = WCT colours.
 * Calendar style (events with `style`): fill by salesperson, every event drawn (cancelled / postponed greyed, never hidden).
 */
export function toCalendarInputs(events: CalendarEvent[], showCancelled: boolean, movable = false, byPtw = false) {
  return events
    .filter((e) => showCancelled || !e.cancelled || !!e.style)
    .map((e) => (e.style ? styledInput(e, e.style, movable) : plainInput(e, movable, byPtw)));
}

function styledInput(e: CalendarEvent, st: EventStyle, movable: boolean) {
  return {
    id: e.id,
    title: styledTitle(e),
    start: e.start,
    end: e.end ?? undefined,
    allDay: e.allDay,
    ...(movable && isMovable(e) && !st.greyed ? { startEditable: true, durationEditable: false } : {}),
    // 2026-11-19: a soft tint of the salesperson's colour with dark text (the full colour stays for the Schedule dot
    // and the side panel); the PTW bar sits on the chip's right edge (StyledChip).
    backgroundColor: chipFill(st.fill),
    borderColor: chipBorder(st.fill),
    textColor: CHIP_TEXT,
    // Round 36: cancelled fully grey (greyscale), postponed / on hold faded (greyed); both keep aims-jc-greyed.
    classNames: [
      "aims-jc-event",
      "aims-jc-styled",
      ...(e.completed ? ["aims-jc-completed"] : []),
      ...(st.greyed ? ["aims-jc-greyed", e.cancelled ? "aims-jc-tone-cancelled" : "aims-jc-tone-postponed"] : []),
    ],
    extendedProps: { event: e },
  };
}

/** The full title with the category prefix: "(SV) ORD… · #12 Acme" (side panel, tooltip, day list). */
export const styledTitle = (e: Pick<CalendarEvent, "title" | "style">): string => (e.style?.prefix ? `${e.style.prefix} ${e.title}` : e.title);

/**
 * Calendar style chip, line 1 (2026-11-19): the category prefix + the customer only, no order or job number ("(SV)
 * Acme"); a job with no customer shows its site address, with neither its title. Month, Week, Day and the Schedule
 * rows all use it; the tooltip and the side panel keep the full title.
 */
export const chipTitle = (e: Pick<CalendarEvent, "title" | "style" | "chipLabel">): string => {
  const label = e.chipLabel || titleWithoutNumbers(e.title);
  return e.style?.prefix ? `${e.style.prefix} ${label}` : label;
};

/** The title fallback without order / job numbers ("ORD… · #41 Domino's" → "Domino's"; same rule as the server). */
export function titleWithoutNumbers(title: string): string {
  const t = String(title ?? "")
    .replace(/^\s*ORD[\w-]*\s*·\s*/i, "")
    .replace(/^(Return\s+)?#\d+\s+/i, (_m, r) => r ?? "")
    .trim();
  return t || title;
}

/**
 * Month rows (2026-11-19): at most 2 icons inline so the customer stays readable, by priority: ❌ / ⭕ status, PTW
 * status, ✅, 📌, 🟫. The rest are in the hover text and the side panel (the Schedule view shows all).
 */
const ICON_RANK: Array<(icon: string) => boolean> = [
  (i) => i === "❌" || i === "⭕",
  (i) => i === "✋" || i === "👍" || i === "👎",
  (i) => i.endsWith("✅"),
  (i) => i === "📌",
  (i) => i === "🟫",
];
export function rowIcons(icons: Array<{ icon: string }>, max = 2): string {
  const rank = (i: string) => {
    const k = ICON_RANK.findIndex((f) => f(i));
    return k < 0 ? ICON_RANK.length : k;
  };
  return icons
    .map((x, n) => ({ icon: x.icon, n }))
    .sort((a, b) => rank(a.icon) - rank(b.icon) || a.n - b.n)
    .slice(0, max)
    .map((x) => x.icon)
    .join(" ");
}

/** Calendar style chip, line 2: "10:00 am – 11:00 am" (Singapore), or "All day". */
export function chipTimeRange(e: Pick<CalendarEvent, "start" | "end" | "allDay">): string {
  if (e.allDay) return "All day";
  return e.end ? `${timeFmt(e.start)} – ${timeFmt(e.end)}` : timeFmt(e.start);
}

/** Calendar style: the chip's icons as one string ("✋ 2✅"). */
export const chipIcons = (e: Pick<CalendarEvent, "style">): string => (e.style?.icons ?? []).map((i) => i.icon).join(" ");

/** Calendar style: a Leave note leads with 📅 (other notes unchanged). */
export const LEAVE_ICON = "📅";
export const styledNoteTitle = (type: string, title: string): string => (type === "LEAVE" ? `${LEAVE_ICON} ${title}` : title);

/** The panel's colour dot: the salesperson fill when styled, else the WCT / kind colour. */
export const panelColor = (e: CalendarEvent, byPtw: boolean): string => e.style?.fill ?? eventColor(e, byPtw);

function plainInput(e: CalendarEvent, movable: boolean, byPtw: boolean) {
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
export function eventClickTarget(e: Pick<CalendarEvent, "source" | "orderHref" | "doHref" | "href" | "siteclockUrl" | "viewOnly">): { href: string; external: boolean } | null {
  if (e.viewOnly) return null;
  if (e.source === "siteclock") return e.siteclockUrl ? { href: e.siteclockUrl, external: true } : null;
  const href = e.orderHref || e.doHref || e.href;
  return href ? { href, external: false } : null;
}

/**
 * WCT details panel: the links in order, order > DO > job; a SiteClock job
 * opens in SiteClock (read only in AIMS). `numbered` (calendar add gate, where
 * the panel's Order / DO numbers are links, 2026-11-17): no "Open order" /
 * "View DO" buttons, only "Open job".
 */
export function panelLinks(
  e: Pick<CalendarEvent, "source" | "orderHref" | "doHref" | "href" | "siteclockUrl" | "viewOnly">,
  numbered = false,
): Array<{ label: string; href: string; external: boolean }> {
  if (e.viewOnly) return [];
  if (e.source === "siteclock") return e.siteclockUrl ? [{ label: "Open in SiteClock", href: e.siteclockUrl, external: true }] : [];
  return [
    ...(e.orderHref && !numbered ? [{ label: "Open order", href: e.orderHref, external: false }] : []),
    ...(e.doHref && !numbered ? [{ label: "View DO", href: e.doHref, external: false }] : []),
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

/**
 * What a "+n more" handler returns once it has listed the day in the side panel (WCT, 2026-11-18 crash fix).
 * FullCalendar 6 (MoreLinkContainer.handleClick) opens its own pop-over when the handler returns nothing or
 * "popover", and zooms to a view when it returns any other string. The old handler returned nothing, so the
 * pop-over still mounted under a `display: none` rule; a hidden element has no offsetParent, and the pop-over's
 * first sizing pass (Popover.updateSize: rootEl.offsetParent.getBoundingClientRect()) threw, which took the
 * whole page down ("Application error"). A truthy non-string is neither branch: nothing else happens.
 */
export const MORE_LINK_HANDLED = Object.freeze({ handled: true }) as unknown as string;

/** "Ali · arrived 10:05 am · left 11:20 am" for the popup. */
export function crewLine(c: CalendarCrew): string {
  const parts = [c.name];
  if (c.arrivedAt) parts.push(`arrived ${timeFmt(c.arrivedAt)}`);
  if (c.leftAt) parts.push(`left ${timeFmt(c.leftAt)}`);
  return parts.join(" · ");
}

/** The banner above the calendar, or null. */
export function siteclockBanner(p: Pick<CalendarPayload, "siteclock" | "siteclockJobsHidden"> | null | undefined): string | null {
  if (p?.siteclock?.state !== "unavailable" || p.siteclockJobsHidden) return null;
  return "SiteClock unavailable: showing AIMS jobs only. SiteClock jobs will appear when it answers again.";
}

/** One numbered row of the WCT panel: "Order ORD…", "Quotation QO…" or "DO DO…", linked to its page. */
export interface PanelRef {
  key: "order" | "quotation" | "do";
  label: "Order" | "Quotation" | "DO";
  number: string;
  href: string | null;
}

/**
 * WCT calendar add (enableWctOrders + enableJobsCalendar): the panel's numbered
 * links and where the job's title goes. Order job: Order + Quotation + DO, the
 * title opens the order. Quick job on an unsigned quotation: Quotation only.
 * Misc job: no Order / Quotation rows. SiteClock job: no rows (Open in SiteClock
 * stays). null = gate off: the panel stays as it was (plain Order / DO numbers).
 */
export function panelRefs(
  e: Pick<CalendarEvent, "source" | "orderNumber" | "orderHref" | "quotationNumber" | "quotationHref" | "doNumber" | "doHref" | "viewOnly">,
  enabled: boolean,
): { titleHref: string | null; rows: PanelRef[] } | null {
  if (!enabled) return null;
  if (e.source === "siteclock") return { titleHref: null, rows: [] };
  // Group calendar: a child org's job the viewer is not a member of shows its numbers without links.
  const link = (h: string | null | undefined) => (e.viewOnly ? null : h ?? null);
  const rows: PanelRef[] = [];
  if (e.orderNumber) rows.push({ key: "order", label: "Order", number: e.orderNumber, href: link(e.orderHref) });
  if (e.quotationNumber) rows.push({ key: "quotation", label: "Quotation", number: e.quotationNumber, href: link(e.quotationHref) });
  if (e.doNumber) rows.push({ key: "do", label: "DO", number: e.doNumber, href: link(e.doHref) });
  return { titleHref: e.orderNumber && link(e.orderHref) ? link(e.orderHref) : null, rows };
}

/**
 * Group calendar: a link of a child org's job, for a member of that org, opens
 * only after the person agrees to switch this tab to that org (never a silent
 * switch). Own-org items and calendars without the group view: null (plain link).
 */
export function crossOrgTarget(e: Pick<CalendarEvent, "foreign" | "viewOnly" | "orgId" | "orgName">): { orgId: string; orgName: string } | null {
  if (!e.foreign || e.viewOnly || !e.orgId) return null;
  return { orgId: e.orgId, orgName: e.orgName || "" };
}

/** Group calendar: the company line of a panel item (null when the group view is off). */
export const orgLabel = (e: Pick<GroupTag, "orgName">): string | null => (e.orgName ? e.orgName : null);


// ── People list (WCT group, 2026-11-19, calendar style orgs) ───────────────────────────────────────────────────
// Like Google Calendar's "Other calendars": one row per person who made jobs / notes in the org (plus the Sales
// people), a row per sister company on the group calendar, and "Unknown" for items with no creator recorded.
// Everyone is ticked by default; unticking hides what that person made (or that company's items). The choice is a
// list of HIDDEN rows, so a person who appears later starts ticked. Remembered per user in this browser.

export const UNKNOWN_PERSON = "__unknown__";
export const UNKNOWN_COLOUR = "#9e9e9e";
export const orgRowId = (orgId: string) => `org:${orgId}`;
export const peopleStorageKey = (userId: string | null | undefined) => `aims-jc-people-hidden:${userId || "anon"}`;

/** A stored choice back to a hidden list (anything malformed = nobody hidden). */
export function parseHidden(raw: string | null | undefined): string[] {
  try {
    const v = JSON.parse(raw || "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export interface PeopleRow {
  id: string;
  label: string;
  colour: string;
  checked: boolean;
  kind: "person" | "unknown" | "company";
}

type Made = { createdBy?: { id: string } | null; foreign?: boolean; orgId?: string };

/** The row an item belongs to: a sister company's row, else its creator, else Unknown. */
export function rowOf(item: Made): string {
  if (item.foreign && item.orgId) return orgRowId(item.orgId);
  return item.createdBy?.id || UNKNOWN_PERSON;
}

/**
 * The panel's rows: the people (server order), "Unknown" when anything on screen has no creator (or it is
 * unticked, so it can be ticked again), then one row per sister company on the group calendar.
 */
export function peopleRows(p: Pick<CalendarPayload, "people" | "events" | "notes" | "group">, hidden: string[]): PeopleRow[] {
  const off = new Set(hidden);
  const rows: PeopleRow[] = (p.people ?? []).map((x) => ({ id: x.id, label: x.name, colour: x.colour, checked: !off.has(x.id), kind: "person" }));
  const known = new Set(rows.map((r) => r.id));
  const items: Made[] = [...(p.events ?? []), ...(p.notes ?? [])];
  // A creator not in the list (e.g. removed from the org since): still a row, so their items can be hidden.
  for (const it of items) {
    const id = it.createdBy?.id;
    if (!it.foreign && id && !known.has(id)) {
      known.add(id);
      rows.push({ id, label: (it as any).createdBy?.name || "Former user", colour: UNKNOWN_COLOUR, checked: !off.has(id), kind: "person" });
    }
  }
  if (off.has(UNKNOWN_PERSON) || items.some((it) => !it.foreign && !it.createdBy?.id)) {
    rows.push({ id: UNKNOWN_PERSON, label: "Unknown", colour: UNKNOWN_COLOUR, checked: !off.has(UNKNOWN_PERSON), kind: "unknown" });
  }
  // 2026-11-22: the calendar's own company leads the Companies list (ticked by default); unticking it hides its own
  // items the same way a sister company's row hides theirs. Names come from the server (the DB), never hard-coded.
  for (const o of p.group?.orgs ?? []) {
    rows.push({ id: orgRowId(o.id), label: o.name, colour: UNKNOWN_COLOUR, checked: !off.has(orgRowId(o.id)), kind: "company" });
  }
  return rows;
}

/** Items whose row is ticked (an empty hidden list keeps the same array). An own item also needs its company ticked. */
export function filterByPeople<T extends Made>(items: T[], hidden: string[]): T[] {
  if (!hidden.length) return items;
  const off = new Set(hidden);
  return items.filter((it) => !off.has(rowOf(it)) && !(it.orgId && off.has(orgRowId(it.orgId))));
}

/** Tick / untick one row. */
export function toggleRow(hidden: string[], id: string): string[] {
  return hidden.includes(id) ? hidden.filter((h) => h !== id) : [...hidden, id];
}

/** "Select all" = nobody hidden; "None" = every row hidden. */
export const selectAllRows = (): string[] => [];
export const selectNoRows = (rows: PeopleRow[]): string[] => rows.map((r) => r.id);

// ── Schedule view (WCT group, 2026-11-19) ─────────────────────────────────────────────────────────────────────
// A list grouped by date (date badge on the left): each row the time (or All day), a coloured dot, the icons, the
// title and the site. All-day items first (notes, then jobs), then jobs and notes together by clock time. A note spanning days shows on each of them.

export interface ScheduleRow {
  key: string;
  time: string;
  colour: string;
  /** Calendar style (2026-11-19): the PTW applicant's colour (a circle after the time); null when no PTW is needed. */
  ptw?: string | null;
  icons: string;
  title: string;
  site: string | null;
  greyed: boolean;
  cancelled: boolean;
  event?: CalendarEvent;
  note?: import("@/helpers/calendarAdd").CalendarNote & GroupTag;
}

export interface ScheduleDay {
  date: string;
  rows: ScheduleRow[];
}


/** An instant's Singapore clock time, "09:05" (sorts timed jobs and notes together). */
/** "09:00" → "9am", "21:30" → "9:30pm" (Month rows and the Schedule list, 2026-11-19: Google Calendar's short style). */
export const compactHhmm = (t: string): string => {
  const [h, m] = t.split(":").map(Number);
  return `${h % 12 || 12}${m ? `:${String(m).padStart(2, "0")}` : ""}${h < 12 ? "am" : "pm"}`;
};
/** An instant's Singapore time, short: "9am", "9:30pm". */
export const compactTime = (iso: string): string => compactHhmm(sgtHhmm(iso));
/** A timed job's range, short: "9am – 10:30am" (start only when it has no end). */
export const compactRange = (e: Pick<CalendarEvent, "start" | "end">): string => (e.end ? `${compactTime(e.start)} – ${compactTime(e.end)}` : compactTime(e.start));

const sgtHhmm = (iso: string): string => new Intl.DateTimeFormat("en-GB", { timeZone: CALENDAR_TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));

const dayOfEvent = (e: Pick<CalendarEvent, "start" | "allDay">): string => (e.allDay ? ymd(e.start) : dayOfInstant(new Date(e.start)));

/** The Schedule view's days, from..to inclusive (only days with something on them), in order. */
export function scheduleDays(
  events: CalendarEvent[],
  notes: Array<import("@/helpers/calendarAdd").CalendarNote & GroupTag> | undefined,
  range: { from: string; to: string } | null,
  opts: { showCancelled?: boolean; byPtw?: boolean } = {},
): ScheduleDay[] {
  const by = new Map<string, Array<ScheduleRow & { sort: string }>>();
  const inRange = (d: string) => !range || (d >= range.from && d <= range.to);
  const push = (d: string, r: ScheduleRow & { sort: string }) => {
    if (!inRange(d)) return;
    const list = by.get(d) ?? [];
    list.push(r);
    by.set(d, list);
  };
  for (const n of notes ?? []) {
    const timed = !n.allDay && !!n.startTime && !!n.endTime;
    for (let d = n.startDate; d <= n.endDate; d = addDays(d, 1)) {
      if (range && d > range.to) break;
      push(d, {
        key: `note:${n.id}:${d}`,
        time: timed ? `${compactHhmm(n.startTime!)} – ${compactHhmm(n.endTime!)}` : "All day",
        colour: NOTE_CHIP_COLOR,
        icons: n.type === "LEAVE" ? LEAVE_ICON : "",
        title: [n.title, n.staffName].filter(Boolean).join(" · "),
        site: n.orgName ?? null,
        greyed: false,
        cancelled: false,
        note: n,
        sort: timed ? `2|${n.startTime}|${n.title}` : `0||${n.title}`,
      });
    }
  }
  for (const e of events) {
    if (e.cancelled && !e.style && !opts.showCancelled) continue;
    // The site: the job's address (its customer is already in the title); the site name only when the title lacks it.
    const place = e.address || (e.site && !e.title.includes(e.site) ? e.site : null);
    const site = [place, e.orgName ?? null].filter(Boolean).join(" · ") || null;
    push(dayOfEvent(e), {
      key: e.id,
      time: e.allDay ? "All day" : compactRange(e),
      colour: panelColor(e, !!opts.byPtw),
      ptw: e.style?.bar ?? null,
      icons: chipIcons(e),
      title: chipTitle(e),
      site,
      greyed: !!e.style?.greyed,
      cancelled: e.cancelled,
      event: e,
      sort: e.allDay ? `1||${chipTitle(e)}` : `2|${sgtHhmm(e.start)}|${chipTitle(e)}`,
    });
  }
  return [...by.keys()]
    .sort()
    .map((date) => ({ date, rows: by.get(date)!.sort((a, b) => a.sort.localeCompare(b.sort)).map(({ sort: _s, ...r }) => r) }));
}

/** Where the Schedule view opens: today, else the next day with items, else the last one (null = empty). */
export function scheduleScrollDay(days: ScheduleDay[], today: string): string | null {
  if (!days.length) return null;
  return (days.find((d) => d.date >= today) ?? days[days.length - 1]).date;
}

/** The date badge: "19" + "THU" (+ "Nov" under it). */
export function scheduleBadge(date: string): { day: string; weekday: string; month: string } {
  const d = new Date(`${date}T12:00:00+08:00`);
  const f = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-SG", { timeZone: CALENDAR_TZ, ...o }).format(d);
  return { day: f({ day: "numeric" }), weekday: f({ weekday: "short" }).toUpperCase(), month: f({ month: "short" }) };
}

/**
 * Calendar style chips (2026-11-19): soft fills. A chip is the salesperson's colour at CHIP_STRENGTH over white
 * (a pastel tint, each person still distinct) with dark text; its outline a little stronger so a pale chip
 * still has an edge. The PTW bar keeps the full colour.
 */
export const CHIP_STRENGTH = 0.35;
export const CHIP_TEXT = "#1f2328";
/** Round 39: the small time on Month chips and Schedule rows (grey, still readable on every pastel fill). */
export const CHIP_TIME = "#5f6368";
/** Cancelled / postponed chips: fully grey at this opacity. */
export const GREYED_OPACITY = 0.8;
const mixWhite = (hex: string, strength: number): string => {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || "").trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => Math.round(c * strength + 255 * (1 - strength)));
  return `#${ch.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
};
export const chipFill = (hex: string) => mixWhite(hex, CHIP_STRENGTH);
export const chipBorder = (hex: string) => mixWhite(hex, 0.6);

/** WCAG contrast ratio of two #rrggbb colours (1 to 21). */
export function contrastRatio(a: string, b: string): number {
  const lum = (hex: string) => {
    const n = parseInt(hex.replace("#", ""), 16);
    const [r, g, bl] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
      const s = c / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

/** The applicant as the side panel and pickers show it: marked when it is not on the org's list. */
export const applicantLabel = (p: { name: string | null; inList?: boolean | false } | null | undefined): string =>
  !p ? "" : `${p.name || "Unknown"}${p.inList === false ? " (not in list)" : ""}`;

/** PTW applicants list orgs (2026-11-19): a job's applicant that is not on the list keeps showing, marked. */
export const applicantOptionLabel = (o: { id: string; name: string }, list: Array<{ id: string }>, fromList: boolean): string =>
  fromList && !list.some((p) => p.id === o.id) ? `${o.name} (not in list)` : o.name;

/** Where the People panel's open / closed choice is kept (next to the hidden people; null = not kept). */
export const peopleOpenKey = (peopleKey: string | null | undefined): string | null =>
  peopleKey ? peopleKey.replace(/^aims-jc-people-hidden:/, "aims-jc-people-open:") : null;
/** The stored choice: "1" open, "0" closed, anything else = not chosen yet (the screen width decides). */
export const parsePanelOpen = (v: string | null | undefined): boolean | null => (v === "1" ? true : v === "0" ? false : null);

/**
 * Calendar style chip font (WCT group). Owner 25 Nov: timed jobs' chips ("10am Hood Making") 1px smaller than before;
 * all-day bars keep the old size (notes and PH have their own styles, unchanged).
 */
export const CHIP_FONT_BASE = { text: "0.85rem", time: "0.76rem", row2: "0.82rem" } as const;
export function chipFontOf(e: Pick<CalendarEvent, "allDay">): { text: string; time: string; row2: string } {
  if (e.allDay) return { ...CHIP_FONT_BASE };
  return { text: `calc(${CHIP_FONT_BASE.text} - 1px)`, time: `calc(${CHIP_FONT_BASE.time} - 1px)`, row2: `calc(${CHIP_FONT_BASE.row2} - 1px)` };
}
