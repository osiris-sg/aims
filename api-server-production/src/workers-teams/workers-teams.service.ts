import { BadRequestException, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { isOrgFeatureEnabled } from '../common/org-features';
import { fieldAreaOn } from '../field/common/field-flags';
import { open } from '../common/secret-box';
import { ClerkIdentityService } from '../clerk/clerk-identity.service';
import { SiteClockApiError, SiteClockClient } from '../siteclock/siteclock.client';
import { Candidate, planSync, ScTeam, ScWorker, SyncPlan, withSharedWorkers } from './workers-teams.sync';

export const WORKERS_TEAMS_FLAG = 'enableWorkersTeams';
/** Same flag as siteclock-link.service (kept here so this module does not load that service). */
const CREW_SYNC_FLAG = 'enableSiteClockCrewSync';

const text = (v: unknown, max: number): string | null => {
  const s = String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
  return s || null;
};

/**
 * Workers & Teams (WCT 2026-11-20, flag enableWorkersTeams; Settings > Workers & Teams). The org's field workers and
 * crews: added by hand, or synced from SiteClock (read only there: GET /v1/workers, GET /v1/teams with the org's key,
 * which only the deployed API can open). Nothing is hard-deleted: hide = active false. Every route is HTTP, so the
 * Activity Log interceptor writes the rows; the sync leaves a short result on the request.
 */
@Injectable()
export class WorkersTeamsService {
  private readonly logger = new Logger(WorkersTeamsService.name);
  /** Tests swap SiteClock's HTTP for a fake; production uses global fetch. */
  fetchImpl?: typeof fetch;

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly clerkIdentity?: ClerkIdentityService,
  ) {}

  private get db(): any {
    return this.prisma as any;
  }

  async assertOn(organizationId: string) {
    if (!(await isOrgFeatureEnabled(this.prisma as any, organizationId, WORKERS_TEAMS_FLAG))) throw new NotFoundException('Workers & Teams is not on for this company');
  }

  /**
   * Field People on (FIELD_PLAN.md phase 1): team membership is dated there (FieldTeamStint) and
   * WorkerTeamMember is rebuilt from it, so this page must not change members or run the SiteClock
   * sync. Every other org: unchanged.
   */
  private async assertNotFieldManaged(organizationId: string) {
    const ui = await this.db.organizationUIConfig.findUnique({ where: { organizationId }, select: { features: true } });
    if (fieldAreaOn((ui?.features as any) || {}, 'people')) throw new BadRequestException('Team members are managed in Field > Teams');
  }

  // ── Reads ───────────────────────────────────────────────────────────────────

  /** Settings page: every worker and team (hidden ones too), membership, and the org's logins for the link picker. */
  async list(organizationId: string) {
    await this.assertOn(organizationId);
    const [workers, teams, members] = await Promise.all([
      this.db.worker.findMany({ where: { organizationId }, orderBy: [{ active: 'desc' }, { name: 'asc' }] }),
      this.db.workerTeam.findMany({ where: { organizationId }, orderBy: [{ active: 'desc' }, { name: 'asc' }] }),
      this.db.workerTeamMember.findMany({ where: { organizationId }, select: { teamId: true, workerId: true, source: true } }),
    ]);
    const users = await this.logins(organizationId);
    const userName = new Map(users.map((u) => [u.userId, u.name]));
    return {
      workers: workers.map((w: any) => ({
        id: w.id,
        name: w.name,
        phone: w.phone,
        role: w.role,
        active: w.active,
        siteclockId: w.siteclockId,
        userId: w.userId,
        userName: w.userId ? userName.get(w.userId) ?? null : null,
        teamIds: members.filter((m: any) => m.workerId === w.id).map((m: any) => m.teamId),
      })),
      teams: teams.map((t: any) => ({
        id: t.id,
        name: t.name,
        active: t.active,
        siteclockId: t.siteclockId,
        workerIds: members.filter((m: any) => m.teamId === t.id).map((m: any) => m.workerId),
      })),
      users: users.map((u) => ({ id: u.userId, name: u.name })),
    };
  }

  /** Job forms' "Team / crew" picker: active teams (with their active workers) and active workers, names only. */
  async picker(organizationId: string) {
    await this.assertOn(organizationId);
    const [workers, teams, members] = await Promise.all([
      this.db.worker.findMany({ where: { organizationId, active: true }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
      this.db.workerTeam.findMany({ where: { organizationId, active: true }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
      this.db.workerTeamMember.findMany({ where: { organizationId }, select: { teamId: true, workerId: true } }),
    ]);
    const live = new Set(workers.map((w: any) => w.id));
    return {
      teams: teams.map((t: any) => ({ id: t.id, name: t.name, workerIds: members.filter((m: any) => m.teamId === t.id && live.has(m.workerId)).map((m: any) => m.workerId) })),
      workers: workers.map((w: any) => ({ id: w.id, name: w.name })),
    };
  }

  // ── Workers ─────────────────────────────────────────────────────────────────

  private async validUserId(organizationId: string, userId: unknown): Promise<string | null> {
    if (userId === null || userId === undefined || userId === '') return null;
    return this.validUserIdFor(organizationId, String(userId), null);
  }

  async createWorker(organizationId: string, body: any) {
    await this.assertOn(organizationId);
    const name = text(body?.name, 120);
    if (!name) throw new BadRequestException('Give the worker a name');
    const userId = await this.validUserId(organizationId, body?.userId);
    return this.db.worker.create({ data: { organizationId, name, phone: text(body?.phone, 40), role: text(body?.role, 60), userId, active: true } });
  }

  private async worker(organizationId: string, id: string) {
    const w = await this.db.worker.findFirst({ where: { id, organizationId } });
    if (!w) throw new NotFoundException('Worker not found');
    return w;
  }

  async updateWorker(organizationId: string, id: string, body: any) {
    await this.assertOn(organizationId);
    const w = await this.worker(organizationId, id);
    const data: any = {};
    if (body?.name !== undefined) {
      const name = text(body.name, 120);
      if (!name) throw new BadRequestException('Give the worker a name');
      data.name = name;
    }
    if (body?.phone !== undefined) data.phone = text(body.phone, 40);
    if (body?.role !== undefined) data.role = text(body.role, 60);
    if (body?.userId !== undefined && (body.userId || null) !== w.userId) {
      // Changing the link: the old one is released first so the "already linked" check never trips on itself.
      data.userId = body.userId ? await this.validUserIdFor(organizationId, body.userId, w.id) : null;
    }
    return this.db.worker.update({ where: { id: w.id }, data });
  }

  /** A login a worker may link: an active member of the org, not linked to another worker. */
  private async validUserIdFor(organizationId: string, userId: string, workerId: string | null): Promise<string> {
    const uo = await this.db.userOrganization.findFirst({ where: { organizationId, userId, isActive: true }, select: { userId: true } });
    if (!uo) throw new BadRequestException('That login is not an active member of this company');
    const other = await this.db.worker.findFirst({ where: { organizationId, userId, ...(workerId ? { id: { not: workerId } } : {}) }, select: { name: true } });
    if (other) throw new BadRequestException(`That login is already linked to ${other.name}`);
    return userId;
  }

  async setWorkerActive(organizationId: string, id: string, active: boolean) {
    await this.assertOn(organizationId);
    const w = await this.worker(organizationId, id);
    const out = await this.db.worker.update({ where: { id: w.id }, data: { active } });
    await this.resendCrewJobs(organizationId);
    return out;
  }

  /**
   * Crew sync orgs (enableSiteClockCrewSync): who is in a team, or active, decides who gets a job in SiteClock, so a
   * change here marks the org's still-scheduled SiteClock jobs to be checked again (the link service's minute sweep
   * re-reads each crew; a job whose crew did not change makes no SiteClock call). Every other org: nothing happens.
   * Never fails the save that called it.
   */
  private async resendCrewJobs(organizationId: string): Promise<void> {
    try {
      if (!(await isOrgFeatureEnabled(this.prisma, organizationId, CREW_SYNC_FLAG))) return;
      await this.db.deliverySiteClockJob.updateMany({ where: { organizationId, lastPushedStatus: 'SCHEDULED' }, data: { syncState: 'PENDING', nextAttemptAt: new Date() } });
    } catch (e: any) {
      this.logger.warn(`resendCrewJobs ${organizationId}: ${e?.message}`);
    }
  }

  // ── Teams ───────────────────────────────────────────────────────────────────

  private async team(organizationId: string, id: string) {
    const t = await this.db.workerTeam.findFirst({ where: { id, organizationId } });
    if (!t) throw new NotFoundException('Team not found');
    return t;
  }

  async createTeam(organizationId: string, body: any) {
    await this.assertOn(organizationId);
    const name = text(body?.name, 120);
    if (!name) throw new BadRequestException('Give the team a name');
    if (Array.isArray(body?.workerIds) && body.workerIds.length) await this.assertNotFieldManaged(organizationId);
    const team = await this.db.workerTeam.create({ data: { organizationId, name, active: true } });
    for (const wid of Array.isArray(body?.workerIds) ? body.workerIds : []) await this.addMember(organizationId, team.id, wid);
    return team;
  }

  async updateTeam(organizationId: string, id: string, body: any) {
    await this.assertOn(organizationId);
    const t = await this.team(organizationId, id);
    const name = body?.name !== undefined ? text(body.name, 120) : t.name;
    if (!name) throw new BadRequestException('Give the team a name');
    return this.db.workerTeam.update({ where: { id: t.id }, data: { name } });
  }

  async setTeamActive(organizationId: string, id: string, active: boolean) {
    await this.assertOn(organizationId);
    const t = await this.team(organizationId, id);
    const out = await this.db.workerTeam.update({ where: { id: t.id }, data: { active } });
    await this.resendCrewJobs(organizationId);
    return out;
  }

  async addMember(organizationId: string, teamId: string, workerId: unknown) {
    await this.assertOn(organizationId);
    await this.assertNotFieldManaged(organizationId);
    const t = await this.team(organizationId, teamId);
    const w = await this.worker(organizationId, String(workerId ?? ''));
    const existing = await this.db.workerTeamMember.findFirst({ where: { teamId: t.id, workerId: w.id } });
    if (existing) return existing;
    const made = await this.db.workerTeamMember.create({ data: { organizationId, teamId: t.id, workerId: w.id, source: 'manual' } });
    await this.resendCrewJobs(organizationId);
    return made;
  }

  async removeMember(organizationId: string, teamId: string, workerId: string) {
    await this.assertOn(organizationId);
    await this.assertNotFieldManaged(organizationId);
    const t = await this.team(organizationId, teamId);
    const r = await this.db.workerTeamMember.deleteMany({ where: { organizationId, teamId: t.id, workerId } });
    if (r.count) await this.resendCrewJobs(organizationId);
    return { removed: r.count };
  }

  // ── SiteClock sync ──────────────────────────────────────────────────────────

  /** The org's SiteClock client (the key is opened here, on the server, and never returned). */
  private async siteclock(organizationId: string): Promise<SiteClockClient> {
    const conn = await this.db.siteClockConnection.findUnique({ where: { organizationId } });
    if (!conn || !conn.enabled || !conn.apiKeyEnc) throw new BadRequestException('SiteClock is not connected for this company');
    let apiKey: string;
    try {
      apiKey = open(conn.apiKeyEnc);
    } catch (e: any) {
      throw new BadRequestException(`The SiteClock key cannot be read here: ${e?.message}`);
    }
    return new SiteClockClient({ baseUrl: conn.baseUrl, apiKey, timeoutMs: 20_000, fetchImpl: this.fetchImpl });
  }

  /** The org's active members as login candidates: name, phones (Clerk + WhatsApp), Clerk id, SiteClock link. */
  async logins(organizationId: string): Promise<Candidate[]> {
    const uos: Array<{ userId: string }> = await this.db.userOrganization.findMany({ where: { organizationId, isActive: true }, select: { userId: true } });
    const ids = [...new Set(uos.map((u) => u.userId))];
    const profiles: Array<{ userId: string; siteclockUserId: string | null; whatsappNumber: string | null }> = ids.length
      ? await this.db.organizationMemberProfile.findMany({ where: { organizationId, userId: { in: ids } }, select: { userId: true, siteclockUserId: true, whatsappNumber: true } })
      : [];
    let clerk = new Map<string, any>();
    try {
      if (this.clerkIdentity && ids.length) clerk = await this.clerkIdentity.toClerkUsers(ids);
    } catch (e: any) {
      this.logger.warn(`Clerk lookup failed (names / phones from AIMS only): ${e?.message}`);
    }
    return ids.map((userId) => {
      const u = clerk.get(userId);
      const p = profiles.find((x) => x.userId === userId);
      const name = u ? [u.firstName, u.lastName].filter(Boolean).join(' ').trim() || null : null;
      const phones = [...(u?.phoneNumbers ?? []).map((n: any) => n?.phoneNumber).filter(Boolean), ...(p?.whatsappNumber ? [p.whatsappNumber] : [])];
      return { userId, name, phones, clerkId: u?.id ?? null, siteclockUserId: p?.siteclockUserId ?? null };
    });
  }

  /** What SiteClock has now (workers incl. inactive; phones only when the key may read them) and the plan against AIMS. */
  async plan(organizationId: string): Promise<SyncPlan> {
    await this.assertOn(organizationId);
    const c = await this.siteclock(organizationId);
    let phones = true;
    let workers: ScWorker[];
    try {
      workers = (await c.allWorkers({ phone: true })).workers as ScWorker[];
    } catch (e) {
      if (!(e instanceof SiteClockApiError) || e.status !== 403) throw this.siteclockError(e);
      phones = false;
      workers = (await c.allWorkers().catch((x) => Promise.reject(this.siteclockError(x)))).workers as ScWorker[];
    }
    // Crew sync orgs: the workers a linked SiteClock company shares come in too, named with their company,
    // so they can be picked on a job. Every other org: the call is not made.
    if (await isOrgFeatureEnabled(this.prisma, organizationId, CREW_SYNC_FLAG)) {
      workers = withSharedWorkers(workers, await c.sharedWorkers().catch((x) => Promise.reject(this.siteclockError(x))));
    }
    const teams: ScTeam[] = (await c.teams().catch((x) => Promise.reject(this.siteclockError(x)))).teams;
    const [aimsWorkers, aimsTeams, members] = await Promise.all([
      this.db.worker.findMany({ where: { organizationId } }),
      this.db.workerTeam.findMany({ where: { organizationId } }),
      this.db.workerTeamMember.findMany({ where: { organizationId }, select: { teamId: true, workerId: true, source: true } }),
    ]);
    return planSync({ scWorkers: workers, scTeams: teams, phones, workers: aimsWorkers, teams: aimsTeams, members, candidates: await this.logins(organizationId) });
  }

  private siteclockError(e: unknown) {
    if (e instanceof SiteClockApiError) return new BadRequestException(`SiteClock: ${e.message}`);
    return e;
  }

  /** Dry run: the plan, nothing written. */
  async preview(organizationId: string) {
    return { applied: false, ...(await this.plan(organizationId)) };
  }

  /**
   * Apply: the same plan, written in one transaction under an org lock (two applies at once never double-create).
   * Re-runnable: a second apply with nothing new in SiteClock writes nothing.
   */
  async apply(organizationId: string) {
    await this.assertNotFieldManaged(organizationId);
    const plan = await this.plan(organizationId);
    const db = this.db;
    await db.$transaction(
      async (tx: any) => {
        await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', `workers-teams-sync:${organizationId}`);
        const workerIdByScId = new Map<string, string>();
        for (const p of plan.workers) {
          const prev = p.aimsId ? await tx.worker.findFirst({ where: { id: p.aimsId, organizationId }, select: { siteclockData: true } }) : null;
          const snapshot = { ...((prev?.siteclockData as any) || {}), ...p.snapshot };
          if (p.action === 'create') {
            // The unique (org, siteclockId) index makes a parallel create fail here instead of doubling the worker.
            const existing = await tx.worker.findFirst({ where: { organizationId, siteclockId: p.siteclockId }, select: { id: true } });
            const row = existing ?? (await tx.worker.create({ data: { organizationId, name: p.data.name, phone: p.data.phone, role: p.data.role, active: p.data.active, siteclockId: p.siteclockId, siteclockData: snapshot, userId: p.user?.userId ?? null } }));
            workerIdByScId.set(p.siteclockId, row.id);
            continue;
          }
          if (!p.aimsId) continue;
          workerIdByScId.set(p.siteclockId, p.aimsId);
          const data: any = { siteclockData: snapshot };
          if (p.action === 'link') data.siteclockId = p.siteclockId;
          for (const [f, ch] of Object.entries(p.changes)) data[f] = (ch as any).to;
          if (p.user) data.userId = p.user.userId;
          await tx.worker.update({ where: { id: p.aimsId }, data });
        }
        const teamIdByScId = new Map<string, string>();
        for (const t of plan.teams) {
          if (t.action === 'create') {
            const existing = await tx.workerTeam.findFirst({ where: { organizationId, siteclockId: t.siteclockId }, select: { id: true } });
            const row = existing ?? (await tx.workerTeam.create({ data: { organizationId, name: t.name, active: true, siteclockId: t.siteclockId, siteclockData: t.snapshot } }));
            teamIdByScId.set(t.siteclockId, row.id);
            continue;
          }
          if (!t.aimsId) continue;
          teamIdByScId.set(t.siteclockId, t.aimsId);
          const data: any = { siteclockData: t.snapshot };
          if (t.changes.name) data.name = t.changes.name.to;
          if (t.changes.active) data.active = t.changes.active.to;
          await tx.workerTeam.update({ where: { id: t.aimsId }, data });
        }
        for (const m of plan.memberships.add) {
          const teamId = teamIdByScId.get(m.teamSiteclockId);
          const workerId = workerIdByScId.get(m.workerSiteclockId);
          if (!teamId || !workerId) continue;
          const exists = await tx.workerTeamMember.findFirst({ where: { teamId, workerId }, select: { id: true } });
          if (!exists) await tx.workerTeamMember.create({ data: { organizationId, teamId, workerId, source: 'siteclock' } });
        }
        for (const m of plan.memberships.remove) {
          const teamId = teamIdByScId.get(m.teamSiteclockId);
          const workerId = workerIdByScId.get(m.workerSiteclockId);
          if (teamId && workerId) await tx.workerTeamMember.deleteMany({ where: { organizationId, teamId, workerId, source: 'siteclock' } });
        }
      },
      { timeout: 60_000 },
    );
    await this.resendCrewJobs(organizationId);
    return { applied: true, ...plan };
  }
}

/** The Activity Log row's result for an apply: counts only. */
export function syncLogResult(r: SyncPlan & { applied: boolean }) {
  const c = r.counts;
  return {
    applied: r.applied,
    siteclock: `${r.source.workers} workers, ${r.source.teams} teams`,
    workers: `+${c.workersCreate} new, ${c.workersLink} linked, ${c.workersUpdate} updated, ${c.workersHidden} hidden`,
    teams: `+${c.teamsCreate} new, ${c.teamsUpdate} updated, ${c.teamsHide} hidden`,
    memberships: `+${c.membershipsAdd} / -${c.membershipsRemove}`,
    logins: `${c.loginsMatched} linked, ${c.loginsUnmatched} without a login`,
    differences: c.differences,
  };
}
