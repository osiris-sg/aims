import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
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

// ── RECURRING (2026-09) ──────────────────────────────────────────────────────
// Pure calendar math on YYYY-MM-DD strings: no clock, no time zone, so no JS
// Date ever reaches a timestamp-without-tz column through it.
export type RepeatUnit = 'WEEK' | 'MONTH';
const REPEAT_UNITS: RepeatUnit[] = ['WEEK', 'MONTH'];
const MAX_REPEAT_EVERY = 24;
/** Most assets one batch can schedule. */
const MAX_BATCH_ASSETS = 200;

function daysInMonth(y: number, m: number): number {
  // m is 1..12; day 0 of the next month is the last day of this one.
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/**
 * The k-th occurrence after `anchor` for "every N weeks / months". Months are
 * counted from the ANCHOR's day and clamped to the month's length, so a series
 * started on 31 Jan runs 28/29 Feb, 31 Mar, 30 Apr... and never drifts to the 28th.
 */
export function addInterval(anchor: string, k: number, every: number, unit: RepeatUnit): string {
  if (unit === 'WEEK') return addDays(anchor, 7 * every * k);
  const [y, m, d] = anchor.split('-').map(Number);
  const total = m - 1 + every * k;
  const ny = y + Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const nd = Math.min(d, daysInMonth(ny, nm));
  return `${ny}-${String(nm).padStart(2, '0')}-${String(nd).padStart(2, '0')}`;
}

/** "Every week", "Every 2 weeks", "Every month", "Every 3 months". */
export function repeatLabel(every: number | null | undefined, unit: string | null | undefined): string | null {
  if (!every || !unit) return null;
  const word = unit === 'WEEK' ? 'week' : 'month';
  return every === 1 ? `Every ${word}` : `Every ${every} ${word}s`;
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

interface RemindResult {
  scheduleId: string;
  organizationId: string;
  assetId: string;
  dueDate: string;
  units: number;
  via: 'daily-job' | 'instant';
  /** Size of the grouped reminder this schedule went out in (absent when single). */
  grouped?: number;
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
      repeatEvery: s.repeatEvery ?? null,
      repeatUnit: s.repeatUnit ?? null,
      seriesId: s.seriesId ?? null,
      repeatLabel: repeatLabel(s.repeatEvery, s.repeatUnit),
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

  /** undefined = not sent; null = no repeat; else a validated { every, unit }. */
  private parseRepeat(v: unknown): { every: number; unit: RepeatUnit } | null | undefined {
    if (v === undefined) return undefined;
    if (v === null || v === false) return null;
    const r = v as { every?: unknown; unit?: unknown };
    const every = Number(r?.every);
    const unit = String(r?.unit ?? '').toUpperCase() as RepeatUnit;
    if (!Number.isInteger(every) || every < 1 || every > MAX_REPEAT_EVERY) {
      throw new BadRequestException(`Repeat every must be a whole number from 1 to ${MAX_REPEAT_EVERY}.`);
    }
    if (!REPEAT_UNITS.includes(unit)) throw new BadRequestException('Repeat unit must be WEEK or MONTH.');
    return { every, unit };
  }

  private cleanNotes(v: unknown): string | null {
    if (v === undefined || v === null) return null;
    const s = String(v).trim();
    return s ? s.slice(0, 2000) : null;
  }

  /**
   * Create ONE schedule (or the first occurrence of a series) for one asset,
   * under the per-asset advisory lock and the one-upcoming-date rule. Throws a
   * BadRequest with a readable reason when the asset already has a date.
   * No reminder here: create / createBatch decide how to remind.
   */
  private async createOne(
    organizationId: string,
    userId: string | null,
    assetId: string,
    due: string,
    notes: string | null,
    repeat: { every: number; unit: RepeatUnit } | null | undefined,
  ) {
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
      return tx.maintenanceSchedule.create({
        data: {
          organizationId,
          assetId,
          dueDate: dateOnly(due),
          notes,
          createdByUserId: userId,
          // A repeating date starts a series; a one-off has none.
          ...(repeat ? { repeatEvery: repeat.every, repeatUnit: repeat.unit, seriesId: randomUUID() } : {}),
        },
      });
    });
  }

  async create(
    organizationId: string,
    userId: string | null,
    body: { assetId?: string; dueDate?: string; notes?: string; repeat?: { every?: number; unit?: string } | null },
  ) {
    await this.assertEnabled(organizationId);
    const assetId = String(body?.assetId ?? '').trim();
    if (!assetId) throw new BadRequestException('Pick an asset.');
    const due = this.parseDate(body?.dueDate);
    const repeat = this.parseRepeat(body?.repeat);
    const asset = await this.prisma.asset.findFirst({ where: { id: assetId, organizationId, deletedAt: null }, select: { id: true } });
    if (!asset) throw new NotFoundException('Asset not found');
    const row = await this.createOne(organizationId, userId, assetId, due, this.cleanNotes(body?.notes), repeat);
    return this.remindIfDueSoon(row.id);
  }

  /**
   * Schedule several assets at once: one date + optional repeat + notes, one
   * schedule (or series) per asset, each under the same rules as a single
   * create. Partial success is allowed: every asset gets its own result. The
   * ones created inside the reminder window share ONE grouped reminder (one
   * push + one office bell) instead of one per asset.
   */
  async createBatch(
    organizationId: string,
    userId: string | null,
    body: { assetIds?: string[]; dueDate?: string; notes?: string; repeat?: { every?: number; unit?: string } | null },
  ) {
    await this.assertEnabled(organizationId);
    const ids = [...new Set((Array.isArray(body?.assetIds) ? body.assetIds : []).map((x) => String(x ?? '').trim()).filter(Boolean))];
    if (!ids.length) throw new BadRequestException('Pick at least one asset.');
    if (ids.length > MAX_BATCH_ASSETS) throw new BadRequestException(`Pick at most ${MAX_BATCH_ASSETS} assets at a time.`);
    const due = this.parseDate(body?.dueDate);
    const repeat = this.parseRepeat(body?.repeat);
    const notes = this.cleanNotes(body?.notes);
    const assets = await this.prisma.asset.findMany({
      where: { id: { in: ids }, organizationId, deletedAt: null },
      select: { id: true, name: true },
    });
    const nameOf = new Map(assets.map((a) => [a.id, a.name]));

    const results: Array<{ assetId: string; assetName: string | null; ok: boolean; schedule?: any; error?: string }> = [];
    const created: any[] = [];
    for (const assetId of ids) {
      const assetName = nameOf.get(assetId) ?? null;
      if (!assetName) {
        results.push({ assetId, assetName, ok: false, error: 'Asset not found' });
        continue;
      }
      try {
        const row = await this.createOne(organizationId, userId, assetId, due, notes, repeat);
        created.push(row);
        results.push({ assetId, assetName, ok: true, schedule: row });
      } catch (e: any) {
        results.push({ assetId, assetName, ok: false, error: e?.response?.message ?? e?.message ?? 'Could not schedule' });
      }
    }

    // One grouped instant reminder for everything created inside the window.
    const soon = created.filter((r) => this.inReminderWindow(r.dueDate));
    if (soon.length) {
      try {
        await this.remindRows(soon, new Date(), 'instant');
      } catch (e: any) {
        this.logger.warn(`instant batch reminder failed: ${e?.message}`);
      }
    }
    const fresh = created.length
      ? new Map((await this.prisma.maintenanceSchedule.findMany({ where: { id: { in: created.map((r) => r.id) } } })).map((r) => [r.id, r]))
      : new Map();
    return {
      dueDate: due,
      scheduled: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok).length,
      results: results.map((r) => (r.ok ? { ...r, schedule: this.scheduleDto(fresh.get(r.schedule.id) ?? r.schedule) } : r)),
    };
  }

  private async activeRow(organizationId: string, id: string) {
    const row = await this.prisma.maintenanceSchedule.findFirst({ where: { id, organizationId } });
    if (!row) throw new NotFoundException('Maintenance date not found');
    if (row.cancelledAt) throw new BadRequestException('This maintenance date was cancelled.');
    if (ymdOf(row.dueDate) < sgtToday()) throw new BadRequestException('A past maintenance date is history and cannot be changed.');
    return row;
  }

  /**
   * Edit the upcoming occurrence. dueDate / notes change THIS occurrence only
   * (the series keeps counting from its anchor). repeat changes the rule for
   * future occurrences: the next one is counted from this occurrence under the
   * new rule; null stops repeating after this date; a one-off gets a new series.
   */
  async update(
    organizationId: string,
    id: string,
    body: { dueDate?: string; notes?: string | null; repeat?: { every?: number; unit?: string } | null },
  ) {
    await this.assertEnabled(organizationId);
    const row = await this.activeRow(organizationId, id);
    const data: {
      dueDate?: Date;
      notes?: string | null;
      remindedAt?: null;
      repeatEvery?: number | null;
      repeatUnit?: string | null;
      seriesId?: string;
    } = {};
    const repeat = this.parseRepeat(body?.repeat);
    if (repeat === null) {
      data.repeatEvery = null;
      data.repeatUnit = null;
    } else if (repeat) {
      data.repeatEvery = repeat.every;
      data.repeatUnit = repeat.unit;
      if (!row.seriesId) data.seriesId = randomUUID();
    }
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
    // A moved date is re-armed (remindedAt cleared above); if it now falls
    // inside the window it is reminded at once rather than tomorrow at 08:52.
    return this.remindIfDueSoon(updated.id);
  }

  /**
   * mode "date" (default): cancel this occurrence; a repeating series carries
   * on with its next occurrence, created now (and reminded now if within 7 days).
   * mode "series": cancel this occurrence AND end the series (its repeat rule is
   * cleared, so the daily job never continues it).
   */
  async cancel(organizationId: string, id: string, mode: 'date' | 'series' = 'date') {
    await this.assertEnabled(organizationId);
    if (mode !== 'date' && mode !== 'series') throw new BadRequestException('mode must be "date" or "series".');
    const row = await this.activeRow(organizationId, id);
    const updated = await this.prisma.maintenanceSchedule.update({
      where: { id: row.id },
      data: { cancelledAt: new Date(), ...(mode === 'series' ? { repeatEvery: null, repeatUnit: null } : {}) },
    });
    let next: any = null;
    if (mode === 'date' && updated.seriesId && updated.repeatEvery) {
      const created = await this.rollSeries(updated.seriesId, sgtToday(), 'cancel-date');
      if (created) next = await this.remindIfDueSoon(created.id);
    }
    return { ...this.scheduleDto(updated), next };
  }

  // ── recurring series ────────────────────────────────────────────────────

  /**
   * Create the next occurrence of ONE series when it needs one: its latest row
   * still repeats and is either past or cancelled. The next date is the first
   * step from the series' anchor (the earliest occurrence under the current
   * rule) that is after the latest row and not before today, so missed runs
   * skip ahead instead of back-filling. Runs under the same per-asset advisory
   * lock as create and re-reads inside it: two job runs (or a job and a cancel)
   * can never create two successors. Skipped while the asset already has
   * another upcoming date (one upcoming date per asset); the job retries daily.
   * Returns the created row, or null.
   */
  private async rollSeries(seriesId: string, today: string, via: 'daily-job' | 'cancel-date') {
    const head = await this.prisma.maintenanceSchedule.findFirst({ where: { seriesId }, select: { assetId: true, organizationId: true } });
    if (!head) return null;
    const created = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`maint-sched:${head.assetId}`}))`;
      const rows = await tx.maintenanceSchedule.findMany({ where: { seriesId }, orderBy: [{ dueDate: 'asc' }, { createdAt: 'asc' }] });
      const tail = rows[rows.length - 1];
      if (!tail || !tail.repeatEvery || !tail.repeatUnit) return null; // one-off or ended
      const tailDue = ymdOf(tail.dueDate);
      if (!tail.cancelledAt && tailDue >= today) return null; // still upcoming: nothing to do
      const upcoming = await tx.maintenanceSchedule.findFirst({
        where: { organizationId: tail.organizationId, assetId: tail.assetId, cancelledAt: null, dueDate: { gte: dateOnly(today) } },
        select: { id: true },
      });
      if (upcoming) return null;
      // Anchor: the earliest occurrence in the trailing run with the same rule.
      let anchorIdx = rows.length - 1;
      while (
        anchorIdx > 0 &&
        rows[anchorIdx - 1].repeatEvery === tail.repeatEvery &&
        rows[anchorIdx - 1].repeatUnit === tail.repeatUnit
      ) anchorIdx--;
      const anchor = ymdOf(rows[anchorIdx].dueDate);
      const unit = tail.repeatUnit as RepeatUnit;
      let next: string | null = null;
      for (let k = 1; k <= 2000; k++) {
        const d = addInterval(anchor, k, tail.repeatEvery, unit);
        if (d > tailDue && d >= today) {
          next = d;
          break;
        }
      }
      if (!next) return null;
      return tx.maintenanceSchedule.create({
        data: {
          organizationId: tail.organizationId,
          assetId: tail.assetId,
          dueDate: dateOnly(next),
          notes: tail.notes,
          createdByUserId: tail.createdByUserId,
          repeatEvery: tail.repeatEvery,
          repeatUnit: tail.repeatUnit,
          seriesId,
        },
      });
    });
    if (created) {
      this.actionLog.system('maintenance-series', 'CREATE', 'maintenance-schedules', {
        organizationId: created.organizationId,
        resourceId: created.id,
        details: { seriesId, dueDate: ymdOf(created.dueDate), via, rule: repeatLabel(created.repeatEvery, created.repeatUnit) },
      });
    }
    return created;
  }

  /**
   * Daily: continue every series whose latest occurrence has passed (or was
   * cancelled and could not continue at the time). Idempotent (see rollSeries).
   */
  async runSeriesRollover(now: Date = new Date()) {
    const today = sgtToday(now);
    const tails = await this.prisma.maintenanceSchedule.findMany({
      where: { seriesId: { not: null } },
      orderBy: [{ seriesId: 'asc' }, { dueDate: 'desc' }, { createdAt: 'desc' }],
      distinct: ['seriesId'],
      select: { seriesId: true, organizationId: true, repeatEvery: true, dueDate: true, cancelledAt: true },
    });
    const flagCache = new Map<string, boolean>();
    const created: string[] = [];
    for (const t of tails) {
      if (!t.seriesId || !t.repeatEvery) continue;
      if (!t.cancelledAt && ymdOf(t.dueDate) >= today) continue;
      let on = flagCache.get(t.organizationId);
      if (on === undefined) {
        on = await isOrgFeatureEnabled(this.prisma, t.organizationId, MAINTENANCE_DATES_FLAG);
        flagCache.set(t.organizationId, on);
      }
      if (!on) continue;
      const row = await this.rollSeries(t.seriesId, today, 'daily-job');
      if (row) created.push(row.id);
    }
    return { today, created };
  }

  // ── daily reminder ──────────────────────────────────────────────────────

  /** 08:52 SGT daily: continue recurring series, then send reminders. */
  @Cron('52 0 * * *') // 00:52 UTC = 08:52 SGT
  async dailyReminders() {
    try {
      await this.runDaily();
    } catch (e: any) {
      this.logger.error(`maintenance daily run failed: ${e?.message}`, e?.stack);
    }
  }

  /** Series rollover first, so a new occurrence inside the window is reminded in the same run. */
  async runDaily(now: Date = new Date()) {
    const rollover = await this.runSeriesRollover(now);
    const reminders = await this.runReminders(now);
    return { rollover, reminders };
  }

  /**
   * Remind every live schedule whose dueDate is 0 to 7 days away (Singapore
   * date) and has not been reminded: a push to the org's field techs and an
   * office bell (MAINTENANCE_DUE), linking to the asset, through remindRows (grouped by org + date).
   * Idempotent: each row is CLAIMED (remindedAt set where it is still null)
   * before anything is sent, so a second run, a second instance, or a date
   * already reminded instantly on create / edit sends nothing. The bell is also
   * unique per (user, kind, schedule id + date). Returns what it did.
   */
  async runReminders(now: Date = new Date()) {
    const today = sgtToday(now);
    const horizon = addDays(today, REMIND_DAYS_AHEAD);
    const due = await this.prisma.maintenanceSchedule.findMany({
      where: { cancelledAt: null, remindedAt: null, dueDate: { gte: dateOnly(today), lte: dateOnly(horizon) } },
      orderBy: { dueDate: 'asc' },
    });
    const flagCache = new Map<string, boolean>();
    const eligible: typeof due = [];
    for (const s of due) {
      let on = flagCache.get(s.organizationId);
      if (on === undefined) {
        on = await isOrgFeatureEnabled(this.prisma, s.organizationId, MAINTENANCE_DATES_FLAG);
        flagCache.set(s.organizationId, on);
      }
      if (on) eligible.push(s);
    }
    // Grouped by org + due date inside remindRows: several assets due the same
    // day get ONE push and ONE bell.
    const sent: RemindResult[] = await this.remindRows(eligible, now, 'daily-job');

    this.logger.log(`maintenance reminders: ${sent.length} sent (${due.length} candidate(s), ${today}..${horizon})`);
    return { today, horizon, candidates: due.length, sent };
  }

  /** Is this due date inside the reminder window (today..today+7, Singapore date)? */
  private inReminderWindow(dueDate: Date, now: Date = new Date()): boolean {
    const today = sgtToday(now);
    const d = ymdOf(dueDate);
    return d >= today && d <= addDays(today, REMIND_DAYS_AHEAD);
  }

  /**
   * THE reminder, shared by the daily job and the instant sends so the message
   * and the order are identical: CLAIM first (remindedAt set only where it is
   * still null, on a live row), THEN send. A lost claim sends nothing, so the
   * job, an instant send and a second instance can never double-send.
   *
   * Claimed rows are grouped by org + due date. A group of one keeps the
   * single-asset wording; a bigger group sends ONE push and ONE office bell
   * ("Maintenance due for N assets on <date>", the assets listed in the bell,
   * linking to Maintenance Dates filtered to that date). Every schedule still
   * gets its own Activity Log row. Push and bell are best-effort, never throw.
   */
  private async remindRows(
    rows: Array<{ id: string; organizationId: string; assetId: string; dueDate: Date; notes: string | null }>,
    now: Date,
    via: 'daily-job' | 'instant',
  ): Promise<RemindResult[]> {
    const claimed: typeof rows = [];
    for (const s of rows) {
      const claim = await this.prisma.maintenanceSchedule.updateMany({
        where: { id: s.id, remindedAt: null, cancelledAt: null },
        data: { remindedAt: now },
      });
      if (claim.count === 1) claimed.push(s);
    }
    const groups = new Map<string, typeof rows>();
    for (const s of claimed) {
      const key = `${s.organizationId}|${ymdOf(s.dueDate)}`;
      groups.set(key, [...(groups.get(key) ?? []), s]);
    }
    const out: RemindResult[] = [];
    for (const group of groups.values()) {
      const organizationId = group[0].organizationId;
      const dueYmd = ymdOf(group[0].dueDate);
      const assets = await this.prisma.asset.findMany({ where: { id: { in: group.map((s) => s.assetId) } }, select: { id: true, name: true } });
      const nameOf = new Map(assets.map((a) => [a.id, a.name]));
      const lines: Array<{ s: (typeof rows)[number]; name: string; units: number }> = [];
      for (const s of group) {
        lines.push({ s, name: nameOf.get(s.assetId) ?? 'an asset', units: (await this.deployedUnits(organizationId, s.assetId)).length });
      }
      const unitsText = (n: number) => `${n} unit${n === 1 ? '' : 's'} deployed`;

      if (group.length === 1) {
        const { s, name, units } = lines[0];
        // Same channel as a new scheduled delivery: push to every field tech.
        await this.push.sendToFieldTechs(organizationId, {
          title: 'Maintenance due',
          body: `${name} on ${fmtDate(dueYmd)}, ${unitsText(units)}`,
          data: { kind: 'MAINTENANCE_DUE', scheduleId: s.id, assetId: s.assetId, dueDate: dueYmd },
        });
        await this.notifications.emit({
          organizationId,
          kind: 'MAINTENANCE_DUE',
          title: `Maintenance due for ${name} on ${fmtDate(dueYmd)}, ${unitsText(units)}`,
          body: s.notes ?? null,
          entityType: 'maintenance-schedule',
          // Keyed by schedule AND date: the bell is unique per (user, kind,
          // entityId), so a re-dated schedule still gets a bell for its new date.
          entityId: `${s.id}:${dueYmd}`,
          linkUrl: `/portal/maintenance-reports/dates/${s.assetId}`,
        });
      } else {
        const n = group.length;
        const names = lines.map((l) => l.name);
        const shown = names.slice(0, 5).join(', ') + (n > 5 ? ` and ${n - 5} more` : '');
        const ids = group.map((s) => s.id).sort();
        await this.push.sendToFieldTechs(organizationId, {
          title: 'Maintenance due',
          body: `${n} assets on ${fmtDate(dueYmd)}: ${shown}`,
          data: { kind: 'MAINTENANCE_DUE', dueDate: dueYmd, count: String(n), scheduleIds: ids.join(',') },
        });
        await this.notifications.emit({
          organizationId,
          kind: 'MAINTENANCE_DUE',
          title: `Maintenance due for ${n} assets on ${fmtDate(dueYmd)}`,
          body: lines.map((l) => `${l.name} (${unitsText(l.units)})`).join('\n'),
          entityType: 'maintenance-schedule-group',
          // One bell per group; each schedule is claimed once, so the lowest
          // id of the group can never head another group for the same date.
          entityId: `grp:${dueYmd}:${ids[0]}`,
          linkUrl: `/portal/maintenance-reports/dates?due=${dueYmd}`,
        });
      }
      for (const { s, units } of lines) {
        const result = { scheduleId: s.id, organizationId, assetId: s.assetId, dueDate: dueYmd, units, via, grouped: group.length > 1 ? group.length : undefined };
        this.actionLog.system('maintenance-reminders', 'SEND', 'maintenance-schedules', {
          organizationId,
          resourceId: s.id,
          details: result,
        });
        out.push(result);
      }
    }
    return out;
  }

  /**
   * Instant reminder after a create or a date change: when the date is due
   * within the window and this date has not been reminded, send it now (same
   * remindRows as the 08:52 job, which then skips it). Never fails the save.
   * Returns the schedule as stored after any send.
   */
  private async remindIfDueSoon(scheduleId: string) {
    let row = await this.prisma.maintenanceSchedule.findUnique({ where: { id: scheduleId } });
    if (row && !row.cancelledAt && !row.remindedAt && this.inReminderWindow(row.dueDate)) {
      try {
        if ((await this.remindRows([row], new Date(), 'instant')).length) {
          row = await this.prisma.maintenanceSchedule.findUnique({ where: { id: scheduleId } });
        }
      } catch (e: any) {
        this.logger.warn(`instant maintenance reminder failed for ${scheduleId}: ${e?.message}`);
      }
    }
    return this.scheduleDto(row);
  }
}
