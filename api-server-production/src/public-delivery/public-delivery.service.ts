import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { randomBytes, randomUUID } from 'crypto';
import { DeliveryStatus, ItemType, MaintenanceReportKind } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';
import { DocumentsService } from '../documents/documents.service';
import { UploadsService } from '../uploads/uploads.service';
import { MaintenanceReportsService } from '../maintenance-reports/maintenance-reports.service';
import { CreateMaintenanceReportDto } from '../maintenance-reports/dto/create-maintenance-report.dto';
import { SignMaintenanceReportDto } from '../maintenance-reports/dto/sign-maintenance-report.dto';

// Guests may ONLY create delivery-flow reports — never a SERVICE report.
const GUEST_ALLOWED_KINDS: MaintenanceReportKind[] = [
  MaintenanceReportKind.DO_START,
  MaintenanceReportKind.DO_ACK,
  MaintenanceReportKind.DO_INSTALL,
];
// technicianUserId is NOT NULL and means "Clerk user id" for the field flow.
// Guests have no Clerk identity, so we store a fixed, non-secret marker (never
// the share token — that's a credential). The human signer is signedByName.
const GUEST_TECHNICIAN = 'GUEST';

/**
 * Guest (no-login) delivery surface.
 *
 * SECURITY MODEL — every public method resolves the org + the single DO SOLELY
 * from the share-link token. There is no user/session context here; nothing
 * reads req.userOrganization. A token grants access to EXACTLY ONE delivery
 * order's delivery surface and nothing else:
 *   - the link must exist, be non-revoked and non-expired;
 *   - the linked document MUST be a DELIVERY_ORDER (never expose other types);
 *   - item advances are delegated to advanceDeliveryItem scoped to the token's
 *     documentId + org, so an item that isn't on THIS DO can't be touched.
 */
@Injectable()
export class PublicDeliveryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly documentsService: DocumentsService,
    private readonly uploadsService: UploadsService,
    private readonly maintenanceReportsService: MaintenanceReportsService,
  ) {}

  /** Unguessable, crypto-random URL token. */
  private generateToken(): string {
    return randomBytes(32).toString('base64url');
  }

  /**
   * AUTHENTICATED (office) — create or reuse a guest link for a DO.
   * Caller passes the org from their authenticated session; we re-validate the
   * document belongs to that org and is a delivery order.
   */
  async generateForDocument(documentId: string, organizationId: string) {
    const doc = await this.prisma.document.findFirst({
      where: { id: documentId, organizationId },
      select: { id: true, type: true },
    });
    if (!doc) throw new NotFoundException('Delivery order not found');
    if (doc.type !== 'DELIVERY_ORDER') {
      throw new BadRequestException(
        'Only delivery orders can be shared via a guest link',
      );
    }

    // Reuse the most recent active (non-revoked) link if present; else create.
    const existing = await this.prisma.deliveryShareLink.findFirst({
      where: { documentId, revokedAt: null },
      orderBy: { createdAt: 'desc' },
      select: { token: true },
    });
    const token =
      existing?.token ??
      (
        await this.prisma.deliveryShareLink.create({
          data: { documentId, token: this.generateToken() },
          select: { token: true },
        })
      ).token;

    const base = (process.env.PORTAL_URL || process.env.FRONTEND_URL || '').replace(/\/$/, '');
    const path = `/guest/delivery/${token}`;
    return { token, path, url: base ? `${base}${path}` : path };
  }

  /**
   * Resolve a token to its link + the linked DELIVERY_ORDER. The ONLY entry
   * point for every public method. Throws 404 for missing/revoked/expired
   * links and for any non-DELIVERY_ORDER document (defence in depth).
   */
  private async resolveToken(token: string) {
    const link = await this.prisma.deliveryShareLink.findUnique({
      where: { token },
      select: {
        id: true,
        revokedAt: true,
        expiresAt: true,
        document: {
          select: {
            id: true,
            name: true,
            status: true,
            type: true,
            organizationId: true,
            config: true,
          },
        },
      },
    });
    if (!link || link.revokedAt || (link.expiresAt && link.expiresAt.getTime() < new Date().getTime())) {
      throw new NotFoundException('Delivery link not found');
    }
    if (link.document.type !== 'DELIVERY_ORDER') {
      // A token must never expose anything but a delivery order.
      throw new NotFoundException('Delivery link not found');
    }
    return link;
  }

  private withActions(deliveryStatus: DeliveryStatus) {
    return {
      canStart: deliveryStatus === DeliveryStatus.not_delivered,
      canAck: deliveryStatus === DeliveryStatus.delivering,
      canInstall: deliveryStatus === DeliveryStatus.not_installed,
      canSkip: deliveryStatus === DeliveryStatus.not_installed,
    };
  }

  /**
   * PUBLIC — minimal guest view of the ONE DO behind the token. Deliberately
   * narrow: doc number/status, customer name, and the per-item delivery rows.
   * No full config dump, no other documents, no org-wide data.
   */
  async getGuestView(token: string) {
    const link = await this.resolveToken(token);
    const doc = link.document;
    const config: any = doc.config || {};

    const items = await this.prisma.documentItem.findMany({
      where: { documentId: doc.id },
      orderBy: { lineNumber: 'asc' },
      select: {
        id: true,
        itemId: true,
        itemType: true,
        inventoryId: true,
        sku: true,
        description: true,
        quantity: true,
        deliveryStatus: true,
        // Physical unit SKU from the linked Inventory (DocumentItem.sku is often
        // null) — the guest list shows it as the per-row sub-label, matching the
        // field getScanContext projection.
        inventory: { select: { sku: true } },
      },
    });

    return {
      documentNumber: doc.name,
      status: doc.status,
      customerName: config?.customer?.name || config?.customerName || '',
      deliveryItems: items.map((it) => ({
        id: it.id,
        itemId: it.itemId,
        itemType: it.itemType,
        // Unit id the guest passes to /report + /advance (typed FK, else itemId).
        inventoryId: it.inventoryId,
        sku: it.sku,
        unitSku: it.inventory?.sku ?? null,
        description: it.description,
        quantity: it.quantity,
        deliveryStatus: it.deliveryStatus,
        ...this.withActions(it.deliveryStatus),
      })),
    };
  }

  /**
   * PUBLIC — advance ONE item on the token's DO. The org + documentId come from
   * the token; advanceDeliveryItem only matches DocumentItems of THAT document,
   * so an item not on this DO yields a 404 from the delegate.
   */
  async advance(
    token: string,
    identifier: string,
    action: 'start' | 'ack' | 'install' | 'skip',
  ) {
    if (!identifier) throw new BadRequestException('itemId is required');
    if (!['start', 'ack', 'install', 'skip'].includes(action)) {
      throw new BadRequestException('Invalid action');
    }
    const link = await this.resolveToken(token);
    await this.documentsService.advanceDeliveryItem(
      link.document.id,
      identifier,
      action,
      link.document.organizationId,
    );
    return this.getGuestView(token);
  }

  /**
   * PUBLIC — proof-of-delivery photo upload, scoped to the token's DO. The S3
   * key is namespaced by the token's org + document, so a guest can only write
   * under this one DO's POD path.
   */
  async uploadPhoto(token: string, file: Express.Multer.File) {
    if (!file) throw new BadRequestException('No file uploaded');
    const link = await this.resolveToken(token);
    const key = `delivery-pod/${link.document.organizationId}/${link.document.id}/${randomUUID()}.jpg`;
    const Key = await this.uploadsService.uploadFileInChunks({ file, key });
    return { Key };
  }

  /**
   * PUBLIC — create a delivery MaintenanceServiceReport for the token's DO,
   * reusing the SAME MaintenanceReportsService.create() as the authenticated
   * field flow (so the MSR→advanceDeliveryItem bridge fires: DO_START → start,
   * an inline-signed DO_ACK/DO_INSTALL → ack/install with stock deduct + status
   * flip). Mirrors the field split: DO_START is created here; DO_ACK/DO_INSTALL
   * are created here then completed via signReport().
   *
   * SECURITY — org + documentId + assetId are derived from the TOKEN and a
   * server-side lookup, NEVER from the client body. The scanned unit must be a
   * line item on THIS token's DO (404 otherwise), so a guest cannot create an
   * MSR against another DO, asset, or org. `kind` is whitelisted to the three
   * delivery kinds (no guest SERVICE reports). technicianUserId is a fixed
   * non-secret marker.
   */
  async createReport(
    token: string,
    body: {
      kind?: string;
      inventoryId?: string;
      description?: string;
      photos?: string[];
      signature?: string;
      signedByName?: string;
      latitude?: number;
      longitude?: number;
    },
  ) {
    const link = await this.resolveToken(token);
    const organizationId = link.document.organizationId;
    const documentId = link.document.id;

    const kind = body?.kind as MaintenanceReportKind | undefined;
    if (!kind || !GUEST_ALLOWED_KINDS.includes(kind)) {
      throw new BadRequestException('Invalid report kind for guest delivery');
    }
    if (!body?.inventoryId) {
      throw new BadRequestException('inventoryId is required');
    }

    // Resolve the scanned unit FIRST — create() requires its assetId, and the
    // parent asset is part of the DO item-match below. Scoped to the token's org
    // so a cross-org unit id can't be smuggled in via the body.
    const unit = await this.prisma.inventory.findFirst({
      where: { id: body.inventoryId, organizationId },
      select: { id: true, assetId: true },
    });
    if (!unit) {
      throw new NotFoundException('Inventory unit not found');
    }

    // The scanned unit MUST be a line item on THIS token's DO. Uses the SAME
    // predicate as advanceDeliveryItem so createReport and advance accept an
    // identical item set: typed inventory FK, OR legacy itemId, OR the parent
    // asset row (asset-level / SKU DOs).
    const itemMatch: any[] = [{ inventoryId: body.inventoryId }, { itemId: body.inventoryId }];
    if (unit.assetId) itemMatch.push({ itemId: unit.assetId, itemType: ItemType.ASSET });
    const item = await this.prisma.documentItem.findFirst({
      where: { documentId, OR: itemMatch },
      select: { id: true },
    });
    if (!item) {
      throw new NotFoundException('Item is not on this delivery order');
    }

    // Build the MSR payload SERVER-SIDE: documentId + assetId come from the
    // token/lookup, not the client. Only proof fields are taken from the body.
    const photos = Array.isArray(body.photos)
      ? body.photos.filter((p) => typeof p === 'string')
      : [];
    const dto: CreateMaintenanceReportDto = {
      assetId: unit.assetId,
      inventoryId: unit.id,
      documentId,
      kind,
      description: (body.description || '').trim() || `${kind} (guest delivery)`,
      photos,
      ...(body.signedByName ? { signedByName: body.signedByName } : {}),
      ...(body.signature ? { signature: body.signature } : {}),
      ...(typeof body.latitude === 'number' ? { latitude: body.latitude } : {}),
      ...(typeof body.longitude === 'number' ? { longitude: body.longitude } : {}),
    };

    const report = await this.maintenanceReportsService.create(
      dto,
      organizationId,
      GUEST_TECHNICIAN,
    );
    return { id: report.id, kind: report.kind, status: report.status };
  }

  /**
   * PUBLIC — sign (complete) a delivery MSR on the token's DO, reusing the SAME
   * MaintenanceReportsService.sign() as the field flow. A completed DO_ACK/
   * DO_INSTALL bridges into advanceDeliveryItem (ack → deduct + rental/sold
   * flip; install → completion gate).
   *
   * SECURITY — the report must belong to THIS token's DO + org (404 otherwise),
   * so a guest cannot sign an MSR on any other delivery order.
   */
  async signReport(
    token: string,
    reportId: string,
    body: { signature?: string; signedByName?: string },
  ) {
    const link = await this.resolveToken(token);
    const organizationId = link.document.organizationId;
    if (!body?.signature) {
      throw new BadRequestException('signature is required');
    }

    // Report must be on THIS token's DO — never sign across delivery orders.
    const report = await this.prisma.maintenanceServiceReport.findFirst({
      where: { id: reportId, documentId: link.document.id, organizationId },
      select: { id: true },
    });
    if (!report) {
      throw new NotFoundException('Report not found for this delivery order');
    }

    const dto: SignMaintenanceReportDto = {
      signature: body.signature,
      ...(body.signedByName ? { signedByName: body.signedByName } : {}),
    };
    const signed = await this.maintenanceReportsService.sign(
      reportId,
      dto,
      organizationId,
    );
    return { id: signed.id, status: signed.status };
  }
}
