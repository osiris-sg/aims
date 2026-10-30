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
 *  - Every other SiteClock job is its own event.
 *  - An AIMS run's popup carries its DO number, the DO's Pending / Completed /
 *    Cancelled tag and the office DO page (WCT real DO numbers, 2026-10-30).
 */
import { DoStatusTag, doStatusTag } from '../deliveries/do-number';

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
  riderUserId: string | null;
  riderName: string | null;
  siteAddress: string | null;
  customerName: string | null;
  projectName: string | null;
  /** Any SERVICE line on the run (WCT service jobs). */
  service: boolean;
  /** The run's Delivery Order (the document its lines point at), if it has one. */
  deliveryOrder?: { id: string; name: string | null; status: string; templateId: string; cancelled: boolean } | null;
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
  const who = r.customerName || r.projectName || r.siteAddress || 'Delivery';
  return `${r.direction === 'RETURN' ? 'Return ' : ''}#${r.deliveryNumber} ${who}`;
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

export function buildCalendarEvents(runs: CalendarRun[], links: CalendarLink[], siteclockJobs: CalendarSiteClockJob[] | null): CalendarEvent[] {
  const linkBy = new Map(links.map((l) => [l.deliveryId, l]));
  const aimsJobs = new Map<string, CalendarSiteClockJob[]>();
  const events: CalendarEvent[] = [];

  for (const j of siteclockJobs ?? []) {
    const deliveryId = deliveryIdOfRef(j.externalRef);
    if (deliveryId) {
      // AIMS-created: merged onto the run below, never shown twice.
      const list = aimsJobs.get(deliveryId) ?? [];
      list.push(j);
      aimsJobs.set(deliveryId, list);
      continue;
    }
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
    const planned = (job?.crew.length ? job.crew.map((c) => c.name).join(', ') : null) ?? link?.workerName ?? null;
    events.push({
      id: `aims:${r.id}`,
      source: 'aims',
      kind: r.service ? 'service' : r.direction === 'RETURN' ? 'return' : 'delivery',
      title: runTitle(r),
      start: start.toISOString(),
      end: new Date(start.getTime() + minutes * 60_000).toISOString(),
      allDay: false,
      status: r.status,
      statusLabel: RUN_STATUS_LABEL[r.status] ?? r.status,
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
    });
  }

  return events.sort((a, b) => a.start.localeCompare(b.start) || a.title.localeCompare(b.title));
}
