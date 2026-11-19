// Jobs calendar round 36 (WCT group, 2026-11-20, calendar style orgs only): chip content, the side panel's quick
// toggles, Cancel / Undo, Postpone / Reschedule clashes, the filter bar and the WhatsApp "Export list".
// Pure helpers, tested by helpers/calendarPanel.test.mjs. The events come from GET /dashboard/jobs-calendar
// (api-server-production/src/dashboard/jobs-calendar.service.ts styled()).

import { CALENDAR_TZ, compactTime, dayOfInstant, titleWithoutNumbers, type CalendarEvent } from "./calendarModel";

// ── Chip content (Month rows, Week / Day blocks and Schedule rows alike) ─────────────────────────────────────────

/** "✅" for one completed DO, "2✅" for two. */
export const doIcon = (n: number | null | undefined): string => (Number(n) > 1 ? `${n}✅` : Number(n) === 1 ? "✅" : "");

/** The PTW status as an icon: ✋ pending (required or applied), 👍 approved, 👎 rejected; none when not needed. */
export function ptwStatusIcon(status: string | null | undefined): string {
  const s = String(status ?? "").toUpperCase();
  if (s === "REQUIRED" || s === "SUBMITTED") return "✋";
  if (s === "APPROVED") return "👍";
  if (s === "REJECTED") return "👎";
  return "";
}

/** The stored PTW status of a job (the panel's pills), NOT_NEEDED when none. */
export const ptwStatusOf = (e: Pick<CalendarEvent, "ptwStatus" | "ptw">): string => String(e.ptwStatus || e.ptw?.status || "NOT_NEEDED").toUpperCase();

/** The customer as a chip and the panel title show it: the customer, else the chip label, else the title without numbers. */
export const customerOf = (e: Pick<CalendarEvent, "customer" | "chipLabel" | "title">): string => e.customer?.trim() || e.chipLabel?.trim() || titleWithoutNumbers(e.title);

export interface ChipLines {
  /** "9am" / "8:30pm"; "" for an all-day job. */
  time: string;
  /** ✅ (or 2✅), ❌, ⭕, 📌, 🟫 in that order. */
  icons: string;
  customer: string;
  /** (SV) / (M) / (CC), the PTW status icon, the PTW applicant's colour circle; "" when none (no second row). */
  row2: string;
}

/**
 * Round 36: row 1 = time, status icons, customer; row 2 (only when any) = category prefix, PTW status, applicant.
 * The same in every view (Month rows, Week / Day blocks, Schedule rows).
 */
export function chipLines(e: CalendarEvent): ChipLines {
  const icons = [doIcon(e.doCount), e.cancelled ? "❌" : "", e.postponed && !e.cancelled ? "⭕" : "", e.sticker ? "📌" : "", e.cod ? "🟫" : ""].filter(Boolean).join(" ");
  const ptw = ptwStatusIcon(ptwStatusOf(e));
  const row2 = [e.style?.prefix ?? "", ptw, ptw ? e.style?.applicantIcon ?? "" : ""].filter(Boolean).join(" ");
  return { time: e.allDay ? "" : compactTime(e.start), icons, customer: customerOf(e), row2 };
}

/** The chip's look: cancelled fully grey (greyscale), postponed / on hold faded (greyed). */
export function chipTone(e: Pick<CalendarEvent, "cancelled" | "postponed">): "cancelled" | "postponed" | null {
  if (e.cancelled) return "cancelled";
  if (e.postponed) return "postponed";
  return null;
}

// ── Colour circles for the PTW applicant (mirror of the server's calendar-style.ts COLOUR_CIRCLES) ──────────────

export const COLOUR_CIRCLES: ReadonlyArray<{ icon: string; hex: string }> = [
  { icon: "🔴", hex: "#d50000" },
  { icon: "🟠", hex: "#f4511e" },
  { icon: "🟡", hex: "#e8b500" },
  { icon: "🟢", hex: "#0b8043" },
  { icon: "🔵", hex: "#1e64c8" },
  { icon: "🟣", hex: "#8e24aa" },
  { icon: "🟤", hex: "#795548" },
  { icon: "⚫", hex: "#212121" },
];

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const dist = (a: string, b: string) => {
  const [r1, g1, b1] = rgb(a);
  const [r2, g2, b2] = rgb(b);
  return Math.sqrt((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2);
};

/** The colour circle closest to a #rrggbb colour (Bala 🔴, Joyna 🟡, Kherry 🟢); "" for no colour. */
export function colourCircle(hex: string | null | undefined): string {
  const h = String(hex ?? "").trim().toLowerCase();
  if (!/^#[0-9a-f]{6}$/.test(h)) return "";
  let best = COLOUR_CIRCLES[0];
  for (const c of COLOUR_CIRCLES) if (dist(h, c.hex) < dist(h, best.hex)) best = c;
  return best.icon;
}

// ── Quick toggles (side panel pills) ──────────────────────────────────────────────────────────────────────────

export const PTW_PILLS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "NOT_NEEDED", label: "Not needed" },
  { value: "REQUIRED", label: "Pending ✋" },
  { value: "APPROVED", label: "Approved 👍" },
  { value: "REJECTED", label: "Rejected 👎" },
];

/** Which PTW pill is on: SUBMITTED (applied) reads as Pending. */
export const ptwPillOf = (status: string): string => (status === "SUBMITTED" ? "REQUIRED" : status);

export const CATEGORY_PREFIX: Record<string, string> = { "site visit": "(SV)", meeting: "(M)", "collect cheque": "(CC)" };
export const categoryPrefix = (c: string | null | undefined): string | null => CATEGORY_PREFIX[String(c ?? "").trim().toLowerCase()] ?? null;

export type PanelToggle =
  | { kind: "ptw"; status: string }
  | { kind: "applicant"; applicant: { id: string; name: string; colour?: string } | null }
  | { kind: "sticker"; on: boolean }
  | { kind: "cod"; on: boolean }
  | { kind: "category"; category: string }
  | { kind: "team"; team: string | null };

/** The run id behind an AIMS event, or null. */
const runOf = (e: Pick<CalendarEvent, "id">) => (e.id.startsWith("aims:") ? e.id.slice(5) : null);

/** The API call for a toggle (each is one Activity Log row on the server). */
export function toggleRequest(e: Pick<CalendarEvent, "id">, t: PanelToggle, currentStatus = "NOT_NEEDED"): { method: string; path: string; body: any } | null {
  const id = runOf(e);
  if (!id) return null;
  switch (t.kind) {
    case "ptw":
      // Pending on a job already applied (SUBMITTED) changes nothing.
      if (ptwPillOf(currentStatus) === t.status) return null;
      return { method: "PATCH", path: `/deliveries/${id}/ptw`, body: { ptwStatus: t.status } };
    case "applicant":
      return { method: "PATCH", path: `/deliveries/${id}/style`, body: { ptwApplicant: t.applicant ? { id: t.applicant.id, name: t.applicant.name } : null } };
    case "sticker":
      return { method: "PATCH", path: `/deliveries/${id}/style`, body: { sticker: t.on } };
    case "cod":
      return { method: "PATCH", path: `/deliveries/${id}/style`, body: { cod: t.on } };
    case "category":
      return { method: "PUT", path: `/deliveries/${id}/category`, body: { category: t.category } };
    case "team":
      return { method: "PATCH", path: `/deliveries/${id}/style`, body: { team: t.team } };
  }
}

/**
 * The event as it reads right after a toggle (shown at once; the calendar reloads from the server after the save).
 * A PTW set to Not needed drops the applicant circle; a PTW set on with the applicant's colour known shows it.
 */
export function applyToggle(e: CalendarEvent, t: PanelToggle, defaultApplicant?: { id: string; name: string; colour?: string } | null): CalendarEvent {
  const style = e.style ? { ...e.style } : undefined;
  switch (t.kind) {
    case "ptw": {
      const status = t.status === "REQUIRED" && ptwStatusOf(e) === "SUBMITTED" ? "SUBMITTED" : t.status;
      const needed = status !== "NOT_NEEDED";
      let applicant = needed ? e.ptwApplicant ?? null : null;
      if (needed && !applicant && defaultApplicant) applicant = { id: defaultApplicant.id, name: defaultApplicant.name };
      if (style) style.applicantIcon = needed ? style.applicantIcon || (applicant && defaultApplicant && applicant.id === defaultApplicant.id ? colourCircle(defaultApplicant.colour) || null : null) : null;
      return { ...e, ptwStatus: status, ptw: needed ? { status, label: status, remark: e.ptw?.remark ?? null } : undefined, ptwApplicant: applicant, style };
    }
    case "applicant":
      if (style) style.applicantIcon = t.applicant ? colourCircle(t.applicant.colour) || null : null;
      return { ...e, ptwApplicant: t.applicant ? { id: t.applicant.id, name: t.applicant.name } : null, style };
    case "sticker":
      return { ...e, sticker: t.on };
    case "cod":
      return { ...e, cod: t.on };
    case "category":
      if (style) style.prefix = categoryPrefix(t.category);
      return { ...e, category: t.category, style };
    case "team":
      return { ...e, team: t.team?.trim() || null };
  }
}

// ── Group calendar: another company's job ──────────────────────────────────────────────────────────────────────

/** Toggles, Cancel and Reschedule: own company's AIMS jobs only (another company's job is read only here). */
export const canEditOnCalendar = (e: Pick<CalendarEvent, "source" | "foreign" | "viewOnly" | "style">): boolean => e.source === "aims" && !e.foreign && !e.viewOnly && !!e.style;

/**
 * Another company's job: a member opens it in one click (the tab switches to that company, no extra question);
 * a non member gets no link. null = an own job (plain link).
 */
export function crossOrgOpen(e: Pick<CalendarEvent, "foreign" | "viewOnly" | "orgId" | "href">): { orgId: string; href: string } | null {
  if (!e.foreign || e.viewOnly || !e.orgId || !e.href) return null;
  return { orgId: e.orgId, href: e.href };
}

/** Where the "switch back" marker is kept (this tab only): the company to return to when the calendar shows again. */
export const RETURN_ORG_KEY = "aims-jc-return-org";
export const RETURN_ORG_TTL_MS = 6 * 3600_000;

/** The marker written before switching: the tab's org before the switch ("" = the person's default org). */
export const returnOrgMarker = (currentStored: string | null, now = Date.now()): string => JSON.stringify({ org: currentStored ?? "", at: now });

/**
 * On the calendar: switch back when the tab is still on the other company. Returns the org to store ("" = the
 * default, remove the key) or null (nothing to do: no marker, too old, malformed, or already there).
 */
export function returnOrgAction(marker: string | null, currentStored: string | null, now = Date.now()): string | null {
  if (!marker) return null;
  try {
    const m = JSON.parse(marker);
    if (typeof m?.org !== "string" || typeof m?.at !== "number" || now - m.at > RETURN_ORG_TTL_MS) return null;
    return (currentStored ?? "") === m.org ? null : m.org;
  } catch {
    return null;
  }
}

// ── Linked documents (side panel): Order, Quotation, Invoice(s), DO(s), each with its status ─────────────────────

export interface PanelDoc {
  key: string;
  label: "Order" | "Quotation" | "Invoice" | "DO";
  number: string;
  status: string;
  href: string | null;
}

const titleCase = (s: string | null | undefined) => {
  const v = String(s ?? "").replace(/_/g, " ").trim().toLowerCase();
  return v ? v.charAt(0).toUpperCase() + v.slice(1) : "";
};

/**
 * From the order page's own model (helpers/orderPage.ts orderPageModel), so the panel and the order page always
 * agree: the order, then its quotations, invoices and DOs, one line each (jobs, reports, files, credit notes left out).
 */
export function panelDocsFromOrder(model: { number: string; statusLabel: string; documents: Array<{ key: string; kind: string; number: string; status: string; href: string | null }> }, orderHref: string | null): PanelDoc[] {
  const label = { quotation: "Quotation", invoice: "Invoice", do: "DO" } as const;
  const rank = { quotation: 0, invoice: 1, do: 2 } as Record<string, number>;
  const rows = model.documents
    .filter((d) => d.kind in label)
    .sort((a, b) => rank[a.kind] - rank[b.kind])
    .map((d) => ({ key: d.key, label: label[d.kind as keyof typeof label], number: d.number, status: d.status || "", href: d.href ?? null }));
  return [{ key: "order", label: "Order", number: model.number, status: model.statusLabel, href: orderHref }, ...rows];
}

/** A job with no order: its quotation (with the quotation's status) and its DO (Pending / Completed / Cancelled). */
export function panelDocsFallback(e: Pick<CalendarEvent, "quotationNumber" | "quotationHref" | "quotationStatus" | "doNumber" | "doHref" | "doTag" | "viewOnly">): PanelDoc[] {
  const link = (h: string | null | undefined) => (e.viewOnly ? null : h ?? null);
  const out: PanelDoc[] = [];
  if (e.quotationNumber) out.push({ key: "quotation", label: "Quotation", number: e.quotationNumber, status: titleCase(e.quotationStatus), href: link(e.quotationHref) });
  if (e.doNumber) out.push({ key: "do", label: "DO", number: e.doNumber, status: e.doTag ?? "", href: link(e.doHref) });
  return out;
}

// ── Postpone / Reschedule: clashes on the new day ───────────────────────────────────────────────────────────────

export interface RescheduleTarget {
  date: string;
  /** "HH:mm", or null = all day. */
  time: string | null;
}

export interface Clash {
  event: CalendarEvent;
  reasons: Array<"Same time" | "Same team">;
}

const SGT_MS = 8 * 3600_000;
const instantOf = (date: string, time: string) => Date.parse(`${date}T${time}:00Z`) - SGT_MS;
const dayOfEvent = (e: Pick<CalendarEvent, "start" | "allDay">) => (e.allDay ? e.start.slice(0, 10) : dayOfInstant(new Date(e.start)));
const norm = (s: string | null | undefined) => String(s ?? "").replace(/\s+/g, " ").trim().toLowerCase();

/** The job's length in minutes (60 when it has no end). */
export const durationOf = (e: Pick<CalendarEvent, "start" | "end" | "allDay">): number => (e.allDay || !e.end ? 60 : Math.max(15, Math.round((Date.parse(e.end) - Date.parse(e.start)) / 60_000)));

/**
 * The jobs on the new day that clash with the moved job: overlapping times (both timed) or the same team. The job
 * itself, cancelled jobs and jobs of another company are never clashes.
 */
export function rescheduleClashes(events: CalendarEvent[], job: CalendarEvent, target: RescheduleTarget): Clash[] {
  const team = norm(job.team);
  const start = target.time ? instantOf(target.date, target.time) : null;
  const end = start != null ? start + durationOf(job) * 60_000 : null;
  const out: Clash[] = [];
  for (const e of events) {
    if (e.id === job.id || e.cancelled || e.foreign || e.source !== "aims") continue;
    if (dayOfEvent(e) !== target.date) continue;
    const reasons: Clash["reasons"] = [];
    if (start != null && end != null && !e.allDay) {
      const s = Date.parse(e.start);
      const f = e.end ? Date.parse(e.end) : s + 60 * 60_000;
      if (s < end && start < f) reasons.push("Same time");
    }
    if (team && norm(e.team) === team) reasons.push("Same team");
    if (reasons.length) out.push({ event: e, reasons });
  }
  return out;
}

// ── Filter bar ──────────────────────────────────────────────────────────────────────────────────────────────────

export type PtwFilter = "needed" | "pending" | "approved" | "rejected" | "none";

export interface CalendarFilters {
  /** "yes" = DO generated (a completed DO), "no" = none yet, "" = both. */
  doState: "" | "yes" | "no";
  ptw: PtwFilter[];
  /** PTW applicant ids; NO_APPLICANT = none. */
  applicants: string[];
  categories: string[];
  /** Group calendar: org ids. */
  companies: string[];
}

export const NO_APPLICANT = "__none__";
// Round 38 (2026-11-20): the Cancelled / Postponed / COD / Sticker chip filters are gone (a stored "flags" is ignored).
export const NO_FILTERS: CalendarFilters = { doState: "", ptw: [], applicants: [], categories: [], companies: [] };

export const filterCount = (f: CalendarFilters): number => (f.doState ? 1 : 0) + f.ptw.length + f.applicants.length + f.categories.length + f.companies.length;

/** A stored filter set back (anything malformed = no filters). */
export function parseFilters(raw: string | null | undefined): CalendarFilters {
  try {
    const v = JSON.parse(raw || "null");
    if (!v || typeof v !== "object") return NO_FILTERS;
    const list = (x: unknown) => (Array.isArray(x) ? x.filter((s): s is string => typeof s === "string") : []);
    return {
      doState: v.doState === "yes" || v.doState === "no" ? v.doState : "",
      ptw: list(v.ptw).filter((s): s is PtwFilter => ["needed", "pending", "approved", "rejected", "none"].includes(s)),
      applicants: list(v.applicants),
      categories: list(v.categories),
      companies: list(v.companies),
    };
  } catch {
    return NO_FILTERS;
  }
}

function ptwMatches(status: string, want: PtwFilter[]): boolean {
  const s = status.toUpperCase();
  return want.some((w) =>
    w === "needed" ? s !== "NOT_NEEDED" : w === "pending" ? s === "REQUIRED" || s === "SUBMITTED" : w === "approved" ? s === "APPROVED" : w === "rejected" ? s === "REJECTED" : s === "NOT_NEEDED",
  );
}

/** One event against the filters: different groups must all match; within a group any value matches. */
export function eventMatches(e: CalendarEvent, f: CalendarFilters, ownOrgId?: string | null): boolean {
  if (f.doState === "yes" && !(Number(e.doCount) > 0)) return false;
  if (f.doState === "no" && Number(e.doCount) > 0) return false;
  if (f.ptw.length && !ptwMatches(ptwStatusOf(e), f.ptw)) return false;
  if (f.applicants.length) {
    const id = ptwStatusOf(e) !== "NOT_NEEDED" ? e.ptwApplicant?.id ?? null : null;
    if (!f.applicants.includes(id ?? NO_APPLICANT)) return false;
  }
  if (f.categories.length && !f.categories.some((c) => norm(c) === norm(e.category))) return false;
  if (f.companies.length && !f.companies.includes(e.orgId || ownOrgId || "")) return false;
  return true;
}

/** The events the filters keep (no filters = the same array). */
export function filterEvents(events: CalendarEvent[], f: CalendarFilters, ownOrgId?: string | null): CalendarEvent[] {
  if (!filterCount(f)) return events;
  return events.filter((e) => eventMatches(e, f, ownOrgId));
}

// ── Export list (WhatsApp) ──────────────────────────────────────────────────────────────────────────────────────

export const DEFAULT_EXPORT_HEADER = "Workers to sign back all DOs & inform in gc if there's no one to sign off";

/** WhatsApp *bold* only: asterisks inside the text would break it, and every value is one line. */
const plain = (s: string | null | undefined) =>
  String(s ?? "")
    .replace(/\*/g, "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .join(", ")
    .replace(/\s+/g, " ")
    .trim();

/** "4pm", "830pm", "12pm", "1015am" (Singapore time); "" for an all-day job. */
export function exportTime(e: Pick<CalendarEvent, "start" | "allDay">): string {
  if (e.allDay) return "";
  const t = new Intl.DateTimeFormat("en-GB", { timeZone: CALENDAR_TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(e.start));
  const [h, m] = t.split(":").map(Number);
  return `${h % 12 || 12}${m ? String(m).padStart(2, "0") : ""}${h < 12 ? "am" : "pm"}`;
}

/** A site address, short: no "Singapore 123456" / postal code, no repeated spaces or commas. */
export function shortAddress(a: string | null | undefined): string {
  let s = plain(a);
  s = s.replace(/,?\s*\(?\bS(?:ingapore)?\)?\s*\(?\d{6}\)?\s*$/i, "");
  s = s.replace(/,?\s*\bSingapore\b\s*$/i, "");
  s = s.replace(/,?\s*\b\d{6}\s*$/, "");
  return s.replace(/\s*,\s*,+/g, ",").replace(/^[\s,]+|[\s,]+$/g, "").trim();
}

/** "4pm - Ajiya Okonomiyaki Restaurant @ E!Avenue #02-346 (Subject) - Team A *Remarks*". */
export function exportLine(e: CalendarEvent): string {
  const time = exportTime(e);
  const where = shortAddress(e.address);
  const subject = plain(e.subject);
  const team = plain(e.team);
  const remarks = plain(e.remarks);
  // Remarks prefilled from the quotation's Subject are not repeated.
  const extra = remarks && norm(remarks) !== norm(subject) ? remarks : "";
  return [
    time ? `${time} - ` : "All day - ",
    plain(customerOf(e)),
    where ? ` @ ${where}` : "",
    subject ? ` (${subject})` : "",
    team ? ` - ${team}` : "",
    extra ? ` *${extra}*` : "",
  ].join("");
}

/** "*20/10/2026, Tuesday*". */
export function exportDateLine(date: string): string {
  const d = new Date(`${date}T12:00:00+08:00`);
  const weekday = new Intl.DateTimeFormat("en-GB", { timeZone: CALENDAR_TZ, weekday: "long" }).format(d);
  return `*${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}, ${weekday}*`;
}

export interface ExportOptions {
  from: string;
  to: string;
  header: string;
  includeCancelled?: boolean;
  includeOnHold?: boolean;
}

/** The jobs that go on the list: AIMS jobs in range, by time; cancelled / on hold only when asked. */
export function exportJobs(events: CalendarEvent[], o: Pick<ExportOptions, "from" | "to" | "includeCancelled" | "includeOnHold">): Map<string, CalendarEvent[]> {
  const by = new Map<string, CalendarEvent[]>();
  for (const e of events) {
    if (e.source !== "aims") continue;
    if (e.cancelled && !o.includeCancelled) continue;
    if (e.postponed && !e.cancelled && !o.includeOnHold) continue;
    const day = dayOfEvent(e);
    if (day < o.from || day > o.to) continue;
    by.set(day, [...(by.get(day) ?? []), e]);
  }
  for (const [day, list] of by) {
    by.set(
      day,
      // All-day jobs first, then by time; the same time keeps the calendar's order (a stable sort).
      list.sort((a, b) => (a.allDay === b.allDay ? (a.allDay ? 0 : Date.parse(a.start) - Date.parse(b.start)) : a.allDay ? -1 : 1)),
    );
  }
  return by;
}

/**
 * The WhatsApp text: per date "*dd/mm/yyyy, Weekday*", the header line, "*SCHEDULE*", then one line per job by time,
 * a blank line between everything. Days with no jobs are left out; nothing at all = "".
 */
export function exportText(events: CalendarEvent[], o: ExportOptions): string {
  const by = exportJobs(events, o);
  const header = plain(o.header);
  return [...by.keys()]
    .sort()
    .map((day) => [exportDateLine(day), ...(header ? [header] : []), "*SCHEDULE*", ...by.get(day)!.map(exportLine)].join("\n\n"))
    .join("\n\n");
}

/** Tomorrow in Singapore (the export's default day). */
export const tomorrowSgt = (now = new Date()): string => dayOfInstant(new Date(now.getTime() + 86_400_000));
