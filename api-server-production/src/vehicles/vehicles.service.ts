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
import { isOrgFolderKey } from '../common/storage-keys';
import {
  EXPIRY_WARN_DAYS,
  LOG_TYPE_LABEL,
  RENEWAL_FIELD,
  RENEWAL_LABEL,
  WCT_VEHICLES_FLAG,
  byNewest,
  cleanText,
  currentDriverOf,
  daysUntil,
  lastMileageOf,
  mileageWarnings,
  moneySummary,
  normalizeVehicleNo,
  parseAmount,
  parseLogType,
  parseMileage,
  parseRenewalKind,
  parseYmd,
  reminderThreshold,
  ymd,
  type LogType,
  type RenewalKind,
} from './vehicle-rules';

export type Actor = { id?: string | null; name?: string | null };

/**
 * WCT VEHICLES (enableWctVehicles, 2026-11-12, WCT (S) Systems only): the
 * office's register of vans and lorries and each one's "Vehicle / Lorry Usage &
 * Repair Form". Office users only; nothing is entered from the field app.
 *
 * LOG BOOK (2026-11-16): every transaction of a vehicle is a log entry (driver
 * assigned, repair / servicing, fuel, renewals, parking / ERP / fines, other)
 * with an optional mileage, amount and attachment. The current driver is the
 * latest "Driver assigned" entry; the money summary adds the amounts. Mileage
 * that goes backwards is a WARNING, never a block (typos must stay fixable);
 * an approved repair is locked (no edit, no delete) until an admin unlocks it
 * with a reason (kept on the entry and in the Activity Log). Deleting hides
 * the entry. Every write is an HTTP request, so the Activity Log interceptor
 * records it; the reminder cron logs its own system rows. The old usage rows
 * (VehicleUsage) are kept and converted once by scripts/wct-vehicle-usage-to-log.ts.
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
      include: {
        logEntries: {
          where: { deletedAt: null },
          select: { id: true, date: true, createdAt: true, type: true, mileage: true, amount: true, driverName: true, driverUserId: true, description: true, repairApprovedAt: true },
        },
      },
    });
    return rows.map(({ logEntries, ...v }) => {
      const entries = logEntries.map((e) => this.entryLike(e));
      const driver = currentDriverOf(entries);
      return {
        ...this.vehicleDto(v, today),
        currentDriver: driver?.driverName ?? null,
        driverSince: driver ? ymd(driver.date) : null,
        lastMileage: lastMileageOf(entries),
        entryCount: entries.length,
        spentThisYear: moneySummary(entries, today).year.total,
        repairsToApprove: logEntries.filter((e) => e.type === 'REPAIR' && e.description && !e.repairApprovedAt).length,
      };
    });
  }

  async get(id: string, organizationId: string) {
    await this.assertEnabled(organizationId);
    const today = await orgTodayFor(this.prisma, organizationId);
    const v = await this.prisma.vehicle.findFirst({ where: { id, organizationId }, include: { logEntries: { where: { deletedAt: null } } } });
    if (!v) throw new NotFoundException('Vehicle not found');
    const { logEntries, ...rest } = v;
    const entries = logEntries.map((e) => this.entryLike(e)).sort(byNewest);
    const driver = currentDriverOf(entries);
    return {
      ...this.vehicleDto(rest, today),
      currentDriver: driver?.driverName ?? null,
      currentDriverUserId: driver?.driverUserId ?? null,
      driverSince: driver ? ymd(driver.date) : null,
      lastMileage: lastMileageOf(entries),
      summary: moneySummary(entries, today),
      entries: entries.map((e) => this.entryDto(e)),
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
    if (body?.roadTaxExpiry !== undefined) data.roadTaxExpiry = parseYmd(body.roadTaxExpiry, 'Road tax expiry', false);
    if (body?.insuranceExpiry !== undefined) data.insuranceExpiry = parseYmd(body.insuranceExpiry, 'Insurance expiry', false);
    if (body?.inspectionExpiry !== undefined) data.inspectionExpiry = parseYmd(body.inspectionExpiry, 'Inspection due date', false);
    if (body?.notes !== undefined) data.notes = cleanText(body.notes, 1000);
    const saved = await this.prisma.vehicle.update({ where: { id }, data });
    return this.vehicleDto(saved, await orgTodayFor(this.prisma, organizationId));
  }

  /** Archive (hidden from the list, log kept) or bring back. */
  async setArchived(id: string, archived: boolean, organizationId: string) {
    await this.assertEnabled(organizationId);
    const v = await this.vehicleOr404(id, organizationId);
    if (!archived) {
      await this.assertNoDuplicate(organizationId, v.vehicleNo, id);
    }
    await this.prisma.vehicle.update({ where: { id }, data: { archivedAt: archived ? new Date() : null } });
    return { id, archived };
  }

  // ---------------------------------------------------------------- log entries

  /** Add an entry of any type to a vehicle's log. */
  async addEntry(vehicleId: string, body: any, organizationId: string, actor: Actor) {
    await this.assertEnabled(organizationId);
    const v = await this.vehicleOr404(vehicleId, organizationId);
    if (v.archivedAt) throw new BadRequestException('This vehicle is archived');
    const type = parseLogType(body?.type);
    const data = await this.entryFields(type, body, organizationId, true);
    const others = await this.liveEntries(vehicleId);
    const created = await this.prisma.vehicleLogEntry.create({
      data: { organizationId, vehicleId, type, ...data, createdBy: actor.id ?? null, createdByName: await this.nameOf(actor) } as Prisma.VehicleLogEntryUncheckedCreateInput,
    });
    const renewed = await this.applyRenewal(v.id, created);
    return { entry: this.entryDto(this.entryLike(created)), warnings: mileageWarnings(created.mileage, others), renewed };
  }

  /** Correct an entry (not a locked, approved repair). The type stays. */
  async editEntry(id: string, body: any, organizationId: string) {
    await this.assertEnabled(organizationId);
    const e = await this.entryOr404(id, organizationId);
    if (e.repairApprovedAt) throw new BadRequestException('This repair is approved and locked. An admin can unlock it.');
    const data = await this.entryFields(e.type as LogType, { ...this.entryBody(e), ...body }, organizationId, false);
    const others = await this.liveEntries(e.vehicleId);
    const saved = await this.prisma.vehicleLogEntry.update({ where: { id }, data: data as Prisma.VehicleLogEntryUncheckedUpdateInput });
    const renewed = await this.applyRenewal(e.vehicleId, saved);
    return { entry: this.entryDto(this.entryLike(saved)), warnings: mileageWarnings(saved.mileage, others, id), renewed };
  }

  /** Delete = hide (kept for the record, Activity Log row from the request). A locked repair must be unlocked first. */
  async deleteEntry(id: string, organizationId: string, actor: Actor) {
    await this.assertEnabled(organizationId);
    const e = await this.entryOr404(id, organizationId);
    if (e.repairApprovedAt) throw new BadRequestException('This repair is approved and locked. An admin can unlock it first.');
    await this.prisma.vehicleLogEntry.update({ where: { id }, data: { deletedAt: new Date(), deletedBy: actor.id ?? null } });
    return { id, deleted: true };
  }

  async approveRepair(id: string, body: any, organizationId: string, actor: Actor) {
    await this.assertEnabled(organizationId);
    const e = await this.entryOr404(id, organizationId);
    if (e.type !== 'REPAIR' || !e.description) throw new BadRequestException('Only a repair / servicing entry with details can be approved');
    if (e.repairApprovedAt) throw new BadRequestException('This repair is already approved');
    const approvedBy = cleanText(body?.approvedBy, 120) ?? (await this.nameOf(actor)) ?? 'Admin';
    const approvedAt = parseYmd(body?.approvedDate, 'Repair approved date', false) ?? parseYmd(await orgTodayFor(this.prisma, organizationId), 'today')!;
    const saved = await this.prisma.vehicleLogEntry.update({
      where: { id },
      data: { repairApprovedBy: approvedBy, repairApprovedById: actor.id ?? null, repairApprovedAt: approvedAt },
    });
    return { entry: this.entryDto(this.entryLike(saved)) };
  }

  /** Admin only: lift the lock on an approved repair. The reason is required, kept on the entry and in the Activity Log (request body). */
  async unlockRepair(id: string, body: any, organizationId: string, actor: Actor) {
    await this.assertEnabled(organizationId);
    const e = await this.entryOr404(id, organizationId);
    if (!e.repairApprovedAt) throw new BadRequestException('This repair is not approved, so it is not locked');
    const reason = cleanText(body?.reason, 500);
    if (!reason) throw new BadRequestException('Give a reason for unlocking');
    const history = Array.isArray(e.repairUnlocks) ? (e.repairUnlocks as any[]) : [];
    const entry = { at: new Date().toISOString(), byUserId: actor.id ?? null, byName: (await this.nameOf(actor)) ?? null, reason, approvedBy: e.repairApprovedBy, approvedAt: ymd(e.repairApprovedAt) };
    const saved = await this.prisma.vehicleLogEntry.update({
      where: { id },
      data: { repairApprovedAt: null, repairApprovedBy: null, repairApprovedById: null, repairUnlocks: [...history, entry] as Prisma.InputJsonValue },
    });
    return { entry: this.entryDto(this.entryLike(saved)) };
  }

  // ---------------------------------------------------------------- the paper form

  async logPdf(id: string, organizationId: string, filter: { type?: string; from?: string; to?: string } = {}): Promise<{ buffer: Buffer; filename: string }> {
    await this.assertEnabled(organizationId);
    const html = await this.logHtml(id, organizationId, filter);
    const v = await this.vehicleOr404(id, organizationId);
    const buffer = await this.pdf.generatePdfFromHtml(html, { landscape: true, margin: { top: '0', right: '0', bottom: '0', left: '0' } });
    return { buffer, filename: `Vehicle log book ${v.vehicleNo} ${await orgTodayFor(this.prisma, organizationId)}.pdf` };
  }

  async logHtml(id: string, organizationId: string, filter: { type?: string; from?: string; to?: string } = {}): Promise<string> {
    const v = await this.prisma.vehicle.findFirst({ where: { id, organizationId }, include: { logEntries: { where: { deletedAt: null } } } });
    if (!v) throw new NotFoundException('Vehicle not found');
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { name: true, logo: true, address: true, phoneNumber: true, email: true, registrationNumber: true },
    });
    const from = filter.from ? parseYmd(filter.from, 'From date') : null;
    const to = filter.to ? parseYmd(filter.to, 'To date') : null;
    const type = filter.type ? parseLogType(filter.type) : null;
    const rows = v.logEntries
      .map((e) => this.entryLike(e))
      .filter((e) => (!type || e.type === type) && (!from || e.date >= from) && (!to || e.date <= to))
      .sort((a, b) => -byNewest(a, b)); // oldest first, as the paper is filled
    return buildVehicleLogHtml({
      org: { ...(org ?? { name: '' }), name: org?.name ?? '' },
      vehicle: { vehicleNo: v.vehicleNo, model: v.model, coeExpiry: ymd(v.coeExpiry), lifespanExpiry: ymd(v.lifespanExpiry) },
      filterLine: [type ? `Type: ${LOG_TYPE_LABEL[type]}` : '', from ? `From ${ymd(from)}` : '', to ? `To ${ymd(to)}` : ''].filter(Boolean).join('  ·  ') || null,
      entries: rows.map((e) => ({
        date: ymd(e.date)!,
        type: this.typeText(e),
        details: this.detailsText(e),
        driverName: e.driverName ?? null,
        mileage: e.mileage,
        amount: e.amount,
        approvedBy: e.repairApprovedBy ?? null,
        approvedAt: ymd(e.repairApprovedAt ?? null),
      })),
      printedOn: await orgTodayFor(this.prisma, organizationId),
    });
  }

  // ---------------------------------------------------------------- reminders

  /** 08:55 Singapore: a bell at 90 and at 30 days before each COE / lifespan / road tax / insurance / inspection date. */
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
          // Log book (2026-11-16): the renewal dates get the same 90 / 30-day bells.
          ['ROAD_TAX', 'Road tax', v.roadTaxExpiry],
          ['INSURANCE', 'Insurance', v.insuranceExpiry],
          ['INSPECTION', 'Inspection', v.inspectionExpiry],
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
            title: `${label} of ${v.vehicleNo} ${which === 'INSPECTION' ? 'is due' : 'expires'} on ${expiry.split('-').reverse().join('/')} (${days === 0 ? 'today' : `in ${days} day${days === 1 ? '' : 's'}`})`,
            body: v.model ?? null,
            entityType: 'vehicle',
            entityId,
            linkUrl: `/portal/assets/vehicles/${v.id}`,
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

  private vehicleDto(
    v: { id: string; vehicleNo: string; model: string | null; coeExpiry: Date | null; lifespanExpiry: Date | null; roadTaxExpiry?: Date | null; insuranceExpiry?: Date | null; inspectionExpiry?: Date | null; notes: string | null; archivedAt: Date | null; createdAt: Date; updatedAt: Date },
    today: string,
  ) {
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
      roadTaxExpiry: ymd(v.roadTaxExpiry ?? null),
      insuranceExpiry: ymd(v.insuranceExpiry ?? null),
      inspectionExpiry: ymd(v.inspectionExpiry ?? null),
      roadTaxDays: daysUntil(v.roadTaxExpiry ?? null, today),
      insuranceDays: daysUntil(v.insuranceExpiry ?? null, today),
      inspectionDays: daysUntil(v.inspectionExpiry ?? null, today),
      notes: v.notes,
      archived: !!v.archivedAt,
      createdAt: v.createdAt,
      updatedAt: v.updatedAt,
    };
  }

  /** A Prisma row (amount Decimal) as the plain shape the rules read. */
  private entryLike(e: any) {
    return { ...e, amount: e.amount == null ? null : Number(e.amount) };
  }

  /** "Renewal: Road tax (new expiry 31/12/2027)" style label, for the paper and the export. */
  private typeText(e: any): string {
    if (e.type === 'RENEWAL' && e.renewalKind) return `${RENEWAL_LABEL[e.renewalKind as RenewalKind] ?? 'Renewal'} renewal`;
    return LOG_TYPE_LABEL[e.type as LogType] ?? e.type;
  }

  private detailsText(e: any): string {
    const parts = [
      e.vendor ? `Vendor: ${e.vendor}` : '',
      e.description ?? '',
      e.type === 'RENEWAL' && e.renewalExpiry ? `New expiry ${ymd(e.renewalExpiry)!.split('-').reverse().join('/')}` : '',
    ].filter(Boolean);
    return parts.join('. ');
  }

  private entryDto(e: any) {
    return {
      id: e.id,
      vehicleId: e.vehicleId,
      date: ymd(e.date),
      type: e.type,
      typeLabel: this.typeText(e),
      description: e.description ?? null,
      details: this.detailsText(e),
      mileage: e.mileage ?? null,
      amount: e.amount ?? null,
      // Only a stored file counts (an empty JSON value is "no attachment").
      attachment: e.attachment && typeof e.attachment === 'object' && (e.attachment as any).key ? e.attachment : null,
      driverUserId: e.driverUserId ?? null,
      driverName: e.driverName ?? null,
      vendor: e.vendor ?? null,
      renewalKind: e.renewalKind ?? null,
      renewalExpiry: ymd(e.renewalExpiry ?? null),
      repairApprovedBy: e.repairApprovedBy ?? null,
      repairApprovedAt: ymd(e.repairApprovedAt ?? null),
      repairLocked: !!e.repairApprovedAt,
      repairUnlocks: Array.isArray(e.repairUnlocks) ? e.repairUnlocks : [],
      converted: !!e.sourceUsageId,
      createdByName: e.createdByName ?? null,
      createdAt: e.createdAt,
    };
  }

  /** The editable fields of a stored entry, in the shape a request body has. */
  private entryBody(e: any) {
    return {
      date: ymd(e.date),
      description: e.description,
      mileage: e.mileage,
      amount: e.amount == null ? null : Number(e.amount),
      attachment: e.attachment,
      driverUserId: e.driverUserId,
      driverName: e.driverName,
      vendor: e.vendor,
      renewalKind: e.renewalKind,
      renewalExpiry: ymd(e.renewalExpiry),
    };
  }

  /** Validate and normalise an entry's fields for its type. */
  private async entryFields(type: LogType, body: any, organizationId: string, creating: boolean) {
    const date = parseYmd(body?.date, 'Date')!;
    const mileage = parseMileage(body?.mileage, 'Mileage', false);
    const amount = parseAmount(body?.amount);
    const description = cleanText(body?.description, 2000);
    const attachment = this.cleanAttachment(body?.attachment, organizationId);
    let driver: { driverUserId: string | null; driverName: string | null } = { driverUserId: null, driverName: null };
    if (type === 'DRIVER') driver = await this.resolveDriver(body, organizationId);
    else if (cleanText(body?.driverName, 120) || body?.driverUserId) driver = await this.resolveDriver(body, organizationId);
    // No attachment: nothing written on create; cleared on an edit.
    const out: Record<string, any> = { date, mileage, amount, description, ...driver };
    if (attachment) out.attachment = attachment;
    else if (!creating) out.attachment = Prisma.DbNull;
    out.vendor = type === 'REPAIR' ? cleanText(body?.vendor, 160) : null;
    if (type === 'REPAIR' && !description && !out.vendor) throw new BadRequestException('Write what was repaired or serviced');
    if (type === 'RENEWAL') {
      out.renewalKind = parseRenewalKind(body?.renewalKind);
      out.renewalExpiry = parseYmd(body?.renewalExpiry, 'New expiry date', false);
    } else {
      out.renewalKind = null;
      out.renewalExpiry = null;
    }
    if ((type === 'FUEL' || type === 'PARKING') && amount == null && creating) throw new BadRequestException('Enter the amount');
    return out;
  }

  /** A renewal with a new expiry date sets that date on the vehicle. Returns what changed, for the toast. */
  private async applyRenewal(vehicleId: string, e: { type: string; renewalKind: string | null; renewalExpiry: Date | null }) {
    if (e.type !== 'RENEWAL' || !e.renewalKind || !e.renewalExpiry) return null;
    const field = RENEWAL_FIELD[e.renewalKind as RenewalKind];
    if (!field) return null;
    await this.prisma.vehicle.update({ where: { id: vehicleId }, data: { [field]: e.renewalExpiry } });
    return { field, label: RENEWAL_LABEL[e.renewalKind as RenewalKind], expiry: ymd(e.renewalExpiry) };
  }

  /** { key, fileName, mimeType } of an uploaded file in this org's vehicles folder, else null. */
  private cleanAttachment(v: any, organizationId: string): { key: string; fileName: string | null; mimeType: string | null } | null {
    if (!v || typeof v !== 'object' || !v.key) return null;
    const key = String(v.key).trim();
    if (!isOrgFolderKey(key, organizationId, 'vehicles')) throw new BadRequestException('That attachment is not a file of this organisation');
    return { key, fileName: cleanText(v.fileName, 200), mimeType: cleanText(v.mimeType, 100) };
  }

  private async liveEntries(vehicleId: string) {
    return (await this.prisma.vehicleLogEntry.findMany({ where: { vehicleId, deletedAt: null } })).map((e) => this.entryLike(e));
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

  private async entryOr404(id: string, organizationId: string) {
    const e = await this.prisma.vehicleLogEntry.findFirst({ where: { id, organizationId, deletedAt: null } });
    if (!e) throw new NotFoundException('Log entry not found');
    return e;
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
