/**
 * Field > Leave (FIELD_PLAN.md phase 5). Ported from siteclock @62b7d9d src/modules/leave/leave.router.ts and
 * src/lib/leave.ts (leaveDaysInYear, leaveBalances). Oddities kept and shown (§6.1): no over-balance check (a
 * warning says by how much), balances count calendar days (payroll counts workdays), a new request writes no
 * audit and sends nothing (it comes from the app). Office side: types, entitlements, balances, the requests list,
 * record leave on behalf (approved at once), approve / reject, cancel (any status but cancelled), the month calendar.
 * Documents: imported ones stay in SiteClock until the files are copied; new ones come with the AIMS app.
 */
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import { PrismaService } from '../../common/prisma.service';
import { atLeast } from '../common/field-access';
import { FieldCtx } from '../common/field-context.service';

const dateRe = /^\d{4}-\d{2}-\d{2}$/;
const daysSchema = z.number().min(0).max(366).multipleOf(0.5);
const DAY_MS = 86_400_000;
const dayNum = (ymd: string) => Date.UTC(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10)) / DAY_MS;

/** Calendar days of a request falling inside `year` (half day = 0.5). */
export function leaveDaysInYear(r: { startDate: string; endDate: string; halfDay: boolean }, year: number) {
  const from = Math.max(dayNum(r.startDate), dayNum(`${year}-01-01`));
  const to = Math.min(dayNum(r.endDate), dayNum(`${year}-12-31`));
  if (to < from) return 0;
  return r.halfDay ? 0.5 : to - from + 1;
}

const yearOf = (q: unknown) => {
  const y = Number(q);
  return Number.isInteger(y) && y >= 2000 && y <= 2100 ? y : new Date().getFullYear();
};

function parseOr400<T>(schema: z.ZodType<T>, body: unknown): T {
  const r = schema.safeParse(body ?? {});
  if (!r.success) throw new BadRequestException({ message: 'Check the form', error: r.error.flatten() });
  return r.data;
}

const present = ({ documentKeys = [], ...r }: any) => ({
  ...r,
  hasDocument: documentKeys.length > 0,
  documentCount: documentKeys.length,
  documentsCopied: documentKeys.every((k: string) => !String(k).startsWith('siteclock:')),
  recorded: !!r.recordedById,
});

/** SiteClock leave.manage (types, entitlements, record, office cancel): the built-in Admin only; approving is leave.approve. */
function requireManage(ctx: FieldCtx) {
  if (!ctx.access.admin) throw new ForbiddenException('Only an Admin manages leave types, entitlements and recorded leave');
}

@Injectable()
export class FieldLeaveService {
  constructor(private readonly prisma: PrismaService) {}
  private get db(): any {
    return this.prisma as any;
  }

  // ── Types ─────────────────────────────────────────────────────────────────

  async types(ctx: FieldCtx, all?: string) {
    const types = await this.db.fieldLeaveType.findMany({ where: { organizationId: ctx.organizationId, ...(all === '1' ? {} : { archived: false }) }, orderBy: [{ archived: 'asc' }, { name: 'asc' }] });
    const counts = await this.db.fieldLeaveRequest.groupBy({ by: ['typeId'], where: { organizationId: ctx.organizationId }, _count: { _all: true } });
    const n = new Map((counts as any[]).map((c) => [c.typeId, c._count._all]));
    return { types: types.map((t: any) => ({ ...t, requestCount: n.get(t.id) ?? 0 })) };
  }

  async createType(ctx: FieldCtx, body: unknown) {
    requireManage(ctx);
    const d = parseOr400(z.object({ name: z.string().min(1), paid: z.boolean().default(true), defaultDays: daysSchema.nullable().optional(), requiresDocument: z.boolean().default(false) }), body);
    return { type: await this.db.fieldLeaveType.create({ data: { ...d, organizationId: ctx.organizationId } }) };
  }

  /** defaultDays is what new workers get; existing workers keep theirs. */
  async updateType(ctx: FieldCtx, id: string, body: unknown) {
    requireManage(ctx);
    const d = parseOr400(z.object({ name: z.string().min(1).optional(), paid: z.boolean().optional(), defaultDays: daysSchema.nullable().optional(), requiresDocument: z.boolean().optional() }), body);
    const before = await this.db.fieldLeaveType.findFirst({ where: { id, organizationId: ctx.organizationId } });
    if (!before) throw new NotFoundException('Not found');
    return { type: await this.db.fieldLeaveType.update({ where: { id }, data: d }), before };
  }

  /** A type nobody requested goes for good; one with requests is archived (past requests keep it). */
  async deleteType(ctx: FieldCtx, id: string) {
    requireManage(ctx);
    const type = await this.db.fieldLeaveType.findFirst({ where: { id, organizationId: ctx.organizationId } });
    if (!type) throw new NotFoundException('Not found');
    const used = await this.db.fieldLeaveRequest.count({ where: { typeId: id } });
    if (!used) {
      await this.db.$transaction([this.db.fieldLeaveEntitlement.deleteMany({ where: { typeId: id } }), this.db.fieldLeaveType.delete({ where: { id } })]);
      return { deleted: true, archived: false, action: 'LEAVE_TYPE_DELETE', before: type };
    }
    const updated = await this.db.fieldLeaveType.update({ where: { id }, data: { archived: true } });
    return { deleted: false, archived: true, type: updated, requestCount: used, action: 'LEAVE_TYPE_ARCHIVE', before: type };
  }

  async restoreType(ctx: FieldCtx, id: string) {
    requireManage(ctx);
    const type = await this.db.fieldLeaveType.findFirst({ where: { id, organizationId: ctx.organizationId } });
    if (!type) throw new NotFoundException('Not found');
    return { type: await this.db.fieldLeaveType.update({ where: { id }, data: { archived: false } }) };
  }

  // ── Balances ──────────────────────────────────────────────────────────────

  /** Per type for one worker and calendar year: entitled (own, else the type default), taken (approved), pending, remaining. */
  async balancesOf(organizationId: string, workerId: string, year: number) {
    const [types, ents, requests] = await Promise.all([
      this.db.fieldLeaveType.findMany({ where: { organizationId }, orderBy: { name: 'asc' } }),
      this.db.fieldLeaveEntitlement.findMany({ where: { workerId } }),
      this.db.fieldLeaveRequest.findMany({ where: { workerId, status: { in: ['APPROVED', 'PENDING'] }, startDate: { lte: `${year}-12-31` }, endDate: { gte: `${year}-01-01` } } }),
    ]);
    return types
      .map((t: any) => {
        const own = ents.find((e: any) => e.typeId === t.id);
        const entitled = own?.days ?? t.defaultDays;
        const sum = (status: string) => requests.filter((r: any) => r.typeId === t.id && r.status === status).reduce((n: number, r: any) => n + leaveDaysInYear(r, year), 0);
        const taken = sum('APPROVED');
        return { typeId: t.id, name: t.name, paid: t.paid, defaultDays: t.defaultDays, entitled: entitled ?? null, custom: !!own, taken, pending: sum('PENDING'), remaining: entitled == null ? null : entitled - taken, archived: t.archived };
      })
      .filter((b: any) => !b.archived || b.taken > 0);
  }

  /** Every active worker (scoped for a supervisor) with their balances for the year. */
  async balances(ctx: FieldCtx, q: { year?: string; workerId?: string }) {
    const year = yearOf(q.year);
    const workers = await this.db.worker.findMany({ where: { organizationId: ctx.organizationId, active: true, ...(q.workerId ? { id: q.workerId } : {}), ...(ctx.access.scoped.leave ? { id: { in: ctx.supervisedWorkerIds } } : {}) }, orderBy: { name: 'asc' } });
    const out = [];
    for (const w of workers) out.push({ workerId: w.id, name: w.name, balances: await this.balancesOf(ctx.organizationId, w.id, year) });
    return { year, workers: out };
  }

  /** Set a worker's days per type; null removes their own figure (the type default applies). */
  async setEntitlements(ctx: FieldCtx, workerId: string, body: unknown) {
    requireManage(ctx);
    const d = parseOr400(z.object({ entitlements: z.record(z.string(), daysSchema.nullable()) }), body);
    const worker = await this.db.worker.findFirst({ where: { id: workerId, organizationId: ctx.organizationId } });
    if (!worker) throw new NotFoundException('Not found');
    const typeIds = Object.keys(d.entitlements);
    if ((await this.db.fieldLeaveType.count({ where: { id: { in: typeIds }, organizationId: ctx.organizationId } })) !== typeIds.length) throw new BadRequestException('Unknown leave type');
    const before = await this.db.fieldLeaveEntitlement.findMany({ where: { workerId } });
    await this.db.$transaction(
      Object.entries(d.entitlements).map(([typeId, days]) =>
        days === null
          ? this.db.fieldLeaveEntitlement.deleteMany({ where: { workerId, typeId } })
          : this.db.fieldLeaveEntitlement.upsert({ where: { workerId_typeId: { workerId, typeId } }, create: { organizationId: ctx.organizationId, workerId, typeId, days }, update: { days } }),
      ),
    );
    const year = new Date().getFullYear();
    return { year, balances: await this.balancesOf(ctx.organizationId, workerId, year), before: before.map((e: any) => ({ typeId: e.typeId, days: e.days })) };
  }

  // ── Requests ──────────────────────────────────────────────────────────────

  private scopeWhere(ctx: FieldCtx) {
    return ctx.access.scoped.leave ? { workerId: { in: ctx.supervisedWorkerIds } } : {};
  }

  /** Over-balance warning (SiteClock has no check): remaining for the request's year after it, when negative. */
  private async overBy(ctx: FieldCtx, r: any): Promise<number | null> {
    const year = Number(r.startDate.slice(0, 4));
    const b = (await this.balancesOf(ctx.organizationId, r.workerId, year)).find((x: any) => x.typeId === r.typeId);
    if (!b || b.entitled == null) return null;
    const after = b.entitled - b.taken - (r.status === 'PENDING' ? leaveDaysInYear(r, year) : 0);
    return after < 0 ? -after : null;
  }

  async requests(ctx: FieldCtx, q: { status?: string }) {
    if (q.status && !['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'].includes(q.status)) throw new BadRequestException('Unknown status');
    const rows = await this.db.fieldLeaveRequest.findMany({ where: { organizationId: ctx.organizationId, ...(q.status ? { status: q.status } : {}), ...this.scopeWhere(ctx) }, orderBy: { createdAt: 'desc' } });
    const [types, workers] = await Promise.all([
      this.db.fieldLeaveType.findMany({ where: { organizationId: ctx.organizationId } }),
      this.db.worker.findMany({ where: { id: { in: [...new Set(rows.map((r: any) => r.workerId))] } }, select: { id: true, name: true } }),
    ]);
    const t = new Map(types.map((x: any) => [x.id, x]));
    const w = new Map(workers.map((x: any) => [x.id, x.name]));
    const out = [];
    for (const r of rows) {
      out.push({ ...present(r), type: t.get(r.typeId) ?? null, workerName: w.get(r.workerId) ?? '', days: leaveDaysInYear(r, Number(r.startDate.slice(0, 4))) + (r.endDate.slice(0, 4) !== r.startDate.slice(0, 4) ? leaveDaysInYear(r, Number(r.endDate.slice(0, 4))) : 0), overBy: ['PENDING', 'APPROVED'].includes(r.status) ? await this.overBy(ctx, r) : null });
    }
    return { requests: out };
  }

  /** The office enters leave a worker took: approved at once (documents optional: the office has the paper). */
  async record(ctx: FieldCtx, body: unknown) {
    requireManage(ctx);
    const d = parseOr400(z.object({ workerId: z.string(), typeId: z.string(), startDate: z.string().regex(dateRe), endDate: z.string().regex(dateRe), halfDay: z.boolean().default(false), reason: z.string().max(500).optional() }), body);
    if (d.endDate < d.startDate) throw new BadRequestException('The last day is before the first');
    const [worker, type] = await Promise.all([
      this.db.worker.findFirst({ where: { id: d.workerId, organizationId: ctx.organizationId } }),
      this.db.fieldLeaveType.findFirst({ where: { id: d.typeId, organizationId: ctx.organizationId } }),
    ]);
    if (!worker) throw new NotFoundException('Worker not found');
    if (!type || type.archived) throw new NotFoundException('Leave type not found');
    const request = await this.db.fieldLeaveRequest.create({
      data: { organizationId: ctx.organizationId, workerId: worker.id, typeId: type.id, startDate: d.startDate, endDate: d.endDate, halfDay: d.halfDay, reason: d.reason ?? null, status: 'APPROVED', recordedById: ctx.userId, recordedByName: ctx.userName, decidedById: ctx.userId, decidedByName: ctx.userName, decidedAt: new Date() },
    });
    return { request: present(request), overBy: await this.overBy(ctx, request) };
  }

  /** decideLeave: PENDING only; a supervisor only for their people. */
  async decide(ctx: FieldCtx, id: string, status: 'APPROVED' | 'REJECTED') {
    if (!atLeast(ctx.access.levels.leave, 'approve')) throw new ForbiddenException('You cannot approve leave');
    const r = await this.db.fieldLeaveRequest.findFirst({ where: { id, organizationId: ctx.organizationId, ...this.scopeWhere(ctx) } });
    if (!r) throw new NotFoundException('Not found');
    if (r.status !== 'PENDING') throw new ConflictException('Not pending');
    const overBy = status === 'APPROVED' ? await this.overBy(ctx, r) : null;
    const request = await this.db.fieldLeaveRequest.update({ where: { id }, data: { status, decidedById: ctx.userId, decidedByName: ctx.userName, decidedAt: new Date() } });
    return { request: present(request), overBy };
  }

  /** Office cancel of any request but a cancelled one (admin DELETE in SiteClock). */
  async cancel(ctx: FieldCtx, id: string) {
    requireManage(ctx);
    const r = await this.db.fieldLeaveRequest.findFirst({ where: { id, organizationId: ctx.organizationId } });
    if (!r) throw new NotFoundException('Not found');
    if (r.status === 'CANCELLED') throw new ConflictException('Already cancelled');
    return { request: present(await this.db.fieldLeaveRequest.update({ where: { id }, data: { status: 'CANCELLED' } })), before: { status: r.status } };
  }

  /** Approved leave in a month (yyyy-MM), optionally for a site's people. */
  async calendar(ctx: FieldCtx, q: { month?: string; siteId?: string }) {
    if (!q.month || !/^\d{4}-\d{2}$/.test(q.month)) throw new BadRequestException('Pick a month');
    let workerFilter: any = this.scopeWhere(ctx);
    if (q.siteId) {
      const at = (await this.db.fieldSiteAssignment.findMany({ where: { organizationId: ctx.organizationId, siteId: q.siteId }, select: { workerId: true } })).map((a: any) => a.workerId);
      workerFilter = { workerId: { in: ctx.access.scoped.leave ? at.filter((x: string) => ctx.supervisedWorkerIds.includes(x)) : at } };
    }
    const rows = await this.db.fieldLeaveRequest.findMany({ where: { organizationId: ctx.organizationId, status: 'APPROVED', startDate: { lte: `${q.month}-31` }, endDate: { gte: `${q.month}-01` }, ...workerFilter }, orderBy: { startDate: 'asc' } });
    const [types, workers] = await Promise.all([
      this.db.fieldLeaveType.findMany({ where: { organizationId: ctx.organizationId } }),
      this.db.worker.findMany({ where: { id: { in: rows.map((r: any) => r.workerId) } }, select: { id: true, name: true } }),
    ]);
    const t = new Map(types.map((x: any) => [x.id, x.name]));
    const w = new Map(workers.map((x: any) => [x.id, x.name]));
    return { requests: rows.map((r: any) => ({ ...present(r), typeName: t.get(r.typeId) ?? '', workerName: w.get(r.workerId) ?? '' })) };
  }
}
