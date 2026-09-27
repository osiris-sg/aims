import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from 'src/common/prisma.service';
import { isOrgFeatureEnabled } from 'src/common/org-features';
import { NotificationsService } from '../notifications/notifications.service';
import { PushService } from '../push/push.service';
import { ActionLogService } from '../action-log/action-log.service';

export const MAINTENANCE_DATES_FLAG = 'enableMaintenanceDates';

const DAY_MS = 24 * 60 * 60 * 1000;
const SGT_OFFSET_MS = 8 * 60 * 60 * 1000;
/** How far ahead the reminder looks: a date exactly 7 days out (or nearer, when
 *  the schedule was created late) is reminded once. */
const REMIND_DAYS_AHEAD = 7;

/** Today's calendar date in Singapore, as YYYY-MM-DD. */
export function sgtToday(now: Date = new Date()): string {
  return new Date(now.getTime() + SGT_OFFSET_MS).toISOString().slice(0, 10);
}

/** A YYYY-MM-DD string as the Date Prisma stores in a @db.Date column. */
function dateOnly(ymd: string): Date {
  return new Date(`${ymd}T00:00:00.000Z`);
}

function ymdOf(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(ymd: string, n: number): string {
  return ymdOf(new Date(dateOnly(ymd).getTime() + n * DAY_MS));
}

/** Midnight Singapore time on a calendar date, as a UTC instant. Report
 *  timestamps are UTC, so "signed on or after <date>" means after this. */
function sgtMidnight(ymd: string): Date {
  return new Date(dateOnly(ymd).getTime() - SGT_OFFSET_MS);
}

/** "5 Oct 2026". dueDate is a UTC-midnight date, so format it in UTC. */
function fmtDate(ymd: string): string {
  return dateOnly(ymd).toLocaleDateString('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' });
}

type DeployKind = 'RENTAL' | 'SALE';

interface DeployedUnit {
  inventoryId: string;
  assetId: string;
  sku: string;
  serialNumber: string | null;
  type: DeployKind;
  deployedDate: Date | null;
  projectId: string;
  projectName: string;
  projectNumber: string | null;
  site: string | null;
  customerName: string | null;
}

interface LastReport {
  id: string;
  reportNumber: number | null;
  signedAt: Date;
}

/**
 * MAINTENANCE DATES (Biofuel, 2026-09). The office plans a maintenance date per
 * ASSET (product); every deployed unit of that product is due. Behind the
 * per-org `enableMaintenanceDates` flag.
 *
 * Counting rules (one place, used by list, detail and the reminder):
 *  - DEPLOYED unit = an Assignment with a unit, no endDate, in an ACTIVE
 *    ProjectDeployment of type RENTAL or SALE. Not Inventory.status: on prod 16
 *    units are marked rental/sold with no active deployment behind them, and a
 *    deployment is what gives the customer, project, site and deployed date.
 *  - DONE this cycle = the unit has a completed SERVICE report signed on or
 *    after the cycle start. Cycle start = the asset's previous (past, not
 *    cancelled) dueDate, at 00:00 Singapore time; for the first schedule, the
 *    schedule's createdAt.
 */
@Injectable()
export class MaintenanceSchedulesService {
  private readonly logger = new Logger(MaintenanceSchedulesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly push: PushService,
    private readonly actionLog: ActionLogService,
  ) {}

  async assertEnabled(organizationId: string) {
    if (!(await isOrgFeatureEnabled(this.prisma, organizationId, MAINTENANCE_DATES_FLAG))) {
      throw new ForbiddenException('Maintenance Dates is not enabled for this organization.');
    }
  }

  // ── data helpers ────────────────────────────────────────────────────────

  /** Deployed units (rule above), optionally for one asset. One row per unit. */
  private async deployedUnits(organizationId: string, assetId?: string): Promise<DeployedUnit[]> {
    const rows = await this.prisma.assignment.findMany({
      where: {
        inventoryId: { not: null },
        endDate: null,
        projectDeployment: { organizationId, status: 'ACTIVE', type: { in: ['RENTAL', 'SALE'] } },
        inventory: { organizationId, ...(assetId ? { assetId } : {}) },
      },
      orderBy: { createdAt: 'desc' },
      select: {
        inventoryId: true,
        startDate: true,
        inventory: { select: { id: true, assetId: true, sku: true, serialNumber: true } },
        projectDeployment: { select: { type: true, deployedDate: true } },
        project: {
          select: {
            id: true,
            name: true,
            projectNumber: true,
            address: true,
            siteOffice: { select: { name: true } },
            customer: { select: { name: true } },
          },
        },
      },
    });
    const seen = new Set<string>();
    const out: DeployedUnit[] = [];
    for (const r of rows) {
      if (!r.inventory || !r.projectDeployment || seen.has(r.inventory.id)) continue;
      seen.add(r.inventory.id);
      out.push({
        inventoryId: r.inventory.id,
        assetId: r.inventory.assetId,
        sku: r.inventory.sku,
        serialNumber: r.inventory.serialNumber,
        type: r.projectDeployment.type as DeployKind,
        deployedDate: r.projectDeployment.deployedDate ?? r.startDate ?? null,
        projectId: r.project.id,
        projectName: r.project.name,
        projectNumber: r.project.projectNumber,
        site: r.project.address || r.project.siteOffice?.name || null,
        customerName: r.project.customer?.name ?? null,
      });
    }
    return out;
  }

  /** Latest completed, signed SERVICE report per unit. */
  private async lastReports(organizationId: string, inventoryIds: string[]): Promise<Map<string, LastReport>> {
    const map = new Map<string, LastReport>();
    if (!inventoryIds.length) return map;
    const rows = await this.prisma.maintenanceServiceReport.findMany({
      where: {
        organizationId,
        kind: 'SERVICE',
        status: 'completed',
        signedAt: { not: null },
        inventoryId: { in: inventoryIds },
      },
      orderBy: { signedAt: 'desc' },
      select: { id: true, reportNumber: true, signedAt: true, inventoryId: true },
    });
    for (const r of rows) {
      if (r.inventoryId && !map.has(r.inventoryId)) map.set(r.inventoryId, { id: r.id, reportNumber: r.reportNumber, signedAt: r.signedAt! });
    }
    return map;
  }

  /** An asset's non-cancelled schedules, split into the active one and the past. */
  private splitSchedules<T extends { dueDate: Date; cancelledAt: Date | null }>(rows: T[], today: string) {
    const live = rows.filter((s) => !s.cancelledAt).sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());
    const active = live.find((s) => ymdOf(s.dueDate) >= today) ?? null;
    const past = live.filter((s) => ymdOf(s.dueDate) < today);
    return { active, past };
  }

  /** When the current cycle began (see the class doc). null = nothing scheduled. */
  private cycleStart(active: { dueDate: Date; createdAt: Date } | null, past: Array<{ dueDate: Date }>): Date | null {
    if (!active) return null;
    const prev = past.filter((s) => s.dueDate < active.dueDate).pop();
    return prev ? sgtMidnight(ymdOf(prev.dueDate)) : active.createdAt;
  }

  private scheduleDto(s: any) {
    return {
      id: s.id,
      dueDate: ymdOf(s.dueDate),
      notes: s.notes ?? null,
      createdAt: s.createdAt,
      remindedAt: s.remindedAt ?? null,
      cancelledAt: s.cancelledAt ?? null,
    };
  }

  // ── list / detail ───────────────────────────────────────────────────────

  /**
   * One row per asset that has deployed units or a live schedule: next date,
   * rental / sold counts, and done / not done for the current cycle.
   */
  async list(organizationId: string, search?: string) {
    await this.assertEnabled(organizationId);
    const today = sgtToday();
    const [units, schedules] = await Promise.all([
      this.deployedUnits(organizationId),
      this.prisma.maintenanceSchedule.findMany({ where: { organizationId, cancelledAt: null } }),
    ]);
    const assetIds = [...new Set([...units.map((u) => u.assetId), ...schedules.map((s) => s.assetId)])];
    const [assets, reports] = await Promise.all([
      this.prisma.asset.findMany({
        where: { id: { in: assetIds }, organizationId },
        select: { id: true, name: true, skuKey: true },
      }),
      this.lastReports(organizationId, units.map((u) => u.inventoryId)),
    ]);

    const q = (search ?? '').trim().toLowerCase();
    const rows = assets
      .filter((a) => !q || a.name.toLowerCase().includes(q) || (a.skuKey ?? '').toLowerCase().includes(q))
      .map((a) => {
        const mine = units.filter((u) => u.assetId === a.id);
        const { active, past } = this.splitSchedules(schedules.filter((s) => s.assetId === a.id), today);
        const start = this.cycleStart(active, past);
        const done = start ? mine.filter((u) => (reports.get(u.inventoryId)?.signedAt ?? null) !== null && reports.get(u.inventoryId)!.signedAt >= start).length : null;
        return {
          assetId: a.id,
          assetName: a.name,
          skuKey: a.skuKey,
          schedule: active ? this.scheduleDto(active) : null,
          lastDueDate: past.length ? ymdOf(past[past.length - 1].dueDate) : null,
          cycleStart: start,
          rentalCount: mine.filter((u) => u.type === 'RENTAL').length,
          soldCount: mine.filter((u) => u.type === 'SALE').length,
          doneCount: done,
          notDoneCount: done === null ? null : mine.length - done,
        };
      })
      // Soonest date first; unscheduled assets after, by name.
      .sort((x, y) => {
        const dx = x.schedule?.dueDate ?? '9999';
        const dy = y.schedule?.dueDate ?? '9999';
        return dx === dy ? x.assetName.localeCompare(y.assetName) : dx.localeCompare(dy);
      });
    return { today, docs: rows };
  }

  /** One asset: next date, history, and every deployed unit with done / not done. */
  async assetDetail(organizationId: string, assetId: string) {
    await this.assertEnabled(organizationId);
    const asset = await this.prisma.asset.findFirst({
      where: { id: assetId, organizationId },
      select: { id: true, name: true, skuKey: true },
    });
    if (!asset) throw new NotFoundException('Asset not found');
    const today = sgtToday();
    const [units, schedules] = await Promise.all([
      this.deployedUnits(organizationId, assetId),
      this.prisma.maintenanceSchedule.findMany({ where: { organizationId, assetId }, orderBy: { dueDate: 'desc' } }),
    ]);
    const reports = await this.lastReports(organizationId, units.map((u) => u.inventoryId));
    const { active, past } = this.splitSchedules(schedules, today);
    const start = this.cycleStart(active, past);

    const unitRows = units
      .map((u) => {
        const r = reports.get(u.inventoryId) ?? null;
        return {
          inventoryId: u.inventoryId,
          sku: u.sku,
          serialNumber: u.serialNumber,
          type: u.type,
          customerName: u.customerName,
          projectId: u.projectId,
          projectName: u.projectName,
          projectNumber: u.projectNumber,
          site: u.site,
          deployedDate: u.deployedDate,
          lastReport: r ? { id: r.id, reportNumber: r.reportNumber, signedAt: r.signedAt } : null,
          done: start ? !!r && r.signedAt >= start : null,
        };
      })
      // Not done first, so the list reads as a to-do.
      .sort((a, b) => Number(a.done) - Number(b.done) || a.sku.localeCompare(b.sku));

    return {
      today,
      asset,
      schedule: active ? this.scheduleDto(active) : null,
      cycleStart: start,
      history: schedules.filter((s) => s.id !== active?.id).map((s) => this.scheduleDto(s)),
      rentalCount: units.filter((u) => u.type === 'RENTAL').length,
      soldCount: units.filter((u) => u.type === 'SALE').length,
      doneCount: start ? unitRows.filter((u) => u.done).length : null,
      notDoneCount: start ? unitRows.filter((u) => !u.done).length : null,
      units: unitRows,
    };
  }

  // ── create / update / cancel ────────────────────────────────────────────

  private parseDate(v: unknown): string {
    const s = typeof v === 'string' ? v.trim() : '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || isNaN(dateOnly(s).getTime()) || ymdOf(dateOnly(s)) !== s) {
      throw new BadRequestException('dueDate must be a date as YYYY-MM-DD');
    }
    if (s < sgtToday()) throw new BadRequestException('The maintenance date cannot be in the past.');
    return s;
  }

  private cleanNotes(v: unknown): string | null {
    if (v === undefined || v === null) return null;
    const s = String(v).trim();
    return s ? s.slice(0, 2000) : null;
  }

  async create(organizationId: string, userId: string | null, body: { assetId?: string; dueDate?: string; notes?: string }) {
    await this.assertEnabled(organizationId);
    const assetId = String(body?.assetId ?? '').trim();
    if (!assetId) throw new BadRequestException('Pick an asset.');
    const due = this.parseDate(body?.dueDate);
    const asset = await this.prisma.asset.findFirst({ where: { id: assetId, organizationId, deletedAt: null }, select: { id: true } });
    if (!asset) throw new NotFoundException('Asset not found');
    const today = sgtToday();

    // One active date per asset. The advisory lock serialises two office users
    // scheduling the same asset at once, so the check-then-insert cannot race.
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`maint-sched:${assetId}`}))`;
      const existing = await tx.maintenanceSchedule.findFirst({
        where: { organizationId, assetId, cancelledAt: null, dueDate: { gte: dateOnly(today) } },
        select: { dueDate: true },
      });
      if (existing) {
        throw new BadRequestException(
          `This asset already has a maintenance date on ${fmtDate(ymdOf(existing.dueDate))}. Edit that date instead.`,
        );
      }
      const row = await tx.maintenanceSchedule.create({
        data: { organizationId, assetId, dueDate: dateOnly(due), notes: this.cleanNotes(body?.notes), createdByUserId: userId },
      });
      return this.scheduleDto(row);
    });
  }

  private async activeRow(organizationId: string, id: string) {
    const row = await this.prisma.maintenanceSchedule.findFirst({ where: { id, organizationId } });
    if (!row) throw new NotFoundException('Maintenance date not found');
    if (row.cancelledAt) throw new BadRequestException('This maintenance date was cancelled.');
    if (ymdOf(row.dueDate) < sgtToday()) throw new BadRequestException('A past maintenance date is history and cannot be changed.');
    return row;
  }

  async update(organizationId: string, id: string, body: { dueDate?: string; notes?: string | null }) {
    await this.assertEnabled(organizationId);
    const row = await this.activeRow(organizationId, id);
    const data: { dueDate?: Date; notes?: string | null; remindedAt?: null } = {};
    if (body?.dueDate !== undefined) {
      const due = this.parseDate(body.dueDate);
      if (due !== ymdOf(row.dueDate)) {
        data.dueDate = dateOnly(due);
        // A new date gets its own reminder.
        data.remindedAt = null;
      }
    }
    if (body?.notes !== undefined) data.notes = this.cleanNotes(body.notes);
    const updated = await this.prisma.maintenanceSchedule.update({ where: { id: row.id }, data });
    return this.scheduleDto(updated);
  }

  async cancel(organizationId: string, id: string) {
    await this.assertEnabled(organizationId);
    const row = await this.activeRow(organizationId, id);
    const updated = await this.prisma.maintenanceSchedule.update({ where: { id: row.id }, data: { cancelledAt: new Date() } });
    return this.scheduleDto(updated);
  }

  // ── daily reminder ──────────────────────────────────────────────────────

  /** 08:52 SGT daily. */
  @Cron('52 0 * * *') // 00:52 UTC = 08:52 SGT
  async dailyReminders() {
    try {
      await this.runReminders();
    } catch (e: any) {
      this.logger.error(`maintenance reminders failed: ${e?.message}`, e?.stack);
    }
  }

  /**
   * Remind every live schedule whose dueDate is 0 to 7 days away (Singapore
   * date) and has not been reminded: a push to the org's field techs and an
   * office bell (MAINTENANCE_DUE), linking to the asset. Idempotent: each row is
   * CLAIMED (remindedAt set where it is still null) before anything is sent, so
   * a second run, or a second instance, sends nothing. The bell is also unique
   * per (user, kind, schedule id + date). Returns what it did, for tests and the log.
   */
  async runReminders(now: Date = new Date()) {
    const today = sgtToday(now);
    const horizon = addDays(today, REMIND_DAYS_AHEAD);
    const due = await this.prisma.maintenanceSchedule.findMany({
      where: { cancelledAt: null, remindedAt: null, dueDate: { gte: dateOnly(today), lte: dateOnly(horizon) } },
      orderBy: { dueDate: 'asc' },
    });
    const sent: Array<{ scheduleId: string; organizationId: string; assetId: string; dueDate: string; units: number }> = [];
    const flagCache = new Map<string, boolean>();

    for (const s of due) {
      let on = flagCache.get(s.organizationId);
      if (on === undefined) {
        on = await isOrgFeatureEnabled(this.prisma, s.organizationId, MAINTENANCE_DATES_FLAG);
        flagCache.set(s.organizationId, on);
      }
      if (!on) continue;

      const claim = await this.prisma.maintenanceSchedule.updateMany({
        where: { id: s.id, remindedAt: null, cancelledAt: null },
        data: { remindedAt: now },
      });
      if (claim.count !== 1) continue;

      const asset = await this.prisma.asset.findFirst({ where: { id: s.assetId }, select: { name: true } });
      const units = (await this.deployedUnits(s.organizationId, s.assetId)).length;
      const dueYmd = ymdOf(s.dueDate);
      const assetName = asset?.name ?? 'an asset';
      const unitsText = `${units} unit${units === 1 ? '' : 's'} deployed`;
      const message = `Maintenance due for ${assetName} on ${fmtDate(dueYmd)}, ${unitsText}`;
      const linkUrl = `/portal/maintenance-reports/dates/${s.assetId}`;

      // Same channel as a new scheduled delivery: push to every field tech.
      // Both calls are best-effort and never throw.
      await this.push.sendToFieldTechs(s.organizationId, {
        title: 'Maintenance due',
        body: `${assetName} on ${fmtDate(dueYmd)}, ${unitsText}`,
        data: { kind: 'MAINTENANCE_DUE', scheduleId: s.id, assetId: s.assetId, dueDate: dueYmd },
      });
      await this.notifications.emit({
        organizationId: s.organizationId,
        kind: 'MAINTENANCE_DUE',
        title: message,
        body: s.notes ?? null,
        entityType: 'maintenance-schedule',
        // Keyed by schedule AND date: the bell is unique per (user, kind,
        // entityId), so a re-dated schedule still gets a bell for its new date.
        entityId: `${s.id}:${dueYmd}`,
        linkUrl,
      });
      sent.push({ scheduleId: s.id, organizationId: s.organizationId, assetId: s.assetId, dueDate: dueYmd, units });
    }

    // One Activity Log row per org that had reminders this run.
    for (const org of new Set(sent.map((x) => x.organizationId))) {
      const mine = sent.filter((x) => x.organizationId === org);
      this.actionLog.system('maintenance-reminders', 'SEND', 'maintenance-schedules', {
        organizationId: org,
        resourceId: mine.length === 1 ? mine[0].scheduleId : undefined,
        details: { today, horizon, reminders: mine },
      });
    }
    this.logger.log(`maintenance reminders: ${sent.length} sent (${due.length} candidate(s), ${today}..${horizon})`);
    return { today, horizon, candidates: due.length, sent };
  }
}
