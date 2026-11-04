import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/common/prisma.service';
import { isCalendarAddEnabled, parseNote } from '../deliveries/quick-jobs';

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
}

const SELECT = { id: true, title: true, type: true, staffId: true, staffName: true, startDate: true, endDate: true, allDay: true, startTime: true, endTime: true, remark: true };

/**
 * WCT jobs calendar notes (2026-11-04, enableWctOrders + enableJobsCalendar):
 * leave, permit windows, blockages and the like, shown as bars on the
 * calendar. Not jobs: no SiteClock sync, no billing. Any office user with the
 * calendar (dashboard:read) can add, edit and delete them.
 */
@Injectable()
export class CalendarNotesService {
  constructor(private readonly prisma: PrismaService) {}

  private async assertOn(organizationId: string) {
    if (!(await isCalendarAddEnabled(this.prisma, organizationId))) throw new NotFoundException('Calendar notes are not enabled for this organisation');
  }

  /** Notes overlapping from..to (yyyy-MM-dd, inclusive); [] when the feature is off (the calendar never fails on it). */
  async inRange(organizationId: string, from: string, to: string): Promise<CalendarNoteView[] | null> {
    if (!(await isCalendarAddEnabled(this.prisma, organizationId))) return null;
    return this.prisma.calendarNote.findMany({
      where: { organizationId, startDate: { lte: to }, endDate: { gte: from } },
      select: SELECT,
      orderBy: [{ startDate: 'asc' }, { title: 'asc' }],
    });
  }

  async create(organizationId: string, userId: string | null, body: any): Promise<CalendarNoteView> {
    await this.assertOn(organizationId);
    const n = parseNote(body);
    return this.prisma.calendarNote.create({ data: { organizationId, ...n, createdById: userId }, select: SELECT });
  }

  async update(organizationId: string, id: string, body: any): Promise<CalendarNoteView> {
    await this.assertOn(organizationId);
    const n = parseNote(body);
    const found = await this.prisma.calendarNote.findFirst({ where: { id, organizationId }, select: { id: true } });
    if (!found) throw new NotFoundException('Note not found');
    return this.prisma.calendarNote.update({ where: { id }, data: n, select: SELECT });
  }

  async remove(organizationId: string, id: string): Promise<{ id: string; deleted: true }> {
    await this.assertOn(organizationId);
    const found = await this.prisma.calendarNote.findFirst({ where: { id, organizationId }, select: { id: true } });
    if (!found) throw new NotFoundException('Note not found');
    await this.prisma.calendarNote.delete({ where: { id } });
    return { id, deleted: true };
  }
}
