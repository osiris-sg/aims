import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from 'src/common/prisma.service';
import { PdfGeneratorService } from 'src/common/services/pdf-generator.service';
import { isOrgFeatureEnabled } from 'src/common/org-features';
import { orgTodayFor } from 'src/common/org-today';
import { ActionLogService } from 'src/action-log/action-log.service';
import { ClerkIdentityService } from 'src/clerk/clerk-identity.service';
import { NotificationsService } from '../notifications/notifications.service';
import { buildVehicleLogHtml } from './vehicle-log-html';
import {
  EXPIRY_WARN_DAYS,
  WCT_VEHICLES_FLAG,
  cleanText,
  currentMileage,
  daysUntil,
  endChecks,
  normalizeVehicleNo,
  parseMileage,
  parseYmd,
  reminderThreshold,
  startWarnings,
  ymd,
} from './vehicle-rules';

export type Actor = { id?: string | null; name?: string | null };

/**
 * WCT VEHICLES (enableWctVehicles, 2026-11-12, WCT (S) Systems only): the
 * office's register of vans and lorries and each one's "Vehicle / Lorry Usage &
 * Repair Form". Office users only; nothing is entered from the field app.
 *
 * Rules: one open usage per vehicle; a usage cannot end before it started;
 * mileage that goes backwards is a WARNING, never a block (typos must stay
 * fixable); an approved repair is locked until an admin unlocks it with a
 * reason (kept on the row and in the Activity Log). Every write is an HTTP
 * request, so the Activity Log interceptor records it; the reminder cron logs
 * its own system rows.
 */
@Injectable()
export class VehiclesService {
  private readonly logger = new Logger(VehiclesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly pdf: PdfGeneratorService,
    private readonly notifications: NotificationsService,
    private readonly actionLog: ActionLogService,
    @Optional() private readonly identity?: ClerkIdentityService,
  ) {}

  async assertEnabled(organizationId: string) {
    if (!(await isOrgFeatureEnabled(this.prisma, organizationId, WCT_VEHICLES_FLAG))) {
      throw new ForbiddenException('Vehicles are not enabled for this organisation');
    }
  }

  // ---------------------------------------------------------------- reads

  async list(organizationId: string, includeArchived = false) {
    await this.assertEnabled(organizationId);
    const today = await orgTodayFor(this.prisma, organizationId);
    const rows = await this.prisma.vehicle.findMany({
      where: { organizationId, ...(includeArchived ? {} : { archivedAt: null }) },
      orderBy: { vehicleNo: 'asc' },
      include: { usages: { select: { id: true, driverName: true, startDate: true, startMileage: true, endDate: true, endMileage: true, repairDetails: true, repairApprovedAt: true } } },
    });
    return rows.map(({ usages, ...v }) => {
      const open = usages.find((u) => !u.endDate) ?? null;
      return {
        ...this.vehicleDto(v, today),
        currentDriver: open?.driverName ?? null,
        inUseSince: ymd(open?.startDate),
        lastMileage: currentMileage(usages),
        usageCount: usages.length,
        repairsToApprove: usages.filter((u) => u.repairDetails && !u.repairApprovedAt).length,
      };
    });
  }

  async get(id: string, organizationId: string) {
    await this.assertEnabled(organizationId);
    const today = await orgTodayFor(this.prisma, organizationId);
    const v = await this.prisma.vehicle.findFirst({
      where: { id, organizationId },
      include: { usages: { orderBy: [{ startDate: 'desc' }, { createdAt: 'desc' }] } },
    });
    if (!v) throw new NotFoundException('Vehicle not found');
    const { usages, ...rest } = v;
    return {
      ...this.vehicleDto(rest, today),
      lastMileage: currentMileage(usages),
      openUsageId: usages.find((u) => !u.endDate)?.id ?? null,
      usages: usages.map((u) => this.usageDto(u)),
    };
  }

  /** Who can be picked as a driver: the org's active AIMS users, by name. */
  async drivers(organizationId: string) {
    await this.assertEnabled(organizationId);
    const rows = await this.prisma.userRole.findMany({ where: { organizationId, isActive: true }, select: { userId: true } });
    const ids = [...new Set(rows.map((r) => r.userId))];
    const names = await this.userNames(ids);
    return ids
      .map((id) => ({ id, name: names.get(id) ?? null }))
      .filter((d): d is { id: string; name: string } => !!d.name)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  // ---------------------------------------------------------------- vehicle writes

  async create(body: any, organizationId: string, actor: Actor) {
    await this.assertEnabled(organizationId);
    const vehicleNo = normalizeVehicleNo(body?.vehicleNo);
    await this.assertNoDuplicate(organizationId, vehicleNo);
    const v = await this.prisma.vehicle.create({
      data: {
        organizationId,
        vehicleNo,
        model: cleanText(body?.model, 120),
        coeExpiry: parseYmd(body?.coeExpiry, 'COE Expiry Date', false),
        lifespanExpiry: parseYmd(body?.lifespanExpiry, 'Vehicle Lifespan Expiry Date', false),
        notes: cleanText(body?.notes, 1000),
        createdBy: actor.id ?? null,
      },
    });
    return this.vehicleDto(v, await orgTodayFor(this.prisma, organizationId));
  }

  async update(id: string, body: any, organizationId: string) {
    await this.assertEnabled(organizationId);
    const v = await this.vehicleOr404(id, organizationId);
    const data: Prisma.VehicleUpdateInput = {};
    if (body?.vehicleNo !== undefined) {
      const vehicleNo = normalizeVehicleNo(body.vehicleNo);
      if (vehicleNo !== v.vehicleNo) await this.assertNoDuplicate(organizationId, vehicleNo, id);
      data.vehicleNo = vehicleNo;
    }
    if (body?.model !== undefined) data.model = cleanText(body.model, 120);
    if (body?.coeExpiry !== undefined) data.coeExpiry = parseYmd(body.coeExpiry, 'COE Expiry Date', false);
    if (body?.lifespanExpiry !== undefined) data.lifespanExpiry = parseYmd(body.lifespanExpiry, 'Vehicle Lifespan Expiry Date', false);
    if (body?.notes !== undefined) data.notes = cleanText(body.notes, 1000);
    const saved = await this.prisma.vehicle.update({ where: { id }, data });
    return this.vehicleDto(saved, await orgTodayFor(this.prisma, organizationId));
  }

  /** Archive (hidden from the list, log kept) or bring back. */
  async setArchived(id: string, archived: boolean, organizationId: string) {
    await this.assertEnabled(organizationId);
    const v = await this.vehicleOr404(id, organizationId);
    if (archived) {
      const open = await this.prisma.vehicleUsage.findFirst({ where: { vehicleId: id, endDate: null }, select: { id: true } });
      if (open) throw new BadRequestException('End the current usage before archiving this vehicle');
    } else {
      await this.assertNoDuplicate(organizationId, v.vehicleNo, id);
    }
    await this.prisma.vehicle.update({ where: { id }, data: { archivedAt: archived ? new Date() : null } });
    return { id, archived };
  }

  // ---------------------------------------------------------------- usage writes

  async startUsage(vehicleId: string, body: any, organizationId: string, actor: Actor) {
    await this.assertEnabled(organizationId);
    const v = await this.vehicleOr404(vehicleId, organizationId);
    if (v.archivedAt) throw new BadRequestException('This vehicle is archived');
    const usages = await this.prisma.vehicleUsage.findMany({ where: { vehicleId } });
    const open = usages.find((u) => !u.endDate);
    if (open) {
      throw new BadRequestException(`${v.vehicleNo} is already in use by ${open.driverName} since ${ymd(open.startDate)}. End that usage first.`);
    }
    const driver = await this.resolveDriver(body, organizationId);
    const startDate = parseYmd(body?.startDate, 'Usage start date')!;
    const startMileage = parseMileage(body?.startMileage, 'Mileage at start')!;
    const created = await this.prisma.vehicleUsage.create({
      data: { organizationId, vehicleId, ...driver, startDate, startMileage, createdBy: actor.id ?? null },
    });
    return { usage: this.usageDto(created), warnings: startWarnings(startMileage, usages) };
  }

  async endUsage(id: string, body: any, organizationId: string) {
    await this.assertEnabled(organizationId);
    const u = await this.usageOr404(id, organizationId);
    if (u.endDate) throw new BadRequestException('This usage has already ended');
    const endDate = parseYmd(body?.endDate, 'Usage end date')!;
    const endMileage = parseMileage(body?.endMileage, 'Mileage at end')!;
    const warnings = endChecks(u, endDate, endMileage);
    const saved = await this.prisma.vehicleUsage.update({ where: { id }, data: { endDate, endMileage } });
    return { usage: this.usageDto(saved), warnings };
  }

  /** Fix a usage row (driver, dates, mileage). Repair fields go through logRepair / approve. */
  async editUsage(id: string, body: any, organizationId: string) {
    await this.assertEnabled(organizationId);
    const u = await this.usageOr404(id, organizationId);
    const data: Prisma.VehicleUsageUpdateInput = {};
    if (body?.driverUserId !== undefined || body?.driverName !== undefined) Object.assign(data, await this.resolveDriver(body, organizationId));
    const startDate = body?.startDate !== undefined ? parseYmd(body.startDate, 'Usage start date')! : u.startDate;
    const startMileage = body?.startMileage !== undefined ? parseMileage(body.startMileage, 'Mileage at start')! : u.startMileage;
    const endDate = body?.endDate !== undefined ? parseYmd(body.endDate, 'Usage end date', false) : u.endDate;
    const endMileage = body?.endMileage !== undefined ? parseMileage(body.endMileage, 'Mileage at end', false) : u.endMileage;
    if ((endDate == null) !== (endMileage == null)) throw new BadRequestException('An ended usage needs both its end date and its mileage at end');
    if (!endDate && !u.endDate) {
      /* still open: fine */
    } else if (!endDate) {
      // Re-opening a usage: only when the vehicle has no other open one.
      const other = await this.prisma.vehicleUsage.findFirst({ where: { vehicleId: u.vehicleId, endDate: null, id: { not: id } }, select: { id: true } });
      if (other) throw new BadRequestException('Another usage of this vehicle is open; end it first');
    }
    Object.assign(data, { startDate, startMileage, endDate, endMileage });
    const others = await this.prisma.vehicleUsage.findMany({ where: { vehicleId: u.vehicleId, id: { not: id } } });
    const warnings = [...startWarnings(startMileage, others), ...(endDate && endMileage != null ? endChecks({ startDate, startMileage }, endDate, endMileage) : [])];
    const saved = await this.prisma.vehicleUsage.update({ where: { id }, data });
    return { usage: this.usageDto(saved), warnings };
  }

  /** Log (or correct) the damage / issue / repair details on a usage. Locked once approved. */
  async logRepair(id: string, body: any, organizationId: string) {
    await this.assertEnabled(organizationId);
    const u = await this.usageOr404(id, organizationId);
    if (u.repairApprovedAt) throw new BadRequestException('This repair is approved and locked. An admin can unlock it.');
    const repairDetails = cleanText(body?.repairDetails, 2000);
    const saved = await this.prisma.vehicleUsage.update({
      where: { id },
      data: { repairDetails, repairLoggedAt: repairDetails ? u.repairLoggedAt ?? new Date() : null },
    });
    return { usage: this.usageDto(saved) };
  }

  async approveRepair(id: string, body: any, organizationId: string, actor: Actor) {
    await this.assertEnabled(organizationId);
    const u = await this.usageOr404(id, organizationId);
    if (!u.repairDetails) throw new BadRequestException('There is no damage or repair logged on this usage');
    if (u.repairApprovedAt) throw new BadRequestException('This repair is already approved');
    const approvedBy = cleanText(body?.approvedBy, 120) ?? (await this.nameOf(actor)) ?? 'Admin';
    const approvedAt = parseYmd(body?.approvedDate, 'Repair approved date', false) ?? parseYmd(await orgTodayFor(this.prisma, organizationId), 'today')!;
    const saved = await this.prisma.vehicleUsage.update({
      where: { id },
      data: { repairApprovedBy: approvedBy, repairApprovedById: actor.id ?? null, repairApprovedAt: approvedAt },
    });
    return { usage: this.usageDto(saved) };
  }

  /** Admin only: lift the lock on an approved repair. The reason is required, kept on the row and in the Activity Log (request body). */
  async unlockRepair(id: string, body: any, organizationId: string, actor: Actor) {
    await this.assertEnabled(organizationId);
    const u = await this.usageOr404(id, organizationId);
    if (!u.repairApprovedAt) throw new BadRequestException('This repair is not approved, so it is not locked');
    const reason = cleanText(body?.reason, 500);
    if (!reason) throw new BadRequestException('Give a reason for unlocking');
    const history = Array.isArray(u.repairUnlocks) ? (u.repairUnlocks as any[]) : [];
    const entry = {
      at: new Date().toISOString(),
      byUserId: actor.id ?? null,
      byName: (await this.nameOf(actor)) ?? null,
      reason,
      approvedBy: u.repairApprovedBy,
      approvedAt: ymd(u.repairApprovedAt),
    };
    const saved = await this.prisma.vehicleUsage.update({
      where: { id },
      data: { repairApprovedAt: null, repairApprovedBy: null, repairApprovedById: null, repairUnlocks: [...history, entry] as Prisma.InputJsonValue },
    });
    return { usage: this.usageDto(saved) };
  }

  // ---------------------------------------------------------------- the paper form

  async logPdf(id: string, organizationId: string): Promise<{ buffer: Buffer; filename: string }> {
    await this.assertEnabled(organizationId);
    const html = await this.logHtml(id, organizationId);
    const v = await this.vehicleOr404(id, organizationId);
    const buffer = await this.pdf.generatePdfFromHtml(html, { landscape: true, margin: { top: '0', right: '0', bottom: '0', left: '0' } });
    return { buffer, filename: `Vehicle usage log ${v.vehicleNo} ${await orgTodayFor(this.prisma, organizationId)}.pdf` };
  }

  async logHtml(id: string, organizationId: string): Promise<string> {
    const v = await this.prisma.vehicle.findFirst({
      where: { id, organizationId },
      include: { usages: { orderBy: [{ startDate: 'asc' }, { createdAt: 'asc' }] } },
    });
    if (!v) throw new NotFoundException('Vehicle not found');
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { name: true, logo: true, address: true, phoneNumber: true, email: true, registrationNumber: true },
    });
    return buildVehicleLogHtml({
      org: { ...(org ?? { name: '' }), name: org?.name ?? '' },
      vehicle: { vehicleNo: v.vehicleNo, model: v.model, coeExpiry: ymd(v.coeExpiry), lifespanExpiry: ymd(v.lifespanExpiry) },
      usages: v.usages.map((u) => ({
        driverName: u.driverName,
        startDate: ymd(u.startDate)!,
        startMileage: u.startMileage,
        endDate: ymd(u.endDate),
        endMileage: u.endMileage,
        repairDetails: u.repairDetails,
        repairApprovedBy: u.repairApprovedBy,
        repairApprovedAt: ymd(u.repairApprovedAt),
      })),
      printedOn: await orgTodayFor(this.prisma, organizationId),
    });
  }

  // ---------------------------------------------------------------- reminders

  /** 08:55 Singapore: a bell at 90 and at 30 days before each COE / lifespan expiry. */
  @Cron('55 0 * * *')
  async dailyExpiryReminders() {
    try {
      await this.runExpiryReminders();
    } catch (e: any) {
      this.logger.error(`vehicle expiry reminders failed: ${e?.message}`, e?.stack);
    }
  }

  /**
   * For every org with the flag on: each live vehicle whose COE or lifespan
   * expiry is 90 (then 30) days away or less gets ONE bell per threshold and
   * expiry date (a vehicle added 20 days before expiry gets only the 30-day
   * one). Keyed by (vehicle, kind, threshold, date): re-runs are no-ops, and a
   * renewed COE (new date) is reminded again. Expired dates are not reminded
   * (the list shows them red).
   */
  async runExpiryReminders(now: Date = new Date()) {
    const configs = await this.prisma.organizationUIConfig.findMany({
      where: { features: { path: [WCT_VEHICLES_FLAG], equals: true } },
      select: { organizationId: true },
    });
    const sent: Array<{ organizationId: string; vehicleId: string; which: string; threshold: number; expiry: string }> = [];
    for (const { organizationId } of configs) {
      const today = await orgTodayFor(this.prisma, organizationId, now);
      const vehicles = await this.prisma.vehicle.findMany({ where: { organizationId, archivedAt: null } });
      for (const v of vehicles) {
        for (const [which, label, date] of [
          ['COE', 'COE', v.coeExpiry],
          ['LIFESPAN', 'Vehicle lifespan', v.lifespanExpiry],
        ] as const) {
          const days = daysUntil(date, today);
          const threshold = reminderThreshold(days);
          if (!threshold || !date) continue;
          const expiry = ymd(date)!;
          const entityId = `${v.id}:${which}:${threshold}:${expiry}`;
          const already = await this.prisma.notification.findFirst({ where: { organizationId, kind: 'VEHICLE_EXPIRY', entityId }, select: { id: true } });
          if (already) continue;
          await this.notifications.emit({
            organizationId,
            kind: 'VEHICLE_EXPIRY',
            title: `${label} of ${v.vehicleNo} expires on ${expiry.split('-').reverse().join('/')} (${days === 0 ? 'today' : `in ${days} day${days === 1 ? '' : 's'}`})`,
            body: v.model ?? null,
            entityType: 'vehicle',
            entityId,
            linkUrl: `/portal/vehicles/${v.id}`,
          });
          this.actionLog.system('vehicle-expiry-reminders', 'SEND', 'vehicles', {
            organizationId,
            resourceId: v.id,
            details: { which, threshold, expiry, days },
          });
          sent.push({ organizationId, vehicleId: v.id, which, threshold, expiry });
        }
      }
    }
    return sent;
  }

  // ---------------------------------------------------------------- helpers

  private vehicleDto(v: { id: string; vehicleNo: string; model: string | null; coeExpiry: Date | null; lifespanExpiry: Date | null; notes: string | null; archivedAt: Date | null; createdAt: Date; updatedAt: Date }, today: string) {
    const coeDays = daysUntil(v.coeExpiry, today);
    const lifespanDays = daysUntil(v.lifespanExpiry, today);
    return {
      id: v.id,
      vehicleNo: v.vehicleNo,
      model: v.model,
      coeExpiry: ymd(v.coeExpiry),
      lifespanExpiry: ymd(v.lifespanExpiry),
      coeDays,
      lifespanDays,
      expiryWarning: [coeDays, lifespanDays].some((d) => d != null && d <= EXPIRY_WARN_DAYS),
      notes: v.notes,
      archived: !!v.archivedAt,
      createdAt: v.createdAt,
      updatedAt: v.updatedAt,
    };
  }

  private usageDto(u: any) {
    return {
      id: u.id,
      vehicleId: u.vehicleId,
      driverUserId: u.driverUserId,
      driverName: u.driverName,
      startDate: ymd(u.startDate),
      startMileage: u.startMileage,
      endDate: ymd(u.endDate),
      endMileage: u.endMileage,
      open: !u.endDate,
      repairDetails: u.repairDetails,
      repairApprovedBy: u.repairApprovedBy,
      repairApprovedAt: ymd(u.repairApprovedAt),
      repairLocked: !!u.repairApprovedAt,
      repairUnlocks: Array.isArray(u.repairUnlocks) ? u.repairUnlocks : [],
      createdAt: u.createdAt,
    };
  }

  /** An org user picked from the list (name looked up), or a typed name. */
  private async resolveDriver(body: any, organizationId: string): Promise<{ driverUserId: string | null; driverName: string }> {
    const userId = typeof body?.driverUserId === 'string' && body.driverUserId.trim() ? body.driverUserId.trim() : null;
    if (userId) {
      const member = await this.prisma.userRole.findFirst({ where: { organizationId, userId, isActive: true }, select: { userId: true } });
      if (!member) throw new BadRequestException('That driver is not a user of this organisation');
      const name = cleanText(body?.driverName, 120) ?? (await this.userNames([userId])).get(userId) ?? null;
      if (!name) throw new BadRequestException('Could not find that user’s name; type the driver’s name instead');
      return { driverUserId: userId, driverName: name };
    }
    const typed = cleanText(body?.driverName, 120);
    if (!typed) throw new BadRequestException('Pick a driver or type their name');
    return { driverUserId: null, driverName: typed };
  }

  private async assertNoDuplicate(organizationId: string, vehicleNo: string, exceptId?: string) {
    const dup = await this.prisma.vehicle.findFirst({
      where: { organizationId, vehicleNo, archivedAt: null, ...(exceptId ? { id: { not: exceptId } } : {}) },
      select: { id: true },
    });
    if (dup) throw new BadRequestException(`${vehicleNo} is already in the list`);
  }

  private async vehicleOr404(id: string, organizationId: string) {
    const v = await this.prisma.vehicle.findFirst({ where: { id, organizationId } });
    if (!v) throw new NotFoundException('Vehicle not found');
    return v;
  }

  private async usageOr404(id: string, organizationId: string) {
    const u = await this.prisma.vehicleUsage.findFirst({ where: { id, organizationId } });
    if (!u) throw new NotFoundException('Usage not found');
    return u;
  }

  private async nameOf(actor: Actor): Promise<string | null> {
    if (actor.name) return actor.name;
    return actor.id ? (await this.userNames([actor.id])).get(actor.id) ?? null : null;
  }

  /** Display names (first + last, else the email) from Clerk. Never throws. */
  private async userNames(ids: string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    if (!ids.length || !this.identity) return out;
    try {
      const users = await this.identity.toClerkUsers(ids);
      for (const [id, u] of users) {
        const name = [u.firstName, u.lastName].filter(Boolean).join(' ').trim() || u.emailAddresses?.[0]?.emailAddress || '';
        if (name) out.set(id, name);
      }
    } catch {
      /* names are a convenience */
    }
    return out;
  }
}
