import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from 'src/common/prisma.service';
import { CreateMaintenanceReportDto } from './dto/create-maintenance-report.dto';
import { SignMaintenanceReportDto } from './dto/sign-maintenance-report.dto';
import { CreateLocationPingsDto } from './dto/location-ping.dto';

@Injectable()
export class MaintenanceReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateMaintenanceReportDto, organizationId: string, technicianUserId: string) {
    const asset = await this.prisma.asset.findFirst({
      where: { id: dto.assetId, organizationId },
      select: { id: true },
    });
    if (!asset) throw new NotFoundException('Asset not found in this organization');

    const effectiveKind = dto.kind ?? 'SERVICE';
    const isRevampedServiceSubmission = effectiveKind === 'SERVICE' && !!dto.serviceData;

    const baseData: Prisma.MaintenanceServiceReportUncheckedCreateInput = {
      organizationId,
      assetId: dto.assetId,
      inventoryId: dto.inventoryId,
      technicianUserId,
      technicianName: dto.technicianName,
      description: dto.description,
      photos: dto.photos ?? [],
      // Defaults to SERVICE in the schema; explicit pass-through for DO_START
      // and DO_ACK from the field PWA action cards.
      ...(dto.kind ? { kind: dto.kind } : {}),
      // FK to the Document being delivered (DO_START / DO_ACK). Null for SERVICE.
      ...(dto.documentId ? { documentId: dto.documentId } : {}),
      // Geolocation captured at submission. Submission proceeds even if these
      // are absent (browser denial / no signal); just write null.
      ...(typeof dto.latitude === 'number' ? { latitude: dto.latitude } : {}),
      ...(typeof dto.longitude === 'number' ? { longitude: dto.longitude } : {}),
      ...(dto.locationLabel ? { locationLabel: dto.locationLabel } : {}),
      ...(dto.serviceData ? { serviceData: dto.serviceData as Prisma.InputJsonValue } : {}),
      // Inline sign-off path: when the client signature arrives in the create
      // payload (revamped 5-page form), finalize the row in one write.
      ...(dto.signature
        ? {
            signature: dto.signature,
            signedByName: dto.signedByName,
            signedAt: new Date(),
            status: 'completed' as const,
          }
        : {}),
    };

    // Non-revamped flows (DO_START, DO_ACK, legacy SERVICE) skip the
    // sequential numbering entirely.
    if (!isRevampedServiceSubmission) {
      return this.prisma.maintenanceServiceReport.create({ data: baseData });
    }

    // Sequential per-org report number. Race protection: unique index on
    // (organizationId, reportNumber); on P2002 we re-read the max and retry
    // once. Field-tech concurrent submissions are rare enough that two retries
    // would be a strong signal of a different bug.
    const computeNextNumber = async () => {
      const latest = await this.prisma.maintenanceServiceReport.findFirst({
        where: { organizationId, reportNumber: { not: null } },
        orderBy: { reportNumber: 'desc' },
        select: { reportNumber: true },
      });
      return (latest?.reportNumber ?? 0) + 1;
    };

    for (let attempt = 0; attempt < 2; attempt++) {
      const reportNumber = await computeNextNumber();
      try {
        return await this.prisma.maintenanceServiceReport.create({
          data: { ...baseData, reportNumber },
        });
      } catch (err) {
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === 'P2002' &&
          attempt === 0
        ) {
          continue; // someone else grabbed this number — recompute and retry
        }
        throw err;
      }
    }
    throw new Error('Failed to assign a unique report number after retries');
  }

  async sign(id: string, dto: SignMaintenanceReportDto, organizationId: string) {
    const report = await this.prisma.maintenanceServiceReport.findFirst({
      where: { id, organizationId },
    });
    if (!report) throw new NotFoundException('Service report not found');
    if (report.status === 'completed') {
      throw new BadRequestException('Report already signed');
    }

    return this.prisma.maintenanceServiceReport.update({
      where: { id },
      data: {
        signature: dto.signature,
        signedByName: dto.signedByName,
        signedAt: new Date(),
        status: 'completed',
      },
    });
  }

  async findById(id: string, organizationId: string) {
    const report = await this.prisma.maintenanceServiceReport.findFirst({
      where: { id, organizationId },
      include: { asset: true, inventory: true },
    });
    if (!report) throw new NotFoundException('Service report not found');
    return report;
  }

  /**
   * Paginated org-wide list of SERVICE reports for the portal "Service
   * Reports" page. DO_START / DO_ACK rows are excluded — they're tracked in
   * the delivery view and would otherwise clutter the list.
   *
   * Search composes:
   *   - numeric input  → exact reportNumber match
   *   - text input     → JSON-path filter on serviceData.customerName
   * Prisma's JSON-path filters don't support `mode: 'insensitive'`, so
   * customer-name search is case-sensitive. Swap to $queryRaw with
   * `serviceData->>'customerName' ILIKE ...` if insensitivity becomes
   * important.
   */
  async findAllService(
    organizationId: string,
    page = 1,
    limit = 20,
    search?: string,
  ) {
    const trimmed = search?.trim();
    const where: Prisma.MaintenanceServiceReportWhereInput = {
      organizationId,
      kind: 'SERVICE',
    };

    if (trimmed) {
      const orClauses: Prisma.MaintenanceServiceReportWhereInput[] = [];
      const asNum = Number(trimmed);
      if (!Number.isNaN(asNum) && Number.isInteger(asNum)) {
        orClauses.push({ reportNumber: asNum });
      }
      orClauses.push({
        serviceData: {
          path: ['customerName'],
          string_contains: trimmed,
        },
      });
      where.OR = orClauses;
    }

    const skip = (page - 1) * limit;
    const [docs, total] = await Promise.all([
      this.prisma.maintenanceServiceReport.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          asset: { select: { name: true, skuKey: true } },
          inventory: { select: { sku: true, serialNumber: true } },
        },
      }),
      this.prisma.maintenanceServiceReport.count({ where }),
    ]);

    return {
      docs,
      total,
      page,
      limit,
      hasNextPage: skip + docs.length < total,
      hasPreviousPage: page > 1,
    };
  }

  async listByAsset(assetId: string, organizationId: string) {
    return this.prisma.maintenanceServiceReport.findMany({
      where: { assetId, organizationId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  /**
   * Returns every MaintenanceServiceReport for any asset associated with this
   * project. Asset membership is resolved via the union of two paths:
   *   A. Assignment.assetId where Assignment.projectId = projectId
   *   B. DocumentItem.itemId (itemType=ASSET) where Document.projectId = projectId
   *
   * Path B is critical for orgs that imported their projects via the document
   * route (e.g. Biofuel, where 0/213 projects have Assignment rows but every
   * project has Documents whose items reference the assets). Path A covers
   * manually created projects + future imports that populate Assignments.
   */
  async listByProject(projectId: string, organizationId: string) {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, organizationId },
      select: { id: true },
    });
    if (!project) throw new NotFoundException('Project not found');

    const [assignmentAssets, docItemAssets] = await Promise.all([
      this.prisma.assignment.findMany({
        where: { projectId, assetId: { not: null } },
        select: { assetId: true },
      }),
      this.prisma.documentItem.findMany({
        where: {
          itemType: 'ASSET',
          document: { projectId, organizationId },
        },
        select: { itemId: true },
      }),
    ]);

    const assetIds = Array.from(
      new Set([
        ...assignmentAssets.map((a) => a.assetId!).filter(Boolean),
        ...docItemAssets.map((d) => d.itemId).filter(Boolean),
      ]),
    );

    if (assetIds.length === 0) return { reports: [] };

    const reports = await this.prisma.maintenanceServiceReport.findMany({
      where: { assetId: { in: assetIds }, organizationId },
      include: {
        asset: { select: { id: true, name: true, skuKey: true, image: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return { reports };
  }

  /**
   * Bundle everything the field-scan PWA needs for an asset in one call:
   * asset details, latest DO, gating booleans for the action chooser, and
   * recent reports.
   *
   * Two-step delivery flow gating:
   *   canStartDelivery  = a DO exists AND no DO_START MSR is linked to it yet.
   *   canAckDelivery    = a DO_START MSR exists for the DO AND no DO_ACK yet.
   *
   * Linkage is via MaintenanceServiceReport.documentId — added so that an
   * asset with multiple DOs over time can have unambiguous delivery state per
   * DO. Historic DO_ACK rows with null documentId are intentionally ignored
   * by this gating (they're audit trail only).
   */
  async getScanContext(assetId: string, organizationId: string, inventoryId?: string) {
    const asset = await this.prisma.asset.findFirst({
      where: { id: assetId, organizationId },
      include: { category: true },
    });
    if (!asset) throw new NotFoundException('Asset not found');

    // Optional inventory context — when the scan resolved to a specific
    // physical unit, include its details in the response so the chooser can
    // show "Unit MG20240037-001" above the action cards.
    const inventory = inventoryId
      ? await this.prisma.inventory.findFirst({
          where: { id: inventoryId, assetId, organizationId },
        })
      : null;

    // Pick the latest open DO. "Open" = no DO_ACK MSR linked. With the
    // inventory refactor, DocumentItem rows can reference either the parent
    // Asset (legacy / SKU-level DOs) or the specific Inventory unit, so we
    // OR across both itemType values when an inventoryId is in scope.
    const itemFilter: Prisma.DocumentItemWhereInput = inventoryId
      ? {
          OR: [
            { itemId: assetId, itemType: 'ASSET' },
            { itemId: inventoryId, itemType: 'INVENTORY' },
          ],
        }
      : { itemId: assetId, itemType: 'ASSET' };

    const latestDoItem = await this.prisma.documentItem.findFirst({
      where: {
        ...itemFilter,
        document: {
          organizationId,
          type: 'DELIVERY_ORDER',
          maintenanceReports: { none: { kind: 'DO_ACK', organizationId } },
        },
      },
      orderBy: { document: { createdAt: 'desc' } },
      include: { document: true },
    });
    const latestDeliveryOrder = latestDoItem?.document ?? null;

    let canStartDelivery = false;
    let canAckDelivery = false;
    let activeDeliveryStart: {
      id: string;
      createdAt: Date;
      technicianName: string | null;
    } | null = null;

    if (latestDeliveryOrder) {
      const startMsr = await this.prisma.maintenanceServiceReport.findFirst({
        where: {
          documentId: latestDeliveryOrder.id,
          kind: 'DO_START',
          organizationId,
        },
        select: { id: true, createdAt: true, technicianName: true },
        orderBy: { createdAt: 'desc' },
      });

      if (!startMsr) {
        // DO exists, never started. Start enabled, Ack disabled.
        canStartDelivery = true;
      } else {
        // DO started — Ack enabled iff no matching DO_ACK yet.
        const ackMsr = await this.prisma.maintenanceServiceReport.findFirst({
          where: {
            documentId: latestDeliveryOrder.id,
            kind: 'DO_ACK',
            organizationId,
          },
          select: { id: true },
        });
        activeDeliveryStart = ackMsr ? null : startMsr;
        canAckDelivery = !ackMsr;
      }
    }

    const recentReports = await this.prisma.maintenanceServiceReport.findMany({
      where: { assetId, organizationId },
      orderBy: { createdAt: 'desc' },
      take: 5,
    });

    return {
      asset,
      inventory,
      latestDeliveryOrder,
      canStartDelivery,
      canAckDelivery,
      activeDeliveryStart,
      recentServiceReports: recentReports,
    };
  }

  /**
   * Record a batch of GPS pings against a DO_START report. Accepts arrays so
   * the field app can queue + flush during poor connectivity. Idempotent via
   * the (reportId, timestamp) unique constraint — retried batches don't
   * double-insert.
   *
   * Rejects pings against:
   *   - non-existent reports / reports in a different org
   *   - reports whose kind isn't DO_START
   *   - reports whose delivery is already acknowledged (DO_ACK sibling exists)
   */
  async recordLocationPings(
    reportId: string,
    organizationId: string,
    dto: CreateLocationPingsDto,
  ) {
    const report = await this.prisma.maintenanceServiceReport.findFirst({
      where: { id: reportId, organizationId },
      select: { id: true, kind: true, documentId: true },
    });
    if (!report) throw new NotFoundException('Report not found');
    if (report.kind !== 'DO_START') {
      throw new BadRequestException(
        'Location pings only apply to DO_START reports',
      );
    }

    if (report.documentId) {
      const ack = await this.prisma.maintenanceServiceReport.findFirst({
        where: {
          documentId: report.documentId,
          kind: 'DO_ACK',
          organizationId,
        },
        select: { id: true },
      });
      if (ack) {
        throw new BadRequestException(
          'Delivery already acknowledged — pings rejected',
        );
      }
    }

    const data = dto.pings.map((p) => ({
      reportId,
      latitude: p.latitude,
      longitude: p.longitude,
      accuracy: p.accuracy ?? null,
      speed: p.speed ?? null,
      heading: p.heading ?? null,
      timestamp: new Date(p.timestamp),
    }));

    const result = await this.prisma.deliveryLocationPing.createMany({
      data,
      skipDuplicates: true, // (reportId, timestamp) collisions become no-ops
    });

    return {
      accepted: result.count,
      skipped: data.length - result.count,
    };
  }

  /**
   * Return the route for a DO_START report — every ping ordered chronologically,
   * plus convenience start/end markers and an isActive flag for the office
   * map view.
   *
   * Supports incremental polling via the `since` cursor: callers pass the
   * timestamp of their last-known ping; backend returns only newer pings.
   */
  async getLocationTrack(
    reportId: string,
    organizationId: string,
    since?: string,
  ) {
    const report = await this.prisma.maintenanceServiceReport.findFirst({
      where: { id: reportId, organizationId },
      select: { id: true, kind: true, documentId: true },
    });
    if (!report) throw new NotFoundException('Report not found');

    let isActive = true;
    if (report.documentId) {
      const ack = await this.prisma.maintenanceServiceReport.findFirst({
        where: {
          documentId: report.documentId,
          kind: 'DO_ACK',
          organizationId,
        },
        select: { id: true },
      });
      isActive = !ack;
    }

    const whereClause: any = { reportId };
    if (since) whereClause.timestamp = { gt: new Date(since) };

    const pings = await this.prisma.deliveryLocationPing.findMany({
      where: whereClause,
      orderBy: { timestamp: 'asc' },
      select: {
        id: true,
        latitude: true,
        longitude: true,
        accuracy: true,
        speed: true,
        heading: true,
        timestamp: true,
      },
    });

    // Start/end markers come from the global first/last regardless of cursor.
    const [startPing, lastPing] = await Promise.all([
      this.prisma.deliveryLocationPing.findFirst({
        where: { reportId },
        orderBy: { timestamp: 'asc' },
        select: { latitude: true, longitude: true, timestamp: true },
      }),
      this.prisma.deliveryLocationPing.findFirst({
        where: { reportId },
        orderBy: { timestamp: 'desc' },
        select: { latitude: true, longitude: true, timestamp: true },
      }),
    ]);

    return {
      reportId,
      isActive,
      startPing,
      lastPing,
      pings,
    };
  }
}
