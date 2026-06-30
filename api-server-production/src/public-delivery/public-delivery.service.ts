import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { randomBytes, randomUUID } from 'crypto';
import { DeliveryStatus } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';
import { DocumentsService } from '../documents/documents.service';
import { UploadsService } from '../uploads/uploads.service';

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
        sku: true,
        description: true,
        quantity: true,
        deliveryStatus: true,
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
        sku: it.sku,
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
}
