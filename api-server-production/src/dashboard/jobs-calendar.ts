/**
 * Jobs calendar (WCT 2026-10-30, flag enableJobsCalendar): the dashboard's
 * month / week / day calendar of scheduled deliveries, returns and service runs
 * from AIMS plus every job on the org's SiteClock company.
 *
 * Pure merge, no I/O (jobs-calendar.service.ts loads the rows). Rules:
 *  - AIMS runs: real schedules only (no drafts, no ad-hoc runs); cancelled runs
 *    come back flagged so the portal can hide them behind "Show cancelled".
 *  - A run linked to SiteClock lasts the link's duration, else 60 minutes; its
 *    worker is the SiteClock planned worker, and the AIMS rider once claimed.
 *  - SiteClock jobs AIMS created (externalRef "aims-delivery:…") never show on
 *    their own: their crew and arrive / leave times merge onto the AIMS event.
 *  - Every other SiteClock job is its own event, once (WCT shows it as a Misc
 *    job: no order; read only in AIMS, it opens in SiteClock).
 *  - An AIMS run's popup carries its DO number, the DO's Pending / Completed /
 *    Cancelled tag and the office DO page (WCT real DO numbers, 2026-10-30).
 *  - A job of a WCT order (enableWctOrders, 2026-11-01) leads its title with
 *    the order number and links the order page from the popup.
 */
import { DoStatusTag, doStatusTag } from '../deliveries/do-number';
import { VERIFICATION_LABEL } from '../deliveries/finish-modes';
import { deliveredLabel, runNoun } from '../deliveries/job-wording';
import { PTW_LABEL, PtwStatus, ptwShown } from '../deliveries/quick-jobs';
import { ymdIn } from '../deliveries/all-day';
import type { EventStyle } from './calendar-style';

export const CALENDAR_TZ = 'Asia/Singapore';
export const CALENDAR_MAX_DAYS = 62;
export const DEFAULT_RUN_MINUTES = 60;
const SGT_OFFSET_MS = 8 * 3600_000;

const AIMS_REF = 'aims-delivery:';

export interface CalendarRun {
  id: string;
  deliveryNumber: number;
  direction: 'OUTBOUND' | 'RETURN';
  status: string; // DeliveryRunStatus
  scheduledFor: Date;
  /** All-day job (2026-11-10): drawn as an all-day event on its day; scheduledFor is that day's 00:00. */
  scheduledAllDay?: boolean;
  riderUserId: string | null;
  riderName: string | null;
  siteAddress: string | null;
  customerName: string | null;
  projectName: string | null;
  /** Any SERVICE line on the run (WCT service jobs). */
  service: boolean;
  /** The run's Delivery Order (the document its lines point at), if it has one. */
  deliveryOrder?: { id: string; name: string | null; status: string; templateId: string; cancelled: boolean } | null;
  /** WCT orders: the order this job belongs to. */
  order?: { id: string; orderNumber: string } | null;
  /** WCT finish modes: the office check of a stamped-DO / paper finish. */
  verificationState?: string | null;
  /** Custom job fields (enableJobFields): the icons this run shows. */
  badges?: CalendarBadge[];
  /** WCT calendar add: permit-to-work state (null = not needed). */
  ptw?: { status: string; remark: string | null } | null;
  /** WCT calendar add: the job has no order yet. */
  untagged?: boolean;
  /** WCT calendar add: the job's quotation (its order's, else the quick job's own unsigned one). */
  quotation?: { id: string; name: string | null; type: string; templateId: string | null } | null;
  /** Job category (WCT group, deliveries/job-category.ts): blank reads as the default; absent elsewhere. */
  category?: string | null;
}

/** One custom job field's icon on an event (icon key, colour, "Permit approved: Yes"). */
export interface CalendarBadge {
  fieldId: string;
  label: string;
  icon: string;
  colour: string;
  text: string;
}

export interface CalendarLink {
  deliveryId: string;
  workerName: string | null;
  durationMin: number;
  externalRef: string;
}

export interface CalendarSiteClockJob {
  id: string;
  source: string;
  externalRef: string | null;
  externalStatus: string | null;
  title: string;
  location: string;
  description: string | null;
  allDay: boolean;
  startAt: string | null;
  endAt: string | null;
  date: string;
  site: { name: string; address: string | null };
  teams: { name: string }[];
  progress: string;
  crew: { name: string; arrivedAt: string | null; leftAt: string | null }[];
  cancelledAt: string | null;
  webUrl: string;
}

export type EventKind = 'delivery' | 'return' | 'service' | 'siteclock';

export interface CalendarCrew {
  name: string;
  arrivedAt: string | null;
  leftAt: string | null;
}

export interface CalendarEvent {
  id: string;
  source: 'aims' | 'siteclock';
  kind: EventKind;
  title: string;
  start: string; // ISO instant, or yyyy-MM-dd when allDay
  end: string | null;
  allDay: boolean;
  /** AIMS: the run status; SiteClock: NOT_STARTED | IN_PROGRESS | DONE. */
  status: string;
  statusLabel: string;
  completed: boolean;
  cancelled: boolean;
  address: string | null;
  site: string | null;
  /** SiteClock planned worker (AIMS runs) or the job's teams (SiteClock jobs). */
  worker: string | null;
  rider: string | null;
  crew: CalendarCrew[];
  /** AIMS delivery page (portal path) or null. */
  href: string | null;
  /** "Open in SiteClock" (SiteClock jobs only). */
  siteclockUrl: string | null;
  deliveryNumber: number | null;
  /** AIMS runs with a DO: its number, its Pending / Completed / Cancelled tag and the office DO page. */
  doNumber: string | null;
  doTag: DoStatusTag | null;
  doHref: string | null;
  /** WCT orders: the job's order number and the order page. */
  orderNumber?: string | null;
  orderHref?: string | null;
  /** WCT finish modes: "Awaiting verification" / "Verified" / "Rejected" for a checked job. */
  verificationLabel?: string | null;
  /** Custom job fields (enableJobFields): the icons drawn on the event. */
  badges?: CalendarBadge[];
  /** WCT calendar add: PTW badge (only when not "Not needed") and the "Untagged" mark. */
  ptw?: { status: string; label: string; remark: string | null };
  untagged?: boolean;
  /** WCT calendar add: the job's quotation number and its document page (absent for every other org). */
  quotationNumber?: string | null;
  quotationHref?: string | null;
  /** Job category (WCT group): shown in the panel and the chip tooltip (absent for every other org). */
  category?: string | null;
  /** Group calendar (enableGroupCalendar, parent org only): the org the item belongs to (absent otherwise). */
  orgId?: string;
  orgName?: string;
  /** Group calendar: the item is a child org's. */
  foreign?: true;
  /** Group calendar: a child org's item the viewer is not a member of; its links are stripped. */
  viewOnly?: true;
  /** Calendar style (enableCalendarStyle, WCT group; absent for every other org): fill, PTW bar, icons, greyed. */
  style?: EventStyle;
  /** Calendar style: the job's salesperson (own pick, else its quotation's salesman) and PTW applicant. */
  salesperson?: { id: string; name: string | null } | null;
  ptwApplicant?: { id: string; name: string | null; inList?: false } | null;
  /** Calendar style: COD job, postponed (on hold), live DOs on the job. */
  cod?: boolean;
  postponed?: boolean;
  doCount?: number;
  /** Calendar style: "Generate sticker" ticked (📌). */
  sticker?: boolean;
  /**
   * Calendar style (2026-11-19): the chip's short text, the customer name only (no order or job number); no
   * customer = the site address; neither = the title. The tooltip and side panel keep the full title.
   */
  chipLabel?: string;
  /** Calendar style: who made the job (null = not recorded: made before 19 Nov 2026, or by the system). */
  createdBy?: { id: string; name: string | null } | null;
  /**
   * Calendar style panel and WhatsApp list (2026-11-20): the customer's name, the quotation's Subject, the job's
   * Remarks, its "Team / crew", its stored PTW status (NOT_NEEDED when none, for the panel's pills), the quotation's
   * status, and calendarCancelled = cancelled from the calendar panel (Undo offered).
   */
  customer?: string | null;
  subject?: string | null;
  remarks?: string | null;
  team?: string | null;
  ptwStatus?: string;
  quotationStatus?: string | null;
  calendarCancelled?: true;
  /** Shop name (2026-11-24, calendar style): the name shown instead of the customer when filled. */
  shopName?: string;
  /** Postpone keeps the old event (2026-11-24): the other job of the pair and its date; recordOnly = the old one. */
  postponedTo?: { id: string; date: string };
  postponedFrom?: { id: string; date: string };
  recordOnly?: true;
}

/** Group calendar: an item of another org the viewer may not open loses every link (numbers and details stay). */
export function stripLinks<T extends Partial<CalendarEvent>>(e: T): T {
  const out: any = { ...e, href: null, siteclockUrl: null, doHref: null };
  if ('orderHref' in e) out.orderHref = null;
  if ('quotationHref' in e) out.quotationHref = null;
  return out;
}

/** The quotation row of a WCT job's panel: number + the quotation's document page (null without a template). */
export function quotationFields(q: CalendarRun['quotation']): Pick<CalendarEvent, 'quotationNumber' | 'quotationHref'> | null {
  if (!q) return null;
  return { quotationNumber: q.name, quotationHref: q.templateId ? `/portal/documents/${q.type || 'QUOTATION'}/${q.templateId}/${q.id}` : null };
}

/** The DO block of a run's popup: number, tag (from the DO itself) and the office DO page. */
function doFields(d: CalendarRun['deliveryOrder']): Pick<CalendarEvent, 'doNumber' | 'doTag' | 'doHref'> {
  if (!d) return { doNumber: null, doTag: null, doHref: null };
  return {
    doNumber: d.name,
    doTag: doStatusTag({ status: d.status, config: { cancelled: d.cancelled } }),
    doHref: `/portal/documents/DELIVERY_ORDER/${d.templateId}/${d.id}`,
  };
}

const RUN_STATUS_LABEL: Record<string, string> = {
  scheduled: 'Scheduled',
  in_progress: 'In progress',
  delivered: 'Delivered',
  completed: 'Completed',
  cancelled: 'Cancelled',
};
const SC_STATUS_LABEL: Record<string, string> = { NOT_STARTED: 'Not started', IN_PROGRESS: 'In progress', DONE: 'Done' };

/** yyyy-MM-dd → that day's start in Singapore, as an instant. */
export function sgtDayStart(date: string): Date {
  return new Date(Date.parse(`${date}T00:00:00Z`) - SGT_OFFSET_MS);
}

const addDaysIso = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** Validates a from..to day range (inclusive, at most 62 days). Returns an error message or null. */
export function checkRange(from: unknown, to: unknown): string | null {
  const re = /^\d{4}-\d{2}-\d{2}$/;
  if (typeof from !== 'string' || typeof to !== 'string' || !re.test(from) || !re.test(to)) return 'from and to are required as yyyy-MM-dd';
  if (Number.isNaN(Date.parse(`${from}T00:00:00Z`)) || Number.isNaN(Date.parse(`${to}T00:00:00Z`))) return 'Invalid date';
  if (addDaysIso(from, 0) !== from || addDaysIso(to, 0) !== to) return 'Invalid date';
  if (to < from) return 'to must be on or after from';
  if (to > addDaysIso(from, CALENDAR_MAX_DAYS - 1)) return `At most ${CALENDAR_MAX_DAYS} days at a time`;
  return null;
}

/** The query window for AIMS runs: from 00:00 to the day after `to`, Singapore time. */
export function rangeInstants(from: string, to: string): { gte: Date; lt: Date } {
  return { gte: sgtDayStart(from), lt: sgtDayStart(addDaysIso(to, 1)) };
}

/** The delivery id inside an AIMS ref: "aims-delivery:<id>" or "aims-delivery:<id>:<generation>". */
export function deliveryIdOfRef(ref: string | null | undefined): string | null {
  if (!ref || !ref.startsWith(AIMS_REF)) return null;
  return ref.slice(AIMS_REF.length).split(':')[0] || null;
}

const crewOf = (j: CalendarSiteClockJob): CalendarCrew[] => j.crew.map((c) => ({ name: c.name, arrivedAt: c.arrivedAt, leftAt: c.leftAt }));

function runTitle(r: CalendarRun) {
  const who = r.customerName || r.projectName || r.siteAddress || runNoun(r);
  return `${r.order?.orderNumber ? `${r.order.orderNumber} · ` : ''}${r.direction === 'RETURN' ? 'Return ' : ''}#${r.deliveryNumber} ${who}`;
}

/**
 * The SiteClock job AIMS made for a run: the link's current ref first, else the
 * newest live one for that delivery (an older generation is a cancelled one).
 */
function pickAimsJob(jobs: CalendarSiteClockJob[], link: CalendarLink | undefined) {
  if (!jobs.length) return null;
  if (link) {
    const exact = jobs.find((j) => j.externalRef === link.externalRef);
    if (exact) return exact;
  }
  return jobs.find((j) => !j.cancelledAt && j.externalStatus !== 'CANCELLED') ?? null;
}

/**
 * opts.aimsOnly (hideSiteClockJobs): SiteClock-created jobs (no "aims-delivery:" ref) are left out;
 * jobs AIMS pushed to SiteClock still merge their crew onto the AIMS event.
 */
export function buildCalendarEvents(
  runs: CalendarRun[],
  links: CalendarLink[],
  siteclockJobs: CalendarSiteClockJob[] | null,
  opts: { aimsOnly?: boolean } = {},
): CalendarEvent[] {
  const linkBy = new Map(links.map((l) => [l.deliveryId, l]));
  const aimsJobs = new Map<string, CalendarSiteClockJob[]>();
  const events: CalendarEvent[] = [];

  const seenSc = new Set<string>();
  for (const j of siteclockJobs ?? []) {
    // Each SiteClock job once, however often SiteClock lists it (2026-11-16).
    if (seenSc.has(j.id)) continue;
    seenSc.add(j.id);
    const deliveryId = deliveryIdOfRef(j.externalRef);
    if (deliveryId) {
      // AIMS-created: merged onto the run below, never shown twice.
      const list = aimsJobs.get(deliveryId) ?? [];
      list.push(j);
      aimsJobs.set(deliveryId, list);
      continue;
    }
    if (opts.aimsOnly) continue;
    const done = j.progress === 'DONE';
    const cancelled = !!j.cancelledAt || j.externalStatus === 'CANCELLED';
    events.push({
      id: `sc:${j.id}`,
      source: 'siteclock',
      kind: 'siteclock',
      title: j.title,
      start: j.allDay || !j.startAt ? j.date : j.startAt,
      end: j.allDay || !j.endAt ? null : j.endAt,
      allDay: j.allDay || !j.startAt,
      status: cancelled ? 'CANCELLED' : j.progress,
      statusLabel: cancelled ? 'Cancelled' : SC_STATUS_LABEL[j.progress] ?? j.progress,
      completed: done && !cancelled,
      cancelled,
      address: j.site.address,
      site: j.site.name || j.location || null,
      worker: j.teams.length ? j.teams.map((t) => t.name).join(', ') : null,
      rider: null,
      crew: crewOf(j),
      href: null,
      siteclockUrl: j.webUrl,
      deliveryNumber: null,
      doNumber: null,
      doTag: null,
      doHref: null,
    });
  }

  for (const r of runs) {
    const link = linkBy.get(r.id);
    const job = pickAimsJob(aimsJobs.get(r.id) ?? [], link);
    const minutes = link?.durationMin && link.durationMin > 0 ? link.durationMin : DEFAULT_RUN_MINUTES;
    const start = r.scheduledFor;
    // All-day (2026-11-10): the day only, at the top of that day like a SiteClock all-day job.
    const allDay = !!r.scheduledAllDay;
    const planned = (job?.crew.length ? job.crew.map((c) => c.name).join(', ') : null) ?? link?.workerName ?? null;
    events.push({
      id: `aims:${r.id}`,
      source: 'aims',
      kind: r.service ? 'service' : r.direction === 'RETURN' ? 'return' : 'delivery',
      title: runTitle(r),
      start: allDay ? ymdIn(start, 'Asia/Singapore') : start.toISOString(),
      end: allDay ? null : new Date(start.getTime() + minutes * 60_000).toISOString(),
      allDay,
      status: r.status,
      // A WCT order job reads "Done", not "Delivered" (deliveries/job-wording.ts).
      statusLabel: r.status === 'delivered' ? deliveredLabel(runNoun(r) === 'Job') : (RUN_STATUS_LABEL[r.status] ?? r.status),
      completed: r.status === 'completed',
      cancelled: r.status === 'cancelled',
      address: r.siteAddress,
      site: r.customerName || r.projectName || null,
      worker: planned,
      // The rider shows once someone has claimed the run in the field app.
      rider: r.riderUserId ? r.riderName || null : null,
      crew: job ? crewOf(job) : [],
      href: `/portal/deliveries/${r.id}`,
      siteclockUrl: null,
      deliveryNumber: r.deliveryNumber,
      ...doFields(r.deliveryOrder),
      ...(r.order ? { orderNumber: r.order.orderNumber, orderHref: `/portal/orders/${r.order.id}` } : {}),
      ...(r.verificationState && VERIFICATION_LABEL[r.verificationState as keyof typeof VERIFICATION_LABEL]
        ? { verificationLabel: VERIFICATION_LABEL[r.verificationState as keyof typeof VERIFICATION_LABEL] }
        : {}),
      ...(r.badges?.length ? { badges: r.badges } : {}),
      ...(r.ptw && ptwShown(r.ptw.status) ? { ptw: { status: r.ptw.status, label: PTW_LABEL[r.ptw.status as PtwStatus] ?? r.ptw.status, remark: r.ptw.remark } } : {}),
      ...(r.untagged ? { untagged: true } : {}),
      ...(quotationFields(r.quotation) ?? {}),
      ...(r.category ? { category: r.category } : {}),
    });
  }

  return events.sort((a, b) => a.start.localeCompare(b.start) || a.title.localeCompare(b.title));
}

/** Calendar style chip text (2026-11-19): customer, else site address, else the title. */
export function chipLabelOf(run: { customerName?: string | null; siteAddress?: string | null } | null | undefined, title: string): string {
  const c = String(run?.customerName ?? '').trim();
  if (c) return c;
  const a = String(run?.siteAddress ?? '').trim();
  return a || titleWithoutNumbers(title);
}

/**
 * The title fallback without order / job numbers (2026-11-19): "ORD202611-003 · #41 Domino's" and "#41 Domino's"
 * read "Domino's" ("Return #7 X" keeps "Return X"). A title that is only numbers stays as it is.
 */
export function titleWithoutNumbers(title: string): string {
  const t = String(title ?? '')
    .replace(/^\s*ORD[\w-]*\s*·\s*/i, '')
    .replace(/^(Return\s+)?#\d+\s+/i, (_m, r) => r ?? '')
    .trim();
  return t || title;
}

/** A public holiday on the jobs calendar (calendar style orgs, 2026-11-24). */
export interface CalendarHoliday {
  date: string;
  name: string;
}

/**
 * Public holidays for the jobs calendar (calendar style orgs, 2026-11-24), read from the Field module's public
 * holidays table (FieldPublicHoliday). Rows of several orgs (the group's) become one list: in [from, to], one per
 * date (the first org's name wins), by date.
 */
export function holidaysInRange(rows: Array<{ date?: unknown; name?: unknown }>, from: string, to: string): CalendarHoliday[] {
  // One per holiday per day (date + name, any case), whichever companies' lists carry it (2026-11-24).
  const out = new Map<string, CalendarHoliday>();
  for (const r of rows) {
    const date = typeof r?.date === 'string' ? r.date.trim().slice(0, 10) : '';
    const name = typeof r?.name === 'string' ? r.name.replace(/\s+/g, ' ').trim() : '';
    const key = `${date}|${name.toLowerCase()}`;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !name || date < from || date > to || out.has(key)) continue;
    out.set(key, { date, name });
  }
  return [...out.values()].sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
}
