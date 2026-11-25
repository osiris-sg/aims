import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/common/prisma.service';
import { isCalendarAddEnabled } from '../deliveries/quick-jobs';
import { isOrgFeatureEnabled } from '../common/org-features';
import { NoteSave, TsvDetails, parseNoteSave } from './calendar-note-types';

export interface CalendarNoteView {
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
  /** Group calendar (parent org only): the note's org; foreign = a child org's note, read only. */
  orgId?: string;
  orgName?: string;
  foreign?: true;
  /** Calendar style (WCT group): who added the note (null = not recorded). Absent for every other org. */
  createdBy?: { id: string; name: string | null } | null;
  /** Technician Site Visit only (calendar-note-types.ts TsvDetails); absent on every other note. */
  details?: TsvDetails;
  /** Repeating notes (WCT group, 2026-11-25): the series line; the id of an occurrence is "<noteId>~<yyyyMMdd>". */
  repeat?: { seriesId: string; date: string; rrule: string; text: string; anchorDate: string; exception?: true };
}

const SELECT = { id: true, title: true, type: true, staffId: true, staffName: true, startDate: true, endDate: true, allDay: true, startTime: true, endTime: true, remark: true, details: true };

/** A row as the API sends it: `details` only when the note has them (every other note reads exactly as before). */
function viewOf(row: any): CalendarNoteView {
  const { details, ...rest } = row ?? {};
  return details ? { ...rest, details } : rest;
}

/**
 * WCT jobs calendar notes (2026-11-04, enableWctOrders + enableJobsCalendar):
 * leave, permit windows, blockages and the like, shown as bars on the
 * calendar. Not jobs: no SiteClock sync, no billing. Any office user with the
 * calendar (dashboard:read) can add, edit and delete them. Calendar style orgs
 * (2026-11-24) also have Site visit and Technician Site Visit notes; a TSV is
 * drawn like a job (jobs-calendar.service.ts, calendar-note-types.ts).
 */
@Injectable()
export class CalendarNotesService {
  constructor(private readonly prisma: PrismaService) {}

  /** CalendarNote with the `details` column (2026-11-24; typed loosely so a client generated before it still compiles). */
  private get db(): any {
    return this.prisma.calendarNote;
  }

  private async assertOn(organizationId: string) {
    if (!(await isCalendarAddEnabled(this.prisma, organizationId))) throw new NotFoundException('Calendar notes are not enabled for this organisation');
  }

  /** Notes overlapping from..to (yyyy-MM-dd, inclusive); [] when the feature is off (the calendar never fails on it). */
  async inRange(organizationId: string, from: string, to: string): Promise<CalendarNoteView[] | null> {
    if (!(await isCalendarAddEnabled(this.prisma, organizationId))) return null;
    const rows = await this.db.findMany({
      where: { organizationId, startDate: { lte: to }, endDate: { gte: from } },
      select: SELECT,
      orderBy: [{ startDate: 'asc' }, { title: 'asc' }],
    });
    return rows.map(viewOf);
  }

  /**
   * A note from a form. Calendar style orgs (enableCalendarStyle) also take Site visit and Technician Site Visit
   * (calendar-note-types.ts); since 2026-11-25 every type has the General fields.
   */
  private async parse(organizationId: string, body: any): Promise<NoteSave> {
    const styled = await isOrgFeatureEnabled(this.prisma, organizationId, 'enableCalendarStyle');
    return parseNoteSave(body, styled);
  }

  /** The columns to write. `details` (a TSV saved before 2026-11-25) is never written: it stays as stored, hidden. */
  private data(n: NoteSave) {
    const { details: _kept, ...rest } = n;
    return rest;
  }

  /** Calendar people list: who added each note (noteId -> userId; notes with none are left out). */
  async creators(organizationId: string, ids: string[]): Promise<Map<string, string>> {
    if (!ids.length) return new Map();
    const rows = await this.prisma.calendarNote.findMany({ where: { organizationId, id: { in: ids }, createdById: { not: null } }, select: { id: true, createdById: true } });
    return new Map(rows.map((r) => [r.id, r.createdById as string]));
  }

  /** Calendar people list: everyone who has added a note in the org. */
  async creatorIds(organizationId: string): Promise<string[]> {
    const rows = await this.prisma.calendarNote.findMany({ where: { organizationId, createdById: { not: null } }, select: { createdById: true }, distinct: ['createdById'] });
    return rows.map((r) => r.createdById as string);
  }

  async create(organizationId: string, userId: string | null, body: any): Promise<CalendarNoteView> {
    await this.assertOn(organizationId);
    const n = await this.parse(organizationId, body);
    return viewOf(await this.db.create({ data: { organizationId, ...this.data(n), createdById: userId }, select: SELECT }));
  }

  async update(organizationId: string, id: string, body: any): Promise<CalendarNoteView> {
    await this.assertOn(organizationId);
    const n = await this.parse(organizationId, body);
    const found = await this.prisma.calendarNote.findFirst({ where: { id, organizationId }, select: { id: true } });
    if (!found) throw new NotFoundException('Note not found');
    return viewOf(await this.db.update({ where: { id }, data: this.data(n), select: SELECT }));
  }

  async remove(organizationId: string, id: string): Promise<{ id: string; deleted: true }> {
    await this.assertOn(organizationId);
    const found = await this.prisma.calendarNote.findFirst({ where: { id, organizationId }, select: { id: true } });
    if (!found) throw new NotFoundException('Note not found');
    await this.prisma.calendarNote.delete({ where: { id } });
    return { id, deleted: true };
  }
}
