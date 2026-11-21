/**
 * Field > Working hours (FIELD_PLAN.md phase 2). Ported from siteclock @62b7d9d src/modules/schedules/schedules.router.ts
 * (templates, assignments, exceptions / siteRoster) and src/lib/templateSites.ts. Oddity kept (§6.1 #11): an
 * assignment is never checked against the worker's other assignments; the list shows "Overlaps" instead.
 */
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import { PrismaService } from '../../common/prisma.service';
import { FieldCtx } from '../common/field-context.service';
import { weekdayOf } from '../common/time';
import { templateCoversSite } from './jobs-lib';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
export const templateSchema = z.object({
  siteId: z.string().nullable().optional(),
  siteIds: z.array(z.string()).max(50).optional(),
  name: z.string().min(1),
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  endTime: z.string().regex(/^\d{2}:\d{2}$/),
  daysOfWeek: z.array(z.number().int().min(1).max(7)).min(1),
  graceLateMin: z.number().int().min(0).max(120).default(10),
  payEarly: z.boolean().nullable().optional(),
  earlyMode: z.enum(['clamp', 'pay', 'slide']).nullable().optional(),
  active: z.boolean().optional(),
});

function parseOr400<T>(schema: z.ZodType<T>, body: unknown): T {
  const r = schema.safeParse(body);
  if (!r.success) throw new BadRequestException({ message: 'Check the form', error: r.error.flatten() });
  return r.data;
}

/** Two assignments of one worker that share at least one day. */
export const assignmentsOverlap = (a: { startDate: string; endDate: string | null }, b: { startDate: string; endDate: string | null }) =>
  a.startDate <= (b.endDate ?? '9999-12-31') && b.startDate <= (a.endDate ?? '9999-12-31');

/** The roster verdict for one expected worker (schedules.router siteRoster). */
export function rosterStatus(entry: { status: string; lateMinutes?: number | null; leftEarlyMinutes?: number | null } | null, onLeave: boolean) {
  if (onLeave) return 'ON_LEAVE';
  if (!entry) return 'ABSENT';
  if (entry.status === 'OPEN') return 'PRESENT';
  if ((entry.lateMinutes ?? 0) > 0) return 'LATE';
  if ((entry.leftEarlyMinutes ?? 0) > 0) return 'LEFT_EARLY';
  return 'ON_TIME';
}

@Injectable()
export class FieldSchedulesService {
  constructor(private readonly prisma: PrismaService) {}
  private get db(): any {
    return this.prisma as any;
  }

  async templates(ctx: FieldCtx) {
    const [templates, sites, asgs] = await Promise.all([
      this.db.fieldShiftTemplate.findMany({ where: { organizationId: ctx.organizationId }, orderBy: { name: 'asc' } }),
      this.db.fieldSite.findMany({ where: { organizationId: ctx.organizationId }, select: { id: true, name: true } }),
      this.db.fieldShiftAssignment.findMany({ where: { organizationId: ctx.organizationId }, select: { templateId: true } }),
    ]);
    const byId = new Map(sites.map((s: any) => [s.id, s]));
    return {
      templates: templates.map((t: any) => ({
        ...t,
        sites: t.siteIds.map((id: string) => byId.get(id)).filter(Boolean),
        assignmentCount: asgs.filter((a: any) => a.templateId === t.id).length,
      })),
    };
  }

  /** siteIds, or the legacy single siteId; "INVALID" when a site is not this org's; siteId mirrors the first. */
  private async resolveSites(body: { siteId?: string | null; siteIds?: string[] }, organizationId: string) {
    if (body.siteIds === undefined && body.siteId === undefined) return undefined;
    const siteIds = [...new Set(body.siteIds ?? (body.siteId ? [body.siteId] : []))];
    if (siteIds.length && (await this.db.fieldSite.count({ where: { id: { in: siteIds }, organizationId } })) !== siteIds.length) throw new BadRequestException('Invalid siteId');
    return { siteIds, siteId: siteIds[0] ?? null };
  }

  async createTemplate(ctx: FieldCtx, body: unknown) {
    const d = parseOr400(templateSchema, body);
    const sites = await this.resolveSites(d, ctx.organizationId);
    const { siteId: _s, siteIds: _ss, ...rest } = d;
    return { template: await this.db.fieldShiftTemplate.create({ data: { ...rest, ...(sites ?? { siteIds: [], siteId: null }), organizationId: ctx.organizationId } }) };
  }

  async updateTemplate(ctx: FieldCtx, id: string, body: unknown) {
    const d = parseOr400(templateSchema.partial(), body);
    const before = await this.db.fieldShiftTemplate.findFirst({ where: { id, organizationId: ctx.organizationId } });
    if (!before) throw new NotFoundException('Not found');
    const sites = await this.resolveSites(d, ctx.organizationId);
    const { siteId: _s, siteIds: _ss, ...rest } = d;
    return { template: await this.db.fieldShiftTemplate.update({ where: { id }, data: { ...rest, ...(sites ?? {}) } }), before };
  }

  /** Hard delete; computed entries keep their numbers, only their link to the assignment goes. */
  async deleteTemplate(ctx: FieldCtx, id: string) {
    const t = await this.db.fieldShiftTemplate.findFirst({ where: { id, organizationId: ctx.organizationId } });
    if (!t) throw new NotFoundException('Not found');
    const asgIds = (await this.db.fieldShiftAssignment.findMany({ where: { templateId: id }, select: { id: true } })).map((a: any) => a.id);
    await this.db.$transaction([
      this.db.fieldTimeEntry.updateMany({ where: { shiftAssignmentId: { in: asgIds } }, data: { shiftAssignmentId: null } }),
      this.db.fieldShiftAssignment.deleteMany({ where: { templateId: id } }),
      this.db.fieldInvite.updateMany({ where: { templateId: id }, data: { templateId: null } }),
      this.db.fieldShiftTemplate.delete({ where: { id } }),
    ]);
    return { deleted: true, before: t };
  }

  /** Sites a scoped supervisor is assigned to (any assignment, as SiteClock's mySiteIds). */
  private async mySiteIds(ctx: FieldCtx) {
    if (!ctx.workerId) return [] as string[];
    return (await this.db.fieldSiteAssignment.findMany({ where: { organizationId: ctx.organizationId, workerId: ctx.workerId }, select: { siteId: true } })).map((a: any) => a.siteId);
  }

  async assignments(ctx: FieldCtx) {
    const rows = await this.db.fieldShiftAssignment.findMany({ where: { organizationId: ctx.organizationId }, orderBy: { startDate: 'desc' } });
    const [templates, workers] = await Promise.all([
      this.db.fieldShiftTemplate.findMany({ where: { organizationId: ctx.organizationId } }),
      this.db.worker.findMany({ where: { id: { in: rows.map((r: any) => r.workerId) } }, select: { id: true, name: true } }),
    ]);
    const tById = new Map(templates.map((t: any) => [t.id, t]));
    const wName = new Map(workers.map((w: any) => [w.id, w.name]));
    let out = rows.map((a: any) => ({
      ...a,
      template: tById.get(a.templateId) ?? null,
      workerName: wName.get(a.workerId) ?? '',
      overlaps: rows.some((b: any) => b.id !== a.id && b.workerId === a.workerId && assignmentsOverlap(a, b)),
    }));
    if (ctx.access.scoped.jobs) {
      const mine = await this.mySiteIds(ctx);
      const onMySites = new Set((await this.db.fieldSiteAssignment.findMany({ where: { organizationId: ctx.organizationId, siteId: { in: mine } }, select: { workerId: true } })).map((a: any) => a.workerId));
      out = out.filter((a: any) => onMySites.has(a.workerId));
    }
    return { assignments: out };
  }

  async assign(ctx: FieldCtx, body: unknown) {
    const d = parseOr400(z.object({ templateId: z.string(), workerId: z.string(), startDate: z.string().regex(DATE), endDate: z.string().regex(DATE).nullable().optional() }), body);
    const template = await this.db.fieldShiftTemplate.findFirst({ where: { id: d.templateId, organizationId: ctx.organizationId } });
    if (!template) throw new NotFoundException('Template not found');
    const worker = await this.db.worker.findFirst({ where: { id: d.workerId, organizationId: ctx.organizationId } });
    if (!worker) throw new NotFoundException('Worker not found');
    if (ctx.access.scoped.jobs) {
      const mine = await this.mySiteIds(ctx);
      if (template.siteIds.length && !template.siteIds.some((s: string) => mine.includes(s))) throw new ForbiddenException('Template belongs to a site you do not supervise');
      if (!(await this.db.fieldSiteAssignment.findFirst({ where: { organizationId: ctx.organizationId, workerId: worker.id, siteId: { in: mine } } }))) throw new ForbiddenException('Worker is not on any of your sites');
    }
    const assignment = await this.db.fieldShiftAssignment.create({ data: { organizationId: ctx.organizationId, templateId: d.templateId, workerId: d.workerId, startDate: d.startDate, endDate: d.endDate ?? null } });
    return { assignment };
  }

  async unassign(ctx: FieldCtx, id: string) {
    const asg = await this.db.fieldShiftAssignment.findFirst({ where: { id, organizationId: ctx.organizationId } });
    if (!asg) throw new NotFoundException('Not found');
    if (ctx.access.scoped.jobs) {
      const mine = await this.mySiteIds(ctx);
      if (!(await this.db.fieldSiteAssignment.findFirst({ where: { organizationId: ctx.organizationId, workerId: asg.workerId, siteId: { in: mine } } }))) throw new ForbiddenException('Worker is not on any of your sites');
    }
    await this.db.fieldShiftAssignment.delete({ where: { id } });
    return { ok: true, before: asg };
  }

  /** Who is expected at a site on a date and how they did (siteRoster). Office staff "no clock-in needed" are never expected. */
  async exceptions(ctx: FieldCtx, siteId: string, date: string) {
    if (!DATE.test(date)) throw new BadRequestException('Pick a date');
    const site = await this.db.fieldSite.findFirst({ where: { id: siteId, organizationId: ctx.organizationId } });
    if (!site) throw new NotFoundException('Not found');
    const weekday = weekdayOf(date);
    const asgs = await this.db.fieldShiftAssignment.findMany({ where: { organizationId: ctx.organizationId, startDate: { lte: date }, OR: [{ endDate: null }, { endDate: { gte: date } }] } });
    const templates = await this.db.fieldShiftTemplate.findMany({ where: { organizationId: ctx.organizationId, active: true } });
    const tById = new Map(templates.map((t: any) => [t.id, t]));
    const atSite = new Set((await this.db.fieldSiteAssignment.findMany({ where: { organizationId: ctx.organizationId, siteId }, select: { workerId: true } })).map((a: any) => a.workerId));
    const exempt = new Set((await this.db.fieldWorkerProfile.findMany({ where: { organizationId: ctx.organizationId, attendanceExempt: true }, select: { workerId: true } })).map((p: any) => p.workerId));
    const activeWorkers = await this.db.worker.findMany({ where: { organizationId: ctx.organizationId, active: true }, select: { id: true, name: true } });
    const wById = new Map(activeWorkers.map((w: any) => [w.id, w]));
    const profs = await this.db.fieldWorkerProfile.findMany({ where: { organizationId: ctx.organizationId }, select: { workerId: true, employeeNo: true } });
    const emp = new Map(profs.map((p: any) => [p.workerId, p.employeeNo]));
    const expected = asgs
      .map((a: any) => ({ ...a, template: tById.get(a.templateId) }))
      .filter((a: any) => a.template && a.template.daysOfWeek.includes(weekday) && templateCoversSite(a.template, siteId) && wById.has(a.workerId) && !exempt.has(a.workerId) && atSite.has(a.workerId));
    const ids = expected.map((a: any) => a.workerId);
    const [entries, leaves] = await Promise.all([
      this.db.fieldTimeEntry.findMany({ where: { organizationId: ctx.organizationId, siteId, workDate: date, workerId: { in: ids }, status: { not: 'REJECTED' } } }),
      this.db.fieldLeaveRequest.findMany({ where: { organizationId: ctx.organizationId, workerId: { in: ids }, status: 'APPROVED', startDate: { lte: date }, endDate: { gte: date } } }),
    ]);
    return {
      roster: expected.map((a: any) => {
        const entry = entries.find((e: any) => e.workerId === a.workerId) ?? null;
        return {
          workerId: a.workerId,
          name: (wById.get(a.workerId) as any)?.name ?? '',
          employeeNo: emp.get(a.workerId) ?? null,
          shift: `${a.template.name} ${a.template.startTime}-${a.template.endTime}`,
          status: rosterStatus(entry, leaves.some((l: any) => l.workerId === a.workerId)),
          lateMinutes: entry?.lateMinutes ?? 0,
          earlyMinutes: entry?.earlyMinutes ?? 0,
          leftEarlyMinutes: entry?.leftEarlyMinutes ?? 0,
          clockInAt: entry?.clockInAt ?? null,
          clockOutAt: entry?.clockOutAt ?? null,
        };
      }),
    };
  }
}
