import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from 'src/common/prisma.service';
import { PdfGeneratorService } from 'src/common/services/pdf-generator.service';
import { EmailService } from '../email/email.service';
import { DocumentsService } from '../documents/documents.service';
import { CreateMaintenanceReportDto } from './dto/create-maintenance-report.dto';
import { SignMaintenanceReportDto } from './dto/sign-maintenance-report.dto';
import { CreateLocationPingsDto } from './dto/location-ping.dto';
import { buildServiceReportHtml } from './service-report-pdf';

@Injectable()
export class MaintenanceReportsService {
  private readonly logger = new Logger(MaintenanceReportsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly pdfGenerator: PdfGeneratorService,
    private readonly email: EmailService,
    private readonly documentsService: DocumentsService,
  ) {}

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
      paymentRequired: dto.paymentRequired ?? false,
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

    let created: Awaited<ReturnType<typeof this.prisma.maintenanceServiceReport.create>> | null = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      const reportNumber = await computeNextNumber();
      try {
        created = await this.prisma.maintenanceServiceReport.create({
          data: { ...baseData, reportNumber },
        });
        break;
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
    if (!created) {
      throw new Error('Failed to assign a unique report number after retries');
    }

    // Fire-and-forget: when the tech says payment isn't required, email the
    // report PDF to the customer (CC admin). Failures are logged, never
    // propagated — the HTTP response shouldn't fail because Resend is down
    // or puppeteer hiccupped.
    if (!created.paymentRequired) {
      void this.sendReportEmailInBackground(created.id).catch((err) =>
        this.logger.error(`Background MSR email failed for ${created!.id}: ${err?.message}`, err?.stack),
      );
    }

    return created;
  }

  /**
   * Generate the report PDF (puppeteer) and email it to the customer with
   * admin@osiris.sg (or ADMIN_EMAIL) in CC. All steps are independently
   * try/catch'd so a render failure doesn't sink the email and an email
   * failure doesn't sink the request.
   */
  private async sendReportEmailInBackground(reportId: string): Promise<void> {
    const report = await this.prisma.maintenanceServiceReport.findUnique({
      where: { id: reportId },
      include: {
        asset: { select: { name: true, skuKey: true } },
        inventory: { select: { sku: true, serialNumber: true } },
        organization: { select: { name: true } },
      },
    });
    if (!report) {
      this.logger.warn(`MSR email skipped — report ${reportId} not found`);
      return;
    }

    const sd = (report.serviceData as any) ?? {};
    const clientEmail: string | undefined = sd.clientEmail;
    if (!clientEmail || !clientEmail.includes('@')) {
      this.logger.warn(`MSR ${reportId}: no client email on serviceData; skipping email`);
      return;
    }

    let pdfBuffer: Buffer | undefined;
    try {
      const html = buildServiceReportHtml({
        reportNumber: report.reportNumber,
        technicianName: report.technicianName,
        serviceData: sd,
        asset: report.asset,
        inventory: report.inventory,
        orgName: report.organization.name,
      });
      pdfBuffer = await this.pdfGenerator.generatePdfFromHtml(html);
    } catch (err: any) {
      this.logger.error(`MSR ${reportId} PDF generation failed: ${err?.message}`, err?.stack);
      // Continue without attachment — the customer still gets a notification.
    }

    const customerName: string = sd.customerName ?? 'Customer';
    const result = await this.email.sendServiceReportEmail({
      to: [clientEmail],
      cc: [this.email.getAdminEmail()],
      customerName,
      organizationName: report.organization.name,
      reportNumber: report.reportNumber ?? report.id,
      serviceDate: sd.serviceDate ?? '',
      pdfBuffer,
    });

    if (!result.success) {
      this.logger.error(`MSR ${reportId} email failed: ${result.error}`);
    }
  }

  /**
   * Create an Invoice document from a SERVICE report and link them. Called by
   * the office when paymentRequired === true. Idempotent: if an invoice is
   * already linked, returns its ids without creating a duplicate.
   */
  async createInvoiceFromMsr(msrId: string, organizationId: string) {
    const report = await this.prisma.maintenanceServiceReport.findFirst({
      where: { id: msrId, organizationId, kind: 'SERVICE' },
      include: {
        asset: { select: { id: true, name: true, skuKey: true } },
        inventory: { select: { id: true, sku: true, serialNumber: true } },
        invoiceDocument: { select: { id: true, documentTemplateId: true } },
      },
    });
    if (!report) throw new NotFoundException('Service report not found');

    if (report.invoiceDocument) {
      return {
        documentId: report.invoiceDocument.id,
        templateId: report.invoiceDocument.documentTemplateId,
        alreadyExisted: true,
      };
    }

    // Resolve the org's invoice template using the same priority order as
    // documents.service.createFromExtraction: active > default > newest.
    const template = await this.prisma.documentTemplate.findFirst({
      where: { type: 'INVOICE', organizationId },
      select: { id: true },
      orderBy: [
        { isActive: 'desc' },
        { isDefault: 'desc' },
        { createdAt: 'desc' },
      ],
    });
    if (!template) {
      throw new BadRequestException('No INVOICE template configured for this organization');
    }

    const sd = (report.serviceData as any) ?? {};
    const itemId = report.inventory?.id ?? report.asset?.id;
    const sku = report.inventory?.sku ?? report.asset?.skuKey ?? '';
    const description = report.asset?.name ?? 'Service item';

    // Single asset line, price 0 — office fills in pricing. inventoryItemId
    // is the legacy field name in the items[] config (overloaded for both
    // INVENTORY and ASSET item types — see documents.service.syncDocumentItems).
    const items = itemId
      ? [
          {
            inventoryItemId: itemId,
            sku,
            description,
            quantity: 1,
            unitPrice: 0,
            amount: 0,
            discount: 0,
            tax: '9',
            taxAmount: 0,
            uom: 'PCS',
            serialNumbers: report.inventory?.serialNumber ? [report.inventory.serialNumber] : [],
          },
        ]
      : [];

    const config = {
      date: new Date().toISOString(),
      items,
      customer: sd.customerId
        ? { id: sd.customerId, name: sd.customerName ?? '' }
        : sd.customerName
          ? { name: sd.customerName }
          : undefined,
      customerId: sd.customerId,
      documentInfo: {
        currency: 'SGD',
        gstPercent: 9,
        // Surface the originating report in the editor so the office sees
        // the source at a glance; not used by any logic.
        msrReportNumber: report.reportNumber,
      },
    };

    const newDoc = await this.documentsService.createBasicDocument(
      template.id,
      'INVOICE',
      organizationId,
      config,
    );

    await this.prisma.maintenanceServiceReport.update({
      where: { id: report.id },
      data: { invoiceDocumentId: newDoc.id },
    });

    return {
      documentId: newDoc.id,
      templateId: newDoc.documentTemplateId,
      alreadyExisted: false,
    };
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
      include: {
        asset: true,
        inventory: true,
        // Surface the invoice's template id so the dashboard's View Invoice
        // button can construct /portal/documents/INVOICE/{templateId}/{docId}
        // without a second round-trip.
        invoiceDocument: { select: { id: true, documentTemplateId: true, name: true, status: true } },
      },
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
