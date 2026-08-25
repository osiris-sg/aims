import {
  Injectable,
  NotFoundException,
  BadRequestException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { randomBytes, randomUUID } from 'crypto';
import { DeliveryDirection, DeliveryStatus } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';
import { UploadsService } from '../uploads/uploads.service';
import { MaintenanceReportsService } from '../maintenance-reports/maintenance-reports.service';
import { DeliveriesService } from '../deliveries/deliveries.service';
import { minPhotosForAssetClass } from '../common/asset-class';
import { CreateMaintenanceReportDto } from '../maintenance-reports/dto/create-maintenance-report.dto';

// technicianUserId is NOT NULL (means "Clerk user id" in the field flow). Guests
// have no Clerk identity, so we store a fixed non-secret marker (NEVER the token).
const GUEST_TECHNICIAN = 'GUEST';
// Link lifetime past the run's scheduled time (or past mint, if unscheduled).
const LINK_WINDOW_MS = 2 * 24 * 60 * 60 * 1000; // 2 days

// ── IN-MEMORY rate limiter ──────────────────────────────────────────────────
// ⚠️ WARNING: this state lives in THIS Node process ONLY. Render runs a SINGLE
// backend instance today, so a per-process limiter is sufficient. If the backend
// is EVER scaled horizontally (more than one instance/dyno), each instance keeps
// its own counters and the effective limit becomes per-instance (N times looser)
// — the limit silently weakens with no error. Move this to a shared store (Redis)
// BEFORE scaling beyond one instance.
const RL_WINDOW_MS = 60_000;
const RL_MAX = 60; // requests per (token + ip) per minute
const rlBuckets = new Map<string, { count: number; resetAt: number }>();
function enforceRateLimit(key: string) {
  const now = Date.now();
  const bucket = rlBuckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    rlBuckets.set(key, { count: 1, resetAt: now + RL_WINDOW_MS });
    return;
  }
  if (bucket.count >= RL_MAX) {
    throw new HttpException('Too many requests. Please slow down and try again shortly.', HttpStatus.TOO_MANY_REQUESTS);
  }
  bucket.count += 1;
  // Opportunistic sweep so a flood of distinct keys cannot grow the map forever.
  if (rlBuckets.size > 5000) {
    for (const [k, v] of rlBuckets) if (v.resetAt <= now) rlBuckets.delete(k);
  }
}

type TokenState = 'ok' | 'expired' | 'revoked' | 'completed' | 'cancelled' | 'notfound';

/**
 * Run-scoped guest (no-login) delivery surface (2026-08). Replaces the old
 * document-scoped per-item surface. A share token grants access to EXACTLY ONE
 * OUTBOUND delivery RUN and nothing else — never another run, never the DO
 * editor, never any other org. Every public method resolves org + run + DO
 * SOLELY from the token; nothing reads a session or trusts the client body for
 * scope.
 *
 * The guest can only: view the run's items (read-only), deliver each item with
 * its condition photos, and finalize ONCE (install yes/no + one signature),
 * which routes through finalizeRun so the DO commits and the invoice fires
 * atomically — a guest can never leave a half-committed run. No skip, no add, no
 * edit, no cancel.
 */
@Injectable()
export class PublicDeliveryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly uploadsService: UploadsService,
    private readonly maintenanceReportsService: MaintenanceReportsService,
    private readonly deliveriesService: DeliveriesService,
  ) {}

  /** Controller calls this per public request with the token + client IP. */
  publicRateGate(token: string, ip: string) {
    enforceRateLimit(`${token || 'notoken'}::${ip || 'noip'}`);
  }

  private generateToken(): string {
    return randomBytes(32).toString('base64url');
  }

  /**
   * AUTHENTICATED (office) — mint or reuse a RUN-scoped guest link from a
   * delivery order. The DO must belong to the caller's org, be a DELIVERY_ORDER,
   * and have a born-linked OUTBOUND run that is still actionable (not completed /
   * cancelled). expiresAt is set here: a window past the run's scheduledFor, or
   * past now when there is no schedule.
   */
  async generateForDocument(documentId: string, organizationId: string) {
    const doc = await this.prisma.document.findFirst({
      where: { id: documentId, organizationId },
      select: { id: true, type: true },
    });
    if (!doc) throw new NotFoundException('Delivery order not found');
    if (doc.type !== 'DELIVERY_ORDER') {
      throw new BadRequestException('Only delivery orders can be shared via a guest link');
    }

    // The DO's born-linked RUN (a scheduled/started delivery's items carry the DO id).
    const runItem = await this.prisma.deliveryItem.findFirst({
      where: { documentId, delivery: { is: { organizationId, direction: DeliveryDirection.OUTBOUND } } },
      select: { deliveryId: true },
    });
    if (!runItem?.deliveryId) {
      throw new BadRequestException('This delivery order has no started run to share yet');
    }
    const run = await this.prisma.delivery.findFirst({
      where: { id: runItem.deliveryId, organizationId },
      select: { id: true, status: true, scheduledFor: true },
    });
    if (!run) throw new BadRequestException('Run not found for this delivery order');
    if (run.status === 'completed' || run.status === 'cancelled') {
      throw new BadRequestException(`This delivery run is already ${run.status} and cannot be shared`);
    }

    const now = Date.now();
    const windowBase = run.scheduledFor ? run.scheduledFor.getTime() : now;
    const expiresAt = new Date(Math.max(windowBase, now) + LINK_WINDOW_MS);

    // Reuse the newest active (non-revoked, non-expired) link for THIS run; else create.
    const existing = await this.prisma.deliveryShareLink.findFirst({
      where: { deliveryId: run.id, revokedAt: null },
      orderBy: { createdAt: 'desc' },
      select: { token: true, expiresAt: true },
    });
    let token: string;
    let exp: Date | null;
    if (existing && (!existing.expiresAt || existing.expiresAt.getTime() > now)) {
      token = existing.token;
      exp = existing.expiresAt;
    } else {
      const created = await this.prisma.deliveryShareLink.create({
        data: { documentId, deliveryId: run.id, token: this.generateToken(), expiresAt },
        select: { token: true, expiresAt: true },
      });
      token = created.token;
      exp = created.expiresAt;
    }

    const base = (process.env.PORTAL_URL || process.env.FRONTEND_URL || '').replace(/\/$/, '');
    const path = `/guest/delivery/${token}`;
    return { token, path, url: base ? `${base}${path}` : path, expiresAt: exp };
  }

  /** AUTHENTICATED (office) — revoke every active link on the DO's run. */
  async revokeForDocument(documentId: string, organizationId: string) {
    const doc = await this.prisma.document.findFirst({
      where: { id: documentId, organizationId },
      select: { id: true },
    });
    if (!doc) throw new NotFoundException('Delivery order not found');
    const r = await this.prisma.deliveryShareLink.updateMany({
      where: { documentId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { revoked: r.count };
  }

  /**
   * Resolve a token to its link + run + a typed STATE. Never throws for a
   * valid-but-terminal link (the guest view renders the state); mutating methods
   * call assertActionable to reject anything but `ok`.
   */
  private async resolveToken(token: string) {
    const link = await this.prisma.deliveryShareLink.findUnique({
      where: { token },
      select: {
        id: true,
        revokedAt: true,
        expiresAt: true,
        document: { select: { id: true, name: true, organizationId: true, config: true } },
        delivery: { select: { id: true, status: true, direction: true, deliveryNumber: true, organizationId: true } },
      },
    });
    // A run-scoped token must resolve to an OUTBOUND run. Anything else reads as
    // "not found" so the token can never expose a different surface.
    if (!link || !link.delivery || link.delivery.direction !== DeliveryDirection.OUTBOUND) {
      return { link: null, state: 'notfound' as TokenState };
    }
    let state: TokenState = 'ok';
    if (link.revokedAt) state = 'revoked';
    else if (link.expiresAt && link.expiresAt.getTime() < Date.now()) state = 'expired';
    else if (link.delivery.status === 'completed') state = 'completed';
    else if (link.delivery.status === 'cancelled') state = 'cancelled';
    return { link, state };
  }

  private assertActionable(state: TokenState) {
    if (state === 'ok') return;
    const messages: Record<Exclude<TokenState, 'ok'>, string> = {
      expired: 'This delivery link has expired. Please ask the sender for a new one.',
      revoked: 'This delivery link is no longer active.',
      completed: 'This delivery is already complete. Nothing more to do here.',
      cancelled: 'This delivery was cancelled.',
      notfound: 'This delivery link was not found.',
    };
    // 410 Gone: the link resolved but is no longer usable.
    throw new HttpException(messages[state], HttpStatus.GONE);
  }

  /**
   * PUBLIC — read-only view of the ONE run behind the token: its items with
   * their delivery status and the per-item photo minimum. Returns the token
   * `state` so the page can render the expired/revoked/completed/cancelled
   * screens instead of an error.
   */
  async getRunView(token: string) {
    const { link, state } = await this.resolveToken(token);
    if (!link) {
      return { state, deliveryNumber: null, documentNumber: null, customerName: '', deliveryItems: [] };
    }
    const config: any = link.document.config || {};
    const items = await this.prisma.deliveryItem.findMany({
      where: { deliveryId: link.delivery.id },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      select: { id: true, inventoryId: true, assetId: true, description: true, quantity: true, deliveryStatus: true, assetClass: true },
    });
    const invIds = items.map((i) => i.inventoryId).filter((v): v is string => !!v);
    const units = invIds.length
      ? await this.prisma.inventory.findMany({
          where: { id: { in: invIds } },
          select: { id: true, sku: true, asset: { select: { assetClass: true, name: true } } },
        })
      : [];
    const unitById = new Map(units.map((u) => [u.id, u]));
    return {
      state,
      deliveryNumber: link.delivery.deliveryNumber,
      documentNumber: link.document.name,
      customerName: config?.customer?.name || config?.customerName || '',
      deliveryItems: items.map((it) => {
        const u = it.inventoryId ? unitById.get(it.inventoryId) : null;
        const isFreeTyped = !it.inventoryId && !it.assetId;
        const cls = isFreeTyped ? it.assetClass : (u?.asset?.assetClass ?? null);
        return {
          id: it.id,
          isFreeTyped,
          unitSku: u?.sku ?? null,
          description: it.description || u?.asset?.name || u?.sku || 'Item',
          quantity: it.quantity,
          deliveryStatus: it.deliveryStatus,
          minPhotos: minPhotosForAssetClass(cls),
          // A guest can only act on an item that has not been delivered yet.
          canDeliver: it.deliveryStatus === DeliveryStatus.not_delivered || it.deliveryStatus === DeliveryStatus.delivering,
        };
      }),
    };
  }

  /**
   * PUBLIC — proof photo upload, scoped to the token's run + org. The S3 key is
   * namespaced by the run's org + DO, so a guest can only write under this one
   * delivery's POD path.
   */
  async uploadPhoto(token: string, file: Express.Multer.File) {
    if (!file) throw new BadRequestException('No file uploaded');
    const { link, state } = await this.resolveToken(token);
    if (!link) this.assertActionable(state);
    this.assertActionable(state);
    const key = `delivery-pod/${link!.document.organizationId}/${link!.document.id}/${randomUUID()}.jpg`;
    const Key = await this.uploadsService.uploadFileInChunks({ file, key });
    return { Key };
  }

  /**
   * PUBLIC — deliver ONE item on the token's run with its condition photos. The
   * item MUST be on THIS run (404 otherwise). Enforces the class-based photo
   * minimum (5 equipment, 1 accessory). Advances the item to `not_installed`
   * (delivered, awaiting the one end-of-run signature); NO signature here. Unit
   * lines fire a DO_START (photos) then mark delivered; free-typed lines run the
   * same start/end. Idempotent: an already-delivered item is a no-op.
   */
  async deliverItem(token: string, itemId: string, photos: string[]) {
    const { link, state } = await this.resolveToken(token);
    if (!link) this.assertActionable(state);
    this.assertActionable(state);
    const organizationId = link!.document.organizationId;
    const deliveryId = link!.delivery.id;

    const item = await this.prisma.deliveryItem.findFirst({
      where: { id: itemId, deliveryId },
      select: { id: true, inventoryId: true, assetId: true, description: true, deliveryStatus: true, assetClass: true },
    });
    if (!item) throw new NotFoundException('Item is not on this delivery');
    if (item.deliveryStatus === DeliveryStatus.not_installed || item.deliveryStatus === DeliveryStatus.completed) {
      return this.getRunView(token); // already delivered — idempotent
    }
    const clean = Array.isArray(photos) ? photos.filter((p) => typeof p === 'string' && p.trim()) : [];

    if (item.inventoryId) {
      const unit = await this.prisma.inventory.findFirst({
        where: { id: item.inventoryId, organizationId },
        select: { id: true, assetId: true, asset: { select: { assetClass: true } } },
      });
      if (!unit) throw new NotFoundException('Unit not found');
      const min = minPhotosForAssetClass(unit.asset?.assetClass);
      if (clean.length < min) {
        throw new BadRequestException(
          min === 1 ? 'A condition photo is required to deliver this item.' : `This item needs ${min} condition photos to deliver.`,
        );
      }
      // Start with the photos (DO_START advances not_delivered -> delivering via
      // the run bridge), unless the office already started it.
      if (item.deliveryStatus === DeliveryStatus.not_delivered) {
        const dto: CreateMaintenanceReportDto = {
          assetId: unit.assetId,
          inventoryId: unit.id,
          deliveryId,
          kind: 'DO_START' as any,
          description: 'Delivery started (guest)',
          photos: clean,
        };
        await this.maintenanceReportsService.create(dto, organizationId, GUEST_TECHNICIAN);
      }
      // Mark delivered (delivering -> not_installed, unsigned proof).
      await this.deliveriesService.markUnitDelivered(deliveryId, item.inventoryId, { photos: [] }, organizationId, GUEST_TECHNICIAN);
    } else if (!item.assetId) {
      // Free-typed line: same start (photos) then end (-> not_installed).
      const min = minPhotosForAssetClass(item.assetClass);
      if (clean.length < min) {
        throw new BadRequestException(
          min === 1 ? 'A condition photo is required to deliver this item.' : `This item needs ${min} condition photos to deliver.`,
        );
      }
      if (item.deliveryStatus === DeliveryStatus.not_delivered) {
        await this.deliveriesService.startFreeTypedItem(deliveryId, item.id, { photos: clean }, organizationId, GUEST_TECHNICIAN);
      }
      await this.deliveriesService.endFreeTypedItem(deliveryId, item.id, {}, organizationId, GUEST_TECHNICIAN);
    } else {
      throw new BadRequestException('This item cannot be delivered via the guest link');
    }
    return this.getRunView(token);
  }

  /**
   * PUBLIC — finalize the whole run with ONE customer signature. Routes through
   * finalizeRun, which stamps the signature across every proof, completes the
   * items, commits the DO and fires the draft invoice atomically — so a guest can
   * never leave a half-committed run. finalizeRun also auto-revokes this link on
   * completion. `installNeeded` is the single yes/no finalize needs.
   */
  async finalize(
    token: string,
    body: { signature?: string; signedByName?: string; installNeeded?: boolean; installPhotos?: string[] },
  ) {
    const { link, state } = await this.resolveToken(token);
    if (!link) this.assertActionable(state);
    this.assertActionable(state);
    if (!body?.signature) throw new BadRequestException('signature is required');
    await this.deliveriesService.finalizeRun(
      link!.delivery.id,
      {
        signature: body.signature,
        ...(body.signedByName ? { recipientName: body.signedByName } : {}),
        installNeeded: !!body.installNeeded,
        ...(body.installNeeded && Array.isArray(body.installPhotos) && body.installPhotos.length
          ? { installPhotos: body.installPhotos.filter((p) => typeof p === 'string') }
          : {}),
      },
      link!.document.organizationId,
      GUEST_TECHNICIAN,
    );
    return this.getRunView(token);
  }
}
