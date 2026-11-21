/**
 * Field > Timesheets (FIELD_PLAN.md phase 4). Ported from siteclock @62b7d9d src/modules/timesheets/timesheets.router.ts
 * (list with team history, edit, approve / reject (decideEntry), approve-bulk, reopen, delete, manual entry, export,
 * detail) and src/modules/links/links.router.ts (hours each way). The numbers come from the engine (engine.ts).
 * Oddities kept: bulk approve skips entries held for review (NEEDS_REVIEW, shown as such); an office edit makes the
 * entry "edited" so paid-follows-crew stops for that day; AUTO_CLOSED entries are in the export.
 */
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import { PrismaService } from '../../common/prisma.service';
import { FieldCtx, mayReview, reviewScope } from '../common/field-context.service';
import { atLeast } from '../common/field-access';
import { fmtLocal, localDate } from '../common/time';
import { FieldEngine } from '../engine/engine';

const D = /^\d{4}-\d{2}-\d{2}$/;
export const listQuery = z.object({
  siteId: z.string().optional(),
  workerId: z.string().optional(),
  teamId: z.string().optional(),
  from: z.string().regex(D).optional(),
  to: z.string().regex(D).optional(),
  status: z.enum(['OPEN', 'PENDING', 'APPROVED', 'REJECTED', 'AUTO_CLOSED']).optional(),
  needsReview: z.enum(['true']).optional(),
  requests: z.enum(['true']).optional(),
});

type Stint = { workerId: string; teamId: string; startDate: string; endDate: string | null };
const covers = (m: { startDate: string; endDate: string | null }, date: string) => m.startDate <= date && (m.endDate === null || m.endDate >= date);

/** Entries worked while in the team: each stint becomes "this worker, workDate inside the stint" (teams.router teamEntryFilter). */
export function teamEntryFilter(stints: Stint[]) {
  if (!stints.length) return { id: { in: [] as string[] } };
  return { OR: stints.map((m) => ({ workerId: m.workerId, workDate: { gte: m.startDate, ...(m.endDate ? { lte: m.endDate } : {}) } })) };
}

/** SiteClock's export columns, in order (team last so the older positions stay). */
export const EXPORT_HEADERS = ['employeeNo', 'name', 'site', 'workDate', 'clockIn', 'clockOut', 'grossMin', 'breakMin', 'regularMin', 'otMin', 'otMultiplier', 'lateMin', 'earlyMin', 'leftEarlyMin', 'status', 'editedBy', 'approvedBy', 'team'];

@Injectable()
export class FieldTimesheetsService {
  constructor(private readonly prisma: PrismaService) {}
  private get db(): any {
    return this.prisma as any;
  }

  private async where(ctx: FieldCtx, raw: unknown) {
    const q = listQuery.safeParse(raw ?? {});
    if (!q.success) throw new BadRequestException({ message: 'Check the filters', error: q.error.flatten() });
    const d = q.data;
    const w: any = { organizationId: ctx.organizationId, ...reviewScope(ctx, 'timesheets') };
    if (d.siteId) w.siteId = d.siteId;
    if (d.workerId) w.workerId = d.workerId;
    if (d.status) w.status = d.status;
    if (d.needsReview) w.needsReview = true;
    if (d.requests) w.editNote = { contains: 'worker request:' };
    if (d.from || d.to) w.workDate = { ...(d.from ? { gte: d.from } : {}), ...(d.to ? { lte: d.to } : {}) };
    if (d.teamId) w.AND = [teamEntryFilter(await this.db.fieldTeamStint.findMany({ where: { organizationId: ctx.organizationId, teamId: d.teamId } }))];
    return w;
  }

  private async names(org: string, entries: any[]) {
    const [workers, sites, profs] = await Promise.all([
      this.db.worker.findMany({ where: { id: { in: [...new Set(entries.map((e) => e.workerId))] } }, select: { id: true, name: true } }),
      this.db.fieldSite.findMany({ where: { id: { in: [...new Set(entries.flatMap((e) => [e.siteId, e.clockOutSiteId]).filter(Boolean))] } }, select: { id: true, name: true, timezone: true } }),
      this.db.fieldWorkerProfile.findMany({ where: { organizationId: org, workerId: { in: entries.map((e) => e.workerId) } }, select: { workerId: true, employeeNo: true } }),
    ]);
    return { w: new Map(workers.map((x: any) => [x.id, x.name])), s: new Map(sites.map((x: any) => [x.id, x])), emp: new Map(profs.map((p: any) => [p.workerId, p.employeeNo])) };
  }

  async list(ctx: FieldCtx, q: unknown) {
    const entries = await this.db.fieldTimeEntry.findMany({ where: await this.where(ctx, q), orderBy: [{ workDate: 'desc' }, { clockInAt: 'desc' }], take: 500 });
    const n = await this.names(ctx.organizationId, entries);
    const punches = entries.length ? await this.db.fieldPunch.findMany({ where: { timeEntryId: { in: entries.map((e: any) => e.id) } }, orderBy: { serverTime: 'asc' } }) : [];
    return {
      entries: entries.map((e: any) => ({
        ...e,
        worker: { id: e.workerId, name: n.w.get(e.workerId) ?? '', employeeNo: n.emp.get(e.workerId) ?? null },
        site: n.s.get(e.siteId) ?? null,
        clockOutSite: e.clockOutSiteId ? n.s.get(e.clockOutSiteId) ?? null : null,
        workerRequest: !!e.editNote && String(e.editNote).startsWith('worker request:'),
        punches: punches
          .filter((p: any) => p.timeEntryId === e.id)
          .map((p: any) => ({ id: p.id, type: p.type, serverTime: p.serverTime, originalTime: p.originalTime, status: p.status, flagReason: p.flagReason, insideFence: p.insideFence, distanceM: p.distanceM, hasPhoto: !!p.photoKey })),
      })),
    };
  }

  private async load(ctx: FieldCtx, id: string) {
    const e = await this.db.fieldTimeEntry.findFirst({ where: { id, organizationId: ctx.organizationId } });
    if (!e || !mayReview(ctx, 'timesheets', e.siteId, e.workerId)) throw new NotFoundException('Not found');
    return e;
  }

  /** Edit times / note / no-lunch-break: recomputed, back to PENDING, approval cleared, original times kept once. */
  async edit(ctx: FieldCtx, id: string, body: unknown) {
    const p = z.object({ clockInAt: z.string().datetime().optional(), clockOutAt: z.string().datetime().optional(), note: z.string().max(500).optional(), nlb: z.boolean().optional() }).safeParse(body ?? {});
    if (!p.success) throw new BadRequestException({ message: 'Check the times', error: p.error.flatten() });
    const e = await this.load(ctx, id);
    const site = await this.db.fieldSite.findUnique({ where: { id: e.siteId } });
    const clockInAt = p.data.clockInAt ? new Date(p.data.clockInAt) : e.clockInAt;
    const clockOutAt = p.data.clockOutAt ? new Date(p.data.clockOutAt) : e.clockOutAt;
    if (clockOutAt && clockOutAt <= clockInAt) throw new BadRequestException('The clock-out must be after the clock-in');
    const engine = new FieldEngine(this.db);
    const entry = await this.db.$transaction(async (tx: any) => {
      await tx.fieldTimeEntry.update({
        where: { id: e.id },
        data: {
          clockInAt,
          clockOutAt,
          workDate: localDate(clockInAt, site?.timezone ?? ctx.timezone),
          editedById: ctx.userId,
          editedByName: ctx.userName,
          editedAt: new Date(),
          editNote: p.data.note,
          approvedById: null,
          approvedByName: null,
          approvedAt: null,
          ...(e.origClockInAt === null ? { origClockInAt: e.clockInAt } : {}),
          ...(e.origClockOutAt === null && e.clockOutAt ? { origClockOutAt: e.clockOutAt } : {}),
          ...(p.data.nlb !== undefined ? { nlb: p.data.nlb, nlbClaimed: false } : {}),
        },
      });
      return clockOutAt ? engine.computeEntry(tx, e.id, 'PENDING') : tx.fieldTimeEntry.findUnique({ where: { id: e.id } });
    });
    return { entry, before: { clockInAt: e.clockInAt, clockOutAt: e.clockOutAt, status: e.status } };
  }

  /** decideEntry: PENDING or AUTO_CLOSED -> APPROVED / REJECTED. */
  async decide(ctx: FieldCtx, id: string, status: 'APPROVED' | 'REJECTED') {
    if (!atLeast(ctx.access.levels.timesheets, 'approve')) throw new ForbiddenException('You cannot approve timesheets');
    const e = await this.load(ctx, id);
    if (!['PENDING', 'AUTO_CLOSED'].includes(e.status)) throw new ConflictException('Entry not pending');
    const entry = await this.db.fieldTimeEntry.update({ where: { id: e.id }, data: { status, approvedById: ctx.userId, approvedByName: ctx.userName, approvedAt: new Date() } });
    return { entry, before: { status: e.status } };
  }

  /** Bulk approve. Oddity kept: an entry held for review is skipped (NEEDS_REVIEW) and approved on its own. */
  async approveBulk(ctx: FieldCtx, body: unknown) {
    const p = z.object({ entryIds: z.array(z.string()).min(1).max(200) }).safeParse(body ?? {});
    if (!p.success) throw new BadRequestException('Pick 1 to 200 entries');
    const held = new Set((await this.db.fieldTimeEntry.findMany({ where: { organizationId: ctx.organizationId, id: { in: p.data.entryIds }, needsReview: true }, select: { id: true } })).map((e: any) => e.id));
    const results: Record<string, string> = {};
    for (const id of p.data.entryIds) {
      if (held.has(id)) {
        results[id] = 'NEEDS_REVIEW';
        continue;
      }
      try {
        await this.decide(ctx, id, 'APPROVED');
        results[id] = 'APPROVED';
      } catch (e: any) {
        results[id] = e instanceof ForbiddenException ? 'FORBIDDEN' : e instanceof NotFoundException ? 'NOT_FOUND' : e instanceof ConflictException ? 'NOT_PENDING' : 'ERROR';
      }
    }
    const count = (s: string) => Object.values(results).filter((r) => r === s).length;
    return { results, counts: { approved: count('APPROVED'), needsReview: count('NEEDS_REVIEW'), notPending: count('NOT_PENDING'), notFound: count('NOT_FOUND') } };
  }

  /** Remove an accidental clock-out: its OUT punches go, the entry is OPEN again. */
  async reopen(ctx: FieldCtx, id: string) {
    const e = await this.load(ctx, id);
    if (!e.clockOutAt) throw new ConflictException('Entry has no clock-out');
    const outs = await this.db.fieldPunch.findMany({ where: { timeEntryId: e.id, type: 'OUT' } });
    const [, entry] = await this.db.$transaction([
      this.db.fieldPunch.deleteMany({ where: { id: { in: outs.map((p: any) => p.id) } } }),
      this.db.fieldTimeEntry.update({
        where: { id: e.id },
        data: { clockOutAt: null, status: 'OPEN', grossMinutes: null, breakMinutes: null, regularMinutes: null, otMinutes: null, leftEarlyMinutes: null, approvedById: null, approvedByName: null, approvedAt: null },
      }),
    ]);
    return { entry, before: { clockOutAt: e.clockOutAt, status: e.status, deletedOutPunchIds: outs.map((p: any) => p.id) } };
  }

  /** Permanently remove an entry and its punches (Admin only). */
  async remove(ctx: FieldCtx, id: string) {
    if (!ctx.access.admin) throw new ForbiddenException('Only an Admin deletes a time entry');
    const e = await this.load(ctx, id);
    const punches = await this.db.fieldPunch.findMany({ where: { timeEntryId: e.id }, select: { id: true } });
    await this.db.$transaction([this.db.fieldPunch.deleteMany({ where: { timeEntryId: e.id } }), this.db.fieldTimeEntry.delete({ where: { id: e.id } })]);
    return { ok: true, before: { entry: e, punchIds: punches.map((p: any) => p.id) } };
  }

  /** A manual entry on behalf of a worker (PENDING, computed, edited by the office). */
  async manual(ctx: FieldCtx, body: unknown) {
    const p = z.object({ workerId: z.string(), siteId: z.string(), clockInAt: z.string().datetime(), clockOutAt: z.string().datetime(), note: z.string().max(500).optional() }).safeParse(body ?? {});
    if (!p.success) throw new BadRequestException({ message: 'Check the form', error: p.error.flatten() });
    const site = await this.db.fieldSite.findFirst({ where: { id: p.data.siteId, organizationId: ctx.organizationId } });
    if (!site) throw new NotFoundException('Site not found');
    const worker = await this.db.worker.findFirst({ where: { id: p.data.workerId, organizationId: ctx.organizationId } });
    if (!worker) throw new NotFoundException('Worker not found');
    if (!mayReview(ctx, 'timesheets', site.id, worker.id)) throw new ForbiddenException('Not your site or team');
    const clockInAt = new Date(p.data.clockInAt);
    const clockOutAt = new Date(p.data.clockOutAt);
    if (clockOutAt <= clockInAt) throw new BadRequestException('The clock-out must be after the clock-in');
    const engine = new FieldEngine(this.db);
    const entry = await this.db.$transaction(async (tx: any) => {
      const e = await tx.fieldTimeEntry.create({
        data: {
          organizationId: ctx.organizationId, workerId: worker.id, siteId: site.id, workDate: localDate(clockInAt, site.timezone), clockInAt, clockOutAt, status: 'PENDING',
          editedById: ctx.userId, editedByName: ctx.userName, editedAt: new Date(), editNote: p.data.note ?? 'manual entry',
        },
      });
      return engine.computeEntry(tx, e.id, 'PENDING');
    });
    return { entry };
  }

  /** One entry in full: punches (its own plus flagged ones within 6 h), who edited / approved, the crew fields. */
  async detail(ctx: FieldCtx, id: string) {
    const e = await this.load(ctx, id);
    const site = await this.db.fieldSite.findUnique({ where: { id: e.siteId } });
    const worker = await this.db.worker.findUnique({ where: { id: e.workerId }, select: { id: true, name: true } });
    const punches = await this.db.fieldPunch.findMany({
      where: { OR: [{ timeEntryId: e.id }, { workerId: e.workerId, siteId: e.siteId, status: 'FLAGGED', serverTime: { gte: new Date(e.clockInAt.getTime() - 6 * 3600_000), lte: new Date((e.clockOutAt ?? new Date()).getTime() + 6 * 3600_000) } }] },
      orderBy: { serverTime: 'asc' },
    });
    return {
      entry: { ...e, editedBy: e.editedByName ?? null, approvedBy: e.approvedByName ?? null },
      worker,
      site: site ? { id: site.id, name: site.name, lat: site.lat, lng: site.lng, radiusM: site.radiusM, timezone: site.timezone } : null,
      punches: punches.map(({ photoKey, deviceId, idempotencyKey, ...p }: any) => ({ ...p, hasPhoto: !!photoKey, reviewedBy: p.reviewedByName ?? null })),
    };
  }

  /** The export rows, SiteClock's columns, same filters (every status), up to 10 000 rows; the portal writes the file. */
  async exportRows(ctx: FieldCtx, q: unknown) {
    const entries = await this.db.fieldTimeEntry.findMany({ where: await this.where(ctx, q), orderBy: [{ workDate: 'asc' }, { clockInAt: 'asc' }], take: 10000 });
    const n = await this.names(ctx.organizationId, entries);
    const stints = await this.db.fieldTeamStint.findMany({ where: { organizationId: ctx.organizationId, workerId: { in: [...new Set(entries.map((e: any) => e.workerId))] } } });
    const teams = await this.db.workerTeam.findMany({ where: { id: { in: [...new Set(stints.map((s: any) => s.teamId))] } }, select: { id: true, name: true } });
    const tName = new Map(teams.map((t: any) => [t.id, t.name]));
    const teamOn = (w: string, date: string) => stints.filter((m: any) => m.workerId === w && covers(m, date)).map((m: any) => tName.get(m.teamId)).join(', ');
    const rows = entries.map((e: any) => {
      const tz = (n.s.get(e.siteId) as any)?.timezone ?? ctx.timezone;
      return [
        n.emp.get(e.workerId) ?? '', n.w.get(e.workerId) ?? '', (n.s.get(e.siteId) as any)?.name ?? '', e.workDate,
        fmtLocal(e.clockInAt, tz), e.clockOutAt ? fmtLocal(e.clockOutAt, tz) : '',
        e.grossMinutes ?? '', e.breakMinutes ?? '', e.regularMinutes ?? '', e.otMinutes ?? '', e.otMultiplier ?? '', e.lateMinutes ?? '', e.earlyMinutes ?? '', e.leftEarlyMinutes ?? '',
        e.status, e.editedByName ?? '', e.approvedByName ?? '', teamOn(e.workerId, e.workDate),
      ];
    });
    return { headers: EXPORT_HEADERS, rows };
  }

  /**
   * Shared workers (links.router): "borrowed" = linked orgs' workers on our jobs (their entries whose workedFor names
   * us), "lent" = our workers on linked orgs' jobs (our entries with workedFor). Up to 92 days.
   */
  async linkedHours(ctx: FieldCtx, q: { from?: string; to?: string; direction?: string }) {
    if (!q.from || !q.to || !D.test(q.from) || !D.test(q.to)) throw new BadRequestException('Pick the dates');
    if ((Date.parse(q.to) - Date.parse(q.from)) / 86400_000 > 92) throw new BadRequestException('At most 92 days');
    const lent = q.direction === 'lent';
    const entries = await this.db.fieldTimeEntry.findMany({
      where: { ...(lent ? { organizationId: ctx.organizationId } : { organizationId: { not: ctx.organizationId } }), workDate: { gte: q.from, lte: q.to }, NOT: { workedFor: null } },
    });
    const mine = entries.filter((e: any) => e.workedFor && (lent ? Object.keys(e.workedFor).length > 0 : ctx.organizationId in e.workedFor));
    const n = await this.names(ctx.organizationId, mine);
    const orgs = await this.db.organization.findMany({ where: { id: { in: [...new Set(mine.flatMap((e: any) => (lent ? Object.keys(e.workedFor) : [e.organizationId])))] } }, select: { id: true, name: true } });
    const oName = new Map(orgs.map((o: any) => [o.id, o.name]));
    const rows = lent
      ? mine.flatMap((e: any) => Object.entries(e.workedFor as Record<string, number>).map(([org, minutes]) => ({ entryId: e.id, workerId: e.workerId, name: n.w.get(e.workerId) ?? '', workDate: e.workDate, organizationId: org, organizationName: oName.get(org) ?? org, minutes, grossMinutes: e.grossMinutes })))
      : mine.map((e: any) => ({ entryId: e.id, workerId: e.workerId, name: n.w.get(e.workerId) ?? '', workDate: e.workDate, organizationId: e.organizationId, organizationName: oName.get(e.organizationId) ?? '', minutes: (e.workedFor as any)[ctx.organizationId], grossMinutes: e.grossMinutes }));
    return { rows };
  }
}
