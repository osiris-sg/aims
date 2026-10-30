import { BadRequestException, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../common/prisma.service';
import { runAsOrg } from '../common/tenancy/tenant-context';
import { open, seal, secretBoxReady } from '../common/secret-box';
import { NotificationsService } from '../notifications/notifications.service';
import { ActionLogService } from '../action-log/action-log.service';
import { SiteClockApiError, SiteClockClient, SiteClockJob } from './siteclock.client';
import { backoffMs, externalRefFor, Plan, PlanLink, PlanRun, planSync, PushedStatus } from './siteclock-plan';

export const SITECLOCK_LINK_FLAG = 'enableSiteClockLink';
const ALERT_AFTER = 3; // failures in a row before the office bell rings
const FLAG_TTL_MS = 60_000;
const WORKERS_TTL_MS = 5 * 60_000;

/** What the office's schedule form sends; undefined = leave the link alone. */
export interface SiteClockScheduleInput {
  workerId?: string | null;
  workerName?: string | null;
  durationMin?: number | null;
}

export interface SiteClockLinkView {
  workerId: string | null;
  workerName: string | null;
  durationMin: number;
  syncState: string;
  lastPushedStatus: string | null;
  lastError: string | null;
  lastSyncedAt: Date | null;
  attempts: number;
}

type Conn = { id: string; organizationId: string; baseUrl: string; siteclockCompanyId: string; apiKeyEnc: string; enabled: boolean; defaultDurationMin: number };
type LinkRow = PlanLink & { id: string; organizationId: string; deliveryId: string; workerName: string | null; attempts: number; alertedAt: Date | null };

const SITECLOCK_STATUSES: PushedStatus[] = ['SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'];
const asPushed = (s: string | undefined | null): PushedStatus | null => (SITECLOCK_STATUSES.includes(s as PushedStatus) ? (s as PushedStatus) : null);

/** How a run's AIMS status reads as a SiteClock job status (null = no live job wanted). */
function runStatusAsJob(run: { status: string; isDraft: boolean; scheduledFor: Date | null } | undefined): PushedStatus | null {
  if (!run || run.status === 'cancelled' || run.isDraft || !run.scheduledFor) return null;
  if (run.status === 'completed') return 'COMPLETED';
  if (run.status === 'in_progress' || run.status === 'delivered') return 'IN_PROGRESS';
  return 'SCHEDULED';
}

/**
 * SiteClock link (WCT 2026-10-30, flag enableSiteClockLink + an enabled
 * SiteClockConnection). A scheduled delivery can be put on a SiteClock worker's
 * schedule; AIMS keeps that job in step with the run and reports its progress.
 *
 * Never in the way of the AIMS action: hooks only mark the link PENDING and
 * start a sync in the background; a 1-minute sweep retries failures with backoff
 * and catches status changes made on any path (claim, field completion, the
 * documents-side fold). Orgs without the flag cost nothing — the flag lookup is
 * an in-memory set refreshed every minute.
 */
@Injectable()
export class SiteClockLinkService {
  private readonly logger = new Logger(SiteClockLinkService.name);
  private linkedOrgs: { at: number; ids: Set<string> } | null = null;
  private workersCache = new Map<string, { at: number; data: any }>();
  private inFlight = new Set<string>();
  private sweeping = false;
  /** Tests swap SiteClock's HTTP for a fake; production uses global fetch. */
  fetchImpl?: typeof fetch;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    @Optional() private readonly actionLog?: ActionLogService,
  ) {}

  // ── org gating ───────────────────────────────────────────────────────────

  /** Orgs with the flag on AND an enabled connection (cached for a minute). */
  private async linkedOrgIds(): Promise<Set<string>> {
    if (this.linkedOrgs && Date.now() - this.linkedOrgs.at < FLAG_TTL_MS) return this.linkedOrgs.ids;
    const conns = await this.prisma.siteClockConnection.findMany({ where: { enabled: true }, select: { organizationId: true } });
    const ids = new Set<string>();
    for (const c of conns) {
      const ui = await this.prisma.organizationUIConfig.findUnique({ where: { organizationId: c.organizationId }, select: { features: true } });
      if (((ui?.features as any) || {})[SITECLOCK_LINK_FLAG] === true) ids.add(c.organizationId);
    }
    this.linkedOrgs = { at: Date.now(), ids };
    return ids;
  }

  async isLinked(organizationId: string): Promise<boolean> {
    try {
      return (await this.linkedOrgIds()).has(organizationId);
    } catch (e: any) {
      this.logger.warn(`linked-org lookup failed: ${e?.message}`);
      return false;
    }
  }

  private forgetOrgCache() {
    this.linkedOrgs = null;
  }

  private async connection(organizationId: string): Promise<Conn | null> {
    return (await this.prisma.siteClockConnection.findUnique({ where: { organizationId } })) as Conn | null;
  }

  private client(conn: Conn) {
    return new SiteClockClient({ baseUrl: conn.baseUrl, apiKey: open(conn.apiKeyEnc), fetchImpl: this.fetchImpl });
  }

  // ── hooks (called by DeliveriesService; never throw) ─────────────────────

  /** After createScheduled / updateScheduled committed. */
  async onScheduleSaved(organizationId: string, deliveryId: string, input?: SiteClockScheduleInput): Promise<void> {
    try {
      if (!(await this.isLinked(organizationId))) return;
      const sent = !!input && (input.workerId !== undefined || input.durationMin !== undefined || input.workerName !== undefined);
      let link = await this.prisma.deliverySiteClockJob.findUnique({ where: { deliveryId } });
      if (sent) {
        const workerId = input!.workerId === undefined ? (link?.workerId ?? null) : input!.workerId || null;
        const workerName = workerId ? (input!.workerName ?? (workerId === link?.workerId ? link?.workerName : null) ?? null) : null;
        const conn = await this.connection(organizationId);
        const durationMin = clampDuration(input!.durationMin ?? link?.durationMin ?? conn?.defaultDurationMin ?? 60);
        if (!link) {
          if (!workerId) return; // nothing picked, nothing to link
          link = await this.prisma.deliverySiteClockJob.create({
            data: { organizationId, deliveryId, workerId, workerName, durationMin, externalRef: externalRefFor(deliveryId, 1) },
          });
        } else {
          link = await this.prisma.deliverySiteClockJob.update({
            where: { id: link.id },
            data: { workerId, workerName, durationMin, syncState: 'PENDING', nextAttemptAt: new Date() },
          });
        }
      }
      if (!link) return;
      await this.kick(link.id);
    } catch (e: any) {
      this.logger.warn(`onScheduleSaved ${deliveryId}: ${e?.message}`);
    }
  }

  /** Any other change to a run (claim, finish, cancel, delete): re-check its job. */
  async touch(organizationId: string, deliveryId: string): Promise<void> {
    try {
      if (!(await this.isLinked(organizationId))) return;
      const link = await this.prisma.deliverySiteClockJob.findUnique({ where: { deliveryId } });
      if (!link) return;
      await this.kick(link.id);
    } catch (e: any) {
      this.logger.warn(`touch ${deliveryId}: ${e?.message}`);
    }
  }

  private async kick(linkId: string) {
    await this.prisma.deliverySiteClockJob.update({ where: { id: linkId }, data: { syncState: 'PENDING', nextAttemptAt: new Date() } });
    void this.syncLink(linkId).catch((e: any) => this.logger.warn(`sync ${linkId}: ${e?.message}`));
  }

  // ── sync ─────────────────────────────────────────────────────────────────

  private async loadRun(organizationId: string, deliveryId: string): Promise<PlanRun | null> {
    const run = await runAsOrg(organizationId, () =>
      this.prisma.delivery.findFirst({
        where: { id: deliveryId, organizationId },
        select: {
          id: true,
          organizationId: true,
          deliveryNumber: true,
          status: true,
          isDraft: true,
          scheduledFor: true,
          startedAt: true,
          completedAt: true,
          siteAddress: true,
          notes: true,
          customerId: true,
          customer: { select: { name: true } },
          project: { select: { name: true } },
          items: { select: { description: true, quantity: true, assetId: true }, orderBy: { sortOrder: 'asc' } },
        },
      }),
    );
    if (!run) return null;
    const r: any = run;
    // DeliveryItem has no asset relation: name catalog lines from their assets.
    const assetIds = [...new Set((r.items ?? []).map((i: any) => i.assetId).filter(Boolean))] as string[];
    const assets = assetIds.length ? await runAsOrg(organizationId, () => this.prisma.asset.findMany({ where: { id: { in: assetIds }, organizationId }, select: { id: true, name: true } })) : [];
    const assetName = new Map(assets.map((a: any) => [a.id, a.name as string]));
    return {
      id: r.id,
      organizationId: r.organizationId,
      deliveryNumber: r.deliveryNumber,
      status: r.status,
      isDraft: !!r.isDraft,
      scheduledFor: r.scheduledFor,
      startedAt: r.startedAt ?? null,
      completedAt: r.completedAt ?? null,
      siteAddress: r.siteAddress ?? null,
      notes: r.notes ?? null,
      customerId: r.customerId ?? null,
      customerName: r.customer?.name ?? null,
      projectName: r.project?.name ?? null,
      items: (r.items ?? []).map((i: any) => ({ description: String(i.description || assetName.get(i.assetId) || ''), quantity: Number(i.quantity) || 1 })),
    };
  }

  /** Bring one link's SiteClock job in line with its run. Returns the final link state. */
  async syncLink(linkId: string): Promise<{ ok: boolean; error?: string }> {
    if (this.inFlight.has(linkId)) return { ok: true };
    this.inFlight.add(linkId);
    try {
      return await this.syncLinkInner(linkId);
    } finally {
      this.inFlight.delete(linkId);
    }
  }

  private async syncLinkInner(linkId: string): Promise<{ ok: boolean; error?: string }> {
    let link = (await this.prisma.deliverySiteClockJob.findUnique({ where: { id: linkId } })) as LinkRow | null;
    if (!link) return { ok: false, error: 'link not found' };
    const org = link.organizationId;
    const conn = await this.connection(org);
    if (!conn || !conn.enabled) return this.fail(link, 'SiteClock is not connected for this organisation', false);
    let client: SiteClockClient;
    try {
      client = this.client(conn);
    } catch (e: any) {
      return this.fail(link, e?.message || 'SiteClock key could not be read', false);
    }

    const run = await this.loadRun(org, link.deliveryId);
    const done: string[] = [];
    // A step can teach us SiteClock's real state (e.g. the job was already
    // cancelled there); re-plan from it, a few rounds at most.
    for (let round = 0; round < 4; round++) {
      const plan: Plan = planSync(run, link, link.deliveryId);
      if (plan.problem) return this.fail(link, plan.problem, false);
      if (!plan.steps.length) {
        await this.prisma.deliverySiteClockJob.update({
          where: { id: link.id },
          data: { syncState: 'SYNCED', attempts: 0, lastError: null, lastSyncedAt: new Date(), alertedAt: null },
        });
        await this.prisma.siteClockConnection.update({ where: { id: conn.id }, data: { lastOkAt: new Date(), lastError: null } }).catch(() => undefined);
        if (done.length) {
          this.actionLog?.system('siteclock-sync', 'SYNC', 'deliveries', { organizationId: org, resourceId: link.deliveryId, details: { steps: done, status: link.lastPushedStatus } });
        }
        return { ok: true };
      }
      let replan = false;
      for (const step of plan.steps) {
        try {
          link = await this.apply(client, link, step);
          done.push(step.kind === 'status' ? `status:${step.status}` : step.kind);
        } catch (e: any) {
          const learned = e instanceof SiteClockApiError ? await this.learn(client, link, e) : null;
          if (learned) {
            link = learned;
            replan = true;
            break;
          }
          const transient = e instanceof SiteClockApiError ? e.transient : true;
          return this.fail(link, e?.message || String(e), transient, done);
        }
      }
      if (!replan) continue; // all steps applied: next round finds nothing left to do
    }
    return this.fail(link, 'SiteClock job could not be brought in line after several tries', true, done);
  }

  private async save(link: LinkRow, data: Record<string, any>): Promise<LinkRow> {
    return (await this.prisma.deliverySiteClockJob.update({ where: { id: link.id }, data })) as LinkRow;
  }

  private async apply(client: SiteClockClient, link: LinkRow, step: Plan['steps'][number]): Promise<LinkRow> {
    switch (step.kind) {
      case 'regenerate':
        return this.save(link, { generation: step.generation, externalRef: step.externalRef, siteclockJobId: null, syncedHash: null, lastPushedStatus: null, siteRef: null });
      case 'putSite':
        await client.putSite(step.siteRef, { name: step.name, address: step.address });
        return this.save(link, { siteRef: step.siteRef });
      case 'create': {
        const r = await client.createJob({ externalRef: link.externalRef, ...step.fields });
        return this.save(link, { siteclockJobId: r.job.id, syncedHash: step.hash, lastPushedStatus: asPushed(r.job.status) ?? 'SCHEDULED' });
      }
      case 'patch': {
        const r = await client.patchJob(link.externalRef, { ...step.fields });
        return this.save(link, { siteclockJobId: r.job.id, syncedHash: step.hash, lastPushedStatus: asPushed(r.job.status) ?? link.lastPushedStatus });
      }
      case 'status': {
        const r = await client.patchJob(link.externalRef, { status: step.status, at: step.at });
        return this.save(link, { siteclockJobId: r.job.id, lastPushedStatus: asPushed(r.job.status) ?? step.status });
      }
      case 'cancel': {
        try {
          const r = await client.cancelJob(link.externalRef, step.reason);
          return this.save(link, { lastPushedStatus: asPushed(r.job.status) ?? 'CANCELLED' });
        } catch (e) {
          // Never reached SiteClock, or already gone there: nothing left to cancel.
          if (e instanceof SiteClockApiError && e.status === 404) return this.save(link, { lastPushedStatus: 'CANCELLED' });
          throw e;
        }
      }
    }
  }

  /**
   * A 409 means SiteClock's job isn't where we thought (cancelled or finished in
   * the meantime, or created by an earlier attempt whose answer was lost). Read it
   * back and record its real state so the next plan starts from the truth.
   */
  private async learn(client: SiteClockClient, link: LinkRow, e: SiteClockApiError): Promise<LinkRow | null> {
    if (e.status !== 409) return null;
    let job: SiteClockJob | null = e.body?.job ?? null;
    if (!job) {
      try {
        job = (await client.getJob(link.externalRef)).job;
      } catch {
        return null;
      }
    }
    const status = asPushed(job?.status);
    if (!status || status === link.lastPushedStatus) {
      // An unexpected conflict on a job that looks the same: the ref belongs to a job
      // AIMS didn't make the same way. Treat it as existing, so the next plan PATCHes it.
      if (status && e.code === 'EXTERNAL_REF_CONFLICT' && link.lastPushedStatus === null) {
        return this.save(link, { siteclockJobId: job!.id, lastPushedStatus: status, syncedHash: null });
      }
      return null;
    }
    return this.save(link, { siteclockJobId: job!.id, lastPushedStatus: status, syncedHash: null });
  }

  private async fail(link: LinkRow, message: string, _transient: boolean, done: string[] = []): Promise<{ ok: false; error: string }> {
    const attempts = (link.attempts ?? 0) + 1;
    const error = message.slice(0, 500);
    const alert = attempts >= ALERT_AFTER && !link.alertedAt;
    await this.prisma.deliverySiteClockJob.update({
      where: { id: link.id },
      data: { syncState: 'FAILED', attempts, lastError: error, nextAttemptAt: new Date(Date.now() + backoffMs(attempts)), ...(alert ? { alertedAt: new Date() } : {}) },
    });
    await this.prisma.siteClockConnection.update({ where: { organizationId: link.organizationId }, data: { lastError: error } }).catch(() => undefined);
    this.actionLog?.system('siteclock-sync', 'FAIL', 'deliveries', { organizationId: link.organizationId, resourceId: link.deliveryId, details: { error, attempts, steps: done } });
    if (alert) {
      const run = await runAsOrg(link.organizationId, () =>
        this.prisma.delivery.findFirst({ where: { id: link.deliveryId, organizationId: link.organizationId }, select: { deliveryNumber: true } }),
      ).catch(() => null);
      const label = run ? `Delivery #${run.deliveryNumber}` : 'A delivery';
      await runAsOrg(link.organizationId, () =>
        this.notifications.emit({
          organizationId: link.organizationId,
          kind: 'SITECLOCK_SYNC_FAILED',
          title: `${label} is not in SiteClock`,
          body: `SiteClock didn't take the job after ${attempts} tries: ${error}. AIMS keeps retrying; open the delivery to retry now.`,
          entityType: 'delivery',
          entityId: link.deliveryId,
          linkUrl: `/portal/deliveries/${link.deliveryId}`,
        }),
      ).catch((e: any) => this.logger.warn(`bell for ${link.deliveryId}: ${e?.message}`));
    }
    return { ok: false, error };
  }

  /**
   * Every minute: links due a retry, plus live jobs whose run moved on (started,
   * finished, cancelled, deleted) on a path that didn't touch the link itself.
   * One sweep at a time; Render runs a single instance (same as the other crons).
   */
  @Cron('* * * * *')
  async sweep(): Promise<void> {
    if (this.sweeping) return;
    this.sweeping = true;
    try {
      const orgs = await this.linkedOrgIds();
      if (!orgs.size) return;
      const due = await this.prisma.deliverySiteClockJob.findMany({
        where: { organizationId: { in: [...orgs] }, syncState: { in: ['PENDING', 'FAILED'] }, nextAttemptAt: { lte: new Date() } },
        select: { id: true },
        take: 50,
      });
      const ids = new Set(due.map((d) => d.id));
      const live = await this.prisma.deliverySiteClockJob.findMany({
        where: { organizationId: { in: [...orgs] }, syncState: 'SYNCED', lastPushedStatus: { in: ['SCHEDULED', 'IN_PROGRESS'] } },
        select: { id: true, organizationId: true, deliveryId: true, lastPushedStatus: true },
      });
      const byOrg = new Map<string, typeof live>();
      for (const l of live) byOrg.set(l.organizationId, [...(byOrg.get(l.organizationId) ?? []), l]);
      for (const [org, links] of byOrg) {
        const runs = await runAsOrg(org, () =>
          this.prisma.delivery.findMany({
            where: { organizationId: org, id: { in: links.map((l) => l.deliveryId) } },
            select: { id: true, status: true, isDraft: true, scheduledFor: true },
          }),
        );
        const runById = new Map(runs.map((r: any) => [r.id, r]));
        for (const l of links) {
          const want = runStatusAsJob(runById.get(l.deliveryId) as any);
          if (want !== l.lastPushedStatus) ids.add(l.id);
        }
      }
      for (const id of ids) await this.syncLink(id).catch((e: any) => this.logger.warn(`sweep ${id}: ${e?.message}`));
    } catch (e: any) {
      this.logger.warn(`sweep failed: ${e?.message}`);
    } finally {
      this.sweeping = false;
    }
  }

  // ── office reads ─────────────────────────────────────────────────────────

  private view(l: any): SiteClockLinkView {
    return {
      workerId: l.workerId,
      workerName: l.workerName,
      durationMin: l.durationMin,
      syncState: l.syncState,
      lastPushedStatus: l.lastPushedStatus,
      lastError: l.lastError,
      lastSyncedAt: l.lastSyncedAt,
      attempts: l.attempts,
    };
  }

  /** Link views for a page of runs (empty for orgs without the link). */
  async viewsFor(organizationId: string, deliveryIds: string[]): Promise<Map<string, SiteClockLinkView>> {
    const out = new Map<string, SiteClockLinkView>();
    if (!deliveryIds.length || !(await this.isLinked(organizationId))) return out;
    const rows = await this.prisma.deliverySiteClockJob.findMany({ where: { organizationId, deliveryId: { in: deliveryIds } } });
    for (const r of rows) out.set(r.deliveryId, this.view(r));
    return out;
  }

  /**
   * SiteClock's calendar feed for the jobs calendar (enableJobsCalendar). Uses
   * the org's connection whether or not enableSiteClockLink is on; null when
   * there is no enabled connection. SiteClock errors are thrown to the caller.
   */
  async calendarJobs(organizationId: string, from: string, to: string) {
    const conn = await this.connection(organizationId);
    if (!conn || !conn.enabled || !conn.apiKeyEnc) return null;
    return (await this.client(conn).calendar(from, to)).jobs;
  }

  /** For the schedule form: is the link on here, and the default duration. */
  async formConfig(organizationId: string) {
    if (!(await this.isLinked(organizationId))) return { enabled: false };
    const conn = await this.connection(organizationId);
    return { enabled: true, defaultDurationMin: conn?.defaultDurationMin ?? 60 };
  }

  /** SiteClock workers grouped by team, cached ~5 min per org. The key never leaves the server. */
  async workers(organizationId: string, fresh = false) {
    if (!(await this.isLinked(organizationId))) throw new BadRequestException('SiteClock is not linked for this organisation');
    const hit = this.workersCache.get(organizationId);
    if (!fresh && hit && Date.now() - hit.at < WORKERS_TTL_MS) return hit.data;
    const conn = await this.connection(organizationId);
    if (!conn) throw new BadRequestException('SiteClock is not linked for this organisation');
    let teams, workers;
    try {
      const c = this.client(conn);
      [teams, workers] = await Promise.all([c.teams(), c.workers()]);
    } catch (e: any) {
      if (hit) return { ...hit.data, stale: true };
      throw new BadRequestException(`Couldn't load SiteClock workers: ${e?.message}`);
    }
    const all = workers.workers.filter((w) => w.active).map((w) => ({ id: w.id, name: w.name, employeeNo: w.employeeNo ?? null }));
    const inTeam = new Set<string>();
    const grouped = teams.teams.map((t) => {
      const members = t.members.filter((m) => all.some((w) => w.id === m.id)).map((m) => ({ id: m.id, name: m.name, employeeNo: m.employeeNo ?? null }));
      members.forEach((m) => inTeam.add(m.id));
      return { id: t.id, name: t.name, workers: members };
    });
    const data = { teams: grouped.filter((t) => t.workers.length), others: all.filter((w) => !inTeam.has(w.id)), fetchedAt: new Date().toISOString() };
    this.workersCache.set(organizationId, { at: Date.now(), data });
    return data;
  }

  /** "Retry" on a run: sync now and report how it went. */
  async retry(organizationId: string, deliveryId: string) {
    if (!(await this.isLinked(organizationId))) throw new BadRequestException('SiteClock is not linked for this organisation');
    const link = await this.prisma.deliverySiteClockJob.findUnique({ where: { deliveryId } });
    if (!link || link.organizationId !== organizationId) throw new NotFoundException('This delivery has no SiteClock job');
    await this.prisma.deliverySiteClockJob.update({ where: { id: link.id }, data: { syncState: 'PENDING', nextAttemptAt: new Date() } });
    const result = await this.syncLink(link.id);
    const after = await this.prisma.deliverySiteClockJob.findUnique({ where: { id: link.id } });
    return { ...result, siteclock: after ? this.view(after) : null };
  }

  // ── admin (Osiris) ───────────────────────────────────────────────────────

  async getConnection(organizationId: string) {
    const c = await this.prisma.siteClockConnection.findUnique({ where: { organizationId } });
    if (!c) return { connected: false, secretsReady: secretBoxReady() };
    return {
      connected: true,
      secretsReady: secretBoxReady(),
      baseUrl: c.baseUrl,
      siteclockCompanyId: c.siteclockCompanyId,
      apiKeyLast4: c.apiKeyLast4,
      enabled: c.enabled,
      defaultDurationMin: c.defaultDurationMin,
      lastOkAt: c.lastOkAt,
      lastError: c.lastError,
      updatedAt: c.updatedAt,
    };
  }

  async saveConnection(organizationId: string, body: { baseUrl?: string; siteclockCompanyId?: string; apiKey?: string; enabled?: boolean; defaultDurationMin?: number }) {
    const existing = await this.prisma.siteClockConnection.findUnique({ where: { organizationId } });
    const baseUrl = (body.baseUrl ?? existing?.baseUrl ?? '').trim().replace(/\/+$/, '');
    const companyId = (body.siteclockCompanyId ?? existing?.siteclockCompanyId ?? '').trim();
    const apiKey = normaliseApiKey(body.apiKey);
    if (!/^https?:\/\/[^\s]+$/.test(baseUrl)) throw new BadRequestException('Base URL must start with http:// or https://');
    if (!companyId) throw new BadRequestException('SiteClock company id is required');
    if (!existing && !apiKey) throw new BadRequestException('API key is required');
    if (apiKey && !/^sck_(live|test)_[A-Za-z0-9_-]{16,}$/.test(apiKey)) throw new BadRequestException('That does not look like a SiteClock API key (sck_live_…)');
    if (apiKey && !secretBoxReady()) throw new BadRequestException('AIMS_SECRETS_KEY is not set on the server, so the key cannot be stored');
    const duration = clampDuration(body.defaultDurationMin ?? existing?.defaultDurationMin ?? 60);
    const data = {
      baseUrl,
      siteclockCompanyId: companyId,
      enabled: body.enabled ?? existing?.enabled ?? false,
      defaultDurationMin: duration,
      ...(apiKey ? { apiKeyEnc: seal(apiKey), apiKeyLast4: apiKey.slice(-4) } : {}),
    };
    if (existing) await this.prisma.siteClockConnection.update({ where: { organizationId }, data });
    else await this.prisma.siteClockConnection.create({ data: { organizationId, ...(data as any) } });
    this.forgetOrgCache();
    this.workersCache.delete(organizationId);
    return this.getConnection(organizationId);
  }

  /** Admin "Test connection": one read call with the stored key. */
  async testConnection(organizationId: string) {
    const conn = await this.connection(organizationId);
    if (!conn) throw new NotFoundException('No SiteClock connection for this organisation');
    try {
      const t = await this.client(conn).teams();
      await this.prisma.siteClockConnection.update({ where: { id: conn.id }, data: { lastOkAt: new Date(), lastError: null } });
      return { ok: true, teams: t.teams.length };
    } catch (e: any) {
      const error = String(e?.message || e).slice(0, 500);
      await this.prisma.siteClockConnection.update({ where: { id: conn.id }, data: { lastError: error } });
      return { ok: false, error };
    }
  }
}

/** The key as pasted: tolerates surrounding spaces / quotes and a copied `SITECLOCK_API_KEY=` prefix (the key file's line). */
export function normaliseApiKey(raw?: string | null): string {
  return String(raw ?? '')
    .trim()
    .replace(/^SITECLOCK_API_KEY\s*=\s*/i, '')
    .replace(/^["']|["']$/g, '')
    .trim();
}

function clampDuration(n: number) {
  const v = Math.round(Number(n) || 60);
  return Math.min(24 * 60, Math.max(5, v));
}
