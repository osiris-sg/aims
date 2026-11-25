import { BadRequestException, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from 'src/common/prisma.service';
import { runAsOrg } from '../common/tenancy/tenant-context';
import { isCalendarAddEnabled } from '../deliveries/quick-jobs';
import { isCalendarStyleEnabled } from '../deliveries/job-style';
import { SiteClockLinkService } from '../siteclock/siteclock-link.service';
import { addDays, daysBetween, endBefore, isYmd, occurrences, parseRule, ruleText, splitRule } from './recurrence';

/**
 * Repeating jobs and notes (WCT group, 2026-11-25; enableCalendarStyle + the calendar add flags). Google Calendar's
 * model: a series = RRULE + exdates over a TEMPLATE (a draft Delivery, hidden everywhere a draft is, or a
 * CalendarNote hidden from the calendar); occurrences are expanded for the asked range only. An occurrence that
 * gets its own action (edit "this event", Complete job, DO, PTW, cancel, postpone, team) is MATERIALISED: a real
 * job / note copied from the template, linked by CalendarSeriesException (seriesId, originalDate). Its proof and DOs
 * are its own.
 *
 * Virtual occurrence ids: "<templateId>~<yyyyMMdd>" (jobs: event id "aims:<templateId>~<yyyyMMdd>").
 */
export const OCC_SEP = '~';
export const occurrenceId = (templateId: string, date: string) => `${templateId}${OCC_SEP}${date.replace(/-/g, '')}`;
export function parseOccurrenceId(id: string): { templateId: string; date: string } | null {
  const m = String(id ?? '').match(/^(.+)~(\d{4})(\d{2})(\d{2})$/);
  return m ? { templateId: m[1], date: `${m[2]}-${m[3]}-${m[4]}` } : null;
}

export interface SeriesRow {
  id: string;
  organizationId: string;
  kind: 'JOB' | 'NOTE';
  templateId: string;
  rrule: string;
  startDate: string;
  startTime: string | null;
  durationMin: number | null;
  exdates: string[];
  source: any;
}

export interface RepeatView {
  seriesId: string;
  /** The occurrence's own date (yyyy-MM-dd). */
  date: string;
  rrule: string;
  text: string;
  /** The series' first day (its template's): "All events" edits start from it. */
  anchorDate: string;
  /** true = an occurrence made into its own job / note (an exception of the series). */
  exception?: true;
}

const SG = 'Asia/Singapore';
const sgParts = (d: Date) => {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: SG, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(d);
  const g = (t: string) => f.find((p) => p.type === t)?.value ?? '00';
  return { date: `${g('year')}-${g('month')}-${g('day')}`, time: `${g('hour') === '24' ? '00' : g('hour')}:${g('minute')}` };
};
export const sgInstant = (date: string, time: string | null) => new Date(`${date}T${time ?? '00:00'}:00+08:00`);

@Injectable()
export class CalendarSeriesService {
  private readonly logger = new Logger(CalendarSeriesService.name);
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly siteclock?: SiteClockLinkService,
  ) {}

  private get db(): any {
    return this.prisma as any;
  }

  async enabled(organizationId: string): Promise<boolean> {
    const [style, add] = await Promise.all([isCalendarStyleEnabled(this.prisma, organizationId), isCalendarAddEnabled(this.prisma, organizationId)]);
    return style && add;
  }

  private async assertOn(organizationId: string) {
    if (!(await this.enabled(organizationId))) throw new NotFoundException('Repeating jobs are not enabled for this organisation');
  }

  /** Every series of the org of one kind (the calendar reads them all: a series never ends on its own). */
  async seriesOf(organizationId: string, kind: 'JOB' | 'NOTE'): Promise<SeriesRow[]> {
    try {
      return await runAsOrg(organizationId, () => this.db.calendarSeries.findMany({ where: { organizationId, kind } }));
    } catch (e: any) {
      // Before the table exists (a deploy in between): no series, the calendar never fails on it.
      this.logger.warn(`seriesOf: ${e?.message}`);
      return [];
    }
  }

  async exceptionsOf(organizationId: string, seriesIds: string[]): Promise<Array<{ seriesId: string; originalDate: string; recordId: string | null }>> {
    if (!seriesIds.length) return [];
    return runAsOrg(organizationId, () => this.db.calendarSeriesException.findMany({ where: { organizationId, seriesId: { in: seriesIds } }, select: { seriesId: true, originalDate: true, recordId: true } }));
  }

  async get(organizationId: string, id: string): Promise<SeriesRow> {
    const s = await runAsOrg(organizationId, () => this.db.calendarSeries.findFirst({ where: { id, organizationId } }));
    if (!s) throw new NotFoundException('Repeating series not found');
    return s;
  }

  async byTemplate(organizationId: string, templateId: string): Promise<SeriesRow | null> {
    return runAsOrg(organizationId, () => this.db.calendarSeries.findFirst({ where: { organizationId, templateId } }));
  }

  /** The series' first day and time: its template's (an "All events" edit of the template moves the series). */
  async anchor(organizationId: string, s: SeriesRow): Promise<{ date: string; time: string | null }> {
    if (s.kind === 'JOB') {
      const t = await runAsOrg(organizationId, () => this.prisma.delivery.findFirst({ where: { id: s.templateId, organizationId }, select: { scheduledFor: true, scheduledAllDay: true } }));
      if (t?.scheduledFor) {
        const p = sgParts(t.scheduledFor);
        return { date: p.date, time: t.scheduledAllDay ? null : p.time };
      }
    } else {
      const n = await runAsOrg(organizationId, () => this.prisma.calendarNote.findFirst({ where: { id: s.templateId, organizationId }, select: { startDate: true, allDay: true, startTime: true } }));
      if (n) return { date: n.startDate, time: n.allDay ? null : n.startTime };
    }
    return { date: s.startDate, time: s.startTime };
  }

  /**
   * Occurrence dates of each series in from..to (yyyy-MM-dd), minus exdates and materialised ones. Jobs and notes
   * spanning several days (a note's endDate) start up to `spanDays` before `from`.
   */
  expand(s: SeriesRow, anchor: { date: string }, from: string, to: string, taken: Set<string>, spanDays = 0): string[] {
    try {
      return occurrences(s.rrule, anchor.date, addDays(from, -spanDays), to, s.exdates ?? []).filter((d) => !taken.has(d));
    } catch (e: any) {
      this.logger.warn(`series ${s.id}: ${e?.message}`);
      return [];
    }
  }

  view(s: SeriesRow, anchorDate: string, date: string, exception = false): RepeatView {
    let text = '';
    try {
      text = ruleText(s.rrule, anchorDate);
    } catch {
      text = 'Repeats';
    }
    return { seriesId: s.id, date, rrule: s.rrule, text, anchorDate, ...(exception ? { exception: true as const } : {}) };
  }

  // ── writes ──

  /**
   * Make an existing job / note repeat: the record becomes the series' template (a job turns into a draft and
   * leaves SiteClock), its own date is the series' first occurrence.
   */
  async create(organizationId: string, userId: string | null, body: any): Promise<SeriesRow> {
    await this.assertOn(organizationId);
    const kind = body?.kind === 'NOTE' ? 'NOTE' : body?.kind === 'JOB' ? 'JOB' : null;
    if (!kind) throw new BadRequestException('kind must be JOB or NOTE');
    const recordId = typeof body?.recordId === 'string' ? body.recordId : '';
    const rrule = this.checkRule(body?.rrule);
    if (await this.byTemplate(organizationId, recordId)) throw new BadRequestException('This already repeats');
    let anchor: { date: string; time: string | null };
    let durationMin: number | null = null;
    let source: any = null;
    if (kind === 'JOB') {
      const run = await runAsOrg(organizationId, () => this.prisma.delivery.findFirst({ where: { id: recordId, organizationId }, select: { id: true, scheduledFor: true, scheduledAllDay: true, status: true, plannedRiderUserId: true } }));
      if (!run?.scheduledFor) throw new NotFoundException('Job not found (or it has no date)');
      if (!['scheduled'].includes(String(run.status))) throw new BadRequestException('Only a scheduled job can repeat');
      const items = await runAsOrg(organizationId, () => this.prisma.deliveryItem.count({ where: { deliveryId: run.id, documentId: { not: null } } }));
      if (items) throw new BadRequestException('A job with a DO cannot repeat');
      const p = sgParts(run.scheduledFor);
      anchor = { date: p.date, time: run.scheduledAllDay ? null : p.time };
      const link = await runAsOrg(organizationId, () => this.prisma.deliverySiteClockJob.findUnique({ where: { deliveryId: run.id } })).catch(() => null);
      durationMin = link?.durationMin ?? null;
      if (link?.workerId) source = { siteclock: { workerId: link.workerId, workerName: link.workerName ?? null } };
      await runAsOrg(organizationId, () => this.prisma.delivery.update({ where: { id: run.id }, data: { isDraft: true } }));
      // The template is not a job any more: a draft is never in SiteClock, so the next sync cancels its job there. The
      // worker stays on the template's link: each occurrence made into a job is sent to them.
      if (link) await this.siteclock?.onScheduleSaved(organizationId, run.id);
    } else {
      const n = await runAsOrg(organizationId, () => this.prisma.calendarNote.findFirst({ where: { id: recordId, organizationId } }));
      if (!n) throw new NotFoundException('Note not found');
      anchor = { date: n.startDate, time: n.allDay ? null : n.startTime };
    }
    return runAsOrg(organizationId, () =>
      this.db.calendarSeries.create({
        data: { id: randomUUID(), organizationId, kind, templateId: recordId, rrule, startDate: anchor.date, startTime: anchor.time, durationMin, exdates: [], source, createdById: userId },
      }),
    );
  }

  private checkRule(v: unknown): string {
    if (typeof v !== 'string') throw new BadRequestException('Pick how it repeats');
    try {
      parseRule(v);
    } catch (e: any) {
      throw new BadRequestException(e?.message || 'Repeat rule not understood');
    }
    return v.trim().replace(/^RRULE:/i, '');
  }

  /** "All events": a new rule. */
  async updateRule(organizationId: string, id: string, body: any): Promise<SeriesRow> {
    await this.assertOn(organizationId);
    const s = await this.get(organizationId, id);
    const rrule = this.checkRule(body?.rrule);
    return runAsOrg(organizationId, () => this.db.calendarSeries.update({ where: { id: s.id }, data: { rrule } }));
  }

  /**
   * One occurrence as its own job / note (idempotent): the template copied to that date. Returns the record id.
   */
  async materialize(organizationId: string, id: string, body: any): Promise<{ kind: 'JOB' | 'NOTE'; id: string; seriesId: string; date: string }> {
    await this.assertOn(organizationId);
    const s = await this.get(organizationId, id);
    const date = String(body?.date ?? '');
    if (!isYmd(date)) throw new BadRequestException('date must be yyyy-MM-dd');
    const existing = await runAsOrg(organizationId, () => this.db.calendarSeriesException.findFirst({ where: { seriesId: s.id, originalDate: date } }));
    if (existing?.recordId) return { kind: s.kind, id: existing.recordId, seriesId: s.id, date };
    if (existing) throw new BadRequestException('This occurrence was removed');
    const anchor = await this.anchor(organizationId, s);
    // Only a real occurrence of the rule (a far-future one included).
    if (!occurrences(s.rrule, anchor.date, date, date, s.exdates ?? []).includes(date)) throw new BadRequestException('The series has no occurrence on that day');
    const recordId = s.kind === 'JOB' ? await this.copyJob(organizationId, s, date, anchor.time) : await this.copyNote(organizationId, s, date, anchor);
    try {
      await runAsOrg(organizationId, () => this.db.calendarSeriesException.create({ data: { id: randomUUID(), organizationId, seriesId: s.id, originalDate: date, recordId } }));
    } catch (e: any) {
      // Made by a parallel click: keep theirs, drop ours.
      if (e?.code !== 'P2002') throw e;
      const theirs = await runAsOrg(organizationId, () => this.db.calendarSeriesException.findFirst({ where: { seriesId: s.id, originalDate: date } }));
      await this.dropRecord(organizationId, s.kind, recordId);
      return { kind: s.kind, id: theirs.recordId, seriesId: s.id, date };
    }
    return { kind: s.kind, id: recordId, seriesId: s.id, date };
  }

  private async copyJob(organizationId: string, s: SeriesRow, date: string, time: string | null): Promise<string> {
    const t: any = await runAsOrg(organizationId, () => this.prisma.delivery.findFirst({ where: { id: s.templateId, organizationId } }));
    if (!t) throw new NotFoundException('The series has no job any more');
    let made: string | null = null;
    for (let attempt = 0; attempt < 3 && !made; attempt++) {
      const latest = await runAsOrg(organizationId, () => this.prisma.delivery.findFirst({ where: { organizationId }, orderBy: { deliveryNumber: 'desc' }, select: { deliveryNumber: true } }));
      try {
        const row = await runAsOrg(organizationId, () =>
          this.prisma.delivery.create({
            data: {
              organizationId,
              deliveryNumber: (latest?.deliveryNumber ?? 0) + 1,
              status: 'scheduled',
              isDraft: false,
              scheduledFor: sgInstant(date, time),
              scheduledAllDay: time === null,
              customerId: t.customerId,
              projectId: t.projectId,
              siteAddress: t.siteAddress,
              notes: t.notes,
              ptwStatus: t.ptwStatus,
              ptwRemark: t.ptwRemark,
              crewWorkers: t.crewWorkers ?? undefined,
              orderId: t.orderId,
              sourceQuotationId: t.sourceQuotationId,
              plannedRiderUserId: t.plannedRiderUserId,
              plannedRiderName: t.plannedRiderName,
            } as any,
            select: { id: true },
          }),
        );
        made = row.id;
      } catch (e: any) {
        if (e?.code !== 'P2002') throw e;
      }
    }
    if (!made) throw new BadRequestException('Could not allocate a job number, please retry');
    await this.copyFieldValues(organizationId, s.templateId, made, 'Delivery');
    // The template's SiteClock worker (kept on its link), else the one recorded at creation.
    const link = await runAsOrg(organizationId, () => this.prisma.deliverySiteClockJob.findUnique({ where: { deliveryId: s.templateId } })).catch(() => null);
    const sc = link?.workerId ? { workerId: link.workerId, workerName: link.workerName } : s.source?.siteclock;
    const durationMin = link?.durationMin ?? s.durationMin ?? null;
    if (sc?.workerId) await this.siteclock?.onScheduleSaved(organizationId, made, { workerId: sc.workerId, workerName: sc.workerName ?? null, ...(durationMin ? { durationMin } : {}) });
    return made;
  }

  private async copyNote(organizationId: string, s: SeriesRow, date: string, anchor: { date: string }): Promise<string> {
    const n: any = await runAsOrg(organizationId, () => this.prisma.calendarNote.findFirst({ where: { id: s.templateId, organizationId } }));
    if (!n) throw new NotFoundException('The series has no note any more');
    const span = Math.max(0, daysBetween(n.startDate, n.endDate));
    const { id: _id, createdAt: _c, updatedAt: _u, ...rest } = n;
    const row = await runAsOrg(organizationId, () => this.db.calendarNote.create({ data: { ...rest, startDate: date, endDate: addDays(date, span) }, select: { id: true } }));
    void anchor;
    return row.id;
  }

  /** Job fields, calendar style, category (CustomFieldValue rows) onto the copy; the import key stays on the template. */
  private async copyFieldValues(organizationId: string, fromId: string, toId: string, entityType: string) {
    const rows: any[] = await runAsOrg(organizationId, () =>
      this.prisma.customFieldValue.findMany({ where: { entityId: fromId, customField: { organizationId, fieldName: { not: 'gcal_import' } } }, select: { customFieldId: true, value: true } }),
    );
    for (const r of rows) {
      await runAsOrg(organizationId, () => this.prisma.customFieldValue.create({ data: { customFieldId: r.customFieldId, entityId: toId, entityType, value: r.value } }));
    }
  }

  private async dropRecord(organizationId: string, kind: 'JOB' | 'NOTE', id: string) {
    if (kind === 'JOB') {
      await runAsOrg(organizationId, () => this.prisma.customFieldValue.deleteMany({ where: { entityId: id } }));
      await runAsOrg(organizationId, () => this.prisma.delivery.deleteMany({ where: { id, organizationId } }));
    } else await runAsOrg(organizationId, () => this.prisma.calendarNote.deleteMany({ where: { id, organizationId } }));
  }

  /**
   * "This and following events" from `date`: the series ends the day before; a new series (a copy of the template on
   * `date`) takes the rest, with the exceptions on or after `date`. Returns the new series and its template, which
   * the caller then edits as "All events".
   */
  async split(organizationId: string, id: string, body: any): Promise<{ seriesId: string; templateId: string; kind: 'JOB' | 'NOTE' }> {
    await this.assertOn(organizationId);
    const s = await this.get(organizationId, id);
    const date = String(body?.date ?? '');
    if (!isYmd(date)) throw new BadRequestException('date must be yyyy-MM-dd');
    const anchor = await this.anchor(organizationId, s);
    if (date <= anchor.date) {
      // From the first occurrence: the same as "All events".
      return { seriesId: s.id, templateId: s.templateId, kind: s.kind };
    }
    const { before, after } = splitRule(s.rrule, anchor.date, date);
    // The new template: a copy dated `date`, hidden like every template.
    let templateId: string;
    if (s.kind === 'JOB') {
      templateId = await this.copyJob(organizationId, { ...s, source: null }, date, anchor.time);
      await runAsOrg(organizationId, () => this.prisma.delivery.update({ where: { id: templateId }, data: { isDraft: true } }));
    } else templateId = await this.copyNote(organizationId, s, date, anchor);
    const next = await runAsOrg(organizationId, () =>
      this.db.calendarSeries.create({
        data: {
          id: randomUUID(), organizationId, kind: s.kind, templateId, rrule: after, startDate: date, startTime: anchor.time, durationMin: s.durationMin,
          exdates: (s.exdates ?? []).filter((d) => d >= date), source: s.source?.siteclock ? { siteclock: s.source.siteclock } : null,
        },
      }),
    );
    await runAsOrg(organizationId, () => this.db.calendarSeriesException.updateMany({ where: { seriesId: s.id, originalDate: { gte: date } }, data: { seriesId: next.id } }));
    if (before) await runAsOrg(organizationId, () => this.db.calendarSeries.update({ where: { id: s.id }, data: { rrule: before, exdates: (s.exdates ?? []).filter((d) => d < date) } }));
    else await this.removeSeries(organizationId, s);
    return { seriesId: next.id, templateId, kind: s.kind };
  }

  /** Delete "this event": the occurrence is skipped (EXDATE). A materialised one is deleted by its own delete. */
  async skip(organizationId: string, id: string, body: any): Promise<{ seriesId: string; date: string; skipped: true }> {
    await this.assertOn(organizationId);
    const s = await this.get(organizationId, id);
    const date = String(body?.date ?? '');
    if (!isYmd(date)) throw new BadRequestException('date must be yyyy-MM-dd');
    if (!(s.exdates ?? []).includes(date)) await runAsOrg(organizationId, () => this.db.calendarSeries.update({ where: { id: s.id }, data: { exdates: [...(s.exdates ?? []), date].sort() } }));
    return { seriesId: s.id, date, skipped: true };
  }

  /**
   * Delete "this and following events": the series ends the day before `date`. Occurrences already made into their
   * own jobs / notes stay (a job may hold DOs or proof); they are only unlinked.
   */
  async end(organizationId: string, id: string, body: any): Promise<{ seriesId: string; ended: true; removed: boolean }> {
    await this.assertOn(organizationId);
    const s = await this.get(organizationId, id);
    const date = String(body?.date ?? '');
    if (!isYmd(date)) throw new BadRequestException('date must be yyyy-MM-dd');
    const anchor = await this.anchor(organizationId, s);
    const before = date <= anchor.date ? null : endBefore(s.rrule, anchor.date, date);
    if (!before) {
      await this.removeSeries(organizationId, s);
      return { seriesId: s.id, ended: true, removed: true };
    }
    await runAsOrg(organizationId, () => this.db.calendarSeries.update({ where: { id: s.id }, data: { rrule: before } }));
    await runAsOrg(organizationId, () => this.db.calendarSeriesException.deleteMany({ where: { seriesId: s.id, originalDate: { gte: date } } }));
    return { seriesId: s.id, ended: true, removed: false };
  }

  /** Delete "all events": the series and its template go; occurrences made into their own records stay, unlinked. */
  async remove(organizationId: string, id: string): Promise<{ seriesId: string; deleted: true }> {
    await this.assertOn(organizationId);
    const s = await this.get(organizationId, id);
    await this.removeSeries(organizationId, s);
    return { seriesId: s.id, deleted: true };
  }

  private async removeSeries(organizationId: string, s: SeriesRow) {
    await runAsOrg(organizationId, () => this.db.calendarSeriesException.deleteMany({ where: { seriesId: s.id } }));
    await runAsOrg(organizationId, () => this.db.calendarSeries.delete({ where: { id: s.id } }));
    if (s.kind === 'JOB') {
      // The template is a draft with no lines; anything added to it keeps it.
      const used = await runAsOrg(organizationId, () => this.prisma.deliveryItem.count({ where: { deliveryId: s.templateId } }));
      if (!used) await this.dropRecord(organizationId, 'JOB', s.templateId);
    } else await this.dropRecord(organizationId, 'NOTE', s.templateId);
  }

  /** An occurrence id ("<templateId>~<yyyyMMdd>") made into its own job / note: the calendar's per-occurrence actions. */
  async materializeOccurrence(organizationId: string, occurrence: string) {
    const occ = parseOccurrenceId(occurrence);
    if (!occ) throw new BadRequestException('Not an occurrence of a repeating job');
    const s = await this.byTemplate(organizationId, occ.templateId);
    if (!s) throw new NotFoundException('Repeating series not found');
    return this.materialize(organizationId, s.id, { date: occ.date });
  }

  /** The panel / edit dialog: the series of a template or of a materialised occurrence. */
  async forRecord(organizationId: string, recordId: string): Promise<(RepeatView & { templateId: string; kind: string }) | null> {
    if (!(await this.enabled(organizationId))) return null;
    const occ = parseOccurrenceId(recordId);
    let s = await this.byTemplate(organizationId, occ ? occ.templateId : recordId);
    let date = occ?.date ?? null;
    let exception = false;
    if (!s) {
      const ex = await runAsOrg(organizationId, () => this.db.calendarSeriesException.findFirst({ where: { organizationId, recordId } }));
      if (!ex) return null;
      s = await this.get(organizationId, ex.seriesId);
      date = ex.originalDate;
      exception = true;
    }
    const anchor = await this.anchor(organizationId, s!);
    return { ...this.view(s!, anchor.date, date ?? anchor.date, exception), templateId: s!.templateId, kind: s!.kind };
  }
}
