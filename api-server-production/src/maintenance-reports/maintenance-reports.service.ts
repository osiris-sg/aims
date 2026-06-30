import { Injectable, Logger, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { Prisma, MaintenanceReportKind, DeliveryStatus } from '@prisma/client';
import { PrismaService } from 'src/common/prisma.service';
import { PdfGeneratorService } from 'src/common/services/pdf-generator.service';
import { WaterSgService } from 'src/common/services/water-sg.service';
import { EmailService } from '../email/email.service';
import { DocumentsService } from '../documents/documents.service';
import { DocumentTemplatesService } from '../documentTemplates/documentTemplates.service';
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
    private readonly documentTemplatesService: DocumentTemplatesService,
    private readonly waterSg: WaterSgService,
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
      const created = await this.prisma.maintenanceServiceReport.create({ data: baseData });
      // Per-item DO delivery transition (Phase 3): DO_START → delivering; an
      // inline-signed DO_ACK/DO_INSTALL (signature in the create payload) →
      // ack/install. An UNSIGNED DO_ACK/DO_INSTALL transitions later in sign().
      await this.applyDeliveryItemTransition(created, organizationId);
      return created;
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

    const updated = await this.prisma.maintenanceServiceReport.update({
      where: { id },
      data: {
        signature: dto.signature,
        signedByName: dto.signedByName,
        signedAt: new Date(),
        status: 'completed',
      },
    });

    // When an installation acknowledgment is signed, advance the parent DO to
    // delivered_installed. First automated writer of this status; DOs have no
    // transition guard, so the write is accepted.
    if (updated.kind === 'DO_INSTALL' && updated.documentId) {
      await this.prisma.document.update({
        where: { id: updated.documentId },
        data: { status: 'delivered_installed' },
      });
    }

    // When a delivery acknowledgment is signed, advance the parent DO to
    // delivered_not_installed — UNLESS it's already delivered_installed (don't
    // let a late DO_ACK downgrade an installed DO). First automated writer of
    // delivered_not_installed; DOs have no transition guard. This does NOT
    // affect install gating: canAckInstall keys off a completed DO_ACK
    // existing, not off Document.status.
    if (updated.kind === 'DO_ACK' && updated.documentId) {
      const doc = await this.prisma.document.findUnique({
        where: { id: updated.documentId },
        select: { status: true },
      });
      if (doc && doc.status !== 'delivered_installed') {
        await this.prisma.document.update({
          where: { id: updated.documentId },
          data: { status: 'delivered_not_installed' },
        });
      }
    }

    // Per-item DO delivery transition (Phase 3): a signed DO_ACK deducts stock
    // + moves the item to not_installed; a signed DO_INSTALL completes it (and
    // may trip the completion gate → invoice). Awaited but non-fatal.
    await this.applyDeliveryItemTransition(updated, organizationId);

    // Fire-and-forget: a signed DO_ACK may create a matching site in water-sg.
    // Never blocks or fails the signature — forwardAckToWaterSg swallows every
    // error internally; the extra .catch is belt-and-suspenders against escape.
    void this.forwardAckToWaterSg(updated, organizationId).catch((err) =>
      this.logger.error(
        `water-sg forward threw for report ${updated.id}: ${err?.message}`,
        err?.stack,
      ),
    );

    return updated;
  }

  /**
   * Bridge a DO field report to the per-item delivery state machine in
   * documents.service. DO_START → 'start' (delivering, fired at creation); a
   * COMPLETED DO_ACK → 'ack' (deduct stock + not_installed); a COMPLETED
   * DO_INSTALL → 'install' (completed + completion gate). Requires both
   * documentId + inventoryId (the scanned unit). Errors are logged, never
   * thrown — the report write must not roll back on a downstream transition
   * failure.
   */
  private async applyDeliveryItemTransition(
    report: {
      id: string;
      kind: MaintenanceReportKind;
      status: string;
      documentId: string | null;
      inventoryId: string | null;
    },
    organizationId: string,
  ): Promise<void> {
    if (!report.documentId || !report.inventoryId) return;
    try {
      if (report.kind === 'DO_START') {
        await this.documentsService.advanceDeliveryItem(
          report.documentId,
          report.inventoryId,
          'start',
          organizationId,
        );
      } else if (report.kind === 'DO_ACK' && report.status === 'completed') {
        await this.documentsService.advanceDeliveryItem(
          report.documentId,
          report.inventoryId,
          'ack',
          organizationId,
        );
      } else if (report.kind === 'DO_INSTALL' && report.status === 'completed') {
        await this.documentsService.advanceDeliveryItem(
          report.documentId,
          report.inventoryId,
          'install',
          organizationId,
        );
      }
    } catch (err: any) {
      this.logger.error(
        `Per-item delivery transition failed for report ${report.id} (kind=${report.kind}): ${err?.message}`,
        err?.stack,
      );
    }
  }

  /**
   * Field SKIP-INSTALL action (Phase 3b): the tech marks the scanned unit's
   * installation as skipped — the item goes straight to completed
   * (installSkipped=true) and the completion gate may fire. Delegates to the
   * same per-item state machine as the scan transitions.
   */
  async skipDeliveryInstall(documentId: string, inventoryId: string, organizationId: string) {
    return this.documentsService.advanceDeliveryItem(
      documentId,
      inventoryId,
      'skip',
      organizationId,
    );
  }

  /**
   * Best-effort: when a DO acknowledgment is signed, mirror the delivered unit
   * as a site in water-sg and record the returned id on the report
   * (waterSgSiteId). Fire-and-forget — every failure is logged and swallowed so
   * the signature response is unaffected.
   *
   * Gated twice: the org's enableWaterSgSites feature flag, and the unit's
   * Asset.waterSgProductLine === 'SIDS'. Only DO_ACK rows carry an inventoryId
   * + documentId, so SERVICE / DO_START rows fall out at the inventory guard.
   */
  private async forwardAckToWaterSg(
    report: {
      id: string;
      inventoryId: string | null;
      documentId: string | null;
      latitude: number | null;
      longitude: number | null;
    },
    organizationId: string,
  ): Promise<void> {
    try {
      // Feature-flag gate (per-org). Absent flag => disabled.
      const uiConfig = await this.prisma.organizationUIConfig.findUnique({
        where: { organizationId },
        select: { features: true },
      });
      const features = (uiConfig?.features as any) || {};
      if (!features.enableWaterSgSites) return;

      // No specific unit => nothing to map to a site.
      if (!report.inventoryId) return;

      // Resolve the unit + its asset's product line in one query.
      const inv = await this.prisma.inventory.findUnique({
        where: { id: report.inventoryId },
        select: {
          sku: true,
          cameraP2P: true,
          asset: { select: { waterSgProductLine: true } },
        },
      });

      // Only SIDS units get a water-sg site. (!inv guard also narrows for TS.)
      if (!inv || inv.asset?.waterSgProductLine !== 'SIDS') return;

      // Site name = the DO's project name, falling back to the unit SKU.
      const doc = report.documentId
        ? await this.prisma.document.findUnique({
            where: { id: report.documentId },
            select: { project: { select: { name: true } } },
          })
        : null;
      const name = doc?.project?.name ?? inv.sku;

      // Send 0,0 when GPS is missing (the 2b decision) so the site still lands.
      const payload = {
        siteId: inv.sku,
        name,
        lat: report.latitude ?? 0,
        lng: report.longitude ?? 0,
        cameraP2P: inv.cameraP2P ?? null,
        managerId: null,
      };

      const result = await this.waterSg.createSite(payload);

      // Footprint: record the site id (fall back to the SKU we sent).
      const siteId = result.id ?? payload.siteId;
      await this.prisma.maintenanceServiceReport.update({
        where: { id: report.id },
        data: { waterSgSiteId: siteId },
      });

      this.logger.log(
        `water-sg site created for report ${report.id}: siteId=${payload.siteId} ` +
          `recordedId=${siteId} alreadyExists=${result.alreadyExists ?? false}`,
      );
    } catch (err: any) {
      // Swallow: the signature is already saved; water-sg is best-effort.
      this.logger.error(
        `water-sg site creation failed for report ${report.id} ` +
          `(inventoryId=${report.inventoryId ?? 'none'}): ${err?.message}`,
        err?.stack,
      );
    }
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
   * Delivery flow gating (per-DO strict). We resolve ONE delivery order — the
   * most recent DELIVERY_ORDER for this asset/unit — then read a single
   * `deliveryStage` from THAT DO's own reports + Document.status:
   *   start        → DO exists, never started (no DO_START)
   *   ack_delivery → DO_START exists, no completed DO_ACK yet
   *   ack_install  → completed DO_ACK exists, no DO_INSTALL yet
   *   completed    → DO_INSTALL exists OR status === 'delivered_installed'
   *   null         → no DO for this asset/unit
   * The legacy canStartDelivery / canAckDelivery / canAckInstall booleans are
   * derived from this single stage for backward-compat.
   *
   * Because the stage is read from the resolved DO's own reports (never a
   * second query that excludes acked DOs), a completed DO stays 'completed'
   * and cannot regress to 'start' — fixing the re-start bug.
   *
   * Linkage is via MaintenanceServiceReport.documentId. Historic DO_ACK rows
   * with null documentId are intentionally ignored (audit trail only).
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

    // Resolve ONE delivery order and derive a single stage from ITS OWN
    // reports — never a second query that excludes by report state. This is
    // the fix for the re-start bug: previously an acked DO was dropped from
    // the "open DO" lookup so a *different* DO could re-qualify for "start".
    // Here we lock onto the most recent DO for this asset/unit by recency,
    // then read its stage from its own DO_START/DO_ACK/DO_INSTALL reports.
    //
    // With the inventory refactor, DocumentItem rows can reference either the
    // parent Asset (legacy / SKU-level DOs) or the specific Inventory unit, so
    // we OR across both itemType values when an inventoryId is in scope.
    const itemFilter: Prisma.DocumentItemWhereInput = inventoryId
      ? {
          OR: [
            { itemId: assetId, itemType: 'ASSET' },
            { itemId: inventoryId, itemType: 'INVENTORY' },
          ],
        }
      : { itemId: assetId, itemType: 'ASSET' };

    // The single DO we lock onto: most recent DELIVERY_ORDER matching the
    // filter, WITHOUT any report-state exclusion (an acked / installed DO is
    // intentionally still selected so we read its real stage, not skip it).
    const resolvedDoItem = await this.prisma.documentItem.findFirst({
      where: {
        ...itemFilter,
        document: { organizationId, type: 'DELIVERY_ORDER' },
      },
      orderBy: { document: { createdAt: 'desc' } },
      include: { document: true },
    });
    const resolvedDeliveryOrder = resolvedDoItem?.document ?? null;

    // Single stage derived from the resolved DO's own reports + Document.status.
    // Strict precedence: a completed DO stays 'completed' and can NEVER fall
    // back to 'start' — the stage is read from THIS DO's reports/status, not by
    // re-picking some other DO that happens to lack a DO_ACK.
    let deliveryStage:
      | 'start'
      | 'ack_delivery'
      | 'ack_install'
      | 'completed'
      | null = null;
    let activeDeliveryStart: {
      id: string;
      createdAt: Date;
      technicianName: string | null;
    } | null = null;

    if (resolvedDeliveryOrder) {
      // All reports for THIS DO. SERVICE rows carry a null documentId, so a
      // documentId match only ever returns DO_START / DO_ACK / DO_INSTALL rows.
      const msrs = await this.prisma.maintenanceServiceReport.findMany({
        where: { documentId: resolvedDeliveryOrder.id, organizationId },
        select: {
          id: true,
          kind: true,
          status: true,
          createdAt: true,
          technicianName: true,
        },
        orderBy: { createdAt: 'desc' },
      });

      const hasInstall = msrs.some((m) => m.kind === 'DO_INSTALL');
      const hasCompletedAck = msrs.some(
        (m) => m.kind === 'DO_ACK' && m.status === 'completed',
      );
      const startMsr = msrs.find((m) => m.kind === 'DO_START') ?? null;

      if (hasInstall || resolvedDeliveryOrder.status === 'delivered_installed') {
        // Terminal: installation recorded (or the DO already flipped to
        // delivered_installed). Fully complete — nothing actionable, and this
        // can never regress to 'start'.
        deliveryStage = 'completed';
      } else if (hasCompletedAck) {
        // Delivery signed off; installation not yet recorded.
        deliveryStage = 'ack_install';
      } else if (startMsr) {
        // Delivery started, not yet acknowledged. An unsigned/draft DO_ACK
        // keeps us here (hasCompletedAck is false) so the ack can be completed.
        deliveryStage = 'ack_delivery';
        activeDeliveryStart = {
          id: startMsr.id,
          createdAt: startMsr.createdAt,
          technicianName: startMsr.technicianName,
        };
      } else {
        // DO exists, never started.
        deliveryStage = 'start';
      }
    }

    // Backward-compat fields derived from the single stage so existing callers
    // (the chooser's Start / Ack / Install cards) keep working while the
    // frontend migrates to deliveryStage. All point at the ONE resolved DO and
    // preserve the prior null-unless-actionable semantics.
    const canStartDelivery = deliveryStage === 'start';
    const canAckDelivery = deliveryStage === 'ack_delivery';
    const canAckInstall = deliveryStage === 'ack_install';
    const latestDeliveryOrder =
      canStartDelivery || canAckDelivery ? resolvedDeliveryOrder : null;
    const installableDeliveryOrder = canAckInstall ? resolvedDeliveryOrder : null;

    // Per-item delivery state (Phase 3d). The resolved DO's DocumentItems for
    // the scanned unit (same itemFilter as the DO lock), each with its current
    // deliveryStatus + the actions available from that status. The scan picks
    // WHICH item by the scanned tag → inventoryId/itemId. Additive — the legacy
    // DO-level booleans above are preserved for the not-yet-migrated chooser.
    let deliveryItems: Array<{
      id: string;
      lineNumber: number | null;
      sku: string | null;
      description: string | null;
      deliveryStatus: DeliveryStatus;
      canStart: boolean;
      canAck: boolean;
      canInstall: boolean;
      canSkip: boolean;
    }> = [];
    if (resolvedDeliveryOrder) {
      const doItems = await this.prisma.documentItem.findMany({
        where: { documentId: resolvedDeliveryOrder.id, ...itemFilter },
        orderBy: { lineNumber: 'asc' },
      });
      deliveryItems = doItems.map((it) => ({
        id: it.id,
        lineNumber: it.lineNumber,
        sku: it.sku,
        description: it.description,
        deliveryStatus: it.deliveryStatus,
        canStart: it.deliveryStatus === DeliveryStatus.not_delivered,
        canAck: it.deliveryStatus === DeliveryStatus.delivering,
        canInstall: it.deliveryStatus === DeliveryStatus.not_installed,
        canSkip: it.deliveryStatus === DeliveryStatus.not_installed,
      }));
    }

    const recentReports = await this.prisma.maintenanceServiceReport.findMany({
      where: { assetId, organizationId },
      orderBy: { createdAt: 'desc' },
      take: 5,
    });

    return {
      asset,
      inventory,
      resolvedDeliveryOrder,
      deliveryStage,
      // Per-item delivery rows for the scanned unit (Phase 3d).
      deliveryItems,
      latestDeliveryOrder,
      canStartDelivery,
      canAckDelivery,
      activeDeliveryStart,
      installableDeliveryOrder,
      canAckInstall,
      recentServiceReports: recentReports,
    };
  }

  /**
   * Field-accessible read-only view of a delivery order. One round-trip for the
   * field app's "View DO" screen, aggregating everything CleanDocumentPreview
   * needs so field techs don't have to hit the office document/template
   * endpoints (which require permissions the field-tech role lacks).
   *
   * Security: org-scoped via documentsService.getById's `where: { id,
   * organizationId }` — a DO from another org returns null → 404 (we don't
   * confirm existence across orgs). Also restricted to DELIVERY_ORDER so this
   * field route can't be repurposed to read invoices/quotations by id.
   */
  async getDoView(doId: string, organizationId: string) {
    const document = await this.documentsService.getById(doId, organizationId);
    if (!document) throw new NotFoundException('Delivery order not found');
    if (document.type !== 'DELIVERY_ORDER') {
      throw new ForbiddenException('Not a delivery order');
    }

    let templateVariant = 'DO';
    let fieldConfig: any = null;
    if (document.documentTemplateId) {
      const defs = await this.documentTemplatesService.getTemplateFieldDefinitions(document.documentTemplateId, organizationId);
      fieldConfig = defs?.formFields ?? null;
      templateVariant = defs?.templateVariant ?? templateVariant;
    }

    return {
      document: {
        id: document.id,
        name: document.name,
        status: document.status,
        config: document.config,
        documentTemplateId: document.documentTemplateId,
      },
      documentNumber: document.name,
      status: document.status,
      maintenanceReports: document.maintenanceReports,
      templateVariant,
      fieldConfig,
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
