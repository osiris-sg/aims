/**
 * WCT jobs calendar add (2026-11-04, flags enableWctOrders + enableJobsCalendar).
 *
 *  - QUICK JOB: a scheduled job made from an empty calendar slot with no
 *    quotation (customer, site, date and time, workers, remarks, PTW). It has
 *    no order ("Untagged"), no lines and NO Delivery Order, so it never takes a
 *    DO number: a DO is made only once the job is linked to an order and has
 *    lines, through the normal schedule path and its counter. It syncs to
 *    SiteClock like any job: the first worker is the assignee, the others are
 *    listed in the job's notes (SiteClock takes one assignee).
 *  - LINK: "Link to…" a quotation, order, invoice or DO puts the job under
 *    that order. A quotation with no order yet gets its order WITHOUT the
 *    automatic first job: this job becomes the first one.
 *  - PTW: permit-to-work state on any WCT job, replacing the "Permit required /
 *    approved" job fields.
 *  - NOTES: calendar entries that are not jobs (CalendarNote).
 *
 * Pure helpers (plus the flag check at the end).
 */
import { BadRequestException } from '@nestjs/common';
import { isOrgFeatureEnabled } from '../common/org-features';

export const PTW_STATUSES = ['NOT_NEEDED', 'REQUIRED', 'SUBMITTED', 'APPROVED'] as const;
export type PtwStatus = (typeof PTW_STATUSES)[number];

export const PTW_LABEL: Record<PtwStatus, string> = {
  NOT_NEEDED: 'Not needed',
  REQUIRED: 'Required',
  SUBMITTED: 'Submitted',
  APPROVED: 'Approved',
};

export const NOTE_TYPES = ['LEAVE', 'PTW', 'BLOCKAGE', 'OTHER'] as const;
export type NoteType = (typeof NOTE_TYPES)[number];

export const LINK_KINDS = ['quotation', 'order', 'invoice', 'do'] as const;
export type LinkKind = (typeof LINK_KINDS)[number];

export type CrewWorker = { id: string; name: string };

const PTW_REMARK_MAX = 300;

/** A PTW status from a form (null / '' / NOT_NEEDED all mean "not needed"); throws on anything else. */
export function parsePtwStatus(v: unknown): PtwStatus | null {
  if (v === undefined || v === null || v === '') return null;
  const s = String(v).trim().toUpperCase();
  if (!(PTW_STATUSES as readonly string[]).includes(s)) throw new BadRequestException(`PTW status must be one of ${PTW_STATUSES.join(', ')}`);
  return s === 'NOT_NEEDED' ? null : (s as PtwStatus);
}

export function parsePtwRemark(v: unknown): string | null {
  const s = typeof v === 'string' ? v.trim() : '';
  if (s.length > PTW_REMARK_MAX) throw new BadRequestException(`The PTW remark is limited to ${PTW_REMARK_MAX} characters`);
  return s || null;
}

/** Does this PTW state show a badge? (anything but not needed) */
export const ptwShown = (status: string | null | undefined): boolean => !!status && status !== 'NOT_NEEDED';

/** The workers a form sent, de-duplicated by id, in order: [assignee, ...crew]. */
export function parseWorkers(v: unknown): CrewWorker[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw new BadRequestException('workers must be a list');
  const out: CrewWorker[] = [];
  for (const w of v) {
    const id = typeof w?.id === 'string' ? w.id.trim() : '';
    if (!id) throw new BadRequestException('Each worker needs an id');
    if (out.some((o) => o.id === id)) continue;
    out.push({ id, name: typeof w?.name === 'string' && w.name.trim() ? w.name.trim().slice(0, 120) : id });
  }
  if (out.length > 20) throw new BadRequestException('At most 20 workers on a job');
  return out;
}

/** Delivery.crewWorkers as stored (anything malformed reads as none). */
export function crewOf(v: unknown): CrewWorker[] {
  if (!Array.isArray(v)) return [];
  return v.filter((w: any) => w && typeof w.id === 'string' && typeof w.name === 'string').map((w: any) => ({ id: w.id, name: w.name }));
}

/**
 * The extra lines a SiteClock job's notes carry: the PTW state and the other
 * workers. Empty when there is neither, so a job without them syncs exactly as
 * before.
 */
export function siteclockExtraNotes(ptwStatus: string | null | undefined, ptwRemark: string | null | undefined, crew: CrewWorker[]): string[] {
  const lines: string[] = [];
  if (ptwShown(ptwStatus)) {
    const label = PTW_LABEL[ptwStatus as PtwStatus] ?? String(ptwStatus);
    lines.push(`PTW: ${label}${ptwRemark?.trim() ? ` (${ptwRemark.trim()})` : ''}`);
  }
  if (crew.length) lines.push(`Also on this job: ${crew.map((c) => c.name).join(', ')}`);
  return lines;
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export interface NoteInput {
  title: string;
  type: NoteType;
  staffId: string | null;
  staffName: string | null;
  startDate: string;
  endDate: string;
  allDay: boolean;
  startTime: string | null;
  endTime: string | null;
  remark: string | null;
}

const validDay = (d: string) => DAY_RE.test(d) && new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d;

/** A calendar note from a form; throws a 400 with a plain message on anything wrong. */
export function parseNote(body: any): NoteInput {
  const title = typeof body?.title === 'string' ? body.title.trim() : '';
  if (!title) throw new BadRequestException('A note needs a title');
  if (title.length > 120) throw new BadRequestException('The title is limited to 120 characters');
  const type = String(body?.type ?? '').trim().toUpperCase();
  if (!(NOTE_TYPES as readonly string[]).includes(type)) throw new BadRequestException(`Type must be one of ${NOTE_TYPES.join(', ')}`);
  const startDate = String(body?.startDate ?? '');
  const endDate = String(body?.endDate ?? '') || startDate;
  if (!validDay(startDate) || !validDay(endDate)) throw new BadRequestException('Start and end dates are required as yyyy-MM-dd');
  if (endDate < startDate) throw new BadRequestException('The end date is before the start date');
  if (Date.parse(endDate) - Date.parse(startDate) > 366 * 86_400_000) throw new BadRequestException('A note can span at most a year');
  const allDay = body?.allDay !== false;
  let startTime: string | null = null;
  let endTime: string | null = null;
  if (!allDay) {
    startTime = String(body?.startTime ?? '');
    endTime = String(body?.endTime ?? '');
    if (!TIME_RE.test(startTime) || !TIME_RE.test(endTime)) throw new BadRequestException('Start and end times are required as HH:mm');
    if (endTime <= startTime) throw new BadRequestException('The end time is before the start time');
  }
  const remark = typeof body?.remark === 'string' && body.remark.trim() ? body.remark.trim() : null;
  if (remark && remark.length > 1000) throw new BadRequestException('The remark is limited to 1000 characters');
  const staffId = typeof body?.staffId === 'string' && body.staffId.trim() ? body.staffId.trim() : null;
  const staffName = typeof body?.staffName === 'string' && body.staffName.trim() ? body.staffName.trim().slice(0, 120) : null;
  return { title, type: type as NoteType, staffId, staffName, startDate, endDate, allDay, startTime, endTime, remark };
}

export function parseLinkKind(v: unknown): LinkKind {
  const k = String(v ?? '').trim().toLowerCase();
  if (!(LINK_KINDS as readonly string[]).includes(k)) throw new BadRequestException(`Link to one of: ${LINK_KINDS.join(', ')}`);
  return k as LinkKind;
}

/** Calendar add (quick jobs, notes, link, PTW) is on for orgs with BOTH WCT orders and the jobs calendar. */
export async function isCalendarAddEnabled(prisma: any, organizationId: string): Promise<boolean> {
  const [orders, calendar] = await Promise.all([
    isOrgFeatureEnabled(prisma, organizationId, 'enableWctOrders'),
    isOrgFeatureEnabled(prisma, organizationId, 'enableJobsCalendar'),
  ]);
  return orders && calendar;
}
