/**
 * Field > Reports, Rules, Overview, Audit (FIELD_PLAN.md phase 7). Ported from siteclock @62b7d9d
 * src/modules/reports/reports.router.ts (attendance export, attendance summary, fraud summary), rules.router.ts
 * (OT, breaks, punch rules) and terms.router.ts (text + acceptances, data only: the worker app shows them later).
 * Oddity kept and said: the fraud summary counts days in UTC. Audit: the Activity Log's Field rows plus SiteClock's
 * own imported history.
 */
import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { DateTime } from 'luxon';
import { z } from 'zod';
import { PrismaService } from '../../common/prisma.service';
import { FieldCtx } from '../common/field-context.service';
import { fieldSettings } from '../common/settings';
import { todayIn, weekdayOf } from '../common/time';

const D = /^\d{4}-\d{2}-\d{2}$/;
const range = z.object({ from: z.string().regex(D), to: z.string().regex(D) });

export const punchRulesSchema = z.object({
  unassignedSelfie: z.boolean(),
  selfiePolicy: z.enum(['SMART', 'ALWAYS']),
  notifyRoster: z.boolean(),
  jobClocking: z.enum(['OFF', 'ARRIVE', 'ARRIVE_LEAVE']),
  jobClockingTeamIds: z.array(z.string()).max(50),
  groupJobClocking: z.boolean(),
  groupClockBy: z.enum(['ANYONE', 'SUPERVISORS']),
  offSiteReview: z.enum(['REVIEW', 'MARK', 'BLOCK']),
  missedClockOut: z.enum(['FULL_SHIFT', 'SHIFT_END', 'NO_HOURS']),
  crewMarginBeforeMin: z.number().int().min(0).max(720),
  crewMarginAfterMin: z.number().int().min(0).max(720),
  photoAtFirstLogin: z.boolean(),
  baseClocking: z.boolean(),
  shareWorkers: z.enum(['NONE', 'ALL', 'SELECTED']),
}).partial();

/** One worker's day in the attendance report (reports.router attendance-export). */
export function dayVerdict(dayEntries: any[], onLeave: boolean, scheduled: boolean) {
  if (!dayEntries.length) return onLeave ? 'Leave' : scheduled ? 'Absent' : 'Rest';
  const parts: string[] = [];
  let open = false;
  for (const e of dayEntries) {
    if ((e.lateMinutes ?? 0) > 0) parts.push(`Late ${e.lateMinutes}m`);
    if ((e.leftEarlyMinutes ?? 0) > 0) parts.push(`Left early ${e.leftEarlyMinutes}m`);
    if (e.status === 'AUTO_CLOSED') parts.push('Missed out');
    if (e.status === 'OPEN') open = true;
  }
  if (dayEntries.some((e) => (e.punches ?? []).some((p: any) => p.insideFence === false))) parts.push('Off-site');
  if (open) parts.push('On clock');
  return parts.length ? parts.join(', ') : 'Normal';
}

@Injectable()
export class FieldReportsService {
  constructor(private readonly prisma: PrismaService) {}
  private get db(): any {
    return this.prisma as any;
  }

  /** The attendance report: a row per worker with totals and a verdict per day (1-92 days). Non-rejected entries count. */
  async attendance(ctx: FieldCtx, q: unknown) {
    const p = range.extend({ siteId: z.string().optional() }).safeParse(q ?? {});
    if (!p.success) throw new BadRequestException('Pick the dates');
    const { from, to, siteId } = p.data;
    const start = DateTime.fromFormat(from, 'yyyy-MM-dd');
    const end = DateTime.fromFormat(to, 'yyyy-MM-dd');
    const nDays = end.diff(start, 'days').days + 1;
    if (nDays < 1 || nDays > 92) throw new BadRequestException('Range must be 1 to 92 days');
    const days: string[] = [];
    for (let d = start; d <= end; d = d.plus({ days: 1 })) days.push(d.toFormat('yyyy-MM-dd'));
    let scopeSites: string[] | null = null;
    let scopeWorkers: string[] = [];
    if (ctx.access.scoped.reports) {
      scopeSites = ctx.supervisedSiteIds;
      if (siteId && !scopeSites.includes(siteId)) throw new ForbiddenException('Not your site');
      if (!siteId) scopeWorkers = ctx.supervisedWorkerIds;
    }
    if (siteId) scopeSites = [siteId];
    const org = ctx.organizationId;
    const profs = await this.db.fieldWorkerProfile.findMany({ where: { organizationId: org } });
    const prof = new Map(profs.map((x: any) => [x.workerId, x]));
    const asgsAll = await this.db.fieldSiteAssignment.findMany({ where: { organizationId: org } });
    let workers = (await this.db.worker.findMany({ where: { organizationId: org, active: true } })).filter((w: any) => ['WORKER', 'SUPERVISOR'].includes((prof.get(w.id) as any)?.tier ?? 'WORKER'));
    if (scopeSites) workers = workers.filter((w: any) => asgsAll.some((a: any) => a.workerId === w.id && scopeSites!.includes(a.siteId)) || scopeWorkers.includes(w.id));
    workers.sort((a: any, b: any) => String((prof.get(a.id) as any)?.employeeNo ?? '').localeCompare(String((prof.get(b.id) as any)?.employeeNo ?? '')) || a.name.localeCompare(b.name));
    const ids = workers.map((w: any) => w.id);
    const [entries, leaves, shiftAsgs, templates] = await Promise.all([
      this.db.fieldTimeEntry.findMany({ where: { organizationId: org, workerId: { in: ids }, workDate: { gte: from, lte: to }, status: { not: 'REJECTED' } } }),
      this.db.fieldLeaveRequest.findMany({ where: { organizationId: org, workerId: { in: ids }, status: 'APPROVED', startDate: { lte: to }, endDate: { gte: from } } }),
      this.db.fieldShiftAssignment.findMany({ where: { organizationId: org, workerId: { in: ids }, startDate: { lte: to }, OR: [{ endDate: null }, { endDate: { gte: from } }] } }),
      this.db.fieldShiftTemplate.findMany({ where: { organizationId: org, active: true } }),
    ]);
    const punches = entries.length ? await this.db.fieldPunch.findMany({ where: { timeEntryId: { in: entries.map((e: any) => e.id) } }, select: { timeEntryId: true, insideFence: true } }) : [];
    const tpl = new Map(templates.map((t: any) => [t.id, t]));
    const headers = ['Employee No', 'Name', 'Days worked', 'Rest days', 'Leave days', 'Absent days', 'Worked (min)', 'OT (min)', 'Late count', 'Late (min)', 'Left early count', 'Left early (min)', 'Off-site days', 'Missed out', ...days.map((d) => { const dt = DateTime.fromFormat(d, 'yyyy-MM-dd'); return `${dt.day} ${dt.toFormat('ccc')}`; })];
    const rows = workers.map((w: any) => {
      const p0: any = prof.get(w.id) ?? {};
      const sites = new Set(asgsAll.filter((a: any) => a.workerId === w.id).map((a: any) => a.siteId));
      const mine = entries.filter((e: any) => e.workerId === w.id).map((e: any) => ({ ...e, punches: punches.filter((x: any) => x.timeEntryId === e.id) }));
      const scheduled = (date: string) =>
        !p0.attendanceExempt &&
        shiftAsgs.some((a: any) => {
          const t: any = tpl.get(a.templateId);
          return a.workerId === w.id && t && a.startDate <= date && (!a.endDate || a.endDate >= date) && t.daysOfWeek.includes(weekdayOf(date)) && (t.siteIds.length === 0 || t.siteIds.some((s: string) => sites.has(s)));
        });
      const c = { worked: 0, rest: 0, leave: 0, absent: 0, min: 0, ot: 0, late: 0, lateMin: 0, left: 0, leftMin: 0, off: 0, missed: 0 };
      const cells = days.map((date) => {
        const de = mine.filter((e: any) => e.workDate === date);
        const onLeave = leaves.some((l: any) => l.workerId === w.id && l.startDate <= date && l.endDate >= date);
        const v = dayVerdict(de, onLeave, scheduled(date));
        if (!de.length) {
          if (v === 'Leave') c.leave++;
          else if (v === 'Absent') c.absent++;
          else c.rest++;
          return v;
        }
        c.worked++;
        for (const e of de) {
          c.min += (e.regularMinutes ?? 0) + (e.otMinutes ?? 0);
          c.ot += e.otMinutes ?? 0;
          if ((e.lateMinutes ?? 0) > 0) (c.late++, (c.lateMin += e.lateMinutes));
          if ((e.leftEarlyMinutes ?? 0) > 0) (c.left++, (c.leftMin += e.leftEarlyMinutes));
          if (e.status === 'AUTO_CLOSED') c.missed++;
        }
        if (v.includes('Off-site')) c.off++;
        return v;
      });
      return [p0.employeeNo ?? '', w.name, c.worked, c.rest, c.leave, c.absent, c.min, c.ot, c.late, c.lateMin, c.left, c.leftMin, c.off, c.missed, ...cells].map(String);
    });
    return { title: `Attendance summary ${from} to ${to}`, headers, rows };
  }

  /** Per site: entries, workers, regular / OT / late totals (non-rejected entries). */
  async summary(ctx: FieldCtx, q: unknown) {
    const p = range.safeParse(q ?? {});
    if (!p.success) throw new BadRequestException('Pick the dates');
    // Supervisors: their sites only (SiteClock leaks every site here: FIELD_PLAN.md §6.2, not reproduced).
    const scope = ctx.access.scoped.reports ? { siteId: { in: ctx.supervisedSiteIds } } : {};
    const entries = await this.db.fieldTimeEntry.findMany({ where: { organizationId: ctx.organizationId, workDate: { gte: p.data.from, lte: p.data.to }, status: { not: 'REJECTED' }, ...scope } });
    const sites = await this.db.fieldSite.findMany({ where: { organizationId: ctx.organizationId }, select: { id: true, name: true } });
    const sn = new Map(sites.map((s: any) => [s.id, s.name]));
    const by = new Map<string, any>();
    for (const e of entries) {
      const s = by.get(e.siteId) ?? { siteId: e.siteId, siteName: sn.get(e.siteId) ?? '', entries: 0, workers: new Set<string>(), totalRegularMin: 0, totalOtMin: 0, totalLateMin: 0, lateCount: 0 };
      s.entries++;
      s.workers.add(e.workerId);
      s.totalRegularMin += e.regularMinutes ?? 0;
      s.totalOtMin += e.otMinutes ?? 0;
      s.totalLateMin += e.lateMinutes ?? 0;
      if ((e.lateMinutes ?? 0) > 0) s.lateCount++;
      by.set(e.siteId, s);
    }
    return { summary: [...by.values()].map(({ workers, ...s }) => ({ ...s, uniqueWorkers: workers.size })) };
  }

  /** Flagged punches by reason and the top 20 workers. Oddity kept: days in UTC (SiteClock). Supervisors: their people. */
  async fraud(ctx: FieldCtx, q: unknown) {
    const p = range.safeParse(q ?? {});
    if (!p.success) throw new BadRequestException('Pick the dates');
    const punches = await this.db.fieldPunch.findMany({ where: { organizationId: ctx.organizationId, serverTime: { gte: new Date(`${p.data.from}T00:00:00Z`), lte: new Date(`${p.data.to}T23:59:59Z`) }, flagReason: { not: null }, ...(ctx.access.scoped.reports ? { OR: [{ siteId: { in: ctx.supervisedSiteIds } }, { workerId: { in: ctx.supervisedWorkerIds } }] } : {}) } });
    const workers = await this.db.worker.findMany({ where: { id: { in: [...new Set(punches.map((x: any) => x.workerId))] } }, select: { id: true, name: true } });
    const wn = new Map(workers.map((w: any) => [w.id, w.name]));
    const byReason: Record<string, number> = {};
    const byWorker = new Map<string, any>();
    for (const x of punches) {
      byReason[x.flagReason] = (byReason[x.flagReason] ?? 0) + 1;
      const w = byWorker.get(x.workerId) ?? { workerId: x.workerId, name: wn.get(x.workerId) ?? '', flags: 0 };
      w.flags++;
      byWorker.set(x.workerId, w);
    }
    return { total: punches.length, byReason, topWorkers: [...byWorker.values()].sort((a, b) => b.flags - a.flags).slice(0, 20), utcDays: true };
  }

  /** Overview: what needs doing today (SiteClock web Overview). */
  async overview(ctx: FieldCtx) {
    const org = ctx.organizationId;
    const today = todayIn(ctx.timezone);
    const [flagged, onSite, toApprove, needsReview, leave, autoClosed] = await Promise.all([
      this.db.fieldPunch.count({ where: { organizationId: org, status: 'FLAGGED' } }),
      this.db.fieldTimeEntry.count({ where: { organizationId: org, status: 'OPEN' } }),
      this.db.fieldTimeEntry.count({ where: { organizationId: org, status: 'PENDING' } }),
      this.db.fieldTimeEntry.count({ where: { organizationId: org, status: 'PENDING', needsReview: true } }),
      this.db.fieldLeaveRequest.count({ where: { organizationId: org, status: 'PENDING' } }),
      this.db.fieldTimeEntry.count({ where: { organizationId: org, status: 'AUTO_CLOSED' } }),
    ]);
    return { today, flagged, onSite, toApprove, needsReview, leaveToApprove: leave, autoClosed };
  }

  // ── Rules ─────────────────────────────────────────────────────────────────

  async rules(ctx: FieldCtx) {
    const s = await fieldSettings(this.db, ctx.organizationId);
    const [overtime, breaks] = await Promise.all([
      this.db.fieldOvertimeRule.findMany({ where: { organizationId: ctx.organizationId } }),
      this.db.fieldBreakRule.findMany({ where: { organizationId: ctx.organizationId } }),
    ]);
    const punch = Object.fromEntries(Object.keys(punchRulesSchema.shape).map((k) => [k, (s as any)[k]]));
    return { overtime, breaks, punch, legacy: { supervisorsApproveTimesheets: s.supervisorsApproveTimesheets, supervisorsManageJobs: s.supervisorsManageJobs } };
  }

  private admin(ctx: FieldCtx) {
    if (!ctx.access.admin) throw new ForbiddenException('Only an Admin changes the rules');
  }

  /** Upsert per (org, site) (rules.router PUT /overtime). */
  async setOvertime(ctx: FieldCtx, body: unknown) {
    this.admin(ctx);
    const p = z.object({ siteId: z.string().nullable().optional(), dailyThresholdMin: z.number().int().min(0).max(1440), otMultiplier: z.number().min(1).max(3), weeklyCapOtMin: z.number().int().min(0).nullable().optional(), countEarlyAsWork: z.boolean().optional(), earlyMode: z.enum(['clamp', 'pay', 'slide']).nullable().optional() }).safeParse(body ?? {});
    if (!p.success) throw new BadRequestException({ message: 'Check the OT rule', error: p.error.flatten() });
    const { siteId = null, ...data } = p.data;
    await fieldSettings(this.db, ctx.organizationId);
    const cur = await this.db.fieldOvertimeRule.findFirst({ where: { organizationId: ctx.organizationId, siteId } });
    const rule = cur ? await this.db.fieldOvertimeRule.update({ where: { id: cur.id }, data }) : await this.db.fieldOvertimeRule.create({ data: { organizationId: ctx.organizationId, siteId, ...data } });
    return { rule, before: cur };
  }

  async setBreaks(ctx: FieldCtx, body: unknown) {
    this.admin(ctx);
    const p = z.object({ siteId: z.string().nullable().optional(), deductMinutes: z.number().int().min(0).max(240), minShiftMinutes: z.number().int().min(0).max(1440), nlbCreditMinutes: z.number().int().min(0).max(240) }).safeParse(body ?? {});
    if (!p.success) throw new BadRequestException({ message: 'Check the break rule', error: p.error.flatten() });
    const { siteId = null, ...data } = p.data;
    await fieldSettings(this.db, ctx.organizationId);
    const cur = await this.db.fieldBreakRule.findFirst({ where: { organizationId: ctx.organizationId, siteId } });
    const rule = cur ? await this.db.fieldBreakRule.update({ where: { id: cur.id }, data }) : await this.db.fieldBreakRule.create({ data: { organizationId: ctx.organizationId, siteId, ...data } });
    return { rule, before: cur };
  }

  async setPunchRules(ctx: FieldCtx, body: unknown) {
    this.admin(ctx);
    const p = punchRulesSchema.safeParse(body ?? {});
    if (!p.success || !Object.keys(p.data).length) throw new BadRequestException('Change at least one rule');
    if (p.data.jobClockingTeamIds?.length && (await this.db.workerTeam.count({ where: { organizationId: ctx.organizationId, id: { in: p.data.jobClockingTeamIds } } })) !== p.data.jobClockingTeamIds.length) throw new BadRequestException('Unknown team');
    const before = await fieldSettings(this.db, ctx.organizationId);
    const s = await this.db.fieldSettings.update({ where: { organizationId: ctx.organizationId }, data: p.data });
    return { punch: Object.fromEntries(Object.keys(punchRulesSchema.shape).map((k) => [k, s[k]])), before: Object.fromEntries(Object.keys(p.data).map((k) => [k, (before as any)[k]])) };
  }

  // ── Terms (data only until the AIMS app shows them) ──────────────────────

  async terms(ctx: FieldCtx) {
    const s = await fieldSettings(this.db, ctx.organizationId);
    const profs = await this.db.fieldWorkerProfile.findMany({ where: { organizationId: ctx.organizationId, tier: { in: ['WORKER', 'SUPERVISOR'] } } });
    const workers = await this.db.worker.findMany({ where: { organizationId: ctx.organizationId, active: true, id: { in: profs.map((p: any) => p.workerId) } }, select: { id: true, name: true } });
    const pr = new Map(profs.map((p: any) => [p.workerId, p]));
    return {
      text: s.termsText,
      version: s.termsVersion,
      updatedAt: s.termsUpdatedAt,
      acceptances: workers.map((w: any) => {
        const p: any = pr.get(w.id);
        return { workerId: w.id, name: w.name, acceptedVersion: p.termsAcceptedVersion, acceptedAt: p.termsAcceptedAt, current: p.termsAcceptedVersion === s.termsVersion };
      }),
    };
  }

  async setTerms(ctx: FieldCtx, body: unknown) {
    this.admin(ctx);
    const p = z.object({ text: z.string().min(20).max(20000), reaccept: z.boolean().default(true) }).safeParse(body ?? {});
    if (!p.success) throw new BadRequestException('The terms need 20 to 20,000 characters');
    const s = await fieldSettings(this.db, ctx.organizationId);
    const updated = await this.db.fieldSettings.update({ where: { organizationId: ctx.organizationId }, data: { termsText: p.data.text, termsUpdatedAt: new Date(), ...(p.data.reaccept ? { termsVersion: s.termsVersion + 1 } : {}) } });
    return { version: updated.termsVersion };
  }

  // ── Audit viewer ──────────────────────────────────────────────────────────

  /** Field actions from the Activity Log (AIMS) and SiteClock's own imported history, newest first. */
  async audit(ctx: FieldCtx, q: { from?: string; to?: string; source?: string }) {
    const from = q.from && D.test(q.from) ? new Date(`${q.from}T00:00:00Z`) : new Date(Date.now() - 30 * 86400_000);
    const to = q.to && D.test(q.to) ? new Date(`${q.to}T23:59:59Z`) : new Date();
    const out: any[] = [];
    if (q.source !== 'siteclock') {
      const rows = await this.db.actionLog.findMany({ where: { organizationId: ctx.organizationId, path: { contains: '/field/' }, method: { not: 'GET' }, createdAt: { gte: from, lte: to } }, orderBy: { createdAt: 'desc' }, take: 500 });
      for (const r of rows) out.push({ id: r.id, at: r.createdAt, source: 'AIMS', actor: r.actorName ?? r.actorId, action: r.details?.result?.fieldAction ?? r.action, entity: r.details?.result?.entity ?? r.resource, entityId: r.details?.result?.entityId ?? r.resourceId, method: r.method, status: r.statusCode });
    }
    if (q.source !== 'aims') {
      const rows = await this.db.fieldAuditImport.findMany({ where: { organizationId: ctx.organizationId, createdAt: { gte: from, lte: to } }, orderBy: { createdAt: 'desc' }, take: 500 });
      for (const r of rows) out.push({ id: r.id, at: r.createdAt, source: 'SiteClock', actor: r.actorName ?? (r.actorSiteclockId ? 'SiteClock user' : 'SiteClock'), action: r.action, entity: r.entity, entityId: r.entityId });
    }
    return { rows: out.sort((a, b) => +new Date(b.at) - +new Date(a.at)).slice(0, 1000) };
  }
}
