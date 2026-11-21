/**
 * Field > Plan (FIELD_PLAN.md phase 2): the attendance side of the day's jobs. Ported from siteclock @62b7d9d
 * src/lib/jobs.ts, src/modules/jobs/jobs.router.ts, src/modules/rosters/rosters.router.ts (copy, copy-week,
 * attendance, presets, needs), src/lib/jobs.ts notifyJobs.
 *
 * AIMS has one job list, the calendar (Delivery). A FieldJob is that job's attendance side (place / geofence,
 * clocking mode, QR, crew, expected minutes, needs), 1:1 by deliveryId. Jobs imported from SiteClock that were
 * made there have no calendar job (history only). Copy day / week creates calendar quick jobs through the
 * calendar's own path (DeliveriesService.createQuickJob), never jobs of an order (SiteClock: never external jobs).
 * Notify marks the crew as told (notifiedAt); nothing is sent until the AIMS phone app exists.
 */
import { BadRequestException, ConflictException, Injectable, NotFoundException, Optional, UnprocessableEntityException } from '@nestjs/common';
import { DateTime } from 'luxon';
import { z } from 'zod';
import { PrismaService } from '../../common/prisma.service';
import { DeliveriesService } from '../../deliveries/deliveries.service';
import { jobStyleValues } from '../../deliveries/job-style';
import { FieldCtx } from '../common/field-context.service';
import { fieldSettings } from '../common/settings';
import { addDays } from '../common/time';
import { ensurePlaceSite, findPlace, jobStatus, newQrToken, resolveCrew, visitFor } from './jobs-lib';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ymd = z.string().regex(DATE_RE);

export const jobSettingsSchema = z.object({
  deliveryId: z.string().optional(),
  fieldJobId: z.string().optional(),
  location: z.string().max(200).optional(),
  search: z.string().max(200).optional(),
  siteId: z.string().nullable().optional(),
  teamIds: z.array(z.string()).max(50).optional(),
  workerIds: z.array(z.string()).max(200).optional(),
  exceptWorkerIds: z.array(z.string()).max(200).optional(),
  expectedMinutes: z.number().int().min(5).max(1440).nullable().optional(),
  clocking: z.enum(['OFF', 'ARRIVE', 'ARRIVE_LEAVE']).nullable().optional(),
  qrRequired: z.boolean().optional(),
  instructions: z.string().max(4000).nullable().optional(),
  needs: z.array(z.object({ tradeId: z.string(), qty: z.number().int().min(0).max(200) })).max(20).optional(),
});

function parseOr400<T>(schema: z.ZodType<T>, body: unknown): T {
  const r = schema.safeParse(body);
  if (!r.success) throw new BadRequestException({ message: 'Check the form', error: r.error.flatten() });
  return r.data;
}

/** Local date + HH:mm (null for all-day) of a calendar job's start in the org time zone. */
export function jobWhen(scheduledFor: Date | null, allDay: boolean, tz: string) {
  if (!scheduledFor) return { date: null as string | null, startTime: null as string | null };
  const t = DateTime.fromJSDate(scheduledFor).setZone(tz);
  return { date: t.toFormat('yyyy-MM-dd'), startTime: allDay ? null : t.toFormat('HH:mm') };
}

@Injectable()
export class FieldJobsService {
  constructor(private readonly prisma: PrismaService, @Optional() private readonly deliveries?: DeliveriesService) {}
  private get db(): any {
    return this.prisma as any;
  }

  /** Calendar jobs whose start falls on `date` (org time zone), drafts left out. */
  private async calendarJobs(ctx: FieldCtx, date: string) {
    const from = DateTime.fromISO(date, { zone: ctx.timezone }).startOf('day');
    const rows = await this.db.delivery.findMany({
      where: { organizationId: ctx.organizationId, isDraft: false, scheduledFor: { gte: from.toJSDate(), lt: from.plus({ days: 1 }).toJSDate() } },
      select: { id: true, deliveryNumber: true, status: true, scheduledFor: true, scheduledAllDay: true, customerId: true, siteAddress: true, notes: true, orderId: true, sourceQuotationId: true },
      orderBy: { scheduledFor: 'asc' },
    });
    const custIds = [...new Set<string>(rows.map((r: any) => r.customerId).filter(Boolean))];
    const custs = custIds.length ? await this.db.customer.findMany({ where: { id: { in: custIds } }, select: { id: true, name: true } }) : [];
    const custName = new Map(custs.map((c: any) => [c.id, c.name]));
    const styles: Map<string, any> = rows.length ? await jobStyleValues(this.db, ctx.organizationId, rows.map((r: any) => r.id)) : new Map();
    return rows.map((r: any) => ({ ...r, customerName: r.customerId ? custName.get(r.customerId) ?? null : null, crewPicks: styles.get(r.id)?.crew ?? [] }));
  }

  /** The day plan: every calendar job of the date plus SiteClock-made jobs, with crew, visits and status. */
  async day(ctx: FieldCtx, date: string) {
    if (!DATE_RE.test(date)) throw new BadRequestException('Pick a date');
    const org = ctx.organizationId;
    const cal = await this.calendarJobs(ctx, date);
    const fjs = await this.db.fieldJob.findMany({ where: { organizationId: org, OR: [{ deliveryId: { in: cal.map((c: any) => c.id) } }, { date, deliveryId: null }] } });
    const byDelivery = new Map(fjs.filter((f: any) => f.deliveryId).map((f: any) => [f.deliveryId, f]));
    const crews = fjs.length ? await this.db.fieldJobCrew.findMany({ where: { organizationId: org, jobId: { in: fjs.map((f: any) => f.id) } } }) : [];
    const punches = fjs.length ? await this.db.fieldPunch.findMany({ where: { organizationId: org, jobId: { in: fjs.map((f: any) => f.id) } } }) : [];
    const sites = await this.db.fieldSite.findMany({ where: { organizationId: org, id: { in: fjs.map((f: any) => f.siteId).filter(Boolean) } } });
    const needs = fjs.length ? await this.db.fieldJobNeed.findMany({ where: { organizationId: org, jobId: { in: fjs.map((f: any) => f.id) } } }) : [];
    const workerIds = new Set<string>(crews.map((c: any) => c.workerId));
    const planned: Array<{ key: string; teamIds: string[]; workerIds: string[] }> = [];
    for (const c of cal) {
      if (byDelivery.has(c.id)) continue;
      const teamIds = c.crewPicks.filter((p: any) => p.kind === 'team').map((p: any) => p.id);
      const wIds = c.crewPicks.filter((p: any) => p.kind === 'worker').map((p: any) => p.id);
      planned.push({ key: c.id, teamIds, workerIds: wIds });
    }
    const plannedCrew = new Map<string, Array<{ workerId: string; teamId: string | null }>>();
    for (const p of planned) {
      const crew = await resolveCrew(this.db, org, date, p.teamIds, p.workerIds);
      plannedCrew.set(p.key, crew);
      for (const c of crew) workerIds.add(c.workerId);
    }
    const workers = await this.db.worker.findMany({ where: { id: { in: [...workerIds] } }, select: { id: true, name: true } });
    const wName = new Map(workers.map((w: any) => [w.id, w.name]));
    const siteById = new Map(sites.map((s: any) => [s.id, s]));
    const note = await this.db.fieldDayNote.findUnique({ where: { organizationId_date: { organizationId: org, date } } });
    const settings = await fieldSettings(this.db, org);

    const present = (f: any | null, cal: any | null) => {
      const crewRows = f ? crews.filter((c: any) => c.jobId === f.id) : (plannedCrew.get(cal.id) ?? []).map((c) => ({ ...c, notifiedAt: null }));
      const jp = f ? punches.filter((p: any) => p.jobId === f.id) : [];
      const when = cal ? jobWhen(cal.scheduledFor, cal.scheduledAllDay, ctx.timezone) : { date: f.date, startTime: f.startTime };
      return {
        key: cal?.id ?? f.id,
        deliveryId: cal?.id ?? null,
        fieldJobId: f?.id ?? null,
        source: f?.source ?? 'aims',
        jobNumber: cal?.deliveryNumber ?? null,
        orderJob: !!(cal?.orderId || cal?.sourceQuotationId),
        cancelled: cal?.status === 'cancelled' || f?.status === 'CANCELLED',
        date: when.date,
        startTime: when.startTime,
        allDay: cal ? !!cal.scheduledAllDay : !!f?.allDay,
        title: f?.title ?? cal?.customerName ?? `Job #${cal?.deliveryNumber}`,
        location: f?.location ?? cal?.siteAddress ?? '',
        site: f?.siteId ? siteById.get(f.siteId) ?? null : null,
        settingsSaved: !!f,
        clocking: f?.clocking ?? null,
        qrRequired: !!f?.qrRequired,
        qrToken: f?.qrToken ?? null,
        expectedMinutes: f?.expectedMinutes ?? null,
        instructions: f?.instructions ?? null,
        teamIds: f ? f.teamIds : cal.crewPicks.filter((p: any) => p.kind === 'team').map((p: any) => p.id),
        exceptWorkerIds: f?.exceptWorkerIds ?? [],
        needs: f ? needs.filter((n: any) => n.jobId === f.id).map((n: any) => ({ tradeId: n.tradeId, qty: n.qty })) : [],
        status: jobStatus(crewRows, jp),
        crew: crewRows
          .map((c: any) => ({ workerId: c.workerId, name: wName.get(c.workerId) ?? '', teamId: c.teamId ?? null, notifiedAt: c.notifiedAt ?? null, ...visitFor(jp, c.workerId) }))
          .sort((a: any, b: any) => a.name.localeCompare(b.name)),
      };
    };
    const jobs = [
      ...cal.map((c: any) => present(byDelivery.get(c.id) ?? null, c)),
      ...fjs.filter((f: any) => !f.deliveryId && f.date === date).map((f: any) => present(f, null)),
    ].sort((a, b) => (a.startTime ?? '99').localeCompare(b.startTime ?? '99') || a.title.localeCompare(b.title));
    return { date, note: note?.text ?? '', notifyRoster: settings.notifyRoster, jobClocking: settings.jobClocking, jobs };
  }

  /** The FieldJob of a calendar job, made from the job the first time its Field settings are saved. */
  private async jobFor(ctx: FieldCtx, d: { deliveryId?: string; fieldJobId?: string }) {
    const org = ctx.organizationId;
    if (d.fieldJobId) {
      const f = await this.db.fieldJob.findFirst({ where: { id: d.fieldJobId, organizationId: org } });
      if (!f) throw new NotFoundException('Not found');
      return { f, cal: f.deliveryId ? await this.db.delivery.findFirst({ where: { id: f.deliveryId, organizationId: org } }) : null };
    }
    if (!d.deliveryId) throw new BadRequestException('Pick a job');
    const cal = await this.db.delivery.findFirst({ where: { id: d.deliveryId, organizationId: org, isDraft: false } });
    if (!cal) throw new NotFoundException('Job not found');
    const f = await this.db.fieldJob.findUnique({ where: { deliveryId: cal.id } });
    return { f, cal };
  }

  /**
   * Save a job's Field settings (jobs.ts createJob / updateJob). The crew is rebuilt when teams, named workers or
   * exceptions change; a change of time, place or date clears "told" so the crew is told again.
   */
  async saveJob(ctx: FieldCtx, body: unknown) {
    const d = parseOr400(jobSettingsSchema, body);
    const org = ctx.organizationId;
    const { f: before, cal } = await this.jobFor(ctx, d);
    if (before?.source === 'siteclock-external') throw new ConflictException({ message: 'This job came from AIMS through SiteClock; change it on the calendar.', code: 'EXTERNAL_JOB' });
    const when = cal ? jobWhen(cal.scheduledFor, cal.scheduledAllDay, ctx.timezone) : { date: before.date, startTime: before.startTime };
    if (!when.date) throw new BadRequestException('The job has no date');
    const customer = cal?.customerId ? await this.db.customer.findFirst({ where: { id: cal.customerId }, select: { name: true } }) : null;
    const title = before?.title ?? customer?.name ?? `Job #${cal?.deliveryNumber ?? ''}`;

    let siteId: string | null = before?.siteId ?? null;
    let location: string = before?.location ?? cal?.siteAddress ?? title;
    if (d.siteId) {
      const s = await this.db.fieldSite.findFirst({ where: { id: d.siteId, organizationId: org } });
      if (!s) throw new BadRequestException('Unknown site');
      siteId = s.id;
      location = d.location ?? s.name;
    } else if (d.location !== undefined || (!before && !siteId)) {
      location = (d.location ?? location).trim();
      if (!location) throw new BadRequestException('Say where the job is');
      const place = await findPlace(this.db, org, location, d.search);
      if (!place) throw new UnprocessableEntityException({ message: `Couldn't find "${d.search || location}". Add a postal code, or pick a site.`, code: 'PLACE_NOT_FOUND' });
      siteId = await ensurePlaceSite(this.db, org, place, ctx.timezone);
    }

    const style = cal && !before ? (await jobStyleValues(this.db, org, [cal.id])).get(cal.id) : null;
    const teamIds = d.teamIds ?? before?.teamIds ?? (style?.crew ?? []).filter((p: any) => p.kind === 'team').map((p: any) => p.id);
    const prevNamed = before ? (await this.db.fieldJobCrew.findMany({ where: { jobId: before.id, teamId: null } })).map((c: any) => c.workerId) : (style?.crew ?? []).filter((p: any) => p.kind === 'worker').map((p: any) => p.id);
    const workerIds = d.workerIds ?? prevNamed;
    const exceptWorkerIds = d.exceptWorkerIds ?? before?.exceptWorkerIds ?? [];
    if (teamIds.length && (await this.db.workerTeam.count({ where: { organizationId: org, id: { in: teamIds } } })) !== new Set(teamIds).size) throw new BadRequestException('Unknown team');
    if (workerIds.length && (await this.db.worker.count({ where: { organizationId: org, id: { in: workerIds } } })) !== new Set(workerIds).size) throw new BadRequestException('Unknown worker');

    const data: Record<string, unknown> = {
      date: when.date,
      startTime: when.startTime,
      allDay: cal ? !!cal.scheduledAllDay : !!before?.allDay,
      title,
      location,
      siteId,
      teamIds,
      exceptWorkerIds,
      ...(d.expectedMinutes !== undefined ? { expectedMinutes: d.expectedMinutes } : {}),
      ...(d.clocking !== undefined ? { clocking: d.clocking } : {}),
      ...(d.instructions !== undefined ? { instructions: d.instructions?.trim() || null } : {}),
      // Turning QR on gives the job a code (kept if it had one, so prints stay valid).
      ...(d.qrRequired !== undefined ? { qrRequired: d.qrRequired, ...(d.qrRequired && !before?.qrToken ? { qrToken: newQrToken() } : {}) } : {}),
    };
    const job = await this.db.$transaction(async (tx: any) => {
      const moved = !!before && (siteId !== before.siteId || when.date !== before.date || when.startTime !== before.startTime);
      const j = before
        ? await tx.fieldJob.update({ where: { id: before.id }, data })
        : await tx.fieldJob.create({ data: { organizationId: org, deliveryId: cal?.id ?? null, source: 'aims', createdById: ctx.userId, ...data } });
      const crewChanged = !before || d.teamIds !== undefined || d.workerIds !== undefined || d.exceptWorkerIds !== undefined || when.date !== before.date;
      if (crewChanged) {
        const crew = await resolveCrew(tx, org, when.date!, teamIds, workerIds, exceptWorkerIds);
        const keep = new Set(crew.map((c) => c.workerId));
        await tx.fieldJobCrew.deleteMany({ where: { jobId: j.id, workerId: { notIn: [...keep] } } });
        for (const c of crew) {
          await tx.fieldJobCrew.upsert({ where: { jobId_workerId: { jobId: j.id, workerId: c.workerId } }, create: { organizationId: org, jobId: j.id, ...c }, update: { teamId: c.teamId } });
        }
      }
      if (moved) await tx.fieldJobCrew.updateMany({ where: { jobId: j.id }, data: { notifiedAt: null } });
      if (d.needs) {
        await tx.fieldJobNeed.deleteMany({ where: { jobId: j.id } });
        const keepNeeds = d.needs.filter((n) => n.qty > 0);
        if (keepNeeds.length) await tx.fieldJobNeed.createMany({ data: keepNeeds.map((n) => ({ organizationId: org, jobId: j.id, tradeId: n.tradeId, qty: n.qty })) });
      }
      return j;
    });
    return { job, created: !before };
  }

  /** Rotate the QR code (old prints stop working) and turn QR on (jobs.router POST /:id/qr; oddity kept: cancelled jobs too). */
  async rotateQr(ctx: FieldCtx, fieldJobId: string) {
    const f = await this.db.fieldJob.findFirst({ where: { id: fieldJobId, organizationId: ctx.organizationId } });
    if (!f) throw new NotFoundException('Not found');
    const job = await this.db.fieldJob.update({ where: { id: f.id }, data: { qrToken: newQrToken(), qrRequired: true } });
    return { job };
  }

  /** Mark the crews of the day's jobs as told (notifyJobs). Nothing is sent yet: the AIMS phone app is not out. */
  async notify(ctx: FieldCtx, body: unknown) {
    const d = parseOr400(z.object({ date: ymd }), body);
    const jobs = await this.db.fieldJob.findMany({ where: { organizationId: ctx.organizationId, date: d.date, NOT: { status: 'CANCELLED' } }, select: { id: true } });
    const rows = jobs.length ? await this.db.fieldJobCrew.findMany({ where: { jobId: { in: jobs.map((j: any) => j.id) }, notifiedAt: null } }) : [];
    const workers = new Set(rows.map((r: any) => r.workerId)).size;
    if (rows.length) await this.db.fieldJobCrew.updateMany({ where: { id: { in: rows.map((r: any) => r.id) } }, data: { notifiedAt: new Date() } });
    return { workers, told: 0, marked: rows.length };
  }

  async setDayNote(ctx: FieldCtx, date: string, body: unknown) {
    if (!DATE_RE.test(date)) throw new BadRequestException('Pick a date');
    const d = parseOr400(z.object({ text: z.string().max(2000) }), body);
    const t = d.text.trim();
    if (!t) await this.db.fieldDayNote.deleteMany({ where: { organizationId: ctx.organizationId, date } });
    else await this.db.fieldDayNote.upsert({ where: { organizationId_date: { organizationId: ctx.organizationId, date } }, create: { organizationId: ctx.organizationId, date, text: t }, update: { text: t } });
    return { date, text: t };
  }

  /**
   * Copy one day's calendar quick jobs to another day (rosters copyDay): same customer, place, time of day,
   * crew picks and Field settings; jobs of an order are never copied; a job of the same customer at the same
   * time already on the target day is left alone (never clobber).
   */
  async copyDay(ctx: FieldCtx, fromDate: string, toDate: string) {
    if (!this.deliveries) throw new BadRequestException('Copying jobs is not available');
    if (!DATE_RE.test(fromDate) || !DATE_RE.test(toDate)) throw new BadRequestException('Pick the dates');
    const src = (await this.calendarJobs(ctx, fromDate)).filter((c: any) => !c.orderId && !c.sourceQuotationId && c.status !== 'cancelled');
    const target = await this.calendarJobs(ctx, toDate);
    const style: Map<string, any> = src.length ? await jobStyleValues(this.db, ctx.organizationId, src.map((s: any) => s.id)) : new Map();
    let copied = 0;
    for (const s of src) {
      const when = jobWhen(s.scheduledFor, s.scheduledAllDay, ctx.timezone);
      if (target.some((t: any) => t.customerId === s.customerId && jobWhen(t.scheduledFor, t.scheduledAllDay, ctx.timezone).startTime === when.startTime)) continue;
      const at = s.scheduledAllDay ? DateTime.fromISO(toDate, { zone: ctx.timezone }) : DateTime.fromISO(`${toDate}T${when.startTime}`, { zone: ctx.timezone });
      const meta = style.get(s.id) ?? {};
      const created: any = await this.deliveries.createQuickJob(ctx.organizationId, {
        customerId: s.customerId,
        allDay: !!s.scheduledAllDay,
        scheduledFor: at.toUTC().toISO(),
        siteAddress: s.siteAddress ?? '',
        remarks: s.notes ?? '',
        ...(meta.crew?.length ? { crew: meta.crew } : {}),
        ...(meta.team ? { team: meta.team } : {}),
        ...(meta.salespersonId ? { salespersonId: meta.salespersonId } : {}),
      });
      const f = await this.db.fieldJob.findUnique({ where: { deliveryId: s.id } });
      if (f && created?.id) {
        await this.saveJob(ctx, { deliveryId: created.id, siteId: f.siteId ?? undefined, clocking: f.clocking, qrRequired: f.qrRequired, expectedMinutes: f.expectedMinutes, instructions: f.instructions, teamIds: f.teamIds, exceptWorkerIds: f.exceptWorkerIds });
      }
      copied++;
    }
    return { copied };
  }

  async copyWeek(ctx: FieldCtx, fromMonday: string, toMonday: string) {
    let copied = 0;
    for (let i = 0; i < 7; i++) copied += (await this.copyDay(ctx, addDays(fromMonday, i), addDays(toMonday, i))).copied;
    return { copied };
  }

  /**
   * Who was expected on each job of the date and whether they turned up (rosters /attendance): CLOCKED_IN (an
   * open entry), DONE, ON_LEAVE (approved leave), NOT_ARRIVED; an open entry wins over a closed one.
   */
  async attendance(ctx: FieldCtx, date: string) {
    const plan = await this.day(ctx, date);
    const ids = [...new Set(plan.jobs.flatMap((j) => j.crew.map((c: any) => c.workerId)))];
    const [entries, leaves] = await Promise.all([
      this.db.fieldTimeEntry.findMany({ where: { organizationId: ctx.organizationId, workerId: { in: ids }, workDate: date }, orderBy: { clockInAt: 'asc' } }),
      this.db.fieldLeaveRequest.findMany({ where: { organizationId: ctx.organizationId, workerId: { in: ids }, status: 'APPROVED', startDate: { lte: date }, endDate: { gte: date } } }),
    ]);
    const entryBy = new Map<string, any>();
    for (const e of entries) {
      const prev = entryBy.get(e.workerId);
      if (!prev || (e.status === 'OPEN' && prev.status !== 'OPEN')) entryBy.set(e.workerId, e);
    }
    const onLeave = new Set(leaves.map((l: any) => l.workerId));
    const state = (w: string) => (onLeave.has(w) ? 'ON_LEAVE' : !entryBy.get(w) ? 'NOT_ARRIVED' : entryBy.get(w).status === 'OPEN' ? 'CLOCKED_IN' : 'DONE');
    const jobs = plan.jobs.map((j) => ({ key: j.key, title: j.title, startTime: j.startTime, crew: j.crew.map((c: any) => ({ workerId: c.workerId, name: c.name, state: state(c.workerId), clockInAt: entryBy.get(c.workerId)?.clockInAt ?? null })) }));
    const all = jobs.flatMap((j) => j.crew);
    const counts = { expected: all.length, clockedIn: all.filter((c) => c.state === 'CLOCKED_IN').length, done: all.filter((c) => c.state === 'DONE').length, onLeave: all.filter((c) => c.state === 'ON_LEAVE').length, notArrived: all.filter((c) => c.state === 'NOT_ARRIVED').length };
    return { date, jobs, counts };
  }

  // ── Manning presets (rosters.router) ──────────────────────────────────────

  async presets(ctx: FieldCtx) {
    return { presets: await this.db.fieldManningPreset.findMany({ where: { organizationId: ctx.organizationId }, orderBy: { name: 'asc' } }) };
  }

  /** Upsert by name (1..20 items, qty 1..200). */
  async savePreset(ctx: FieldCtx, body: unknown) {
    const d = parseOr400(z.object({ name: z.string().trim().min(1).max(60), items: z.array(z.object({ tradeId: z.string(), qty: z.number().int().min(1).max(200) })).min(1).max(20) }), body);
    const n = await this.db.fieldTrade.count({ where: { organizationId: ctx.organizationId, id: { in: d.items.map((i) => i.tradeId) } } });
    if (n !== new Set(d.items.map((i) => i.tradeId)).size) throw new BadRequestException('Unknown trade');
    const preset = await this.db.fieldManningPreset.upsert({
      where: { organizationId_name: { organizationId: ctx.organizationId, name: d.name } },
      create: { organizationId: ctx.organizationId, name: d.name, items: d.items },
      update: { items: d.items },
    });
    return { preset };
  }

  async deletePreset(ctx: FieldCtx, id: string) {
    const n = await this.db.fieldManningPreset.deleteMany({ where: { id, organizationId: ctx.organizationId } });
    if (!n.count) throw new NotFoundException('Not found');
    return { ok: true };
  }
}
