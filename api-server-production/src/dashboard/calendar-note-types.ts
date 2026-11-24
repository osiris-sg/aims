import { BadRequestException } from '@nestjs/common';
import { CrewWorker, NoteInput, parseNote } from '../deliveries/quick-jobs';
import type { CalendarEvent } from './jobs-calendar';
import type { EventStyle } from './calendar-style';

/**
 * Note types (WCT group, calendar style orgs, 2026-11-24). The note's stored `type` keeps its meaning; calendar
 * style orgs get two more values next to the old ones:
 *
 *   General               = OTHER (the old "Other", renamed on the form; the default for a new note)
 *   Site visit            = SITE_VISIT (a plain note, like General; "Site visit" left the Job category list)
 *   Technician Site Visit = TECH_SITE_VISIT (drawn on the calendar like a job: time + title). 2026-11-25 (Elroy): the
 *                           same fields as General (title, staff, dates / times, remark). Notes saved before keep
 *                           their customer / shop / address / workers / team / salesperson in `details`, hidden
 *                           (never shown, never cleared by a save).
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

/**
 * What a note save stores: the note columns plus `details`. 2026-11-25: `details` is undefined for every save (the
 * column is left as stored: a TSV's old details stay, hidden); the old-type parse keeps null for its own callers.
 */
export type NoteSave = Omit<NoteInput, 'type'> & { type: string; details?: TsvDetails | null };

/**
 * A note from a form, any type. `styled` = the org has the calendar style (the only orgs with Site visit and
 * Technician Site Visit). The old types parse exactly as before (quick-jobs.ts parseNote).
 */
export function parseNoteSave(body: any, styled: boolean): NoteSave {
  const type = String(body?.type ?? '').trim().toUpperCase();
  const extra = (STYLED_NOTE_TYPES as readonly string[]).includes(type);
  if (extra && !styled) throw new BadRequestException('Type must be one of LEAVE, PTW, BLOCKAGE, OTHER');
  if (!extra) return { ...parseNote(body), details: null };
  // Site visit and (2026-11-25) Technician Site Visit: a General note's fields; `details` left as stored.
  return { ...parseNote({ ...body, type: 'OTHER' }), type };
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
export function tsvEvent(n: TsvNote, extra: { style?: EventStyle; createdBy?: { id: string; name: string | null } | null } = {}): TsvEvent {
  // 2026-11-25: a General note's fields: the card is time + title; old details (customer, shop, address, workers,
  // team, salesperson) are kept on the note but not shown.
  const name = String(n.title ?? '').trim() || TSV_LABEL;
  const timed = !n.allDay && !!n.startTime;
  const start = timed ? sgt(n.startDate, n.startTime!) : n.startDate;
  const lastDay = n.endDate && n.endDate > n.startDate ? n.endDate : n.startDate;
  const end = timed
    ? n.endTime
      ? sgt(lastDay, n.endTime)
      : new Date(Date.parse(start) + tsvDetailsOf(n.details).durationMin * 60_000).toISOString()
    : lastDay > n.startDate
      ? nextDay(lastDay)
      : null;
  return {
    id: `tsv:${n.id}`,
    source: 'aims',
    kind: 'service',
    title: name,
    start,
    end,
    allDay: !timed,
    status: 'site_visit',
    statusLabel: TSV_LABEL,
    completed: false,
    cancelled: false,
    address: null,
    site: null,
    worker: n.staffName?.trim() || null,
    rider: null,
    crew: [],
    href: null,
    siteclockUrl: null,
    deliveryNumber: null,
    doNumber: null,
    doTag: null,
    doHref: null,
    category: TSV_LABEL,
    customer: null,
    subject: null,
    remarks: n.remark?.trim() || null,
    team: null,
    ptwStatus: 'NOT_NEEDED',
    quotationStatus: null,
    postponed: false,
    cod: false,
    doCount: 0,
    salesperson: null,
    ptwApplicant: null,
    chipLabel: name,
    createdBy: extra.createdBy ?? n.createdBy ?? null,
    ...(extra.style ? { style: extra.style } : {}),
    noteId: n.id,
    noteKind: 'technician_site_visit',
    // The note for the side panel / note form; its old details are not sent (hidden).
    note: { id: n.id, title: n.title, type: n.type, staffId: n.staffId, staffName: n.staffName, startDate: n.startDate, endDate: n.endDate, allDay: n.allDay, startTime: n.startTime, endTime: n.endTime, remark: n.remark, ...(n.createdBy !== undefined ? { createdBy: n.createdBy } : {}) },
  };
}

const nextDay = (ymd: string) => new Date(Date.parse(`${ymd}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
