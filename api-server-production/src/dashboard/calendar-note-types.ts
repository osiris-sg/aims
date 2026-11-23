import { BadRequestException } from '@nestjs/common';
import { CrewWorker, NoteInput, parseNote, parseWorkers } from '../deliveries/quick-jobs';
import type { CalendarEvent } from './jobs-calendar';
import type { EventStyle } from './calendar-style';

/**
 * Note types (WCT group, calendar style orgs, 2026-11-24). The note's stored `type` keeps its meaning; calendar
 * style orgs get two more values next to the old ones:
 *
 *   General               = OTHER (the old "Other", renamed on the form; the default for a new note)
 *   Site visit            = SITE_VISIT (a plain note, like General; "Site visit" left the Job category list)
 *   Technician Site Visit = TECH_SITE_VISIT (customer / shop, address, time, duration, workers, team, salesperson,
 *                           remarks in `details`; drawn on the calendar exactly like a job)
 *   Leave, PTW, Blockage  = LEAVE, PTW, BLOCKAGE (unchanged, still selectable)
 *
 * Every other org keeps LEAVE | PTW | BLOCKAGE | OTHER only (the new values are refused).
 */
export const SITE_VISIT_NOTE = 'SITE_VISIT';
export const TSV_NOTE = 'TECH_SITE_VISIT';
export const STYLED_NOTE_TYPES = [SITE_VISIT_NOTE, TSV_NOTE] as const;
export const TSV_LABEL = 'Technician Site Visit';

export const isTsv = (n: { type?: string | null } | null | undefined): boolean => n?.type === TSV_NOTE;

export interface TsvDetails {
  customerId: string | null;
  customerName: string | null;
  shopName: string | null;
  address: string | null;
  /** Minutes (the job form's Duration); the note's endTime is start + this, kept within the day. */
  durationMin: number;
  workers: CrewWorker[];
  team: string | null;
  salesperson: { id: string; name: string | null } | null;
}

/** What a note save stores: the note columns plus `details` (null for every type but TSV). */
export type NoteSave = Omit<NoteInput, 'type'> & { type: string; details: TsvDetails | null };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const str = (v: unknown, max: number): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);

/** "09:00" + 90 → "10:30"; past midnight stays at "23:59" (a note is one day). */
export function addMinutes(hhmm: string, minutes: number): string {
  const [h, m] = hhmm.split(':').map(Number);
  const t = Math.min(h * 60 + m + minutes, 23 * 60 + 59);
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}

/** The TSV fields from a form (customer name is filled by the service from the picked customer). */
export function parseTsvDetails(body: any): TsvDetails {
  const customerId = str(body?.customerId, 64);
  if (customerId && !UUID_RE.test(customerId)) throw new BadRequestException('Pick the customer from the list');
  const shopName = str(body?.shopName, 120);
  if (!customerId && !shopName) throw new BadRequestException('Pick a customer or type a shop name');
  const d = Number(body?.durationMin ?? 60);
  if (!Number.isInteger(d) || d < 15 || d > 1440) throw new BadRequestException('Duration must be between 15 minutes and 24 hours');
  const team = str(body?.team, 200);
  const sp = body?.salesperson;
  const spId = str(sp?.id, 100);
  return {
    customerId,
    customerName: str(body?.customerName, 200),
    shopName,
    address: str(body?.siteAddress ?? body?.address, 500),
    durationMin: d,
    workers: parseWorkers(body?.workers),
    team,
    salesperson: spId ? { id: spId, name: str(sp?.name, 120) } : null,
  };
}

/** A TSV note's title: the shop name, else the customer, else "Technician Site Visit". */
export const tsvTitle = (d: Pick<TsvDetails, 'shopName' | 'customerName'>): string => (d.shopName || d.customerName || TSV_LABEL).slice(0, 120);

/**
 * A note from a form, any type. `styled` = the org has the calendar style (the only orgs with Site visit and
 * Technician Site Visit). The old types parse exactly as before (quick-jobs.ts parseNote).
 */
export function parseNoteSave(body: any, styled: boolean): NoteSave {
  const type = String(body?.type ?? '').trim().toUpperCase();
  const extra = (STYLED_NOTE_TYPES as readonly string[]).includes(type);
  if (extra && !styled) throw new BadRequestException('Type must be one of LEAVE, PTW, BLOCKAGE, OTHER');
  if (!extra) return { ...parseNote(body), details: null };
  if (type !== TSV_NOTE) return { ...parseNote({ ...body, type: 'OTHER' }), type, details: null };
  // Technician Site Visit: one day; a time + duration, or all day.
  const details = parseTsvDetails(body);
  const allDay = body?.allDay === true;
  const startTime = allDay ? null : String(body?.startTime ?? '');
  if (!allDay && !TIME_RE.test(startTime!)) throw new BadRequestException('Pick a time');
  const endTime = allDay ? null : addMinutes(startTime!, details.durationMin);
  if (!allDay && endTime! <= startTime!) throw new BadRequestException('Pick an earlier time');
  const base = parseNote({
    ...body,
    type: 'OTHER',
    title: tsvTitle(details),
    endDate: body?.startDate,
    allDay,
    ...(allDay ? {} : { startTime, endTime }),
    // Workers: the first is the note's staff (search, older readers); all of them are in details.
    staffId: details.workers[0]?.id ?? null,
    staffName: details.workers.map((w) => w.name).join(', ').slice(0, 120) || null,
  });
  return { ...base, type: TSV_NOTE, details };
}

/** details as stored (anything malformed reads as empty). */
export function tsvDetailsOf(raw: unknown): TsvDetails {
  const d: any = raw && typeof raw === 'object' ? raw : {};
  const sp = d.salesperson && typeof d.salesperson.id === 'string' ? { id: d.salesperson.id, name: typeof d.salesperson.name === 'string' ? d.salesperson.name : null } : null;
  return {
    customerId: typeof d.customerId === 'string' ? d.customerId : null,
    customerName: typeof d.customerName === 'string' ? d.customerName : null,
    shopName: typeof d.shopName === 'string' ? d.shopName : null,
    address: typeof d.address === 'string' ? d.address : null,
    durationMin: Number.isInteger(d.durationMin) && d.durationMin > 0 ? d.durationMin : 60,
    workers: Array.isArray(d.workers) ? d.workers.filter((w: any) => w && typeof w.id === 'string' && typeof w.name === 'string').map((w: any) => ({ id: w.id, name: w.name })) : [],
    team: typeof d.team === 'string' ? d.team : null,
    salesperson: sp,
  };
}

/** The note as the TSV event carries it (opened in the Note dialog on click). */
export interface TsvNote {
  id: string;
  title: string;
  type: string;
  staffId: string | null;
  staffName: string | null;
  startDate: string;
  endDate: string;
  allDay: boolean;
  startTime: string | null;
  endTime: string | null;
  remark: string | null;
  details?: unknown;
  createdBy?: { id: string; name: string | null } | null;
}

/** A Technician Site Visit on the calendar: a job's event plus the note it came from. */
export type TsvEvent = CalendarEvent & { noteId: string; noteKind: 'technician_site_visit'; note: TsvNote };

/** A Singapore date + time as an ISO instant. */
const sgt = (date: string, time: string) => new Date(`${date}T${time}:00+08:00`).toISOString();

/**
 * A TSV note as a calendar event, shaped like an AIMS job (source 'aims', so the chip, hover, Schedule row and
 * Export list treat it as one). No links, no PTW, no DO; never draggable (status is not 'scheduled').
 */
export function tsvEvent(n: TsvNote, extra: { style?: EventStyle; createdBy?: { id: string; name: string | null } | null; salesperson?: { id: string; name: string | null } | null } = {}): TsvEvent {
  const d = tsvDetailsOf(n.details);
  const name = d.shopName || d.customerName || TSV_LABEL;
  const timed = !n.allDay && !!n.startTime;
  const start = timed ? sgt(n.startDate, n.startTime!) : n.startDate;
  const end = timed ? new Date(Date.parse(start) + d.durationMin * 60_000).toISOString() : null;
  const workers = d.workers.map((w) => w.name).join(', ') || null;
  return {
    id: `tsv:${n.id}`,
    source: 'aims',
    kind: 'service',
    title: `${name} (${TSV_LABEL})`,
    start,
    end,
    allDay: !timed,
    status: 'site_visit',
    statusLabel: TSV_LABEL,
    completed: false,
    cancelled: false,
    address: d.address,
    site: d.customerName,
    worker: workers,
    rider: null,
    crew: d.workers.map((w) => ({ name: w.name, arrivedAt: null, leftAt: null })),
    href: null,
    siteclockUrl: null,
    deliveryNumber: null,
    doNumber: null,
    doTag: null,
    doHref: null,
    category: TSV_LABEL,
    customer: d.customerName,
    subject: null,
    remarks: n.remark?.trim() || null,
    team: d.team,
    ptwStatus: 'NOT_NEEDED',
    quotationStatus: null,
    postponed: false,
    cod: false,
    doCount: 0,
    salesperson: extra.salesperson !== undefined ? extra.salesperson : d.salesperson,
    ptwApplicant: null,
    chipLabel: name,
    ...(d.shopName ? { shopName: d.shopName } : {}),
    createdBy: extra.createdBy ?? n.createdBy ?? null,
    ...(extra.style ? { style: extra.style } : {}),
    noteId: n.id,
    noteKind: 'technician_site_visit',
    note: { ...n, details: d },
  };
}
