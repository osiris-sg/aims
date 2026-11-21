/**
 * Field > Workers, Teams, Sites, Trades, Invites, Photos on record, Linked orgs (FIELD_PLAN.md phase 1).
 *
 * Ported from siteclock backend @62b7d9d:
 *   src/modules/workers/workers.router.ts, src/modules/teams/teams.router.ts, src/modules/sites/sites.router.ts,
 *   src/modules/invites/invites.router.ts, src/modules/photos/photos.router.ts (office side), src/lib/links.ts,
 *   src/lib/accounts.ts (phoneTaken / otherCompaniesOf / userByPhone), src/lib/leave.ts (grantLeave).
 * Behaviour is kept, oddities included (FIELD_PLAN.md §6.1). Differences, all deliberate:
 *   - SiteClock User = AIMS Worker + FieldWorkerProfile; Team = WorkerTeam; TeamMembership = FieldTeamStint
 *     (WorkerTeamMember is kept as the team's current members, rebuilt from the stints on every change).
 *   - Scope: a supervisor (ASSIGNED) sees their supervised sites and their teams' people (FIELD_PLAN.md §6.2).
 *   - No push, no WhatsApp, no Clerk calls (office side only; the AIMS app sends nothing yet).
 *   - Files: photo keys are S3 keys; imported SiteClock paths are not served until the files are copied.
 */
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { z } from 'zod';
import { PrismaService } from '../../common/prisma.service';
import { FieldCtx } from '../common/field-context.service';
import { searchAddress } from '../common/geocode';
import { fieldSettings } from '../common/settings';
import { addDays, todayIn } from '../common/time';

const dateRe = /^\d{4}-\d{2}-\d{2}$/;
const ymd = z.string().regex(dateRe);
const phoneRe = /^\+?[0-9]{8,15}$/;

type Stint = { startDate: string; endDate: string | null };
/** Was this stint active on `date`? (teams.router coversDate) */
export const coversDate = (m: Stint, date: string) => m.startDate <= date && (m.endDate === null || m.endDate >= date);
/** (teams.router overlaps) */
export const overlaps = (a: Stint, b: Stint) => a.startDate <= (b.endDate ?? '9999-12-31') && b.startDate <= (a.endDate ?? '9999-12-31');

/** workers.router normalizeWorkerBody: "" means back to the company rule. */
export function normalizeWorkerBody(body: Record<string, unknown>) {
  const raw: Record<string, unknown> = { ...(body || {}) };
  for (const k of ['jobClocking', 'offSiteClocking', 'selfiePolicy', 'baseClocking']) if (raw[k] === '' || raw[k] === 'null') raw[k] = null;
  for (const k of ['crewMarginBeforeMin', 'crewMarginAfterMin']) {
    if (raw[k] === '' || raw[k] === 'null') raw[k] = null;
    else if (typeof raw[k] === 'string' && /^\d+$/.test(raw[k] as string)) raw[k] = Number(raw[k]);
  }
  if (raw.employeeNo === '') delete raw.employeeNo;
  return raw;
}

export const workerSchema = z.object({
  phone: z.string().regex(phoneRe),
  name: z.string().min(1),
  tier: z.enum(['WORKER', 'SUPERVISOR', 'COMPANY_ADMIN']).optional(),
  employeeNo: z.string().optional(),
  siteIds: z.array(z.string()).default([]),
  supervisorSiteIds: z.array(z.string()).default([]),
  active: z.boolean().optional(),
  attendanceExempt: z.boolean().optional(),
  payslipVisible: z.boolean().optional(),
  jobClocking: z.enum(['OFF', 'ARRIVE', 'ARRIVE_LEAVE']).nullable().optional(),
  offSiteClocking: z.enum(['REVIEW', 'MARK', 'BLOCK']).nullable().optional(),
  selfiePolicy: z.enum(['SMART', 'ALWAYS']).nullable().optional(),
  baseClocking: z.enum(['ALLOWED', 'NOT_ALLOWED']).nullable().optional(),
  payFollowsCrew: z.boolean().optional(),
  sharedWithLinked: z.boolean().optional(),
  crewMarginBeforeMin: z.number().int().min(0).max(720).nullable().optional(),
  crewMarginAfterMin: z.number().int().min(0).max(720).nullable().optional(),
  leaveDays: z.record(z.string(), z.number().min(0).max(366).multipleOf(0.5)).optional(),
  userId: z.string().nullable().optional(), // AIMS login link (Workers & Teams)
});

export const siteSchema = z.object({
  name: z.string().min(1),
  address: z.string().optional(),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  radiusM: z.number().int().min(20).max(5000).default(150),
  timezone: z.string().default('Asia/Singapore'),
  maxAccuracyM: z.number().int().min(10).max(500).default(50),
  autoCloseAfterH: z.number().int().min(1).max(48).default(14),
  active: z.boolean().optional(),
  kind: z.enum(['PERMANENT', 'BASE']).optional(),
  allWorkers: z.boolean().optional(),
});

const inviteSchema = z.object({
  label: z.string().max(60).optional(),
  role: z.enum(['WORKER', 'SUPERVISOR']).optional(),
  siteId: z.string().optional(),
  templateId: z.string().optional(),
  templateIds: z.array(z.string()).max(10).optional(),
  expiresAt: z.string().datetime().optional().nullable(),
  maxUses: z.number().int().min(1).max(10000).optional().nullable(),
  leaveDays: z.record(z.string(), z.number().min(0).max(366).multipleOf(0.5)).optional().nullable(),
});

const PROFILE_KEYS = [
  'employeeNo', 'attendanceExempt', 'payslipVisible', 'jobClocking', 'offSiteClocking', 'selfiePolicy', 'baseClocking',
  'payFollowsCrew', 'sharedWithLinked', 'crewMarginBeforeMin', 'crewMarginAfterMin',
] as const;

function parseOr400<T>(schema: z.ZodType<T>, body: unknown): T {
  const r = schema.safeParse(body);
  if (!r.success) throw new BadRequestException({ message: 'Check the form', error: r.error.flatten() });
  return r.data;
}

@Injectable()
export class FieldPeopleService {
  constructor(private readonly prisma: PrismaService) {}
  private get db(): any {
    return this.prisma as any;
  }

  // ── Scope helpers ─────────────────────────────────────────────────────────

  /** Workers a supervisor may see: anyone at a site the caller is assigned to (any assignment) + their team members (workers.router GET /). */
  private async workerScope(ctx: FieldCtx): Promise<Record<string, unknown>> {
    if (!ctx.access.scoped.people) return {};
    const mySites = ctx.workerId
      ? (await this.db.fieldSiteAssignment.findMany({ where: { organizationId: ctx.organizationId, workerId: ctx.workerId }, select: { siteId: true } })).map((a: any) => a.siteId)
      : [];
    const inSites = mySites.length
      ? (await this.db.fieldSiteAssignment.findMany({ where: { organizationId: ctx.organizationId, siteId: { in: mySites } }, select: { workerId: true } })).map((a: any) => a.workerId)
      : [];
    return { id: { in: [...new Set([...inSites, ...ctx.supervisedWorkerIds])] } };
  }

  private async worker(organizationId: string, id: string) {
    const w = await this.db.worker.findFirst({ where: { id, organizationId } });
    if (!w) throw new NotFoundException('Not found');
    return w;
  }

  private async profile(organizationId: string, workerId: string) {
    const p = await this.db.fieldWorkerProfile.findUnique({ where: { workerId } });
    if (p) return p;
    return this.db.fieldWorkerProfile.create({ data: { organizationId, workerId } });
  }

  // ── Workers ───────────────────────────────────────────────────────────────

  async listWorkers(ctx: FieldCtx) {
    const org = ctx.organizationId;
    const scope = await this.workerScope(ctx);
    const workers = await this.db.worker.findMany({ where: { organizationId: org, ...scope }, orderBy: { name: 'asc' } });
    const ids = workers.map((w: any) => w.id);
    const [profiles, asgs, sites, photos, trades, tradeNames, stints, teams] = await Promise.all([
      this.db.fieldWorkerProfile.findMany({ where: { organizationId: org, workerId: { in: ids } } }),
      this.db.fieldSiteAssignment.findMany({ where: { organizationId: org, workerId: { in: ids } } }),
      this.db.fieldSite.findMany({ where: { organizationId: org }, select: { id: true, name: true } }),
      this.db.fieldPhotoUpdate.findMany({ where: { organizationId: org, workerId: { in: ids }, status: { in: ['REQUESTED', 'PENDING'] } }, orderBy: { createdAt: 'desc' } }),
      this.db.fieldWorkerTrade.findMany({ where: { organizationId: org, workerId: { in: ids } } }),
      this.db.fieldTrade.findMany({ where: { organizationId: org }, select: { id: true, name: true } }),
      this.db.fieldTeamStint.findMany({ where: { organizationId: org, workerId: { in: ids } } }),
      this.db.workerTeam.findMany({ where: { organizationId: org }, select: { id: true, name: true, active: true } }),
    ]);
    const today = todayIn(ctx.timezone);
    const siteName = new Map(sites.map((s: any) => [s.id, s.name]));
    const tradeName = new Map(tradeNames.map((t: any) => [t.id, t.name]));
    const teamById = new Map(teams.map((t: any) => [t.id, t]));
    const prof = new Map(profiles.map((p: any) => [p.workerId, p]));
    return {
      workers: workers.map((w: any) => {
        const p: any = prof.get(w.id) || {};
        const photo = photos.find((x: any) => x.workerId === w.id);
        return {
          id: w.id,
          name: w.name,
          phone: w.phone,
          active: w.active,
          userId: w.userId,
          siteclockId: w.siteclockId,
          tier: p.tier ?? 'WORKER',
          siteclockRoleName: p.siteclockRoleName ?? null,
          employeeNo: p.employeeNo ?? null,
          overrides: Object.fromEntries(PROFILE_KEYS.filter((k) => k !== 'employeeNo').map((k) => [k, p[k] ?? null])),
          device: { bound: !!p.deviceId, boundAt: p.deviceBoundAt ?? null, verified: p.deviceVerified ?? true },
          photo: { hasPhoto: !!p.photoKey, verifyRequested: !!p.verifyRequested, update: photo ? { id: photo.id, status: photo.status } : null },
          sites: asgs.filter((a: any) => a.workerId === w.id).map((a: any) => ({ siteId: a.siteId, name: siteName.get(a.siteId) ?? '', isSupervisor: a.isSupervisor })),
          trades: trades.filter((t: any) => t.workerId === w.id).map((t: any) => ({ id: t.tradeId, name: tradeName.get(t.tradeId) ?? '' })),
          teams: stints
            .filter((s: any) => s.workerId === w.id && coversDate(s, today))
            .map((s: any) => teamById.get(s.teamId))
            .filter((t: any) => t && t.active)
            .map((t: any) => ({ id: t.id, name: t.name })),
        };
      }),
    };
  }

  /** Names only, for pickers (workers.router GET /directory). */
  async directory(ctx: FieldCtx) {
    const scope = await this.workerScope(ctx);
    const workers = await this.db.worker.findMany({ where: { organizationId: ctx.organizationId, active: true, ...scope }, select: { id: true, name: true }, orderBy: { name: 'asc' } });
    return { workers };
  }

  /** phoneTaken: twice in this org is a clash; another org is fine (one login, an account per company). */
  private async phoneTaken(phone: string, organizationId: string, exceptId?: string): Promise<string | null> {
    const rows = await this.db.worker.findMany({ where: { phone, organizationId, ...(exceptId ? { id: { not: exceptId } } : {}) }, select: { id: true } });
    return rows.length ? 'Phone already registered' : null;
  }

  /** otherCompaniesOf: names of other orgs this phone has an active worker in. */
  private async otherOrgs(phone: string, organizationId: string): Promise<string[]> {
    const rows = await this.db.worker.findMany({ where: { phone, active: true, organizationId: { not: organizationId } }, select: { organizationId: true } });
    if (!rows.length) return [];
    const orgs = await this.db.organization.findMany({ where: { id: { in: rows.map((r: any) => r.organizationId) } }, select: { name: true } });
    return orgs.map((o: any) => o.name);
  }

  /** Active COMPANY_ADMIN-tier workers (permissions.adminCount). */
  private async adminCount(organizationId: string) {
    const profs = await this.db.fieldWorkerProfile.findMany({ where: { organizationId, tier: 'COMPANY_ADMIN' }, select: { workerId: true } });
    if (!profs.length) return 0;
    return this.db.worker.count({ where: { organizationId, active: true, id: { in: profs.map((p: any) => p.workerId) } } });
  }

  /** grantLeave (lib/leave.ts): each tracked type's default days, overridden per type. */
  private async grantLeave(tx: any, organizationId: string, workerId: string, overrides?: Record<string, number> | null) {
    const types = await tx.fieldLeaveType.findMany({ where: { organizationId, archived: false } });
    const rows = types
      .map((t: any) => ({ organizationId, workerId, typeId: t.id, days: overrides?.[t.id] ?? t.defaultDays }))
      .filter((r: any) => typeof r.days === 'number');
    if (rows.length) await tx.fieldLeaveEntitlement.createMany({ data: rows, skipDuplicates: true });
  }

  private async checkSites(organizationId: string, ids: string[]) {
    if (!ids.length) return;
    const n = await this.db.fieldSite.count({ where: { organizationId, id: { in: ids } } });
    if (n !== ids.length) throw new BadRequestException('Invalid siteIds');
  }

  async createWorker(ctx: FieldCtx, body: unknown) {
    const d = parseOr400(workerSchema, normalizeWorkerBody(body as any));
    const org = ctx.organizationId;
    const taken = await this.phoneTaken(d.phone, org);
    if (taken) throw new ConflictException(taken);
    const allSiteIds = [...new Set([...d.siteIds, ...d.supervisorSiteIds])];
    await this.checkSites(org, allSiteIds);
    const tier = d.tier ?? 'WORKER';
    const worker = await this.db.$transaction(async (tx: any) => {
      const w = await tx.worker.create({ data: { organizationId: org, name: d.name, phone: d.phone, role: tier, active: d.active ?? true, userId: d.userId ?? null } });
      await tx.fieldWorkerProfile.create({ data: { organizationId: org, workerId: w.id, tier, ...pick(d, PROFILE_KEYS) } });
      // A SUPERVISOR-tier person supervises every site they are assigned to.
      if (allSiteIds.length)
        await tx.fieldSiteAssignment.createMany({ data: allSiteIds.map((siteId) => ({ organizationId: org, siteId, workerId: w.id, isSupervisor: tier === 'SUPERVISOR' || d.supervisorSiteIds.includes(siteId) })) });
      await this.grantLeave(tx, org, w.id, d.leaveDays);
      return w;
    });
    return { worker, otherCompanies: await this.otherOrgs(d.phone, org) };
  }

  async updateWorker(ctx: FieldCtx, id: string, body: unknown) {
    const d = parseOr400(workerSchema.partial(), normalizeWorkerBody(body as any));
    const org = ctx.organizationId;
    const before = await this.worker(org, id);
    if (ctx.access.scoped.people) throw new ForbiddenException('Forbidden');
    const prof = await this.profile(org, id);
    // The last active admin can neither step down nor be deactivated.
    const wasAdmin = prof.tier === 'COMPANY_ADMIN';
    const losesAdmin = wasAdmin && ((d.tier && d.tier !== 'COMPANY_ADMIN') || d.active === false);
    if (losesAdmin && before.active && (await this.adminCount(org)) <= 1) {
      throw new ConflictException({ message: "This is the company's only admin. Make someone else an admin first.", code: 'LAST_ADMIN' });
    }
    if (d.phone && d.phone !== before.phone) {
      // Oddity kept (§6.1 #15): a phone change refuses a number held in ANY org, while create refuses only this org.
      const clash = await this.db.worker.findFirst({ where: { phone: d.phone, id: { not: id } } });
      if (clash) throw new ConflictException('That number is already registered to another account');
    }
    const updated = await this.db.$transaction(async (tx: any) => {
      if (d.siteIds !== undefined || d.supervisorSiteIds !== undefined) {
        const wanted = [...new Set([...(d.siteIds ?? []), ...(d.supervisorSiteIds ?? [])])];
        const n = await tx.fieldSite.count({ where: { organizationId: org, id: { in: wanted } } });
        if (n !== wanted.length) throw new BadRequestException('Invalid siteIds');
        await tx.fieldSiteAssignment.deleteMany({ where: { organizationId: org, workerId: id } });
        const effTier = d.tier ?? prof.tier;
        if (wanted.length)
          await tx.fieldSiteAssignment.createMany({ data: wanted.map((siteId) => ({ organizationId: org, siteId, workerId: id, isSupervisor: effTier === 'SUPERVISOR' || (d.supervisorSiteIds ?? []).includes(siteId) })) });
      }
      const w = await tx.worker.update({
        where: { id },
        data: { ...(d.name !== undefined ? { name: d.name } : {}), ...(d.phone !== undefined ? { phone: d.phone } : {}), ...(d.active !== undefined ? { active: d.active } : {}), ...(d.tier ? { role: d.tier } : {}), ...(d.userId !== undefined ? { userId: d.userId } : {}) },
      });
      await tx.fieldWorkerProfile.update({ where: { workerId: id }, data: { ...(d.tier ? { tier: d.tier } : {}), ...pick(d, PROFILE_KEYS) } });
      return w;
    });
    return { worker: updated, before };
  }

  /** workers.router POST /:id/change-phone (no OTP codes in AIMS to clear). */
  async changePhone(ctx: FieldCtx, id: string, body: any) {
    const p = z.object({ phone: z.string().regex(phoneRe), resetDevice: z.boolean().default(false) }).safeParse(body);
    if (!p.success) throw new BadRequestException('Enter a valid phone number, e.g. +6591234567');
    const before = await this.worker(ctx.organizationId, id);
    const phone = p.data.phone.startsWith('+') ? p.data.phone : `+${p.data.phone}`;
    if (phone === before.phone) throw new BadRequestException("That is already this worker's number");
    const clash = await this.db.worker.findFirst({ where: { phone, id: { not: id } } });
    if (clash) throw new ConflictException(clash.organizationId === ctx.organizationId ? `${phone} already belongs to ${clash.name}` : 'That number is already registered to another account');
    const worker = await this.db.$transaction(async (tx: any) => {
      const w = await tx.worker.update({ where: { id }, data: { phone } });
      if (p.data.resetDevice) await tx.fieldWorkerProfile.upsert({ where: { workerId: id }, update: { deviceId: null, deviceVerified: true }, create: { organizationId: ctx.organizationId, workerId: id } });
      return w;
    });
    return { worker, before: { phone: before.phone }, after: { phone, deviceReset: p.data.resetDevice } };
  }

  async resetDevice(ctx: FieldCtx, id: string) {
    await this.worker(ctx.organizationId, id);
    const before = await this.profile(ctx.organizationId, id);
    const profile = await this.db.fieldWorkerProfile.update({ where: { workerId: id }, data: { deviceId: null, deviceBoundAt: null } });
    return { profile, before: { deviceId: before.deviceId ? 'set' : null } };
  }

  /** workers.router POST /:id/request-verification (supervisors: a worker on their site or in their team). */
  async requestVerification(ctx: FieldCtx, id: string) {
    const w = await this.worker(ctx.organizationId, id);
    if (ctx.access.scoped.people) {
      const onMySite = await this.db.fieldSiteAssignment.count({ where: { organizationId: ctx.organizationId, workerId: w.id, siteId: { in: ctx.supervisedSiteIds } } });
      if (!onMySite && !ctx.supervisedWorkerIds.includes(w.id)) throw new ForbiddenException('Forbidden');
    }
    await this.profile(ctx.organizationId, id);
    await this.db.fieldWorkerProfile.update({ where: { workerId: id }, data: { verifyRequested: true } });
    return { ok: true };
  }

  async setTrades(ctx: FieldCtx, workerId: string, body: any) {
    const p = z.object({ tradeIds: z.array(z.string()).max(10) }).safeParse(body);
    if (!p.success) throw new BadRequestException('Check the form');
    await this.worker(ctx.organizationId, workerId);
    const n = await this.db.fieldTrade.count({ where: { organizationId: ctx.organizationId, id: { in: p.data.tradeIds } } });
    if (n !== p.data.tradeIds.length) throw new BadRequestException('Unknown trade');
    await this.db.$transaction([
      this.db.fieldWorkerTrade.deleteMany({ where: { organizationId: ctx.organizationId, workerId } }),
      this.db.fieldWorkerTrade.createMany({ data: p.data.tradeIds.map((tradeId) => ({ organizationId: ctx.organizationId, workerId, tradeId })) }),
    ]);
    return { ok: true };
  }

  // ── Teams (dated stints) ─────────────────────────────────────────────────

  /** Keep WorkerTeamMember = the team's members today (open stints), so the job crew picker stays right. */
  private async syncCurrentMembers(organizationId: string, teamId: string, timezone: string) {
    const today = todayIn(timezone);
    const stints = await this.db.fieldTeamStint.findMany({ where: { organizationId, teamId } });
    const now = new Set<string>(stints.filter((s: any) => coversDate(s, today)).map((s: any) => s.workerId));
    const rows = await this.db.workerTeamMember.findMany({ where: { organizationId, teamId } });
    const have = new Set<string>(rows.map((r: any) => r.workerId));
    const drop = rows.filter((r: any) => !now.has(r.workerId)).map((r: any) => r.id);
    if (drop.length) await this.db.workerTeamMember.deleteMany({ where: { id: { in: drop } } });
    const add = [...now].filter((w) => !have.has(w));
    if (add.length) await this.db.workerTeamMember.createMany({ data: add.map((workerId) => ({ organizationId, teamId, workerId, source: 'field' })), skipDuplicates: true });
  }

  private async team(organizationId: string, id: string) {
    const t = await this.db.workerTeam.findFirst({ where: { id, organizationId } });
    if (!t) throw new NotFoundException('Not found');
    return t;
  }

  async listTeams(ctx: FieldCtx, q: { date?: string; all?: string }) {
    const org = ctx.organizationId;
    const date = q.date && dateRe.test(q.date) ? q.date : todayIn(ctx.timezone);
    const teams = await this.db.workerTeam.findMany({ where: { organizationId: org, ...(q.all === '1' ? {} : { active: true }) }, orderBy: { name: 'asc' } });
    const ids = teams.map((t: any) => t.id);
    const [stints, sups] = await Promise.all([
      this.db.fieldTeamStint.findMany({ where: { organizationId: org, teamId: { in: ids } }, orderBy: { startDate: 'asc' } }),
      this.db.fieldTeamSupervisor.findMany({ where: { organizationId: org, teamId: { in: ids } } }),
    ]);
    const wids = [...new Set<string>([...stints.map((s: any) => s.workerId), ...sups.map((s: any) => s.workerId)])];
    const workers = await this.db.worker.findMany({ where: { id: { in: wids } }, select: { id: true, name: true, active: true } });
    const wById = new Map(workers.map((w: any) => [w.id, w]));
    const profs = await this.db.fieldWorkerProfile.findMany({ where: { workerId: { in: wids } }, select: { workerId: true, employeeNo: true, tier: true } });
    const pById = new Map(profs.map((p: any) => [p.workerId, p]));
    const person = (id: string) => {
      const w: any = wById.get(id) || { id, name: '', active: false };
      const p: any = pById.get(id) || {};
      return { id, name: w.name, active: w.active, employeeNo: p.employeeNo ?? null, tier: p.tier ?? 'WORKER' };
    };
    return {
      date,
      teams: teams.map((t: any) => {
        const mine = stints.filter((s: any) => s.teamId === t.id);
        return {
          id: t.id,
          name: t.name,
          active: t.active,
          siteclockId: t.siteclockId,
          supervisors: sups.filter((s: any) => s.teamId === t.id).map((s: any) => person(s.workerId)).sort((a: any, b: any) => a.name.localeCompare(b.name)),
          members: mine
            .filter((m: any) => coversDate(m, date))
            .map((m: any) => ({ membershipId: m.id, startDate: m.startDate, endDate: m.endDate, ...person(m.workerId) }))
            .sort((a: any, b: any) => a.name.localeCompare(b.name)),
          everCount: new Set(mine.map((m: any) => m.workerId)).size,
        };
      }),
    };
  }

  async teamHistory(ctx: FieldCtx, id: string) {
    const team = await this.team(ctx.organizationId, id);
    const stints = await this.db.fieldTeamStint.findMany({ where: { organizationId: ctx.organizationId, teamId: id }, orderBy: [{ startDate: 'asc' }, { createdAt: 'asc' }] });
    const workers = await this.db.worker.findMany({ where: { id: { in: stints.map((s: any) => s.workerId) } }, select: { id: true, name: true } });
    const name = new Map(workers.map((w: any) => [w.id, w.name]));
    return { team: { id: team.id, name: team.name, active: team.active }, stints: stints.map((s: any) => ({ id: s.id, workerId: s.workerId, name: name.get(s.workerId) ?? '', startDate: s.startDate, endDate: s.endDate })) };
  }

  private async orgWorkers(organizationId: string, ids: string[]) {
    const ws = await this.db.worker.findMany({ where: { id: { in: ids }, organizationId }, select: { id: true, name: true } });
    return ws.length === new Set(ids).size ? ws : null;
  }

  /** Supervisors must be SUPERVISOR or COMPANY_ADMIN tier (teams.router companySupervisors). */
  private async orgSupervisors(organizationId: string, ids: string[]) {
    const profs = await this.db.fieldWorkerProfile.findMany({ where: { organizationId, workerId: { in: ids }, tier: { in: ['SUPERVISOR', 'COMPANY_ADMIN'] } }, select: { workerId: true } });
    return profs.length === new Set(ids).size;
  }

  /** addMembers: refuses (listing names) anyone already in the team on or after that date. */
  private async addMembers(ctx: FieldCtx, teamId: string, workerIds: string[], startDate: string) {
    const ws = await this.orgWorkers(ctx.organizationId, workerIds);
    if (!ws) return { error: 'Unknown worker' } as const;
    const existing = await this.db.fieldTeamStint.findMany({ where: { organizationId: ctx.organizationId, teamId, workerId: { in: workerIds } } });
    const clash = ws.filter((u: any) => existing.some((m: any) => m.workerId === u.id && overlaps(m, { startDate, endDate: null })));
    if (clash.length) return { error: `${clash.map((u: any) => u.name).join(', ')} ${clash.length === 1 ? 'is' : 'are'} already in this team on or after ${startDate}` } as const;
    await this.db.fieldTeamStint.createMany({ data: workerIds.map((workerId) => ({ organizationId: ctx.organizationId, teamId, workerId, startDate })) });
    await this.syncCurrentMembers(ctx.organizationId, teamId, ctx.timezone);
    return { ok: true } as const;
  }

  async createTeam(ctx: FieldCtx, body: unknown) {
    const d = parseOr400(
      z.object({ name: z.string().trim().min(1).max(80), memberIds: z.array(z.string()).max(500).default([]), startDate: ymd.optional(), supervisorIds: z.array(z.string()).max(20).default([]) }),
      body,
    );
    const org = ctx.organizationId;
    const dup = await this.db.workerTeam.findFirst({ where: { organizationId: org, name: { equals: d.name, mode: 'insensitive' }, active: true } });
    if (dup) throw new ConflictException(`A team called "${dup.name}" already exists`);
    if (d.memberIds.length && !(await this.orgWorkers(org, d.memberIds))) throw new BadRequestException('Unknown worker');
    if (d.supervisorIds.length && !(await this.orgSupervisors(org, d.supervisorIds))) throw new BadRequestException('Only supervisors can supervise a team');
    const startDate = d.startDate ?? todayIn(ctx.timezone);
    const team = await this.db.workerTeam.create({ data: { organizationId: org, name: d.name } });
    if (d.supervisorIds.length) await this.db.fieldTeamSupervisor.createMany({ data: d.supervisorIds.map((workerId) => ({ organizationId: org, teamId: team.id, workerId })) });
    if (d.memberIds.length) await this.addMembers(ctx, team.id, d.memberIds, startDate);
    return { team, after: { name: team.name, memberIds: d.memberIds, supervisorIds: d.supervisorIds, startDate } };
  }

  async setSupervisors(ctx: FieldCtx, teamId: string, body: unknown) {
    const d = parseOr400(z.object({ workerIds: z.array(z.string()).max(20) }), body);
    const org = ctx.organizationId;
    await this.team(org, teamId);
    const ids = [...new Set(d.workerIds)];
    if (ids.length && !(await this.orgSupervisors(org, ids))) throw new BadRequestException('Only supervisors can supervise a team');
    const before = await this.db.fieldTeamSupervisor.findMany({ where: { organizationId: org, teamId } });
    await this.db.$transaction([
      this.db.fieldTeamSupervisor.deleteMany({ where: { organizationId: org, teamId, workerId: { notIn: ids } } }),
      ...ids.filter((w) => !before.some((s: any) => s.workerId === w)).map((workerId) => this.db.fieldTeamSupervisor.create({ data: { organizationId: org, teamId, workerId } })),
    ]);
    return { supervisorIds: ids, before: before.map((s: any) => s.workerId) };
  }

  /** Rename / archive / restore; archiving keeps the history. */
  async updateTeam(ctx: FieldCtx, teamId: string, body: unknown) {
    const d = parseOr400(z.object({ name: z.string().trim().min(1).max(80).optional(), active: z.boolean().optional() }), body);
    const before = await this.team(ctx.organizationId, teamId);
    const team = await this.db.workerTeam.update({ where: { id: teamId }, data: d });
    return { team, before };
  }

  async addTeamMembers(ctx: FieldCtx, teamId: string, body: unknown) {
    const d = parseOr400(z.object({ workerIds: z.array(z.string()).min(1).max(500), startDate: ymd.optional() }), body);
    await this.team(ctx.organizationId, teamId);
    const startDate = d.startDate ?? todayIn(ctx.timezone);
    const r = await this.addMembers(ctx, teamId, d.workerIds, startDate);
    if ('error' in r) throw r.error === 'Unknown worker' ? new BadRequestException(r.error) : new ConflictException(r.error);
    return { ok: true, startDate };
  }

  /** End a worker's current stint; a last day before the start removes the stint (added by mistake). */
  async removeTeamMember(ctx: FieldCtx, teamId: string, workerId: string, body: unknown) {
    const d = parseOr400(z.object({ lastDay: ymd.optional() }), body ?? {});
    await this.team(ctx.organizationId, teamId);
    const stint = await this.db.fieldTeamStint.findFirst({ where: { organizationId: ctx.organizationId, teamId, workerId, endDate: null } });
    if (!stint) throw new NotFoundException('Not a current member of this team');
    const lastDay = d.lastDay ?? addDays(todayIn(ctx.timezone), -1);
    const discarded = lastDay < stint.startDate;
    if (discarded) await this.db.fieldTeamStint.delete({ where: { id: stint.id } });
    else await this.db.fieldTeamStint.update({ where: { id: stint.id }, data: { endDate: lastDay } });
    await this.syncCurrentMembers(ctx.organizationId, teamId, ctx.timezone);
    return { ok: true, lastDay, discarded, before: stint };
  }

  async editStint(ctx: FieldCtx, id: string, body: unknown) {
    const d = parseOr400(z.object({ startDate: ymd.optional(), endDate: ymd.nullable().optional() }), body);
    const before = await this.db.fieldTeamStint.findFirst({ where: { id, organizationId: ctx.organizationId } });
    if (!before) throw new NotFoundException('Not found');
    const next = { startDate: d.startDate ?? before.startDate, endDate: d.endDate === undefined ? before.endDate : d.endDate };
    if (next.endDate && next.endDate < next.startDate) throw new BadRequestException("The last day can't be before the first day");
    const others = await this.db.fieldTeamStint.findMany({ where: { organizationId: ctx.organizationId, teamId: before.teamId, workerId: before.workerId, id: { not: id } } });
    if (others.some((o: any) => overlaps(o, next))) throw new ConflictException('Those dates overlap another period this worker was in the team');
    const stint = await this.db.fieldTeamStint.update({ where: { id }, data: next });
    await this.syncCurrentMembers(ctx.organizationId, before.teamId, ctx.timezone);
    return { stint, before };
  }

  async deleteStint(ctx: FieldCtx, id: string) {
    const before = await this.db.fieldTeamStint.findFirst({ where: { id, organizationId: ctx.organizationId } });
    if (!before) throw new NotFoundException('Not found');
    await this.db.fieldTeamStint.delete({ where: { id } });
    await this.syncCurrentMembers(ctx.organizationId, before.teamId, ctx.timezone);
    return { ok: true, before };
  }

  // ── Sites ─────────────────────────────────────────────────────────────────

  async listSites(ctx: FieldCtx, q: { kind?: string }) {
    const org = ctx.organizationId;
    const scope = ctx.access.scoped.people ? { id: { in: ctx.supervisedSiteIds } } : {};
    const kind = q.kind === 'all' ? {} : q.kind === 'job' ? { kind: 'JOB' } : { kind: { in: ['PERMANENT', 'BASE'] } };
    const sites = await this.db.fieldSite.findMany({ where: { organizationId: org, ...scope, ...kind }, orderBy: { name: 'asc' } });
    const asgs = await this.db.fieldSiteAssignment.findMany({ where: { organizationId: org, siteId: { in: sites.map((s: any) => s.id) } } });
    const workers = await this.db.worker.findMany({ where: { id: { in: asgs.map((a: any) => a.workerId) } }, select: { id: true, name: true } });
    const name = new Map(workers.map((w: any) => [w.id, w.name]));
    return {
      sites: sites.map((s: any) => ({
        ...s,
        assignments: asgs.filter((a: any) => a.siteId === s.id).map((a: any) => ({ workerId: a.workerId, name: name.get(a.workerId) ?? '', isSupervisor: a.isSupervisor })),
      })),
    };
  }

  async geocode(q: string) {
    const s = String(q ?? '').trim();
    if (s.length < 3) return { results: [] };
    return { results: await searchAddress(s) };
  }

  async createSite(ctx: FieldCtx, body: unknown) {
    const d = parseOr400(siteSchema, body);
    const site = await this.db.fieldSite.create({ data: { ...d, organizationId: ctx.organizationId } });
    return { site };
  }

  /** sites.router PATCH /:id (not scope-restricted in SiteClock; AIMS: admins / company-scope only). */
  async updateSite(ctx: FieldCtx, id: string, body: unknown) {
    const d = parseOr400(siteSchema.partial(), body);
    if (ctx.access.scoped.people) throw new ForbiddenException('Forbidden');
    const before = await this.db.fieldSite.findFirst({ where: { id, organizationId: ctx.organizationId } });
    if (!before) throw new NotFoundException('Not found');
    const site = await this.db.fieldSite.update({ where: { id }, data: d });
    return { site, before };
  }

  /** The full list of people at a site (replaces it). */
  async setSiteAssignments(ctx: FieldCtx, siteId: string, body: unknown) {
    const d = parseOr400(z.object({ assignments: z.array(z.object({ workerId: z.string(), isSupervisor: z.boolean().default(false) })).max(1000) }), body);
    const org = ctx.organizationId;
    const site = await this.db.fieldSite.findFirst({ where: { id: siteId, organizationId: org } });
    if (!site) throw new NotFoundException('Not found');
    const ids = [...new Set(d.assignments.map((a) => a.workerId))];
    if (ids.length && !(await this.orgWorkers(org, ids))) throw new BadRequestException('Unknown worker');
    const before = await this.db.fieldSiteAssignment.findMany({ where: { organizationId: org, siteId } });
    await this.db.$transaction([
      this.db.fieldSiteAssignment.deleteMany({ where: { organizationId: org, siteId } }),
      this.db.fieldSiteAssignment.createMany({ data: d.assignments.map((a) => ({ organizationId: org, siteId, workerId: a.workerId, isSupervisor: a.isSupervisor })) }),
    ]);
    return { ok: true, before: before.map((a: any) => ({ workerId: a.workerId, isSupervisor: a.isSupervisor })) };
  }

  // ── Trades ────────────────────────────────────────────────────────────────

  async listTrades(ctx: FieldCtx) {
    const trades = await this.db.fieldTrade.findMany({ where: { organizationId: ctx.organizationId }, orderBy: { name: 'asc' } });
    const links = await this.db.fieldWorkerTrade.findMany({ where: { organizationId: ctx.organizationId } });
    return { trades: trades.map((t: any) => ({ id: t.id, name: t.name, workers: links.filter((l: any) => l.tradeId === t.id).length })) };
  }

  async createTrade(ctx: FieldCtx, body: unknown) {
    const d = parseOr400(z.object({ name: z.string().trim().min(1).max(60) }), body);
    const dup = await this.db.fieldTrade.findFirst({ where: { organizationId: ctx.organizationId, name: d.name } });
    if (dup) throw new ConflictException(`A trade called "${dup.name}" already exists`);
    return { trade: await this.db.fieldTrade.create({ data: { organizationId: ctx.organizationId, name: d.name } }) };
  }

  async deleteTrade(ctx: FieldCtx, id: string) {
    const t = await this.db.fieldTrade.findFirst({ where: { id, organizationId: ctx.organizationId } });
    if (!t) throw new NotFoundException('Not found');
    await this.db.$transaction([this.db.fieldWorkerTrade.deleteMany({ where: { tradeId: id } }), this.db.fieldTrade.delete({ where: { id } })]);
    return { ok: true, before: t };
  }

  // ── Invites + join requests (office side) ─────────────────────────────────

  /** Site ids a scoped caller supervises (null = all). */
  private inviteScope(ctx: FieldCtx): string[] | null {
    return ctx.access.scoped.people ? ctx.supervisedSiteIds : null;
  }

  async listInvites(ctx: FieldCtx) {
    const scope = this.inviteScope(ctx);
    const invites = await this.db.fieldInvite.findMany({ where: { organizationId: ctx.organizationId, ...(scope !== null ? { siteId: { in: scope } } : {}) }, orderBy: { createdAt: 'desc' } });
    const pending = await this.db.fieldRegistration.groupBy({ by: ['inviteId'], where: { organizationId: ctx.organizationId, status: 'PENDING' }, _count: { _all: true } }).catch(() => []);
    const count = new Map((pending as any[]).map((p) => [p.inviteId, p._count._all]));
    return { invites: invites.map((i: any) => ({ ...i, pendingCount: count.get(i.id) ?? 0 })) };
  }

  async createInvite(ctx: FieldCtx, body: unknown) {
    const d = parseOr400(inviteSchema, body);
    const org = ctx.organizationId;
    if (d.role === 'SUPERVISOR' && ctx.access.scoped.people) throw new ForbiddenException('Only admins can create supervisor invites');
    const scope = this.inviteScope(ctx);
    if (scope !== null && (!d.siteId || !scope.includes(d.siteId))) throw new ForbiddenException('Supervisors must pick a site they supervise');
    if (d.siteId && !(await this.db.fieldSite.findFirst({ where: { id: d.siteId, organizationId: org } }))) throw new BadRequestException('Invalid site');
    const wanted = [...new Set([...(d.templateId ? [d.templateId] : []), ...(d.templateIds ?? [])])];
    if (wanted.length && (await this.db.fieldShiftTemplate.count({ where: { id: { in: wanted }, organizationId: org } })) !== wanted.length) throw new BadRequestException('Invalid template');
    if (d.leaveDays) {
      const ids = Object.keys(d.leaveDays);
      if ((await this.db.fieldLeaveType.count({ where: { id: { in: ids }, organizationId: org } })) !== ids.length) throw new BadRequestException('Unknown leave type');
    }
    const invite = await this.db.fieldInvite.create({
      data: {
        organizationId: org,
        token: randomBytes(12).toString('base64url'),
        label: d.label,
        role: d.role ?? null,
        siteId: d.siteId,
        templateId: d.templateId,
        templateIds: wanted,
        expiresAt: d.expiresAt ? new Date(d.expiresAt) : null,
        maxUses: d.maxUses ?? null,
        leaveDays: d.leaveDays && Object.keys(d.leaveDays).length ? d.leaveDays : undefined,
        createdById: ctx.userId,
      },
    });
    return { invite };
  }

  async updateInvite(ctx: FieldCtx, id: string, body: unknown) {
    const d = parseOr400(inviteSchema.extend({ active: z.boolean().optional() }).partial(), body);
    const invite = await this.db.fieldInvite.findFirst({ where: { id, organizationId: ctx.organizationId } });
    if (!invite) throw new NotFoundException('Not found');
    const scope = this.inviteScope(ctx);
    if (scope !== null && (!invite.siteId || !scope.includes(invite.siteId))) throw new ForbiddenException('Forbidden');
    const updated = await this.db.fieldInvite.update({
      where: { id },
      data: {
        ...(d.label !== undefined ? { label: d.label } : {}),
        ...(d.active !== undefined ? { active: d.active } : {}),
        ...(d.expiresAt !== undefined ? { expiresAt: d.expiresAt ? new Date(d.expiresAt) : null } : {}),
        ...(d.maxUses !== undefined ? { maxUses: d.maxUses } : {}),
      },
    });
    return { invite: updated, before: invite };
  }

  /** Permanently delete an invite link and its sign-ups (admins only, as SiteClock's workers.manage). */
  async deleteInvite(ctx: FieldCtx, id: string) {
    if (ctx.access.scoped.people) throw new ForbiddenException('Forbidden');
    const invite = await this.db.fieldInvite.findFirst({ where: { id, organizationId: ctx.organizationId } });
    if (!invite) throw new NotFoundException('Not found');
    await this.db.$transaction([this.db.fieldRegistration.deleteMany({ where: { inviteId: id } }), this.db.fieldInvite.delete({ where: { id } })]);
    return { ok: true, before: { label: invite.label, uses: invite.uses } };
  }

  async listRegistrations(ctx: FieldCtx, status?: string) {
    const st = String(status ?? 'PENDING').toUpperCase();
    const scope = this.inviteScope(ctx);
    let inviteIds: string[] | undefined;
    if (scope !== null) inviteIds = (await this.db.fieldInvite.findMany({ where: { organizationId: ctx.organizationId, siteId: { in: scope } }, select: { id: true } })).map((i: any) => i.id);
    const requests = await this.db.fieldRegistration.findMany({
      where: { organizationId: ctx.organizationId, status: st, ...(inviteIds ? { inviteId: { in: inviteIds } } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return { requests };
  }

  /** Approve a join request: creates the worker, site assignment, shift assignments and leave (invites.router). No WhatsApp. */
  async approveRegistration(ctx: FieldCtx, id: string) {
    const org = ctx.organizationId;
    const reg = await this.db.fieldRegistration.findFirst({ where: { id, organizationId: org, status: 'PENDING' } });
    if (!reg) throw new NotFoundException('Not found');
    const invite = await this.db.fieldInvite.findFirst({ where: { id: reg.inviteId, organizationId: org } });
    if (!invite) throw new NotFoundException('Not found');
    const scope = this.inviteScope(ctx);
    if (scope !== null && (!invite.siteId || !scope.includes(invite.siteId))) throw new ForbiddenException('Forbidden');
    if (await this.phoneTaken(reg.phone, org)) {
      await this.db.fieldRegistration.update({ where: { id }, data: { status: 'REJECTED', reviewedById: ctx.userId, reviewedByName: ctx.userName, reviewedAt: new Date() } });
      throw new ConflictException('Phone was registered elsewhere in the meantime; request rejected.');
    }
    // Oddity kept (§6.1 #13): the shift start is the server's date, not the company's.
    const today = new Date().toLocaleDateString('sv');
    const tier = invite.role === 'SUPERVISOR' ? 'SUPERVISOR' : 'WORKER';
    const worker = await this.db.$transaction(async (tx: any) => {
      const w = await tx.worker.create({ data: { organizationId: org, name: reg.name, phone: reg.phone, role: tier, active: true } });
      await tx.fieldWorkerProfile.create({ data: { organizationId: org, workerId: w.id, tier, employeeNo: reg.employeeNo, photoKey: reg.photoKey } });
      if (invite.siteId) await tx.fieldSiteAssignment.create({ data: { organizationId: org, siteId: invite.siteId, workerId: w.id, isSupervisor: tier === 'SUPERVISOR' } });
      const tplIds = [...new Set<string>([...(invite.templateId ? [invite.templateId] : []), ...(invite.templateIds ?? [])])];
      for (const tid of tplIds) await tx.fieldShiftAssignment.create({ data: { organizationId: org, templateId: tid, workerId: w.id, startDate: today } });
      await this.grantLeave(tx, org, w.id, invite.leaveDays as Record<string, number> | null);
      await tx.fieldRegistration.update({ where: { id }, data: { status: 'APPROVED', reviewedById: ctx.userId, reviewedByName: ctx.userName, reviewedAt: new Date() } });
      return w;
    });
    return { worker, after: { phone: reg.phone, name: reg.name, inviteId: reg.inviteId } };
  }

  async rejectRegistration(ctx: FieldCtx, id: string) {
    const reg = await this.db.fieldRegistration.findFirst({ where: { id, organizationId: ctx.organizationId, status: 'PENDING' } });
    if (!reg) throw new NotFoundException('Not found');
    const invite = await this.db.fieldInvite.findFirst({ where: { id: reg.inviteId } });
    const scope = this.inviteScope(ctx);
    if (scope !== null && (!invite?.siteId || !scope.includes(invite.siteId))) throw new ForbiddenException('Forbidden');
    await this.db.fieldRegistration.update({ where: { id }, data: { status: 'REJECTED', reviewedById: ctx.userId, reviewedByName: ctx.userName, reviewedAt: new Date() } });
    return { ok: true };
  }

  // ── Photos on record (office review) ──────────────────────────────────────

  async listPhotoUpdates(ctx: FieldCtx) {
    const rows = await this.db.fieldPhotoUpdate.findMany({ where: { organizationId: ctx.organizationId, status: { in: ['REQUESTED', 'PENDING'] } }, orderBy: { createdAt: 'desc' } });
    const workers = await this.db.worker.findMany({ where: { id: { in: rows.map((r: any) => r.workerId) } }, select: { id: true, name: true } });
    const name = new Map(workers.map((w: any) => [w.id, w.name]));
    return { updates: rows.map((r: any) => ({ ...r, workerName: name.get(r.workerId) ?? '' })) };
  }

  /** Ask for a new photo: cancels a pending one, creates REQUESTED, sets verifyRequested. (No push yet.) */
  async requestPhoto(ctx: FieldCtx, workerId: string, body: any) {
    const note = typeof body?.note === 'string' ? body.note.slice(0, 300) : null;
    await this.worker(ctx.organizationId, workerId);
    if (ctx.workerId === workerId) throw new BadRequestException("You can't ask yourself for a photo");
    await this.profile(ctx.organizationId, workerId);
    const update = await this.db.$transaction(async (tx: any) => {
      await tx.fieldPhotoUpdate.updateMany({ where: { organizationId: ctx.organizationId, workerId, status: { in: ['REQUESTED', 'PENDING'] } }, data: { status: 'CANCELLED' } });
      await tx.fieldWorkerProfile.update({ where: { workerId }, data: { verifyRequested: true } });
      return tx.fieldPhotoUpdate.create({ data: { organizationId: ctx.organizationId, workerId, status: 'REQUESTED', requestedById: ctx.userId, requestedByName: ctx.userName, setVerify: true, note } });
    });
    return { update };
  }

  async cancelPhotoRequest(ctx: FieldCtx, workerId: string) {
    const n = await this.db.fieldPhotoUpdate.updateMany({ where: { organizationId: ctx.organizationId, workerId, status: 'REQUESTED' }, data: { status: 'CANCELLED' } });
    if (!n.count) throw new NotFoundException('Not found');
    return { ok: true };
  }

  /** Approve: the new photo becomes the photo on record and the face data is reset (photos.router). */
  async approvePhoto(ctx: FieldCtx, id: string) {
    const u = await this.db.fieldPhotoUpdate.findFirst({ where: { id, organizationId: ctx.organizationId, status: 'PENDING' } });
    if (!u) throw new NotFoundException('Not found');
    await this.db.$transaction([
      this.db.fieldPhotoUpdate.update({ where: { id }, data: { status: 'APPROVED', reviewedById: ctx.userId, reviewedByName: ctx.userName, reviewedAt: new Date() } }),
      this.db.fieldWorkerProfile.update({ where: { workerId: u.workerId }, data: { photoKey: u.photoKey, faceDescriptor: [], ...(u.setVerify ? { verifyRequested: false } : {}) } }),
    ]);
    return { ok: true };
  }

  /** Reject: if it had been requested, a new REQUESTED update follows. */
  async rejectPhoto(ctx: FieldCtx, id: string, body: any) {
    const note = String(body?.note ?? '').slice(0, 300);
    const u = await this.db.fieldPhotoUpdate.findFirst({ where: { id, organizationId: ctx.organizationId, status: 'PENDING' } });
    if (!u) throw new NotFoundException('Not found');
    await this.db.$transaction(async (tx: any) => {
      await tx.fieldPhotoUpdate.update({ where: { id }, data: { status: 'REJECTED', reviewedById: ctx.userId, reviewedByName: ctx.userName, reviewedAt: new Date(), note } });
      if (u.requestedById || u.auto)
        await tx.fieldPhotoUpdate.create({ data: { organizationId: ctx.organizationId, workerId: u.workerId, status: 'REQUESTED', requestedById: u.requestedById, requestedByName: u.requestedByName, auto: u.auto, setVerify: u.setVerify, note } });
    });
    return { ok: true };
  }

  // ── Linked orgs (lib/links.ts) ────────────────────────────────────────────

  async linkedOrgIds(organizationId: string): Promise<string[]> {
    const rows = await this.db.fieldOrgLink.findMany({ where: { OR: [{ orgAId: organizationId }, { orgBId: organizationId }] } });
    return rows.map((r: any) => (r.orgAId === organizationId ? r.orgBId : r.orgAId));
  }

  async links(ctx: FieldCtx) {
    const s = await fieldSettings(this.db, ctx.organizationId);
    const ids = await this.linkedOrgIds(ctx.organizationId);
    const orgs = ids.length ? await this.db.organization.findMany({ where: { id: { in: ids } }, select: { id: true, name: true }, orderBy: { name: 'asc' } }) : [];
    const settings = ids.length ? await this.db.fieldSettings.findMany({ where: { organizationId: { in: ids } }, select: { organizationId: true, shareWorkers: true } }) : [];
    const share = new Map(settings.map((x: any) => [x.organizationId, x.shareWorkers]));
    return { shareWorkers: s.shareWorkers, links: orgs.map((o: any) => ({ id: o.id, name: o.name, shareWorkers: share.get(o.id) ?? 'NONE' })) };
  }

  /** The workers linked orgs share with this one (sharedWorkersFor); someone who is also a worker here (same phone) is left out. */
  async sharedWorkers(ctx: FieldCtx) {
    const ids = await this.linkedOrgIds(ctx.organizationId);
    if (!ids.length) return { workers: [] };
    const sets = await this.db.fieldSettings.findMany({ where: { organizationId: { in: ids }, shareWorkers: { not: 'NONE' } } });
    if (!sets.length) return { workers: [] };
    const orgs = await this.db.organization.findMany({ where: { id: { in: sets.map((s: any) => s.organizationId) } }, select: { id: true, name: true } });
    const orgName = new Map(orgs.map((o: any) => [o.id, o.name]));
    const own = new Set((await this.db.worker.findMany({ where: { organizationId: ctx.organizationId }, select: { phone: true } })).map((w: any) => w.phone));
    const out: any[] = [];
    for (const s of sets) {
      const profs = await this.db.fieldWorkerProfile.findMany({ where: { organizationId: s.organizationId, tier: { in: ['WORKER', 'SUPERVISOR'] }, ...(s.shareWorkers === 'SELECTED' ? { sharedWithLinked: true } : {}) } });
      const ws = await this.db.worker.findMany({ where: { organizationId: s.organizationId, active: true, id: { in: profs.map((p: any) => p.workerId) } }, orderBy: { name: 'asc' } });
      const emp = new Map(profs.map((p: any) => [p.workerId, p.employeeNo]));
      for (const w of ws) if (!own.has(w.phone)) out.push({ id: w.id, name: w.name, employeeNo: emp.get(w.id) ?? null, organizationId: s.organizationId, organizationName: orgName.get(s.organizationId) ?? '' });
    }
    return { workers: out.sort((a, b) => a.name.localeCompare(b.name)) };
  }

  /** Link two orgs (osiris admin only, as SiteClock's platform admin): stored with sorted ids; repeat = no-op. */
  async link(ctx: FieldCtx, otherOrgId: string, isOsirisAdmin: boolean) {
    if (!isOsirisAdmin) throw new ForbiddenException('Only the platform admin links organisations');
    if (otherOrgId === ctx.organizationId) throw new BadRequestException('Pick another organisation');
    const other = await this.db.organization.findUnique({ where: { id: otherOrgId }, select: { id: true } });
    if (!other) throw new NotFoundException('Not found');
    const [orgAId, orgBId] = [ctx.organizationId, otherOrgId].sort();
    await this.db.fieldOrgLink.upsert({ where: { orgAId_orgBId: { orgAId, orgBId } }, update: {}, create: { orgAId, orgBId } });
    return { ok: true };
  }

  async unlink(ctx: FieldCtx, otherOrgId: string, isOsirisAdmin: boolean) {
    if (!isOsirisAdmin) throw new ForbiddenException('Only the platform admin links organisations');
    const [orgAId, orgBId] = [ctx.organizationId, otherOrgId].sort();
    const n = await this.db.fieldOrgLink.deleteMany({ where: { orgAId, orgBId } });
    if (!n.count) throw new NotFoundException('Not found');
    return { ok: true };
  }

  async setShareWorkers(ctx: FieldCtx, body: unknown) {
    const d = parseOr400(z.object({ shareWorkers: z.enum(['NONE', 'ALL', 'SELECTED']) }), body);
    const before = await fieldSettings(this.db, ctx.organizationId);
    await this.db.fieldSettings.update({ where: { organizationId: ctx.organizationId }, data: { shareWorkers: d.shareWorkers } });
    return { shareWorkers: d.shareWorkers, before: before.shareWorkers };
  }
}

function pick<T extends Record<string, any>>(o: T, keys: readonly string[]) {
  const out: Record<string, unknown> = {};
  for (const k of keys) if (o[k] !== undefined) out[k] = o[k];
  return out;
}
