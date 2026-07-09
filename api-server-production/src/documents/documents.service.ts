import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { UpdateDocumentDto } from './dto/update-document.dto';
import { PrismaService } from 'src/common/prisma.service';
import { CreateDocumentWithTimelineDto } from './dto/create-document-with-timeline.dto';
import { InventoryStatus, DocumentStatus, ItemType, DeliveryStatus, DeploymentType } from '@prisma/client';
import { XeroService } from 'src/common/xero.service';
import { PriceHistoryService } from '../price-history/price-history.service';
import { EmailService } from '../email/email.service';
import { JournalAutoPostService } from '../journal/journal-auto-post.service';
import { OrdersService } from '../orders/orders.service';
import { DocumentTemplatesService } from '../documentTemplates/documentTemplates.service';
import { DocumentNumberingService } from '../document-numbering/document-numbering.service';
import { SendInvoiceEmailDto } from '../email/dto/send-invoice-email.dto';
import { S3Service } from 'src/common/services/s3.service';
import { PdfGeneratorService } from 'src/common/services/pdf-generator.service';
import { AuditService } from 'src/common/audit.service';
import * as moment from 'moment';

// Who performed a document action — derived from req.user in the controller.
export interface DocumentActor {
  id?: string;
  name?: string;
  email?: string;
}

@Injectable()
export class DocumentsService {
  constructor(
    private prisma: PrismaService,
    private xeroService: XeroService,
    private priceHistoryService: PriceHistoryService,
    private emailService: EmailService,
    private journalAutoPost: JournalAutoPostService,
    private s3Service: S3Service,
    private pdfGeneratorService: PdfGeneratorService,
    private ordersService: OrdersService,
    private documentTemplatesService: DocumentTemplatesService,
    private documentNumbering: DocumentNumberingService,
    private auditService: AuditService,
  ) {}

  // ── Document history (Xero-style "History and notes") ────────────────────
  // Events are AuditLog rows keyed by resource='document' + resourceId (the
  // admin audit page sees them too). details = { detail, changes? }.
  // AuditService swallows its own errors, so history can never break a save.
  private logDocumentEvent(opts: {
    documentId: string;
    organizationId: string;
    action: 'CREATED' | 'EDITED' | 'APPROVED' | 'STATUS_CHANGED' | 'NOTE' | 'SENT' | 'DELETED';
    detail: string;
    documentName?: string;
    actor?: DocumentActor;
    changes?: string[];
  }): Promise<void> {
    return this.auditService.logAction({
      userId: opts.actor?.id || 'system',
      userName: opts.actor?.name,
      userEmail: opts.actor?.email,
      action: opts.action,
      resource: 'document',
      resourceId: opts.documentId,
      resourceName: opts.documentName,
      organizationId: opts.organizationId,
      details: {
        detail: opts.detail,
        ...(opts.changes?.length ? { changes: opts.changes } : {}),
      },
    });
  }

  async getDocumentHistory(documentId: string, organizationId: string) {
    const doc = await this.prisma.document.findFirst({
      where: { id: documentId, organizationId },
      select: { id: true },
    });
    if (!doc) throw new HttpException('Document not found', HttpStatus.NOT_FOUND);
    return (this.prisma as any).auditLog.findMany({
      where: { resource: 'document', resourceId: documentId, organizationId },
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: { id: true, action: true, userName: true, userEmail: true, details: true, createdAt: true },
    });
  }

  async addDocumentNote(documentId: string, organizationId: string, actor: DocumentActor, text: string) {
    const doc = await this.prisma.document.findFirst({
      where: { id: documentId, organizationId },
      select: { id: true, name: true },
    });
    if (!doc) throw new HttpException('Document not found', HttpStatus.NOT_FOUND);
    const trimmed = (text || '').trim();
    if (!trimmed) throw new HttpException('Note text is required', HttpStatus.BAD_REQUEST);
    await this.logDocumentEvent({
      documentId,
      organizationId,
      action: 'NOTE',
      detail: trimmed,
      documentName: doc.name,
      actor,
    });
    return { success: true };
  }

  /**
   * Sync DocumentItem junction table for efficient item queries.
   * This is called after document create/update to keep the junction table in sync.
   */
  private async syncDocumentItems(documentId: string, config: any, organizationId: string) {
    try {
      const rawItems = config?.items;
      // An absent/malformed items[] is treated as "no desired rows" and routed
      // through the SAME reconciliation below (desired = []), so in-flight rows
      // are still protected — strictly safer than the old delete-everything.
      const items: any[] = Array.isArray(rawItems) ? rawItems : [];

      // Resolve an item's type once, cached for duplicate SKUs. Inventory is
      // checked first, then Asset — mirrors the legacy behavior. Returns null
      // for ids present in neither table (skipped, exactly as before).
      const typeCache = new Map<string, ItemType | null>();
      const resolveType = async (itemId: string): Promise<ItemType | null> => {
        if (typeCache.has(itemId)) return typeCache.get(itemId)!;
        let resolved: ItemType | null = null;
        const inv = await this.prisma.inventory.findUnique({ where: { id: itemId } });
        if (inv) {
          resolved = ItemType.INVENTORY;
        } else {
          const asset = await this.prisma.asset.findUnique({ where: { id: itemId } });
          if (asset) resolved = ItemType.ASSET;
        }
        typeCache.set(itemId, resolved);
        return resolved;
      };

      // Build the DESIRED row set from config.items[]. config.items is the
      // source of truth for the renderer / Xero / totals and is NEVER touched
      // here — we only reconcile the DocumentItem TABLE against it. Each desired
      // row carries its positional lineNumber (1-based) + resolved itemType and
      // inventory/asset FK backfill.
      type Desired = {
        itemId: string;
        itemType: ItemType;
        inventoryId: string | null;
        assetId: string | null;
        lineNumber: number;
        content: {
          sku: string | null;
          description: string | null;
          quantity: number;
          unitPrice: number;
          discount: number;
          amount: number;
          uom: string | null;
          isService: boolean;
          isFixedAsset: boolean;
        };
      };
      const desired: Desired[] = [];
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const itemId = item.inventoryItemId || item.assetId;
        if (!itemId) continue; // Skip items without an ID (e.g. service lines)
        const itemType = await resolveType(itemId);
        if (!itemType) {
          console.warn(`DocumentItem sync: Item ${itemId} not found in Inventory or Asset table, skipping`);
          continue;
        }
        desired.push({
          itemId,
          itemType,
          // Backfill the typed FK from itemId + itemType (the new Phase 1
          // columns); itemId/itemType themselves are still written for the
          // ~15 back-compat readers.
          inventoryId: itemType === ItemType.INVENTORY ? itemId : null,
          assetId: itemType === ItemType.ASSET ? itemId : null,
          lineNumber: i + 1,
          content: {
            sku: item.sku || item.skuKey || null,
            description: item.description || null,
            quantity: parseFloat(item.quantity) || 0,
            unitPrice: parseFloat(item.unitPrice) || 0,
            discount: parseFloat(item.discount) || 0,
            amount: parseFloat(item.amount) || 0,
            uom: item.uom || null,
            isService: !!item.isService,
            isFixedAsset: !!item.isFixedAsset,
          },
        });
      }

      const existing = await this.prisma.documentItem.findMany({
        where: { documentId },
      });

      // ── Pairing (preserving reconciliation) ──────────────────────────────
      // Match desired ↔ existing by itemId ONLY — never by lineNumber, which is
      // positional and shifts on reorder (matching on it would reset delivery
      // state every time a line moves).
      //
      // Duplicate-SKU tiebreak: when one itemId has multiple existing and/or
      // multiple desired rows, pair them deterministically —
      //   • existing rows sorted MOST-ADVANCED first
      //     (completed > not_installed > delivering > not_delivered),
      //     tie-broken by lineNumber asc;
      //   • desired rows taken in document order (lineNumber asc);
      //   • zip the two: the first min(E,D) pair up.
      // This keeps delivery progress on the already-advanced rows; any surplus
      // existing rows (the least-advanced, hence most likely not_delivered) fall
      // into the "removed" bucket — so dropping one of N duplicate lines retires
      // a not-yet-delivered copy rather than an in-flight one.
      const RANK: Record<string, number> = {
        not_delivered: 0,
        delivering: 1,
        not_installed: 2,
        completed: 3,
      };
      const existingByItem = new Map<string, typeof existing>();
      for (const row of existing) {
        const arr = existingByItem.get(row.itemId) || [];
        arr.push(row);
        existingByItem.set(row.itemId, arr);
      }
      for (const arr of existingByItem.values()) {
        arr.sort((a, b) => {
          const rb = RANK[b.deliveryStatus] ?? 0;
          const ra = RANK[a.deliveryStatus] ?? 0;
          if (rb !== ra) return rb - ra; // most-advanced first
          return (a.lineNumber ?? 0) - (b.lineNumber ?? 0);
        });
      }
      const desiredByItem = new Map<string, Desired[]>();
      for (const d of desired) {
        const arr = desiredByItem.get(d.itemId) || [];
        arr.push(d);
        desiredByItem.set(d.itemId, arr);
      }

      const matched: Array<{ id: string; desired: Desired }> = [];
      const toCreate: Desired[] = [];
      const removed: typeof existing = [];
      const allItemIds = new Set<string>([...existingByItem.keys(), ...desiredByItem.keys()]);
      for (const itemId of allItemIds) {
        const ex = existingByItem.get(itemId) || [];
        const de = desiredByItem.get(itemId) || [];
        const pairCount = Math.min(ex.length, de.length);
        for (let k = 0; k < pairCount; k++) matched.push({ id: ex[k].id, desired: de[k] });
        for (let k = pairCount; k < de.length; k++) toCreate.push(de[k]);
        for (let k = pairCount; k < ex.length; k++) removed.push(ex[k]);
      }

      // ── Apply ────────────────────────────────────────────────────────────
      // Park every surviving row's lineNumber to null FIRST so reassigning
      // positions (including same-itemId swaps) can never trip the
      // @@unique([documentId, itemId, lineNumber]) constraint mid-flight —
      // NULLs are distinct under a Postgres unique index.
      if (existing.length > 0) {
        await this.prisma.documentItem.updateMany({
          where: { documentId },
          data: { lineNumber: null },
        });
      }

      // Removed rows: delete ONLY if still not_delivered. In-flight rows
      // (delivering / not_installed / completed) are KEPT — a document edit must
      // not silently destroy delivery progress — and a warning is logged. (Their
      // lineNumber stays null: they no longer have a position in config.items.)
      const removedNotDelivered = removed.filter((r) => r.deliveryStatus === 'not_delivered');
      const removedInFlight = removed.filter((r) => r.deliveryStatus !== 'not_delivered');
      if (removedNotDelivered.length > 0) {
        await this.prisma.documentItem.deleteMany({
          where: { id: { in: removedNotDelivered.map((r) => r.id) } },
        });
      }
      for (const r of removedInFlight) {
        console.warn(
          `DocumentItem sync: item ${r.itemId} (status=${r.deliveryStatus}) was removed from document ${documentId}'s config but is in-flight — keeping the row instead of deleting.`,
        );
      }

      // Matched rows: UPDATE content + lineNumber + FK backfill, and PRESERVE
      // every delivery column (deliveryStatus, deductedAt, deliveringAt,
      // deliveredAt, completedAt, installSkipped) by OMITTING them from the
      // update payload.
      for (const m of matched) {
        const d = m.desired;
        await this.prisma.documentItem.update({
          where: { id: m.id },
          data: {
            itemId: d.itemId,
            itemType: d.itemType,
            inventoryId: d.inventoryId,
            assetId: d.assetId,
            lineNumber: d.lineNumber,
            ...d.content,
          },
        });
      }

      // New rows: CREATE with the default deliveryStatus = not_delivered
      // (omitted ⇒ DB default) and installSkipped = false.
      if (toCreate.length > 0) {
        await this.prisma.documentItem.createMany({
          data: toCreate.map((d) => ({
            documentId,
            itemId: d.itemId,
            itemType: d.itemType,
            inventoryId: d.inventoryId,
            assetId: d.assetId,
            lineNumber: d.lineNumber,
            ...d.content,
          })),
          skipDuplicates: true,
        });
      }

      console.log(
        `📋 DocumentItem sync (preserving): doc ${documentId} — ${matched.length} updated, ${toCreate.length} created, ${removedNotDelivered.length} removed, ${removedInFlight.length} in-flight kept`,
      );
    } catch (error) {
      console.error('Failed to sync DocumentItems:', error);
      // Don't throw - this is a background sync operation
    }
  }

  async getById(id: string, organizationId: string) {
    try {
      const document = await this.prisma.document.findFirst({
        where: {
          id,
          organizationId,
        },
        include: {
          organization: true,
          baseDocument: true,
          revisions: true,
          // Field-tech delivery reports linked to this document. CleanDocumentPreview
          // renders these into a "Proof of Delivery" section at the bottom of the
          // DO print/preview. Restricted to DO_START / DO_ACK so unrelated service
          // reports never leak into print output, even if some future flow sets
          // documentId on a kind=SERVICE row.
          maintenanceReports: {
            where: { kind: { in: ['DO_START', 'DO_ACK'] } },
            orderBy: { createdAt: 'asc' },
            select: {
              id: true,
              kind: true,
              photos: true,
              signature: true,
              signedByName: true,
              signedAt: true,
              technicianName: true,
              createdAt: true,
            },
          },
        },
      });

      if (!document) return document;

      // Fold the template + its field definitions into this response so opening a
      // document is ONE round-trip instead of three (was: GET doc → GET template →
      // GET template/fields). Resolved in-region here; the two extra client fetches
      // are eliminated. Best-effort: if the template can't be resolved in this org,
      // omit the bundle and the client falls back to its legacy per-request path.
      let templateBundle: Awaited<ReturnType<DocumentTemplatesService['getTemplateBundle']>> = null;
      if (document.documentTemplateId) {
        try {
          templateBundle = await this.documentTemplatesService.getTemplateBundle(document.documentTemplateId, organizationId);
        } catch (error) {
          console.warn(`getById: could not resolve template bundle for ${document.documentTemplateId}: ${error?.message ?? error}`);
        }
      }

      return {
        ...document,
        template: templateBundle?.template ?? null,
        fieldDefinitions: templateBundle?.fieldDefinitions ?? null,
      };
    } catch (error) {
      throw new HttpException(`Fetch by ID failed: ${error.message}`, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async getByInventory(inventoryId: string, organizationId: string) {
    try {
      // Use DocumentItem junction table for efficient query (O(log n) with index)
      const documentItems = await this.prisma.documentItem.findMany({
        where: {
          itemId: inventoryId,
          document: {
            organizationId,
          },
        },
        include: {
          document: true,
        },
        orderBy: {
          document: {
            createdAt: 'desc',
          },
        },
      });

      // Return unique documents
      const documentMap = new Map();
      for (const item of documentItems) {
        if (!documentMap.has(item.document.id)) {
          documentMap.set(item.document.id, item.document);
        }
      }
      return Array.from(documentMap.values());
    } catch (error) {
      throw new HttpException(`Fetch by inventory failed: ${error.message}`, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  // --- Concurrent-edit lock (presence + takeover) ----------------------------
  // A holder is considered idle (and thus take-over-able) once they haven't made
  // a real content edit for this long. Presence heartbeats refresh editingAt but
  // NOT lastActivityAt, so a tab left open still goes idle.
  private static readonly LOCK_IDLE_MS = 5 * 60 * 1000; // 5 minutes

  private buildLockState(doc: any, viewerUserId: string) {
    const holder = doc?.editingByUserId || null;
    const heldByMe = !!holder && holder === viewerUserId;
    // Idle is measured from the last REAL edit. Fall back to the presence
    // heartbeat (editingAt) when lastActivityAt is missing, so a just-opened doc
    // (which has a fresh editingAt but no edits yet) is never instantly
    // take-over-able. Only a genuinely held doc with NO timestamps at all is
    // treated as idle.
    const activityTs = doc?.lastActivityAt ?? doc?.editingAt ?? null;
    const lastActivity = activityTs ? new Date(activityTs).getTime() : 0;
    const idleMs = lastActivity ? Date.now() - lastActivity : Number.POSITIVE_INFINITY;
    const isIdle = !holder || idleMs >= DocumentsService.LOCK_IDLE_MS;
    return {
      editingByUserId: holder,
      editingByName: doc?.editingByName || null,
      editingAt: doc?.editingAt || null,
      lastActivityAt: doc?.lastActivityAt || null,
      version: doc?.version ?? 0,
      heldByMe,
      // Someone else is actively editing → the opener should go read-only.
      lockedByOther: !!holder && !heldByMe && !isIdle,
      // Take over is offered ONLY once the holder has been idle (no real edit /
      // save) for >5 min — an actively-working holder is never taken over. A
      // stale lock self-resolves: it goes idle after 5 min and becomes
      // take-over-able, so nobody is permanently dead-ended in read-only.
      canTakeOver: !!holder && !heldByMe && isIdle,
    };
  }

  // Claim/refresh the lock when opening the editor. Claims when the doc is free,
  // already ours, or the holder is idle (>5 min). Never wrests an active editor —
  // an explicit takeover still requires the holder to be idle.
  async acquireDocumentLock(
    id: string,
    organizationId: string,
    userId: string,
    userName: string,
    takeover: boolean,
  ) {
    const doc = await this.prisma.document.findUnique({ where: { id, organizationId } });
    if (!doc) throw new HttpException('Document not found', HttpStatus.NOT_FOUND);
    const state = this.buildLockState(doc, userId);
    // Claim silently only when the doc is free or already ours. An idle holder
    // is NOT auto-grabbed — the opener gets read-only + a "Take over" affordance
    // and must pass takeover=true to claim. An actively-editing holder can never
    // be taken over.
    const canClaim = !state.editingByUserId || state.heldByMe || (takeover && state.canTakeOver);
    if (!canClaim) {
      // Either someone is actively editing (read-only), or it's idle and the
      // opener hasn't asked to take over yet (read-only + canTakeOver).
      return { acquired: false, ...state };
    }
    const now = new Date();
    const updated = await this.prisma.document.update({
      where: { id, organizationId },
      data: {
        editingByUserId: userId,
        editingByName: userName,
        editingAt: now,
        // Reset the idle clock on (re)acquire/takeover so a freshly opened doc
        // isn't instantly take-over-able and a takeover starts a clean window.
        lastActivityAt: now,
      } as any,
    });
    return { acquired: true, ...this.buildLockState(updated, userId) };
  }

  // Heartbeat while the editor is open. edited=true bumps the idle clock; a bare
  // ping only refreshes presence. The lock is self-healing: lostLock is reported
  // ONLY when ANOTHER user now holds it (a genuine takeover). If the lock was
  // found free (lapsed/released transiently — e.g. a stray cleanup or HMR remount
  // in dev), the holder simply re-claims it, so a hiccup never kicks the active
  // editor to read-only.
  async heartbeatDocumentLock(
    id: string,
    organizationId: string,
    userId: string,
    userName: string,
    edited: boolean,
  ) {
    const doc = await this.prisma.document.findUnique({ where: { id, organizationId } });
    if (!doc) throw new HttpException('Document not found', HttpStatus.NOT_FOUND);
    const holder = (doc as any).editingByUserId;
    if (holder && holder !== userId) {
      return { ok: false, lostLock: true, ...this.buildLockState(doc, userId) };
    }
    const reclaiming = !holder; // lock was free → re-assert this editor's hold
    const now = new Date();
    const updated = await this.prisma.document.update({
      where: { id, organizationId },
      data: {
        editingByUserId: userId,
        editingByName: userName || (doc as any).editingByName || 'Someone',
        editingAt: now,
        ...(edited || reclaiming ? { lastActivityAt: now } : {}),
      } as any,
    });
    return { ok: true, lostLock: false, ...this.buildLockState(updated, userId) };
  }

  // Release on close/save. No-op if the caller isn't the current holder.
  async releaseDocumentLock(id: string, organizationId: string, userId: string) {
    const doc = await this.prisma.document.findUnique({ where: { id, organizationId } });
    if (!doc) return { released: false };
    if ((doc as any).editingByUserId && (doc as any).editingByUserId !== userId) {
      return { released: false }; // someone else holds it now — leave it intact
    }
    await this.prisma.document.update({
      where: { id, organizationId },
      data: { editingByUserId: null, editingByName: null, editingAt: null, lastActivityAt: null } as any,
    });
    return { released: true };
  }

  async updateDocument(dto: UpdateDocumentDto, organizationId: string, actor?: DocumentActor) {
    try {
      const configAsPlainObject: any = dto.config ? dto.config : null;
      const id: any = dto.id ? dto.id : null;

      // Check if document exists and its current status
      const existingDocument = await this.prisma.document.findUnique({
        where: {
          id,
          organizationId
        },
      });

      if (!existingDocument) {
        throw new HttpException('Document not found', HttpStatus.NOT_FOUND);
      }

      // If document is already confirmed, prevent any edits to config/content
      // Only allow status changes or no changes at all
      if (existingDocument.status === 'confirmed') {
        // If trying to change config/content of a confirmed document, prevent it
        if (dto.config && Object.keys(dto.config).length > 0) {
          throw new HttpException('Cannot edit confirmed document. Please create a revision instead.', HttpStatus.FORBIDDEN);
        }
        // Allow only status changes for confirmed documents
      }

      // Optimistic-concurrency guard. If the client sent the version it loaded,
      // reject the save when the document has since moved on (someone else saved
      // it, or took the lock over). Stops a stale copy from silently clobbering
      // newer work. Callers that don't send a version (internal/non-editor
      // updates) are unaffected; the editor always sends it.
      const incomingVersion = (dto as any).version;
      if (
        typeof incomingVersion === 'number' &&
        (existingDocument as any).version != null &&
        incomingVersion !== (existingDocument as any).version
      ) {
        throw new HttpException(
          {
            message:
              'This document was updated by someone else. Reload to get the latest version before saving.',
            code: 'VERSION_CONFLICT',
            currentVersion: (existingDocument as any).version,
            editingByName: (existingDocument as any).editingByName || null,
          },
          HttpStatus.CONFLICT,
        );
      }

      // projectId can arrive either at the top level (frontend's update payload
      // sets it there alongside customerId) or nested inside config. Prefer the
      // top-level value so the doc picker actually persists; fall back to the
      // legacy config.projectId for backwards-compat with older callers.
      const projectId =
        (dto as any).projectId ?? configAsPlainObject?.projectId ?? null;
      console.log('Project ID resolved:', projectId, 'Type:', typeof projectId);
      console.log('dto', dto);

      // Handle captured images - ensure they are stored as URLs
      if (configAsPlainObject?.capturedImages && Array.isArray(configAsPlainObject.capturedImages)) {
        // The capturedImages should already be S3 URLs from the frontend
        // Just ensure they are properly stored in the config
        console.log('Captured images to be stored:', configAsPlainObject.capturedImages);
      }

      // Handle MSR photos - ensure they are stored as URLs
      if (configAsPlainObject?.photos && Array.isArray(configAsPlainObject.photos)) {
        // The photos should already be S3 URLs from the frontend
        // Just ensure they are properly stored in the config
        console.log('MSR photos to be stored:', configAsPlainObject.photos.length, 'photos');
      }

      // Preserve "tracking" fields the form doesn't surface. Without this, a
      // round-trip Save wipes them (the form sends back its full config, but
      // not these), which breaks downstream features that depend on them:
      // - sourceOrderId / sourceOrderNumber: how a PO/DO/Invoice traces back
      //   to its parent Order (used by the supplier-doc verify-upload flow
      //   to find which order's items to stamp ✓).
      // - orderType: gates PO editor behaviour (Route Order hides discount,
      //   shows Less Points; Project cascades top discount).
      // - sourceDocumentId / sourceDocumentNumber / sourceDocumentType: the
      //   quotation-to-doc lineage used by the doc breadcrumbs.
      // Honour an *explicit* overwrite from the form (so it's still possible
      // to update these via tooling), but never let a bare save erase them.
      const existingConfig = (existingDocument.config as any) || {};
      const trackingKeys = [
        'sourceOrderId',
        'sourceOrderNumber',
        'orderType',
        'sourceDocumentId',
        'sourceDocumentNumber',
        'sourceDocumentType',
      ];
      for (const k of trackingKeys) {
        if (
          (configAsPlainObject as any)[k] === undefined &&
          existingConfig[k] !== undefined
        ) {
          (configAsPlainObject as any)[k] = existingConfig[k];
        }
      }

      // Validate status transition for invoices
      const invoiceTypesForValidation = ['INVOICE', 'TI', 'TI2'];
      if (dto.status && invoiceTypesForValidation.includes(existingDocument.type)) {
        const currentStatus = existingDocument.status;
        const newStatus = dto.status;

        // Skip validation if status is not changing
        if (currentStatus === newStatus) {
          console.log(`Status unchanged: keeping document as "${currentStatus}"`);
        } else {
          // Define valid status transitions for invoices
          const validTransitions: Record<string, string[]> = {
            'draft': ['confirmed'], // draft can only go to confirmed
            'confirmed': ['pending_payment'], // confirmed can go to pending_payment (after email sent)
            'pending_payment': ['paid'], // pending_payment can go to paid
            'paid': [], // paid is final status
          };

          // Check if transition is valid
          const allowedNextStatuses = validTransitions[currentStatus] || [];
          if (!allowedNextStatuses.includes(newStatus)) {
            // Special case: Allow manual status change to 'paid' only from 'pending_payment'
            if (newStatus === DocumentStatus.paid && currentStatus !== DocumentStatus.pending_payment) {
              throw new HttpException(
                `Invoice must be in "pending_payment" status before marking as paid. Current status: ${currentStatus}`,
                HttpStatus.BAD_REQUEST,
              );
            } else if (newStatus === DocumentStatus.paid && currentStatus === DocumentStatus.pending_payment) {
              // This is allowed - user manually marking as paid from pending_payment status
            } else {
              throw new HttpException(
                `Invalid status transition from "${currentStatus}" to "${newStatus}". ` +
                `Allowed transitions: ${allowedNextStatuses.length > 0 ? allowedNextStatuses.join(', ') : 'none (final status)'}`,
                HttpStatus.BAD_REQUEST,
              );
            }
          }
        }
      }

      // Sync Document.name with the editable "Purchase Order No." / document
      // number on the form. When the user types a custom number into the
      // documentNumber field it becomes the document's authoritative name,
      // so the orders list, supplier-doc verification (which matches on name),
      // and any other downstream surface all stay in agreement.
      const editedDocNumber =
        (configAsPlainObject as any)?.documentNumber ??
        (configAsPlainObject as any)?.documentInfo?.documentNumber;
      const trimmedDocNumber =
        typeof editedDocNumber === 'string' && editedDocNumber.trim() ? editedDocNumber.trim() : undefined;
      const nameToWrite = trimmedDocNumber ?? dto.name;

      // Update the document itself with config only
      const updatedDocument = await this.prisma.document.update({
        where: {
          id,
          organizationId, // Ensure user can only update documents in their organization
        },
        data: {
          config: configAsPlainObject,
          type: dto.type,
          // Update document status if provided
          status: dto.status, // DocumentStatus enum
          name: nameToWrite, // Custom doc number wins; otherwise honour dto.name
          // Link to project if projectId exists in config
          projectId: projectId || undefined,
          // Bump the optimistic-concurrency counter on every successful save so
          // any other editor holding an older copy is rejected on their save.
          version: { increment: 1 },
          // A content save IS activity by the lock holder — bump the idle clock
          // so an actively-saving editor (autosave fires ~every 2s) never reads
          // as idle and can't be taken over. Status-only updates skip this.
          ...(configAsPlainObject ? { lastActivityAt: new Date() } : {}),
        } as any,
      });

      // Order.linkedDocuments stores a *snapshot* of each linked doc's name —
      // so when the user renames a PO/DO/Invoice (typically by typing a custom
      // Purchase Order No.), the chip on the order page would otherwise show
      // the stale label. Propagate the new name to every order that references
      // this document. Skip if the name didn't actually change.
      if (nameToWrite && nameToWrite !== existingDocument.name) {
        try {
          const orders = await this.prisma.order.findMany({
            where: { organizationId },
            select: { id: true, linkedDocuments: true },
          });
          for (const o of orders) {
            const ld: any = o.linkedDocuments || {};
            let dirty = false;
            for (const kind of ['po', 'do', 'invoice', 'salesOrder'] as const) {
              const list: any[] = Array.isArray(ld[kind]) ? ld[kind] : [];
              for (const ref of list) {
                if (ref && ref.id === id && ref.name !== nameToWrite) {
                  ref.name = nameToWrite;
                  dirty = true;
                }
              }
            }
            if (dirty) {
              await this.prisma.order.update({ where: { id: o.id }, data: { linkedDocuments: ld } });
            }
          }
        } catch (e) {
          console.warn('Failed to propagate doc rename to orders.linkedDocuments:', (e as Error).message);
        }
      }

      // ---- Invoice confirmation gate (price history + AR transaction) ----
      // NOTE: GL auto-posting for invoices lives in confirmInvoice(); this generic
      // update() path is for non-invoice document types or backwards-compat updates.
      const isInvoiceType = dto.type === 'INVOICE' || dto.type === 'TI' || dto.type === 'TI2';
      const becomingConfirmed = dto.status === 'confirmed' && existingDocument.status !== 'confirmed';
      console.log('🧾 [INVOICE-CONFIRM gate]', {
        docId: id,
        dtoType: dto.type,
        dtoStatus: dto.status,
        existingStatus: existingDocument.status,
        isInvoiceType,
        becomingConfirmed,
        willAutoPost: isInvoiceType && becomingConfirmed,
      });
      // Route Order PO confirm → decrement the org's Points balance by the
      // editable "Less Points" amount the user entered on the PO. Lives here
      // because confirms-flip is the trigger; balance moves once-per-confirm
      // and a confirmed doc can't be re-confirmed (guarded at the top).
      const isPoType = dto.type === 'PO' || dto.type === 'PURCHASE_ORDER';
      const cfgForPoints: any = configAsPlainObject || {};
      const isRouteOrderPo = isPoType && (cfgForPoints?.orderType ?? cfgForPoints?.documentInfo?.orderType) === 'Route Order';
      if (becomingConfirmed && isRouteOrderPo) {
        const redeemRaw =
          cfgForPoints?.documentInfo?.pointsRedeemed ??
          cfgForPoints?.pointsRedeemed ??
          cfgForPoints?.documentInfo?.pointsDeducted ?? // legacy auto-computed fallback
          cfgForPoints?.pointsDeducted ??
          0;
        const redeem = Math.max(0, Number(redeemRaw) || 0);
        if (redeem > 0) {
          try {
            const result = await this.prisma.organization.update({
              where: { id: organizationId },
              data: { pointsBalance: { decrement: redeem } },
              select: { pointsBalance: true },
            });
            console.log(
              `🎯 Points debited: -${redeem} on Route Order PO ${id}; new balance ${result.pointsBalance}`,
            );
          } catch (err) {
            console.error('Points debit failed (non-fatal):', (err as Error).message);
          }
        }
      }

      if (becomingConfirmed && isInvoiceType) {
        try {
          await this.priceHistoryService.savePriceHistoryFromDocument(id, organizationId);
          console.log('Price history saved for confirmed invoice:', id);
        } catch (error) {
          console.error('Failed to save price history:', error);
          // Don't fail the document update if price history fails
        }

        // NOTE: The Transaction / CustomerBalance sub-ledger has been RETIRED.
        // AR is now derived directly from the Document table (this invoice's
        // config carries the amount + outstanding balance), so the SOA, aging,
        // and AI tools all read one source. We no longer write a Transaction
        // row here. GL auto-post for invoices is handled by confirmInvoice().
      }

      // If document is being confirmed and is a Purchase Order, update inventory quantities
      console.log('📋 UPDATE DOC: dto.type =', dto.type, ', dto.status =', dto.status, ', existingDocument.status =', existingDocument.status);
      console.log('📋 UPDATE DOC: Is PO check:', dto.type === 'PO' || dto.type === 'PURCHASE_ORDER');
      if (dto.status === 'confirmed' &&
          existingDocument.status !== 'confirmed' &&
          (dto.type === 'PO' || dto.type === 'PURCHASE_ORDER')) {
        try {
          const items = configAsPlainObject?.items || [];
          console.log('📦 PO RECEIVE: Processing Purchase Order confirmation with items:', items.length);
          console.log('📦 PO RECEIVE: Items with receivedQty:', items.map((i: any) => ({ id: i.inventoryItemId, qty: i.quantity, receivedQty: i.receivedQty })));

          await Promise.all(
            items.map(async (item: any) => {
              if (!item.inventoryItemId) {
                console.warn('⚠️ PO RECEIVE: Item missing inventoryItemId, skipping');
                return;
              }

              const receivedQty = parseFloat(item.receivedQty) || 0;
              if (receivedQty <= 0) {
                console.warn('⚠️ PO RECEIVE: Item has no received quantity, skipping:', item.inventoryItemId);
                return;
              }

              // Try to find in Inventory table first (Asset Tracking Mode ON)
              let inventory = await this.prisma.inventory.findUnique({
                where: { id: item.inventoryItemId },
              });

              if (inventory) {
                // Update inventory quantity (add received quantity to existing stock)
                const currentQty = inventory.quantity || 0;
                const newQty = currentQty + receivedQty;

                await this.prisma.inventory.update({
                  where: { id: item.inventoryItemId },
                  data: { quantity: newQty },
                });

                console.log(`✅ PO RECEIVE: Updated inventory ${item.inventoryItemId}: ${currentQty} + ${receivedQty} = ${newQty}`);

                // Create timeline entry for the inventory update
                await this.prisma.timelineItem.create({
                  data: {
                    message: `Received ${receivedQty} units from Purchase Order ${updatedDocument.name || id.substring(0, 8)}`,
                    inventoryId: item.inventoryItemId,
                    documentId: id,
                    pdfUrl: null,
                  },
                });
              } else {
                // Try to find in Asset table (Products Mode - Asset Tracking OFF)
                const asset = await this.prisma.asset.findUnique({
                  where: { id: item.inventoryItemId },
                });

                if (asset) {
                  // Update asset quantity (add received quantity to existing stock)
                  const currentQty = asset.quantity || 0;
                  const newQty = currentQty + receivedQty;

                  await this.prisma.asset.update({
                    where: { id: item.inventoryItemId },
                    data: { quantity: newQty },
                  });

                  console.log(`✅ PO RECEIVE: Updated asset ${item.inventoryItemId}: ${currentQty} + ${receivedQty} = ${newQty}`);
                } else {
                  console.warn('⚠️ PO RECEIVE: Neither inventory nor asset found:', item.inventoryItemId);
                }
              }
            })
          );

          console.log('✅ PO RECEIVE: Purchase Order inventory update completed');
        } catch (error) {
          console.error('❌ PO RECEIVE: Failed to update inventory:', error);
          // Don't fail the document update if inventory update fails
        }

        // ---- PO-as-Project auto-creation (feature-flagged) ----
        // When enablePOAsProject is on, confirming a PO spins up a Project named
        // after the PO and links it back so subsequent DOs/invoices can attach to it.
        try {
          const uiConfig = await this.prisma.organizationUIConfig.findUnique({
            where: { organizationId },
            select: { features: true },
          });
          const features = (uiConfig?.features as any) || {};
          if (features.enablePOAsProject && !updatedDocument.projectId) {
            const projectName = updatedDocument.name || `PO-${id.substring(0, 8)}`;
            const newProject = await this.prisma.project.create({
              data: {
                name: projectName,
                organizationId,
                customerPoNumber: updatedDocument.name || null,
              },
              select: { id: true, name: true },
            });
            await this.prisma.document.update({
              where: { id },
              data: { projectId: newProject.id },
            });
            console.log(`✅ PO→PROJECT: created project ${newProject.id} ("${newProject.name}") and linked it to PO ${id}`);
          }
        } catch (err) {
          console.error('❌ PO→PROJECT: failed to auto-create project from PO', err);
          // Best-effort: don't fail the PO confirmation if project creation fails.
        }
      }

      // ---- Auto-create Order from confirmed quotation (gated by flag) ----
      // When a quotation flips to confirmed and enableConfirmQuotation is on,
      // spawn an Order so users can later spin off POs / DOs / Invoices for
      // selected items without having to use the immediate-convert popup.
      const isQuotationType =
        dto.type === 'QUOTATION' ||
        dto.type === 'QO' ||
        dto.type === 'QO1' ||
        dto.type === 'QO2' ||
        dto.type === 'QT';
      if (becomingConfirmed && isQuotationType) {
        try {
          const uiConfig = await this.prisma.organizationUIConfig.findUnique({
            where: { organizationId },
            select: { features: true },
          });
          const features = (uiConfig?.features as any) || {};
          if (features.enableConfirmQuotation) {
            const order = await this.ordersService.createFromQuotation(id, organizationId);
            console.log(`✅ QUOTATION→ORDER: created order ${order.orderNumber} (${order.id})`);
          }
        } catch (err) {
          console.error('❌ QUOTATION→ORDER: failed to auto-create order', err);
          // Best-effort: don't fail the quotation confirmation if order creation fails.
        }
      }

      // ---- GL auto-post for non-invoice transactional types ----
      // Credit Note / Debit Note / Purchase Order / Purchase Return — when status flips to "confirmed".
      const GL_TYPES: Record<string, 'CREDIT_NOTE' | 'DEBIT_NOTE' | 'PURCHASE_ORDER' | 'PURCHASE_RETURN'> = {
        CN: 'CREDIT_NOTE',
        CREDIT_NOTE: 'CREDIT_NOTE',
        DN: 'DEBIT_NOTE',
        DEBIT_NOTE: 'DEBIT_NOTE',
        PO: 'PURCHASE_ORDER',
        PURCHASE_ORDER: 'PURCHASE_ORDER',
        PR: 'PURCHASE_RETURN',
        PURCHASE_RETURN: 'PURCHASE_RETURN',
      };
      const glType = GL_TYPES[dto.type as keyof typeof GL_TYPES];
      if (becomingConfirmed && glType) {
        console.log('📒 [GL auto-post] entering for', dto.type, '→', glType);
        try {
          const existing = await this.journalAutoPost.alreadyPostedForDocument(organizationId, id, glType);
          if (existing) {
            console.log('📒 [GL auto-post] entry already exists — skipping', existing);
          } else {
            const cfg: any = configAsPlainObject || existingDocument.config;
            const items = cfg?.items || [];
            const partyName = cfg?.customer?.name || cfg?.customerName || cfg?.supplier?.name || cfg?.supplierName;

            const explicitNet = parseFloat(cfg?.subTotal ?? cfg?.summary?.subTotal ?? 'NaN');
            const explicitTax = parseFloat(cfg?.gstAmount ?? cfg?.summary?.taxAmount ?? cfg?.tax?.amount ?? 'NaN');
            const explicitGross = parseFloat(cfg?.nettTotal ?? cfg?.summary?.grandTotal ?? 'NaN');

            const fallbackNet = items.reduce((sum: number, item: any) => {
              const amt = parseFloat(item.amount) || (parseFloat(item.quantity) * parseFloat(item.unitPrice)) || 0;
              return sum + amt;
            }, 0);
            const org = await this.prisma.organization.findUnique({ where: { id: organizationId }, select: { taxRate: true } });
            const orgRate = (org?.taxRate ?? 0) / 100;

            const netAmount = !Number.isNaN(explicitNet) ? explicitNet : fallbackNet;
            const taxAmount = !Number.isNaN(explicitTax) ? explicitTax : netAmount * orgRate;
            const grossAmount = !Number.isNaN(explicitGross) ? explicitGross : netAmount + taxAmount;

            console.log('📒 [GL auto-post] computed', { docId: id, type: glType, partyName, netAmount, taxAmount, grossAmount });

            const baseArgs = {
              organizationId,
              documentId: id,
              documentNumber: updatedDocument.name || cfg?.documentNumber,
              entryDate: cfg?.date ? new Date(cfg.date) : new Date(),
              netAmount,
              taxAmount,
              grossAmount,
            };

            let entry: any = null;
            if (glType === 'CREDIT_NOTE') {
              entry = await this.journalAutoPost.postFromCreditNote({ ...baseArgs, customerName: partyName });
            } else if (glType === 'DEBIT_NOTE') {
              entry = await this.journalAutoPost.postFromDebitNote({ ...baseArgs, customerName: partyName });
            } else if (glType === 'PURCHASE_ORDER') {
              entry = await this.journalAutoPost.postFromPurchaseOrder({ ...baseArgs, supplierName: partyName });
            } else if (glType === 'PURCHASE_RETURN') {
              entry = await this.journalAutoPost.postFromPurchaseReturn({ ...baseArgs, supplierName: partyName });
            }

            if (entry) {
              console.log('✅ [GL auto-post] entry created', { journalNumber: entry.journalNumber, totalDebit: entry.totalDebit, totalCredit: entry.totalCredit });
            } else {
              console.warn('⚠️ [GL auto-post] post* returned null — see service warnings above');
            }
          }
        } catch (error) {
          console.error('❌ [GL auto-post] failed for', dto.type, id, error);
        }
      }

      // REMOVED (2026-07-10): legacy block that wrote config.deliveryTo into
      // project.siteOfficeId on every save of a project-linked doc. deliveryTo
      // stopped being a site-office ID long ago — it's a free-text address —
      // so this crashed with a Postgres uuid error the moment a project-linked
      // DO had a Deliver-to filled (and would have silently corrupted the
      // project's site office for UUID-shaped text). Projects manage their own
      // siteOfficeId/startDate via the projects module.

      // If config.items exists and is an array, handle inventory/timeline logic (for DO, RDO, etc.)
      // Exclude invoice types (TI, TI2, INVOICE), quotations (QO1, QUOTATION, QT, QO), service reports (MSR), and Purchase Orders (PO) from inventory status validation
      // Note: PO is handled separately above with receivedQty logic
      const documentTypesExcludedFromInventory = ['QO1', 'QUOTATION', 'QT', 'QO', 'MSR', 'TI', 'TI2', 'INVOICE', 'PO', 'PURCHASE_ORDER'];
      if (!documentTypesExcludedFromInventory.includes(dto.type) && dto.config && Array.isArray(dto.config.items)) {
        // Validate that all items have inventoryItemId
        const itemsWithoutInventory = dto.config.items.filter(
          (_item) => !_item.inventoryItemId || _item.inventoryItemId.trim() === ''
        );

        if (itemsWithoutInventory.length > 0) {
          throw new HttpException(
            'Please select inventory items for all rows before saving the document',
            HttpStatus.BAD_REQUEST
          );
        }

        await Promise.all(
          dto.config.items.map(async (_item) => {

            // Determine inventory status based on document type (not document status)
            let docMessage = '';
            let statusChangeMessage = '';
            const newStatus: InventoryStatus = dto.type === 'DO' ? InventoryStatus.rental : dto.type === 'RDO' ? InventoryStatus.instock : undefined;

            if (dto.type === 'DO') {
              if (dto.status) {
                // Include status information in the message
                const statusText =
                  dto.status === 'delivered_not_installed' ? 'delivered (not installed)' : dto.status === 'delivered_installed' ? 'delivered and installed' : dto.status.replace(/_/g, ' ');
                docMessage = `A DO document is submitted as ${statusText}`;
              } else {
                docMessage = 'A DO document is updated';
              }
              statusChangeMessage = 'Item has been changed from instock to rental';
            } else if (dto.type === 'RDO') {
              docMessage = 'A RDO document is updated';
              statusChangeMessage = 'Item has been changed from rental to instock';
            } else {
              docMessage = `A ${dto.type} document is updated`;
            }

            // Try to update inventory status - first check if item exists in Inventory table
            const inventoryItem = await this.prisma.inventory.findUnique({
              where: { id: _item.inventoryItemId },
            });

            if (inventoryItem) {
              // Item is in Inventory table (Asset Tracking ON)
              await this.prisma.inventory.update({
                where: {
                  id: _item.inventoryItemId,
                  organizationId,
                },
                data: {
                  status: newStatus,
                },
              });

              // Create timeline item for document update
              await this.prisma.timelineItem.create({
                data: {
                  message: docMessage,
                  pdfUrl: '',
                  inventoryId: _item.inventoryItemId,
                  documentId: id,
                },
              });
              // Create timeline item for status change
              await this.prisma.timelineItem.create({
                data: {
                  message: statusChangeMessage,
                  inventoryId: _item.inventoryItemId,
                  documentId: null,
                  pdfUrl: null,
                },
              });
            } else {
              // Item might be in Asset table (Asset Tracking OFF / Products mode)
              // In this mode, we don't track rental status on assets, just skip the status update
              // Timeline entries are not applicable for assets in this context
              console.log(`Item ${_item.inventoryItemId} not found in Inventory table, skipping status update (likely Asset/Product)`);
            }
          }),
        );
      }

      if (projectId && dto.config?.items?.length) {
        // Validate that all PHYSICAL items have inventoryItemId for project
        // assignments — service rows have no unit to assign and are skipped.
        const itemsWithoutInventory = dto.config.items.filter(
          (_item) => !_item.isService && (!_item.inventoryItemId || _item.inventoryItemId.trim() === '')
        );

        if (itemsWithoutInventory.length > 0) {
          throw new HttpException(
            'Please select inventory items for all rows before saving the document',
            HttpStatus.BAD_REQUEST
          );
        }

        await Promise.all(
          dto.config.items.map(async (_item) => {
            if (_item.isService || !_item.inventoryItemId) return;

            // config.items[].inventoryItemId can hold EITHER an Inventory id
            // (serialized unit, Mode A) OR an Asset id (Asset-Tracking-OFF /
            // Products mode, Mode B) — resolve which before creating, else the
            // Assignment_inventoryId_fkey constraint blows up the whole save.
            const inventoryRow = await this.prisma.inventory.findUnique({
              where: { id: _item.inventoryItemId },
              select: { id: true },
            });
            const assetRow = inventoryRow
              ? null
              : await this.prisma.asset.findUnique({
                  where: { id: _item.inventoryItemId },
                  select: { id: true },
                });

            if (!inventoryRow && !assetRow) {
              console.log(
                `Item ${_item.inventoryItemId} not found in Inventory or Asset table, skipping project assignment`,
              );
              return;
            }

            const assignmentWhere: any = { projectId: projectId };
            if (inventoryRow) {
              assignmentWhere.inventoryId = _item.inventoryItemId;
            } else {
              assignmentWhere.assetId = _item.inventoryItemId;
            }

            const existingAssignment = await this.prisma.assignment.findFirst({
              where: assignmentWhere,
            });

            if (!existingAssignment) {
              const assignmentData: any = {
                projectId: projectId,
                startDate: dto.config.startDate || null,
                endDate: dto.config.endDate || null,
              };
              if (inventoryRow) {
                assignmentData.inventoryId = _item.inventoryItemId;
              } else {
                // Asset-mode assignments carry the quantity (no serial per unit)
                assignmentData.assetId = _item.inventoryItemId;
                assignmentData.quantity = Number(_item.quantity) || 1;
                assignmentData.documentId = updatedDocument.id;
              }
              await this.prisma.assignment.create({ data: assignmentData });
            } else if (existingAssignment.endDate) {
              // The unit was soft-closed on this project (e.g. moved off via
              // field-deploy) and is now re-added by this DO. Reopen it —
              // consistent with field-deploy — instead of leaving it closed.
              // ONLY soft-closed rows are touched; an already-active assignment
              // is left exactly as before (the prior no-op skip).
              await this.prisma.assignment.update({
                where: { id: existingAssignment.id },
                data: { endDate: null, startDate: dto.config.startDate || null },
              });
            }
          }),
        );
      }

      // Update Xero invoice if this is a TI (Invoice) document
      if (dto.type === 'TI') {
        console.log('🟡 XERO: Attempting to update invoice for TI document:', updatedDocument.id, 'with status:', dto.status);
        try {
          const xeroResult = await this.updateXeroInvoice(updatedDocument, configAsPlainObject, organizationId);
          console.log('🟢 XERO: Invoice updated successfully!', xeroResult ? `Xero Invoice ID: ${xeroResult.invoiceID}` : 'No invoice ID returned');
        } catch (xeroError) {
          console.error('🔴 XERO: Invoice update failed, but document was updated:', xeroError);
          console.error('🔴 XERO: Error details:', xeroError.message);
          // Don't fail the entire update if Xero fails - just log the error
        }
      } else {
        console.log('⚪ XERO: Skipping invoice update - Document type:', dto.type, 'Status:', dto.status);
      }

      // ── History: diff tracked header fields → one "Edited" entry per save
      // (diff-gated, so autosaves that change nothing log nothing). Status
      // transitions log as Approved / Status changed instead.
      try {
        const oldCfg: any = (existingDocument.config as any) || {};
        const newCfg: any = configAsPlainObject || {};
        const oldInfo: any = oldCfg.documentInfo || {};
        const newInfo: any = newCfg.documentInfo || {};
        const changes: string[] = [];
        const track = (label: string, oldVal: any, newVal: any) => {
          const a = oldVal ?? '';
          const b = newVal ?? '';
          if (String(a) !== String(b)) changes.push(`${label} changed from "${a}" to "${b}"`);
        };
        if (configAsPlainObject) {
          track('Document number', oldInfo.documentNumber, newInfo.documentNumber);
          track('Reference', oldInfo.referenceNo, newInfo.referenceNo);
          track('Terms', oldInfo.paymentTerms, newInfo.paymentTerms);
          // Dates compared day-precision: create seeds ISO timestamps while the
          // form round-trips yyyy-mm-dd — full-string compare would log a fake
          // change on the first save.
          const day = (v: any) => (v ? String(v).slice(0, 10) : '');
          if (day(oldInfo.date) !== day(newInfo.date)) {
            changes.push(`Date changed from "${day(oldInfo.date)}" to "${day(newInfo.date)}"`);
          }
          const oldTotal = Number(oldInfo.nettTotal ?? 0);
          const newTotal = Number(newInfo.nettTotal ?? 0);
          if (oldTotal.toFixed(2) !== newTotal.toFixed(2)) {
            changes.push(`Total changed from ${oldTotal.toFixed(2)} to ${newTotal.toFixed(2)}`);
          }
          track('Customer', oldCfg?.customer?.name, newCfg?.customer?.name);
        }
        const statusChanged = dto.status && dto.status !== existingDocument.status;
        if (statusChanged || changes.length) {
          // Cap entry size — AuditService drops oversized details wholesale.
          const capped = changes.slice(0, 6).map((c) => (c.length > 220 ? `${c.slice(0, 220)}…` : c));
          const docName =
            newInfo.documentNumber || updatedDocument.name || existingDocument.name || updatedDocument.id;
          const effectiveActor: DocumentActor = {
            id: actor?.id,
            name: actor?.name || (dto as any).savedBy || undefined,
            email: actor?.email,
          };
          void this.logDocumentEvent({
            documentId: updatedDocument.id,
            organizationId,
            action: statusChanged ? (dto.status === 'confirmed' ? 'APPROVED' : 'STATUS_CHANGED') : 'EDITED',
            detail: statusChanged
              ? `${docName} status changed from ${existingDocument.status} to ${dto.status}`
              : capped.join('; '),
            documentName: docName,
            actor: effectiveActor,
            changes: capped.length ? capped : undefined,
          });
        }
      } catch (historyError) {
        console.error('Document history logging failed (save unaffected):', historyError);
      }

      // Sync DocumentItem junction table for efficient item queries
      await this.syncDocumentItems(updatedDocument.id, configAsPlainObject || existingDocument.config, organizationId);

      return updatedDocument;
    } catch (error) {
      throw new HttpException(`Update failed: ${error.message}`, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  /**
   * Attach, move, or detach a quotation or delivery-order document's Project link.
   * - projectId = "<uuid>" : link / re-link (overwrite if already linked).
   * - projectId = null     : unlink (set Document.projectId to null).
   */
  async linkProjectToDocument(
    documentId: string,
    projectId: string | null,
    organizationId: string,
    actor?: DocumentActor,
  ) {
    const doc = await this.prisma.document.findFirst({
      where: { id: documentId, organizationId },
      select: { id: true, name: true, type: true, projectId: true },
    });
    if (!doc) throw new HttpException('Document not found', HttpStatus.NOT_FOUND);
    // DO rows are stored as type 'DO'; some paths also use 'DELIVERY_ORDER'
    // (see the project page DO filter), so accept both.
    if (!['QUOTATION', 'DO', 'DELIVERY_ORDER'].includes(doc.type)) {
      throw new HttpException(
        `Only quotations and delivery orders can be linked to a project (got "${doc.type}")`,
        HttpStatus.BAD_REQUEST,
      );
    }
    let projectName: string | null = null;
    if (projectId !== null) {
      const project = await this.prisma.project.findFirst({
        where: { id: projectId, organizationId },
        select: { id: true, name: true },
      });
      if (!project) throw new HttpException('Project not found', HttpStatus.NOT_FOUND);
      projectName = project.name;
    }

    const updated = await this.prisma.document.update({
      where: { id: documentId },
      data: { projectId },
      select: { id: true, name: true, type: true, status: true, projectId: true, createdAt: true, updatedAt: true },
    });

    // Only log actual link changes (the editor re-sends the same link on save).
    if (doc.projectId !== projectId) {
      void this.logDocumentEvent({
        documentId,
        organizationId,
        action: 'EDITED',
        detail: projectId ? `Linked to project "${projectName}"` : 'Unlinked from project',
        documentName: updated.name || undefined,
        actor,
      });
    }

    return updated;
  }

  async deleteDocument(id: string, organizationId: string, actor?: DocumentActor) {
    try {
      // Transaction sub-ledger retired — nothing to clean up there. (Payments
      // referencing this document are handled by their own FK/flow.)
      try {
        // no-op
      } catch (error) {
        console.error('Failed during document pre-delete cleanup:', error);
        // Continue with document deletion even if cleanup fails
      }

      // Delete the document
      const deleted = await this.prisma.document.delete({
        where: {
          id,
          organizationId, // Ensure user can only delete documents in their organization
        },
      });

      // History rows outlive the document (AuditLog has no FK to Document).
      void this.logDocumentEvent({
        documentId: id,
        organizationId,
        action: 'DELETED',
        detail: `${deleted.name || id} deleted`,
        documentName: deleted.name || undefined,
        actor,
      });

      // If this document held the LAST serial its number-format handed out
      // (typical for the editor's auto-delete of untouched drafts), roll the
      // counter back so the next document reuses the number.
      try {
        const released = await this.documentNumbering.releaseNumberIfLatest(
          organizationId,
          deleted.type,
          deleted.name,
        );
        if (released) {
          console.log(`[numbering] released serial of deleted document ${deleted.name}`);
        }
      } catch (e: any) {
        console.warn('[numbering] serial release failed (delete unaffected):', e?.message);
      }

      return deleted;
    } catch (error) {
      throw new HttpException(`Delete failed: ${error.message}`, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async createDocumentWithTimeline(dto: CreateDocumentWithTimelineDto, organizationId: string) {
    return this.prisma.$transaction(async (tx) => {
      try {
        const configAsPlainObject: any = dto.config ? dto.config : null;

        // Handle captured images - ensure they are stored as URLs
        if (configAsPlainObject?.capturedImages && Array.isArray(configAsPlainObject.capturedImages)) {
          // The capturedImages should already be S3 URLs from the frontend
          // Just ensure they are properly stored in the config
          console.log('Captured images to be stored:', configAsPlainObject.capturedImages);
        }

        // Handle MSR photos - ensure they are stored as URLs
        if (configAsPlainObject?.photos && Array.isArray(configAsPlainObject.photos)) {
          // The photos should already be S3 URLs from the frontend
          // Just ensure they are properly stored in the config
          console.log('MSR photos to be stored:', configAsPlainObject.photos.length, 'photos');
        }

        const createdDocument = await tx.document.create({
          data: {
            documentTemplateId: dto.documentTemplateId,
            type: dto.type || 'Default',
            config: configAsPlainObject,
            organizationId, // Automatically assign to user's organization
            name: dto.name, // Include document name if provided
          },
        });

        // Only process items for non-MSR documents
        if (dto.config.items && Array.isArray(dto.config.items) && dto.type !== 'MSR') {
          // Validate that all items have inventoryItemId (except for QO1)
          if (dto.type !== 'QO1') {
            const itemsWithoutInventory = dto.config.items.filter(
              (_item: any) => !_item.inventoryItemId || _item.inventoryItemId.trim() === ''
            );

            if (itemsWithoutInventory.length > 0) {
              throw new HttpException(
                'Please select inventory items for all rows before saving the document',
                HttpStatus.BAD_REQUEST
              );
            }
          }

          await Promise.all(
            dto.config.items.map(async (_item) => {
              // Determine new inventory status and timeline messages based on document type
              let newStatus: InventoryStatus = InventoryStatus.instock;
              let docMessage = 'A RDO document is submitted';
              let statusChangeMessage = 'Item has been changed from rental to instock';
              console.log('Document Type:', JSON.stringify(dto.type, null, 2));
              if (dto.type === 'DO') {
                newStatus = InventoryStatus.rental;
                docMessage = 'A DO document is submitted';
                statusChangeMessage = 'Item has been changed from instock to rental';
              }

              // Update inventory status
              await tx.inventory.update({
                where: {
                  id: _item.inventoryItemId,
                  organizationId, // Ensure inventory belongs to the same organization
                },
                data: {
                  status: newStatus,
                },
              });
              // No need to connect inventory anymore as it's stored in config
              // Create timeline item for document submission
              await tx.timelineItem.create({
                data: {
                  message: docMessage,
                  pdfUrl: '',
                  inventoryId: _item.inventoryItemId,
                  documentId: createdDocument.id,
                },
              });

              // Create timeline item for status change
              await tx.timelineItem.create({
                data: {
                  message: statusChangeMessage,
                  inventoryId: _item.inventoryItemId,
                  documentId: null,
                  pdfUrl: null,
                },
              });
            }),
          );
        }

        // Create Xero invoice if this is a TI (Invoice) document and status is not draft
        if (dto.type === 'TI' && dto.status !== 'draft') {
          console.log('🟡 XERO: Attempting to create invoice for TI document:', createdDocument.id, 'with status:', dto.status);
          try {
            const xeroResult = await this.createXeroInvoice(createdDocument, configAsPlainObject, organizationId);
            console.log('🟢 XERO: Invoice created successfully!', xeroResult ? `Xero Invoice ID: ${xeroResult.invoiceID}` : 'No invoice ID returned');
          } catch (xeroError) {
            console.error('🔴 XERO: Invoice creation failed, but document was created:', xeroError);
            console.error('🔴 XERO: Error details:', xeroError.message);
            // Don't fail the entire transaction if Xero fails - just log the error
          }
        } else {
          console.log('⚪ XERO: Skipping invoice creation - Document type:', dto.type, 'Status:', dto.status);
        }

        return createdDocument;
      } catch (error) {
        throw new HttpException(`Update failed: ${error.message}`, HttpStatus.INTERNAL_SERVER_ERROR);
      }
    }).then(async (createdDocument) => {
      // Sync DocumentItem junction table after transaction completes
      await this.syncDocumentItems(createdDocument.id, dto.config, organizationId);
      return createdDocument;
    });
  }
  async createBasicDocument(
    documentTemplateId: string,
    type: string,
    organizationId: string,
    config: any = {},
    projectId?: string,
    actor?: DocumentActor,
  ) {
    try {
      console.log('Creating basic document with template ID:', documentTemplateId, 'Type:', type, 'Organization ID:', organizationId, 'Config:', config, 'ProjectId:', projectId);

      // If projectId is supplied, validate it belongs to this org and prefill
      // customer info into the config when the caller didn't pass one. Empty-
      // field-only fill so explicit customer choices in the config are never
      // overwritten.
      let resolvedProject: { id: string; customer: any } | null = null;
      if (projectId) {
        const project = await this.prisma.project.findFirst({
          where: { id: projectId, organizationId },
          select: {
            id: true,
            customer: { select: { id: true, name: true, customerCode: true, email: true, phone: true, address: true, gstRegNo: true } },
          },
        });
        if (!project) {
          throw new HttpException('Project not found in this organization', HttpStatus.NOT_FOUND);
        }
        resolvedProject = project;
      }

      // Get organization to check for custom document types and defaults (logo, stamp)
      const organization = await this.prisma.organization.findUnique({
        where: { id: organizationId },
        select: {
          customDocumentTypes: true,
          logo: true,
          defaultStamp: true,
          // Org-wide tax + currency defaults seeded onto documentInfo on new docs.
          taxRate: true,
          taxApplicable: true,
          absorbTax: true,
          defaultCurrency: true,
          // Per-doc-type boilerplate (T&Cs / Notes / Footer message).
          docTypeDefaults: true,
        },
      });

      // Get document template to use templateVariant for naming + inherit
      // column layout (tableColumnOrder/columnLabels) so per-template item
      // table layouts (e.g. FCU/CU Quotation) take effect on new docs.
      const documentTemplate = await this.prisma.documentTemplate.findUnique({
        where: { id: documentTemplateId },
        select: { templateVariant: true, config: true },
      });

      const now = new Date();
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, '0');

      // Use templateVariant for document name prefix (e.g., "SO" instead of "SALES_ORDER")
      // Falls back to custom document types, then to the original type
      const customTypes = organization?.customDocumentTypes as Record<string, string> | null;
      const documentPrefix = documentTemplate?.templateVariant || customTypes?.[type] || type;
      const namePrefix = `${documentPrefix}${year}${month}-`;

      // Find the highest serial number for this prefix to avoid duplicates
      // Exclude revision documents (names containing "Rev-") so they don't interfere with serial lookup
      const existingDocs = await this.prisma.document.findMany({
        where: {
          organizationId,
          documentTemplateId,
          name: {
            startsWith: namePrefix,
          },
          baseDocumentId: null,
        },
        select: { name: true },
        orderBy: { name: 'desc' },
        take: 1,
      });

      let nextSerial = 1;
      if (existingDocs.length > 0) {
        // Extract the serial number from the last document name
        const lastDocName = existingDocs[0].name;
        const match = lastDocName.match(/-(\d+)$/);
        if (match) {
          nextSerial = parseInt(match[1], 10) + 1;
        }
      }

      const serial = String(nextSerial).padStart(3, '0');
      let name = `${namePrefix}${serial}`;

      // Customisable per-type numbering (DocumentNumberFormat variants). When the
      // org has a format for this type — or the create picker passed a chosen
      // variant id in config.numberFormatId — it overrides the legacy scheme and
      // claims that variant's own serial. Falls back to `name` above otherwise.
      try {
        const numberFormatId = (config as any)?.numberFormatId ?? null;
        const custom = await this.documentNumbering.generateNumber(organizationId, type, numberFormatId, now);
        if (custom) name = custom;
      } catch (e: any) {
        console.warn('[numbering] custom format failed, using legacy name:', e?.message);
      }

      // Seed initial config with organization defaults so they persist even if user doesn't save the form
      const initialConfig: any = config && typeof config === 'object' ? { ...config } : {};
      if (!initialConfig.logo && organization?.logo) {
        initialConfig.logo = organization.logo;
      }
      // support stamp.company convention across templates
      if (!initialConfig.stamp) {
        initialConfig.stamp = {};
      }
      if (!initialConfig.stamp.company && organization?.defaultStamp) {
        initialConfig.stamp.company = organization.defaultStamp;
      }
      // Inherit the template's column layout so per-template variants
      // (e.g. FCU/CU Quotation) render with their custom columns on new docs.
      const templateConfig: any = (documentTemplate?.config as any) || {};
      if (!initialConfig.tableColumnOrder && Array.isArray(templateConfig.tableColumnOrder)) {
        initialConfig.tableColumnOrder = templateConfig.tableColumnOrder;
      }
      if (!initialConfig.columnLabels && templateConfig.columnLabels && typeof templateConfig.columnLabels === 'object') {
        initialConfig.columnLabels = templateConfig.columnLabels;
      }

      // Seed the tax block from the org's defaults (Company Profile page →
      // taxApplicable / taxRate / absorbTax). Only fill when the caller didn't
      // already supply a value, so explicit per-doc overrides still win.
      const orgTaxApplicable = (organization as any)?.taxApplicable;
      const orgAbsorbTax = (organization as any)?.absorbTax;
      const orgTaxRate = organization?.taxRate;
      if (!initialConfig.documentInfo || typeof initialConfig.documentInfo !== 'object') {
        initialConfig.documentInfo = {};
      }
      const di = initialConfig.documentInfo;
      // The Tax / Absorb Tax fields render as Y/N selects in the form so we
      // store the string variant — booleans would render as empty.
      if (di.taxApplicable === undefined && orgTaxApplicable !== undefined && orgTaxApplicable !== null) {
        di.taxApplicable = orgTaxApplicable ? 'Y' : 'N';
      }
      if (di.absorbTax === undefined && orgAbsorbTax !== undefined && orgAbsorbTax !== null) {
        di.absorbTax = orgAbsorbTax ? 'Y' : 'N';
      }
      if ((di.gstPercent === undefined || di.gstPercent === null || di.gstPercent === 0) && orgTaxRate != null) {
        di.gstPercent = Number(orgTaxRate);
      }
      const orgCurrency = (organization as any)?.defaultCurrency;
      if (!di.currency && orgCurrency) {
        di.currency = orgCurrency;
      }
      // Some templates read formData.currency at the top level too — seed it
      // in case the form expects it there.
      if (!initialConfig.currency && orgCurrency) {
        initialConfig.currency = orgCurrency;
      }

      // Per-doc-type boilerplate: T&Cs / Notes / Footer message. Looked up
      // by the doc's `type` against organization.docTypeDefaults. Per-doc
      // overrides still win — these only fill empty fields.
      const docTypeDefaults: any = (organization as any)?.docTypeDefaults || {};
      const typeDefaults = (docTypeDefaults && typeof docTypeDefaults === 'object' && docTypeDefaults[type]) || null;
      if (typeDefaults) {
        if (!di.termsAndConditions && typeof typeDefaults.tnc === 'string' && typeDefaults.tnc.trim()) {
          di.termsAndConditions = typeDefaults.tnc;
        }
        if (!di.note && typeof typeDefaults.notes === 'string' && typeDefaults.notes.trim()) {
          di.note = typeDefaults.notes;
        }
        if (!di.footerMessage && typeof typeDefaults.footerMessage === 'string' && typeDefaults.footerMessage.trim()) {
          di.footerMessage = typeDefaults.footerMessage;
        }
      }
      // Prefill customer info from the project when projectId is supplied and
      // the caller didn't already populate it. Generic across document types.
      if (resolvedProject?.customer) {
        if (!initialConfig.customerId) initialConfig.customerId = resolvedProject.customer.id;
        if (!initialConfig.customer) initialConfig.customer = resolvedProject.customer;
      }

      // Honour a user-supplied document number at creation time too — the
      // editable "Purchase Order No." (or any doc's number field) should
      // immediately become the document's name. Falls back to the
      // auto-generated serial when no custom value was passed.
      const initialDocNumber =
        (initialConfig as any)?.documentNumber ?? (initialConfig as any)?.documentInfo?.documentNumber;
      const initialName =
        typeof initialDocNumber === 'string' && initialDocNumber.trim()
          ? initialDocNumber.trim()
          : name;

      const newDocument = await this.prisma.document.create({
        data: {
          documentTemplateId,
          type,
          config: initialConfig,
          organizationId,
          name: initialName,
          revisionNumber: 0,
          projectId: projectId || undefined,
        },
      });

      // Sync DocumentItem junction table (in case config has items)
      await this.syncDocumentItems(newDocument.id, initialConfig, organizationId);

      void this.logDocumentEvent({
        documentId: newDocument.id,
        organizationId,
        action: 'CREATED',
        detail: `${initialName} created`,
        documentName: initialName,
        actor,
      });

      return newDocument;
    } catch (error) {
      throw new HttpException(`Basic document creation failed: ${error.message}`, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  /**
   * Create a draft document from extracted (AI-parsed) data.
   * - Fuzzy-matches customer by name (case-insensitive contains, unique match wins).
   * - Looks up an existing PO whose name == extracted poNumber; if found, the new
   *   draft inherits that PO's projectId so it lands inside the PO-as-project.
   * - Falls back to the type's default DocumentTemplate when no templateId is given.
   * Returns { id, templateId, type, matched: { customerId, projectId, poDocumentId } }.
   */
  // OSI-13: resolve extracted DELIVERY_ORDER line items to real inventory units.
  //  • AUTO-ASSIGN only on an EXACT serial match to a SINGLE in-stock unit in
  //    this org → emits one config line per matched unit (quantity 1) with
  //    inventoryItemId set, so the EXISTING syncDocumentItems materialises a
  //    deliverable DocumentItem row (no change to that path). syncDocumentItems
  //    is one-unit-per-line, so a multi-serial extracted line is SPLIT into
  //    per-unit lines here.
  //  • SUGGEST (never auto-assign) for the remainder: in-stock units of an asset
  //    whose name matches the description, attached as suggestedInventoryIds for
  //    the editor's quick-pick — inventoryItemId is left UNSET (non-deliverable
  //    until a human confirms). SKU/description NEVER auto-assign.
  //  • Strictly org-scoped; nothing cross-org.
  private async matchExtractedItemsToInventory(
    extractedItems: any[],
    organizationId: string,
  ): Promise<{
    items: any[];
    summary: { matched: number; suggested: number; unmatched: number };
  }> {
    const out: any[] = [];
    let matched = 0;
    let suggested = 0;
    let unmatched = 0;
    let lineId = 0;

    for (const it of Array.isArray(extractedItems) ? extractedItems : []) {
      const description: string = (it?.description ?? '').toString();
      const uom = it?.unit || undefined;
      const tax =
        typeof it?.tax === 'number' ? it.tax : parseFloat(it?.tax) || undefined;
      const qty =
        typeof it?.quantity === 'number' ? it.quantity : parseFloat(it?.quantity) || 0;
      const unitPrice =
        typeof it?.unitPrice === 'number' ? it.unitPrice : parseFloat(it?.unitPrice) || 0;
      const amount =
        typeof it?.amount === 'number' ? it.amount : parseFloat(it?.amount) || 0;
      const perUnit = unitPrice || (qty > 0 ? amount / qty : 0);
      const serials: string[] = Array.isArray(it?.serialNumbers)
        ? it.serialNumbers.map((s: any) => String(s ?? '').trim()).filter(Boolean)
        : [];

      // 1) Exact serial → SINGLE in-stock unit ⇒ auto-assign (one line per unit).
      const matchedUnitIds = new Set<string>();
      const unmatchedSerials: string[] = [];
      for (const serial of serials) {
        const units = await this.prisma.inventory.findMany({
          where: {
            organizationId,
            serialNumber: serial,
            status: InventoryStatus.instock,
          },
          select: { id: true },
          take: 2, // stop at 2 to reject ambiguous serials
        });
        if (units.length === 1 && !matchedUnitIds.has(units[0].id)) {
          matchedUnitIds.add(units[0].id);
          out.push({
            id: ++lineId,
            description,
            quantity: 1,
            unitPrice: perUnit,
            amount: perUnit,
            uom,
            tax,
            serialNumber: serial,
            inventoryItemId: units[0].id, // ⇒ syncDocumentItems makes a real row
          });
          matched++;
        } else {
          unmatchedSerials.push(serial);
        }
      }

      // 2) Remaining quantity ⇒ ONE non-deliverable line (no inventoryItemId) +
      //    description-based suggestions for the editor.
      const matchedCount = matchedUnitIds.size;
      const leftover =
        matchedCount === 0
          ? qty > 0
            ? qty
            : 1
          : Math.max(0, (qty || matchedCount) - matchedCount);
      if (leftover > 0) {
        let suggestedInventoryIds: string[] = [];
        if (description.trim()) {
          const assets = await this.prisma.asset.findMany({
            where: {
              organizationId,
              name: { contains: description.trim(), mode: 'insensitive' },
            },
            select: { id: true },
            take: 3,
          });
          if (assets.length) {
            const units = await this.prisma.inventory.findMany({
              where: {
                organizationId,
                assetId: { in: assets.map((a) => a.id) },
                status: InventoryStatus.instock,
              },
              select: { id: true },
              take: 5,
            });
            suggestedInventoryIds = units.map((u) => u.id);
          }
        }
        out.push({
          id: ++lineId,
          description,
          quantity: leftover,
          unitPrice: perUnit,
          amount: perUnit * leftover,
          uom,
          tax,
          ...(unmatchedSerials.length ? { serialNumbers: unmatchedSerials } : {}),
          ...(suggestedInventoryIds.length ? { suggestedInventoryIds } : {}),
        });
        if (suggestedInventoryIds.length) suggested++;
        else unmatched++;
      }
    }

    return { items: out, summary: { matched, suggested, unmatched } };
  }

  async createFromExtraction(
    organizationId: string,
    type: string,
    extracted: any,
    documentTemplateId?: string,
    sourceFileUrl?: string | null,
    // Provenance stamp for config.source.extractedFrom — 'upload' (portal
    // upload button, the default) or 'email' (inbound email ingestion).
    extractedFrom: string = 'upload',
    actor?: DocumentActor,
  ) {
    // Resolve template: explicit > active variant > default > newest.
    // The active/default flags reflect the variant the user normally picks via
    // InvoiceVariantDrawer; without this ordering findFirst can return a legacy
    // variant with a thinner fieldConfig and the upload draft would look sparse.
    let templateId = documentTemplateId;
    if (!templateId) {
      // Multiple templates can be active per org+type; resolve exactly ONE for
      // this headless path: prefer the primary selection, else the isDefault
      // among the selected, else the newest selected. Falls back to the cross-org
      // default (Standard) then the org's own active/default/newest template.
      const selections = await this.prisma.organizationActiveTemplate.findMany({
        where: { organizationId, type },
      });
      if (selections.length > 0) {
        const primary = selections.find((s) => s.isPrimary);
        if (primary) {
          templateId = primary.templateId;
        } else {
          const sel = await this.prisma.documentTemplate.findFirst({
            where: { id: { in: selections.map((s) => s.templateId) } },
            select: { id: true },
            orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
          });
          templateId = sel?.id ?? selections[0].templateId;
        }
      } else {
        // Org's own active template first; seeded cross-org standard only when
        // the org has nothing of its own (keeps this headless path consistent
        // with the create picker's fallback).
        const tmpl =
          (await this.prisma.documentTemplate.findFirst({
            where: { type, organizationId, isActive: true },
            select: { id: true },
            orderBy: [{ createdAt: 'desc' }],
          })) ??
          (await this.prisma.documentTemplate.findFirst({
            where: { OR: [{ type, isDefault: true }, { type, organizationId }] },
            select: { id: true },
            orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
          }));
        if (!tmpl) {
          throw new HttpException(`No document template found for type ${type}`, HttpStatus.NOT_FOUND);
        }
        templateId = tmpl.id;
      }
    }

    // Fuzzy customer match — case-insensitive contains, only auto-link if unique.
    let matchedCustomerId: string | null = null;
    let matchedCustomer:
      | { id: string; name: string; customerCode: string | null; address: string | null; email: string | null }
      | null = null;
    const extractedCustomerName: string | undefined = extracted?.customer?.name?.trim();
    if (extractedCustomerName) {
      const candidates = await this.prisma.customer.findMany({
        where: {
          organizationId,
          name: { contains: extractedCustomerName, mode: 'insensitive' },
        },
        select: { id: true, name: true, customerCode: true, address: true, email: true },
        take: 2,
      });
      if (candidates.length === 1) {
        matchedCustomer = candidates[0];
        matchedCustomerId = candidates[0].id;
      }
    }

    // PO match — exact match on Document.name among PO types.
    let matchedProjectId: string | null = null;
    let matchedPoDocumentId: string | null = null;
    const extractedPoNumber: string | undefined =
      extracted?.references?.poNumber?.trim() || undefined;
    if (extractedPoNumber) {
      const po = await this.prisma.document.findFirst({
        where: {
          organizationId,
          type: { in: ['PO', 'PURCHASE_ORDER'] },
          name: extractedPoNumber,
        },
        select: { id: true, projectId: true },
      });
      if (po) {
        matchedPoDocumentId = po.id;
        matchedProjectId = po.projectId || null;
      }
    }

    // OSI-13: for a DELIVERY_ORDER, auto-match line items to inventory
    // (serial-exact → inventoryItemId; else suggestions). Other document types
    // keep the plain 1:1 mapping so QO/INVOICE behaviour is unchanged.
    const isDeliveryOrder = type === 'DO' || type === 'DELIVERY_ORDER';
    let itemMatchSummary:
      | { matched: number; suggested: number; unmatched: number }
      | null = null;
    let configItems: any[];
    if (isDeliveryOrder) {
      const res = await this.matchExtractedItemsToInventory(
        extracted?.items,
        organizationId,
      );
      configItems = res.items;
      itemMatchSummary = res.summary;
    } else {
      configItems = (Array.isArray(extracted?.items) ? extracted.items : []).map(
        (it: any, idx: number) => ({
          id: idx + 1,
          description: it?.description || '',
          quantity:
            typeof it?.quantity === 'number' ? it.quantity : parseFloat(it?.quantity) || 0,
          unitPrice:
            typeof it?.unitPrice === 'number' ? it.unitPrice : parseFloat(it?.unitPrice) || 0,
          amount: typeof it?.amount === 'number' ? it.amount : parseFloat(it?.amount) || 0,
          uom: it?.unit || undefined,
          tax: typeof it?.tax === 'number' ? it.tax : parseFloat(it?.tax) || undefined,
        }),
      );
    }

    // Map extracted → AIMS document config shape.
    const config: any = {
      customer: {
        id: matchedCustomerId || undefined,
        name: extracted?.customer?.name || undefined,
        address: extracted?.customer?.address || undefined,
        attention: extracted?.customer?.attention || undefined,
      },
      // FLAT customer fields — the editor round-trip contract
      // (documentDataTransformer reads config.customerId/Name/Code/Address/Email;
      // DynamicFormFields renders customerCode). Sourced from the MATCHED customer
      // ROW only; when unmatched we leave them absent so the editor shows blank
      // for the admin to assign.
      ...(matchedCustomer
        ? {
            customerId: matchedCustomer.id,
            customerName: matchedCustomer.name,
            customerCode: matchedCustomer.customerCode || undefined,
            customerAddress: matchedCustomer.address || undefined,
            customerEmail: matchedCustomer.email || undefined,
          }
        : {}),
      documentInfo: {
        documentNumber: extracted?.document?.number || undefined,
        date: extracted?.document?.date || undefined,
        dueDate: extracted?.document?.dueDate || undefined,
        reference: extracted?.document?.reference || undefined,
        // OSI-13 (PART 2): carry the extracted delivery date onto the DO — the
        // preview reads documentInfo.deliveryDate; previously dropped.
        ...(isDeliveryOrder && extracted?.additionalFields?.deliveryDate
          ? { deliveryDate: extracted.additionalFields.deliveryDate }
          : {}),
      },
      // OSI-13 (PART 2): carry the extracted delivery ADDRESS onto the DO — the
      // editor/preview read deliveryAddress.address (an object); previously dropped.
      ...(isDeliveryOrder && extracted?.additionalFields?.deliveryAddress
        ? { deliveryAddress: { address: extracted.additionalFields.deliveryAddress } }
        : {}),
      references: extracted?.references || {},
      items: configItems,
      totals: extracted?.totals || {},
      notes: extracted?.notes || undefined,
      source: {
        extractedFrom,
        fileUrl: sourceFileUrl || undefined,
      },
      sourceFileUrl: sourceFileUrl || undefined,
    };

    // Create the draft via the existing helper so we get document numbering, defaults, etc.
    const created = await this.createBasicDocument(
      templateId,
      type,
      organizationId,
      config,
      undefined,
      actor ?? { name: extractedFrom === 'email' ? 'Email ingestion' : 'AI extraction' },
    );

    // If we matched a project (via PO), link it on the created document.
    if (matchedProjectId) {
      await this.prisma.document.update({
        where: { id: created.id },
        data: { projectId: matchedProjectId },
      });
    }

    return {
      id: created.id,
      templateId,
      type,
      matched: {
        customerId: matchedCustomerId,
        projectId: matchedProjectId,
        poDocumentId: matchedPoDocumentId,
        // OSI-13: item→inventory auto-match summary so the UI can report
        // "N linked, M suggested, K need a unit".
        ...(itemMatchSummary ? { items: itemMatchSummary } : {}),
      },
    };
  }

  async duplicateDocument(documentId: string, organizationId: string, actor?: DocumentActor) {
    try {
      const original = await this.prisma.document.findFirst({
        where: { id: documentId, organizationId },
      });
      if (!original) {
        throw new HttpException('Document not found', HttpStatus.NOT_FOUND);
      }

      // Build a fresh config copy without identity/state fields that should
      // not carry over to a new document.
      const originalConfig = (original.config as any) || {};
      const duplicatedConfig: any = { ...originalConfig };
      // Strip fields tied to the source document's identity/state.
      delete duplicatedConfig.id;
      delete duplicatedConfig.documentNumber;
      if (duplicatedConfig.documentInfo) {
        duplicatedConfig.documentInfo = { ...duplicatedConfig.documentInfo };
        delete duplicatedConfig.documentInfo.documentNumber;
      }
      // The duplicate is always a fresh draft.
      delete duplicatedConfig.savedBy;
      delete duplicatedConfig.savedAt;
      delete duplicatedConfig.confirmedAt;
      delete duplicatedConfig.confirmedBy;

      // Reuse createBasicDocument so we get the standard document-number
      // generation, organization defaults, and item junction sync.
      return await this.createBasicDocument(
        original.documentTemplateId,
        original.type,
        organizationId,
        duplicatedConfig,
        undefined,
        actor,
      );
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new HttpException(
        `Duplicate document failed: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async createRevision(documentId: string, organizationId: string, actor?: DocumentActor) {
    try {
      // Load the original document with its revisions
      const original = await this.prisma.document.findFirst({
        where: { id: documentId, organizationId },
      });
      if (!original) {
        throw new HttpException('Document not found', HttpStatus.NOT_FOUND);
      }

      // Determine baseDocumentId and next revision number
      const baseDocumentId = original.baseDocumentId || original.id;
      // If there is a base document, fetch it to use its clean name (without any appended Rev-x)
      const baseDocument = original.baseDocumentId ? await this.prisma.document.findUnique({ where: { id: baseDocumentId } }) : null;
      const lastRevision = await this.prisma.document.findFirst({
        where: { organizationId, baseDocumentId },
        orderBy: { revisionNumber: 'desc' },
        select: { revisionNumber: true },
      });
      const nextRevisionNumber = (lastRevision?.revisionNumber ?? 0) + 1;

      // Name formatting: ensure we only ever have a single (Rev-X)
      // Prefer the base document's original name when available; otherwise strip any existing Rev-x suffixes
      const rawBaseName = (baseDocument?.name || original.name || `${original.type}-${original.id.slice(0, 6)}`).trim();
      const cleanedBaseName = rawBaseName.replace(/\s*\(Rev-\d+\)/g, '').trim();
      const nameWithRevision = `${cleanedBaseName} (Rev-${nextRevisionNumber})`;

      const created = await this.prisma.document.create({
        data: {
          documentTemplateId: original.documentTemplateId,
          type: original.type,
          config: original.config,
          organizationId: original.organizationId,
          status: 'draft', // Always set revision status to draft
          name: nameWithRevision,
          baseDocumentId,
          revisionNumber: nextRevisionNumber,
        },
      });

      // Sync DocumentItem junction table (copies items from original)
      await this.syncDocumentItems(created.id, original.config, organizationId);

      void this.logDocumentEvent({
        documentId: created.id,
        organizationId,
        action: 'CREATED',
        detail: `${nameWithRevision} created (revision of ${cleanedBaseName})`,
        documentName: nameWithRevision,
        actor,
      });

      return created;
    } catch (error) {
      throw new HttpException(`Create revision failed: ${error.message}`, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async listRevisions(documentId: string, organizationId: string) {
    try {
      const original = await this.prisma.document.findFirst({ where: { id: documentId, organizationId } });
      if (!original) {
        throw new HttpException('Document not found', HttpStatus.NOT_FOUND);
      }
      const baseDocumentId = original.baseDocumentId || original.id;
      const documents = await this.prisma.document.findMany({
        where: { organizationId, baseDocumentId },
        orderBy: { createdAt: 'asc' },
        select: { id: true, name: true, createdAt: true, revisionNumber: true },
      });
      return documents;
    } catch (error) {
      throw new HttpException(`List revisions failed: ${error.message}`, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
  async getAllDocuments(organizationId: string) {
    try {
      const documents = await this.prisma.document.findMany({
        where: {
          organizationId: organizationId,
        },
        orderBy: { createdAt: 'desc' },
      });

      // Fetch customer names if customerId exists in config
      const customerIds = documents
        .map((doc: any) => (doc.config as any)?.customerId)
        .filter(Boolean);

      const uniqueCustomerIds = [...new Set(customerIds)];
      const customers = uniqueCustomerIds.length > 0
        ? await this.prisma.customer.findMany({
            where: { id: { in: uniqueCustomerIds } },
            select: { id: true, name: true },
          })
        : [];

      const customerMap = new Map(customers.map(c => [c.id, c.name]));

      return documents.map((doc: any) => {
        const config = doc.config as any;
        const customerId = config?.customerId;
        const customerName = customerId ? customerMap.get(customerId) : null;

        return {
          id: doc.id,
          name: doc.name,
          associated_item: config?.items?.[0]?.sku ?? 'N/A',
          associated_customer: customerName ?? 'N/A',
          documentType: doc.type,
          templateId: doc.documentTemplateId,
          status: doc.status,
          createdAt: doc.createdAt,
          // Project link — the extract-from-quotation flows carry it onto the
          // new DO/invoice (it lives on the row, not in config).
          projectId: doc.projectId ?? null,
          config: doc.config, // Include config data for due dates and other fields
        };
      });
    } catch (error) {
      throw new HttpException(`Fetch all documents failed: ${error.message}`, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  // Server-side paginated / filtered / sorted document list. ADDITIVE — the
  // legacy getAllDocuments (fetch-all) stays for the editor's prev/next
  // navigation and other consumers. Customer/item live in the `config` JSON;
  // customer is filtered/searched via JSON paths (recent docs store
  // config.customer.id). Sort is limited to real columns (name/createdAt/
  // status/type) since Prisma orderBy can't target JSON paths.
  async getDocumentsPaginated(
    organizationId: string,
    opts: {
      page?: number;
      limit?: number;
      search?: string;
      documentTypes?: string[]; // include ONLY these (variant codes)
      excludeTypes?: string[]; // OR exclude these (Documents page hides invoices)
      status?: string | string[];
      customerId?: string;
      createdOn?: { startDate?: string | Date | null; endDate?: string | Date | null };
      sortBy?: 'name' | 'createdAt' | 'status' | 'type';
      sortDir?: 'asc' | 'desc';
    } = {},
  ) {
    try {
      const page = Math.max(1, opts.page || 1);
      const limit = Math.min(200, Math.max(1, opts.limit || 20));
      const skip = (page - 1) * limit;

      const where: any = { organizationId };
      const and: any[] = [];

      if (opts.documentTypes?.length) where.type = { in: opts.documentTypes };
      else if (opts.excludeTypes?.length) where.type = { notIn: opts.excludeTypes };

      if (opts.status) {
        const s = (Array.isArray(opts.status) ? opts.status : [opts.status]).filter(Boolean);
        if (s.length === 1) where.status = s[0];
        else if (s.length > 1) where.status = { in: s };
      }

      if (opts.customerId) {
        and.push({
          OR: [
            { config: { path: ['customer', 'id'], equals: opts.customerId } },
            { config: { path: ['customerId'], equals: opts.customerId } },
          ],
        });
      }

      if (opts.createdOn?.startDate || opts.createdOn?.endDate) {
        where.createdAt = {};
        if (opts.createdOn.startDate) where.createdAt.gte = new Date(opts.createdOn.startDate);
        if (opts.createdOn.endDate) {
          const end = new Date(opts.createdOn.endDate);
          end.setHours(23, 59, 59, 999);
          where.createdAt.lte = end;
        }
      }

      const term = (opts.search || '').trim();
      if (term) {
        and.push({
          OR: [
            { name: { contains: term, mode: 'insensitive' } },
            { type: { contains: term, mode: 'insensitive' } },
            { config: { path: ['customer', 'name'], string_contains: term } },
          ],
        });
      }

      if (and.length) where.AND = and;

      const sortBy = ['name', 'createdAt', 'status', 'type'].includes(opts.sortBy as string)
        ? (opts.sortBy as string)
        : 'createdAt';
      const sortDir = opts.sortDir === 'asc' ? 'asc' : 'desc';

      const [rows, total] = await Promise.all([
        this.prisma.document.findMany({ where, orderBy: { [sortBy]: sortDir }, skip, take: limit }),
        this.prisma.document.count({ where }),
      ]);

      const customerIds = rows
        .map((d: any) => (d.config as any)?.customer?.id || (d.config as any)?.customerId)
        .filter(Boolean);
      const customers = customerIds.length
        ? await this.prisma.customer.findMany({ where: { id: { in: [...new Set(customerIds)] } }, select: { id: true, name: true } })
        : [];
      const customerMap = new Map(customers.map((c) => [c.id, c.name]));

      const docs = rows.map((doc: any) => {
        const config = doc.config as any;
        const cid = config?.customer?.id || config?.customerId;
        return {
          id: doc.id,
          name: doc.name,
          associated_item: config?.items?.[0]?.sku ?? 'N/A',
          associated_customer: (cid && customerMap.get(cid)) || config?.customer?.name || 'N/A',
          documentType: doc.type,
          templateId: doc.documentTemplateId,
          status: doc.status,
          createdAt: doc.createdAt,
          config: doc.config,
        };
      });

      return { docs, total, page, limit, totalPages: Math.ceil(total / limit) };
    } catch (error) {
      throw new HttpException(`Fetch documents failed: ${error.message}`, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  // Aggregate counts for the list stat cards (total / this-month / drafts),
  // computed server-side so they stay accurate when the list is server-paginated
  // (the paginated query only returns one page). Counts the full type set,
  // independent of the user's search/filter.
  async getDocumentStats(organizationId: string, opts: { documentTypes?: string[] } = {}) {
    try {
      const base: any = { organizationId };
      if (opts.documentTypes?.length) base.type = { in: opts.documentTypes };
      const monthStart = new Date();
      monthStart.setDate(1);
      monthStart.setHours(0, 0, 0, 0);

      const [total, thisMonth, drafts] = await Promise.all([
        this.prisma.document.count({ where: base }),
        this.prisma.document.count({ where: { ...base, createdAt: { gte: monthStart } } }),
        this.prisma.document.count({ where: { ...base, status: 'draft' as any } }),
      ]);
      return { total, thisMonth, drafts };
    } catch (error) {
      throw new HttpException(`Fetch document stats failed: ${error.message}`, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async getDeliveryOrdersByCustomer(customerId: string, organizationId: string) {
    try {
      console.log('🚚 DELIVERY ORDERS: Fetching for customer:', customerId, 'in organization:', organizationId);

      // Get all delivery orders
      const deliveryOrders = await this.prisma.document.findMany({
        where: {
          organizationId: organizationId,
          type: 'DO', // Delivery Order document type
        },
        orderBy: { createdAt: 'desc' },
      });

      // Filter by customerId in config
      const filteredOrders = deliveryOrders.filter((doc: any) => {
        const config = doc.config as any;
        return config?.customerId === customerId;
      });

      console.log('🚚 DELIVERY ORDERS: Found', filteredOrders.length, 'delivery orders for customer');

      // Fetch customer details
      const customer = await this.prisma.customer.findUnique({
        where: { id: customerId },
        select: { name: true },
      });

      const result = filteredOrders.map((doc: any) => {
        const config = doc.config as any;
        return {
          id: doc.id,
          name: doc.name,
          doNo: config?.doNo || doc.name, // Use doNo from config or fallback to name
          status: doc.status,
          customerId: config?.customerId,
          customerName: customer?.name,
          createdAt: doc.createdAt,
        };
      });

      console.log('🚚 DELIVERY ORDERS: Returning:', result);
      return result;
    } catch (error) {
      console.error('🔴 DELIVERY ORDERS: Error fetching delivery orders:', error);
      throw new HttpException(`Fetch delivery orders failed: ${error.message}`, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
  async getDocumentsByAsset(assetId: string, organizationId: string) {
    try {
      const assetTemplateTags = await this.prisma.assetTemplateTag.findMany({
        where: {
          assetId,
          asset: {
            organizationId, // Ensure asset belongs to the same organization
          },
        },
        include: {
          template: true,
        },
      });

      return assetTemplateTags.map((tag) => ({
        doc_id: tag.template.id,
        doc_name: tag.template.name,
        doc_type: tag.template.type,
      }));
    } catch (error) {
      throw new HttpException(`Fetch templates by asset failed: ${error.message}`, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async tagTemplateToAsset(assetId: string, templateId: string, _organizationId: string) {
    try {
      return await this.prisma.assetTemplateTag.create({
        data: {
          assetId,
          templateId,
        },
      });
    } catch (error) {
      throw new HttpException(`Failed to tag template to asset: ${error.message}`, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async untagTemplateFromAsset(assetId: string, templateId: string, _organizationId: string) {
    try {
      return await this.prisma.assetTemplateTag.delete({
        where: {
          assetId_templateId: {
            assetId,
            templateId,
          },
        },
      });
    } catch (error) {
      throw new HttpException(`Failed to untag template from asset: ${error.message}`, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  /**
   * Create an invoice in Xero based on the document data
   * This is called when TI (Invoice) documents are created or updated with non-draft status
   */
  private async createXeroInvoice(document: any, config: any, organizationId: string) {
    try {
      console.log('🔍 XERO: Starting invoice creation process for document:', document.id);

      // Extract customerId from config
      const customerId = config?.customerId;
      console.log('🔍 XERO: Document details - Name:', document.name, 'Customer ID:', customerId);

      if (!customerId) {
        console.error('🔴 XERO: Customer ID not found in document config:', document.id);
        throw new Error('Customer ID not found in document config');
      }

      // Get customer information
      const customer = await this.prisma.customer.findUnique({
        where: { id: customerId },
      });

      if (!customer) {
        console.error('🔴 XERO: Customer not found for document:', document.id, 'Customer ID:', customerId);
        throw new Error('Customer not found for invoice');
      }

      console.log('✅ XERO: Customer found - Name:', customer.name, 'Email:', customer.email || 'No email');

      // Extract invoice data from the document config
      const lineItems = [];
      console.log('🔍 XERO: Processing document items:', config.items ? config.items.length : 0, 'items found');

      // Process items if they exist
      if (config.items && Array.isArray(config.items)) {
        for (const [index, item] of config.items.entries()) {
          console.log(`🔍 XERO: Processing item ${index + 1} - Inventory ID:`, item.inventoryItemId, 'Quantity:', item.quantity);

          // Get inventory item details
          const inventoryItem = await this.prisma.inventory.findUnique({
            where: { id: item.inventoryItemId },
            include: { asset: true },
          });

          if (inventoryItem) {
            const lineItem = {
              description: item.description || inventoryItem.asset?.name || inventoryItem.sku || 'Item',
              quantity: item.quantity || 1,
              unitAmount: item.price || inventoryItem.asset?.price || 0, // Use item price first, then asset price
              accountCode: item.accountCode || '200', // Use selected account code or default to '200'
              taxType: 'NONE', // Default to no tax - you may want to make this configurable
            };
            lineItems.push(lineItem);
            console.log(`✅ XERO: Added line item ${index + 1} -`, lineItem.description, 'Qty:', lineItem.quantity, 'Price:', lineItem.unitAmount, 'Account:', lineItem.accountCode);
          } else {
            console.warn(`⚠️ XERO: Inventory item not found for ID:`, item.inventoryItemId);
          }
        }
      }

      // Format date to DD/MM/YYYY format like in the image
      const formatDate = (dateString: string) => {
        if (!dateString) return new Date().toLocaleDateString('en-GB');
        const date = new Date(dateString);
        return date.toLocaleDateString('en-GB');
      };

      // If no line items from inventory, create a generic line item
      if (lineItems.length === 0) {
        console.log('⚠️ XERO: No items found, creating generic line item');
        lineItems.push({
          description: `Service/Product - Invoice ${document.name || document.id}`,
          quantity: 1,
          unitAmount: 0, // You may want to add amount fields to your document config
          accountCode: '200',
          taxType: 'NONE',
        });
      }

      // Add reference line items AFTER all the actual items (only for Xero, not in app)
      const referenceItems = [];

      // Add DO reference if selected
      if (config.doNo) {
        console.log('📋 XERO: Adding DO reference line item for DO:', config.doNo);
        referenceItems.push({
          description: `Our DO No. ${config.doNo} dated ${formatDate(config.date)}`,
          quantity: 0, // No quantity for reference lines
          unitAmount: 0, // No amount for reference lines
          accountCode: '200',
          taxType: 'NONE',
        });
      }

      // Add quotation reference if available
      if (config.referenceNo) {
        console.log('📋 XERO: Adding quotation reference:', config.referenceNo);
        referenceItems.push({
          description: `Our Qtn Ref. ${config.referenceNo} dated ${formatDate(config.date)}`,
          quantity: 0,
          unitAmount: 0,
          accountCode: '200',
          taxType: 'NONE',
        });
      }

      // Add work order reference if available
      if (config.poNo) {
        console.log('📋 XERO: Adding work order reference:', config.poNo);
        referenceItems.push({
          description: `Your WO No. ${config.poNo} dated ${formatDate(config.date)}`,
          quantity: 0,
          unitAmount: 0,
          accountCode: '200',
          taxType: 'NONE',
        });
      }

      // Add location and project info if available
      if (config.deliveryTo) {
        console.log('📋 XERO: Adding location reference:', config.deliveryTo);
        referenceItems.push({
          description: `Location: ${config.deliveryTo}`,
          quantity: 0,
          unitAmount: 0,
          accountCode: '200',
          taxType: 'NONE',
        });
      }

      // Add project information if available
      if (config.projectId) {
        try {
          const project = await this.prisma.project.findUnique({
            where: { id: config.projectId },
            include: {
              siteOffice: {
                include: {
                  customer: true,
                },
              },
            },
          });

          if (project) {
            console.log('📋 XERO: Adding project reference:', project.name);
            referenceItems.push({
              description: `Project/Dept: ${project.name}`,
              quantity: 0,
              unitAmount: 0,
              accountCode: '200',
              taxType: 'NONE',
            });
          }
        } catch (error) {
          console.warn('⚠️ XERO: Could not fetch project information:', error.message);
        }
      }

      // Add all reference items to the end of line items
      lineItems.push(...referenceItems);

      if (referenceItems.length > 0) {
        console.log('✅ XERO: Added', referenceItems.length, 'reference line items');
      }

      console.log('📝 XERO: Total line items prepared:', lineItems.length);

      // Prepare invoice data for Xero
      const invoiceData = {
        contactName: customer.name,
        contactEmail: customer.email || '',
        reference: config.referenceNo || config.poNo || '',
        invoiceNumber: document.name || undefined, // Let Xero auto-generate if not provided
        dueDate: config.dueDate || undefined,
        lineItems: lineItems,
        status: 'DRAFT' as const, // Start as draft, you can change this based on document status
      };

      console.log('📤 XERO: Sending invoice data:', {
        contactName: invoiceData.contactName,
        reference: invoiceData.reference,
        invoiceNumber: invoiceData.invoiceNumber,
        dueDate: invoiceData.dueDate,
        lineItemsCount: invoiceData.lineItems.length,
      });

      // Create the invoice in Xero
      console.log('🚀 XERO: Calling Xero API to create invoice...');
      const xeroInvoice = await this.xeroService.createInvoice(organizationId, invoiceData);

      console.log('🎉 XERO: Invoice created successfully! Xero Invoice ID:', xeroInvoice?.invoiceID || 'No ID returned');

      // Store the Xero invoice ID in the document config
      if (xeroInvoice?.invoiceID) {
        console.log('💾 XERO: Storing Xero invoice ID in document config:', xeroInvoice.invoiceID);
        await this.prisma.document.update({
          where: { id: document.id },
          data: {
            config: {
              ...config,
              xeroInvoiceId: xeroInvoice.invoiceID,
            },
          },
        });
        console.log('✅ XERO: Xero invoice ID stored successfully');
      }

      return xeroInvoice;
    } catch (error) {
      console.error('💥 XERO: Failed to create invoice - Error type:', error.constructor.name);
      console.error('💥 XERO: Error message:', error.message);
      console.error('💥 XERO: Full error:', error);
      throw error;
    }
  }

  private async updateXeroInvoice(document: any, config: any, organizationId: string) {
    try {
      console.log('🔄 XERO: Starting invoice update process for document:', document.id);

      // Check if we have a Xero invoice ID stored
      let xeroInvoiceId = (config as any)?.xeroInvoiceId;

      if (!xeroInvoiceId) {
        console.log('⚠️ XERO: No Xero invoice ID found in config');

        // Try to find existing invoice by invoice number before creating new one
        const invoiceNumber = document.name;
        console.log('🔍 XERO: Searching for existing invoice with number:', invoiceNumber);

        try {
          const existingInvoice = await this.xeroService.findInvoiceByNumber(organizationId, invoiceNumber);
          if (existingInvoice) {
            console.log('✅ XERO: Found existing invoice in Xero with ID:', existingInvoice.invoiceID);
            xeroInvoiceId = existingInvoice.invoiceID;

            // Store the found invoice ID in the document config for future updates
            const updatedConfig = { ...config, xeroInvoiceId };
            await this.prisma.document.update({
              where: { id: document.id },
              data: { config: updatedConfig },
            });
            console.log('💾 XERO: Stored invoice ID in document config for future updates');
          } else {
            console.log('⚠️ XERO: No existing invoice found, creating new invoice');
            return await this.createXeroInvoice(document, config, organizationId);
          }
        } catch (searchError) {
          console.log('⚠️ XERO: Error searching for existing invoice, creating new invoice:', searchError.message);
          return await this.createXeroInvoice(document, config, organizationId);
        }
      }

      console.log('🔍 XERO: Found Xero invoice ID in config:', xeroInvoiceId);

      // Verify the invoice actually exists in Xero
      const invoiceExists = await this.xeroService.invoiceExists(organizationId, xeroInvoiceId);
      if (!invoiceExists) {
        console.log('⚠️ XERO: Invoice ID exists in config but not found in Xero, creating new invoice');
        // Clear the invalid xeroInvoiceId from config
        const updatedConfig = { ...config };
        delete (updatedConfig as any).xeroInvoiceId;

        // Update the document to remove the invalid xeroInvoiceId
        await this.prisma.document.update({
          where: { id: document.id },
          data: { config: updatedConfig },
        });

        return await this.createXeroInvoice(document, updatedConfig, organizationId);
      }

      console.log('✅ XERO: Invoice confirmed to exist in Xero, proceeding with update');

      // Extract customerId from config
      const customerId = config?.customerId;

      if (!customerId) {
        console.error('🔴 XERO: Customer ID not found in document config:', document.id);
        throw new Error('Customer ID not found in document config');
      }

      // Get customer information
      const customer = await this.prisma.customer.findUnique({
        where: { id: customerId },
      });

      if (!customer) {
        console.error('🔴 XERO: Customer not found for document:', document.id, 'Customer ID:', customerId);
        throw new Error('Customer not found for invoice update');
      }

      console.log('✅ XERO: Customer found - Name:', customer.name, 'Email:', customer.email || 'No email');

      // Extract invoice data from the document config (same logic as create)
      const lineItems = [];
      console.log('🔍 XERO: Processing document items for update:', config.items ? config.items.length : 0, 'items found');

      // Process items if they exist (same logic as createXeroInvoice)
      if (config.items && Array.isArray(config.items)) {
        for (const [index, item] of config.items.entries()) {
          console.log(`🔍 XERO: Processing item ${index + 1} - Inventory ID:`, item.inventoryItemId, 'Quantity:', item.quantity);

          const inventoryItem = await this.prisma.inventory.findUnique({
            where: { id: item.inventoryItemId },
            include: { asset: true },
          });

          if (inventoryItem) {
            const lineItem = {
              description: item.description || inventoryItem.asset?.name || inventoryItem.sku || 'Item',
              quantity: item.quantity || 1,
              unitAmount: item.price || inventoryItem.asset?.price || 0,
              accountCode: item.accountCode || '200',
              taxType: 'NONE',
            };
            lineItems.push(lineItem);
            console.log(`✅ XERO: Added line item ${index + 1} -`, lineItem.description, 'Qty:', lineItem.quantity, 'Price:', lineItem.unitAmount);
          } else {
            console.warn(`⚠️ XERO: Inventory item not found for ID:`, item.inventoryItemId);
          }
        }
      }

      // Format date to DD/MM/YYYY format like in the image
      const formatDate = (dateString: string) => {
        if (!dateString) return new Date().toLocaleDateString('en-GB');
        const date = new Date(dateString);
        return date.toLocaleDateString('en-GB');
      };

      // If no line items from inventory, create a generic line item
      if (lineItems.length === 0) {
        console.log('⚠️ XERO: No items found, creating generic line item');
        lineItems.push({
          description: `Service/Product - Invoice ${document.name || document.id}`,
          quantity: 1,
          unitAmount: 0,
          accountCode: '200',
          taxType: 'NONE',
        });
      }

      // Add reference line items AFTER all the actual items (same logic as create)
      const referenceItems = [];

      // Add DO reference if selected
      if (config.doNo) {
        referenceItems.push({
          description: `Our DO No. ${config.doNo} dated ${formatDate(config.date)}`,
          quantity: 0,
          unitAmount: 0,
          accountCode: '200',
          taxType: 'NONE',
        });
      }

      // Add quotation reference if available
      if (config.referenceNo) {
        referenceItems.push({
          description: `Our Qtn Ref. ${config.referenceNo} dated ${formatDate(config.date)}`,
          quantity: 0,
          unitAmount: 0,
          accountCode: '200',
          taxType: 'NONE',
        });
      }

      // Add work order reference if available
      if (config.poNo) {
        referenceItems.push({
          description: `Your WO No. ${config.poNo} dated ${formatDate(config.date)}`,
          quantity: 0,
          unitAmount: 0,
          accountCode: '200',
          taxType: 'NONE',
        });
      }

      // Add location and project info if available
      if (config.deliveryTo) {
        referenceItems.push({
          description: `Location: ${config.deliveryTo}`,
          quantity: 0,
          unitAmount: 0,
          accountCode: '200',
          taxType: 'NONE',
        });
      }

      // Add project information if available
      if (config.projectId) {
        try {
          const project = await this.prisma.project.findUnique({
            where: { id: config.projectId },
            include: {
              siteOffice: {
                include: {
                  customer: true,
                },
              },
            },
          });

          if (project) {
            referenceItems.push({
              description: `Project/Dept: ${project.name}`,
              quantity: 0,
              unitAmount: 0,
              accountCode: '200',
              taxType: 'NONE',
            });
          }
        } catch (error) {
          console.warn('⚠️ XERO: Could not fetch project information:', error.message);
        }
      }

      // Add all reference items to the end of line items
      lineItems.push(...referenceItems);

      console.log('📝 XERO: Total line items prepared for update:', lineItems.length);

      // Prepare invoice data for Xero update
      const invoiceData = {
        contactName: customer.name,
        contactEmail: customer.email || '',
        reference: config.referenceNo || config.poNo || '',
        invoiceNumber: document.name || undefined,
        dueDate: config.dueDate || undefined,
        lineItems: lineItems,
        status: 'DRAFT' as const,
      };

      console.log('🔄 XERO: Updating invoice in Xero...');
      const xeroInvoice = await this.xeroService.updateInvoice(organizationId, xeroInvoiceId, invoiceData);

      console.log('🎉 XERO: Invoice updated successfully! Xero Invoice ID:', xeroInvoice?.invoiceID || 'No ID returned');

      return xeroInvoice;
    } catch (error) {
      console.error('💥 XERO: Failed to update invoice - Error type:', error.constructor.name);
      console.error('💥 XERO: Error message:', error.message);
      console.error('💥 XERO: Full error:', error);
      throw error;
    }
  }

  async getPastDescriptions(organizationId: string) {
    try {
      // Fetch all documents for the organization
      const documents = await this.prisma.document.findMany({
        where: {
          organizationId,
        },
        select: {
          config: true,
        },
      });

      // Extract unique descriptions from all document items
      const descriptions = new Set<string>();

      documents.forEach(document => {
        const config = document.config as any;
        if (config?.items && Array.isArray(config.items)) {
          config.items.forEach((item: any) => {
            if (item.description && typeof item.description === 'string' && item.description.trim()) {
              descriptions.add(item.description.trim());
            }
          });
        }
      });

      // Convert set to array and sort alphabetically
      const sortedDescriptions = Array.from(descriptions).sort((a, b) =>
        a.toLowerCase().localeCompare(b.toLowerCase())
      );

      return {
        success: true,
        descriptions: sortedDescriptions,
      };
    } catch (error) {
      console.error('Failed to fetch past descriptions:', error);
      throw new HttpException(
        `Failed to fetch past descriptions: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Send invoice email to customer
   */
  async sendInvoiceEmail(
    documentId: string,
    emailDto: SendInvoiceEmailDto,
    organizationId: string,
    actor?: DocumentActor,
  ) {
    try {
      // 1. Get the document
      const document = await this.prisma.document.findFirst({
        where: {
          id: documentId,
          organizationId,
        },
        include: {
          organization: true,
        },
      });

      if (!document) {
        throw new HttpException('Document not found', HttpStatus.NOT_FOUND);
      }

      // 2. Validate it's an invoice or a quotation. Quotations reuse the same
      // Resend + PDF pipeline; only the guards differ (see below).
      const invoiceTypes = ['INVOICE', 'TI', 'TI2'];
      const quotationTypes = ['QUOTATION', 'QO', 'QO1', 'QO2', 'QT'];
      const isQuotation = quotationTypes.includes(document.type);
      if (!invoiceTypes.includes(document.type) && !isQuotation) {
        throw new HttpException(
          'Only invoices or quotations can be sent via email',
          HttpStatus.BAD_REQUEST,
        );
      }

      // 3. Validate status is 'confirmed' — invoices only. Quotations can be
      // emailed at any status (no confirm step is required to send a quote).
      if (!isQuotation && document.status !== 'confirmed') {
        throw new HttpException(
          'Only confirmed invoices can be sent. Please confirm the invoice first.',
          HttpStatus.BAD_REQUEST,
        );
      }

      // 4. Extract invoice details from config
      const config: any = document.config;
      const customer = config?.customer;
      const documentInfo = config?.documentInfo;
      const items = config?.items || [];

      // Customer guard, type-aware. Invoices stay strict. Quotations may be
      // sent with just an Attention contact email — real quotes exist with
      // attention.email filled but no customer picked yet (prospect flow), and
      // the PDF generator + email body are null-safe for a missing customer.
      const attentionEmail: string | undefined = config?.attention?.email || undefined;
      if (isQuotation) {
        if (!customer && !attentionEmail) {
          throw new HttpException(
            'Quotation must have a customer or an Attention contact email',
            HttpStatus.BAD_REQUEST,
          );
        }
      } else if (!customer) {
        throw new HttpException(
          'Invoice must have a customer',
          HttpStatus.BAD_REQUEST,
        );
      }

      // Calculate total amount
      const totalAmount = items.reduce((sum: number, item: any) => {
        const amount =
          parseFloat(item.amount) ||
          parseFloat(item.quantity) * parseFloat(item.unitPrice) ||
          0;
        return sum + amount;
      }, 0);

      // Get invoice number and due date
      const invoiceNumber = document.name || documentInfo?.documentNumber || `${isQuotation ? 'QO' : 'INV'}-${documentId.substring(0, 8)}`;
      // Invoices carry a due date (real, or +30d default). Quotations have none —
      // pass undefined so the email body + PDF omit the Due Date row entirely.
      const dueDate = isQuotation
        ? undefined
        : config?.dueDate
          ? moment(config.dueDate).format('DD MMM YYYY')
          : moment().add(30, 'days').format('DD MMM YYYY');

      // 5. Generate or get PDF URL
      let pdfUrl: string | undefined;
      try {
        // Try to get existing PDF from S3
        const s3Key = `documents/${organizationId}/${document.type}/${documentId}.pdf`;
        try {
          pdfUrl = await this.s3Service.getSignedUrl(s3Key, 3600); // 1 hour expiry
        } catch (error) {
          // PDF doesn't exist, generate it
          console.log('PDF not found in S3, generating new one...');

          // Generate HTML
          const html = this.pdfGeneratorService.generateInvoiceHtml({
            organization: document.organization,
            customer,
            documentInfo,
            items,
            config,
            // Type-aware: quotations title as "Quotation" and omit the due-date
            // row; invoices keep "Tax Invoice" + the real due date.
            isQuotation,
            dueDate,
          });

          // Generate PDF
          const pdfBuffer = await this.pdfGeneratorService.generatePdfFromHtml(html);

          // Upload to S3
          const { key } = await this.s3Service.uploadPdf(
            organizationId,
            document.type,
            documentId,
            pdfBuffer,
          );

          // Get signed URL
          pdfUrl = await this.s3Service.getSignedUrl(key, 3600);
        }
      } catch (error) {
        console.error('Failed to get/generate PDF:', error);
        // Continue without PDF attachment
      }

      // 6. Send email via email service
      const emailResult = await this.emailService.sendInvoiceEmail({
        to: emailDto.to,
        cc: emailDto.cc,
        bcc: emailDto.bcc,
        subject: emailDto.subject,
        message: emailDto.message,
        invoiceNumber,
        invoiceAmount: totalAmount,
        dueDate,
        isQuotation,
        // Null-safe: quotations can now send without a customer object; fall
        // back to the flat extraction field, then a generic salutation.
        customerName: customer?.name || config?.customerName || 'Customer',
        organizationName: document.organization.name,
        pdfUrl,
        paymentLink: undefined, // TODO: Generate payment link when public payment page is implemented
      });

      if (!emailResult.success) {
        throw new HttpException(
          emailResult.error || 'Failed to send email',
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
      }

      {
        const recipients = [emailDto.to, emailDto.cc, emailDto.bcc]
          .flat()
          .filter(Boolean)
          .join(', ');
        void this.logDocumentEvent({
          documentId,
          organizationId,
          action: 'SENT',
          detail: `${invoiceNumber} emailed${recipients ? ` to ${recipients}` : ''}`,
          documentName: invoiceNumber,
          actor,
        });
      }

      // 7. Update document status to 'pending_payment' (email has been sent).
      // Invoices only — quotations have no such status, so their status is
      // left untouched after sending.
      if (!isQuotation) {
        await this.prisma.document.update({
          where: {
            id: documentId,
          },
          data: {
            status: DocumentStatus.pending_payment,
          },
        });
      }

      return {
        success: true,
        message: `${isQuotation ? 'Quotation' : 'Invoice'} email sent successfully`,
        messageId: emailResult.messageId,
      };
    } catch (error) {
      console.error('Error sending invoice email:', error);
      throw new HttpException(
        error.message || 'Failed to send invoice email',
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Per-item Delivery Order flow (Phases 3 + 4)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Deduct stock for ONE DocumentItem — IDEMPOTENTLY. The `deductedAt` column is
   * the idempotency guard: a conditional updateMany ({ deductedAt: null })
   * atomically CLAIMS the deduction in the same transaction as the stock
   * decrement, so an item can never double-deduct whether it arrives via a
   * per-item DO_ACK scan OR the office bulk-complete button. Returns true only
   * when this call actually performed the deduction.
   *
   * Handles BOTH item types (must not regress asset deduction): INVENTORY
   * decrements Inventory.quantity (via inventoryId), ASSET decrements
   * Asset.quantity (via assetId). Falls back to itemId when the typed FK is null
   * (rows created before Phase 2 backfilled the FKs).
   */
  private async deductDocumentItemStock(
    item: {
      id: string;
      itemId: string;
      itemType: ItemType;
      inventoryId: string | null;
      assetId: string | null;
      quantity: number | null;
    },
    documentId: string,
    documentName: string | null,
    organizationId: string,
  ): Promise<boolean> {
    const quantity = item.quantity || 0;
    const inventoryId =
      item.itemType === ItemType.INVENTORY ? item.inventoryId ?? item.itemId : null;
    const assetId =
      item.itemType === ItemType.ASSET ? item.assetId ?? item.itemId : null;

    return this.prisma.$transaction(async (tx) => {
      // Atomically claim the deduction. deductedAt:null guard ⇒ exactly-once.
      const claim = await tx.documentItem.updateMany({
        where: { id: item.id, deductedAt: null },
        data: { deductedAt: new Date() },
      });
      if (claim.count === 0) return false; // already deducted — idempotent no-op

      // Flip the delivered unit's status, mirroring the legacy DO submit path
      // (documents.service DO → rental) + the deployment rental-vs-sale rule
      // (projects.service:584 — SALE → sold, else rental). Idempotent: only from
      // instock, so re-runs / already-moved units are no-ops. Rides the SAME
      // deductedAt claim as the deduction ⇒ exactly-once per item, and runs
      // regardless of line quantity (a delivered unit is rental/sold either way).
      // Serialized (inventory) units only — asset-level quantity rows have no
      // per-unit status to flip.
      if (inventoryId) {
        const dep = await tx.document.findUnique({
          where: { id: documentId },
          select: { projectDeployment: { select: { type: true } } },
        });
        const deliveredStatus =
          dep?.projectDeployment?.type === DeploymentType.SALE
            ? InventoryStatus.sold
            : InventoryStatus.rental;
        await tx.inventory.updateMany({
          where: { id: inventoryId, status: InventoryStatus.instock },
          data: { status: deliveredStatus },
        });
      }

      if (quantity <= 0) return true; // claimed; nothing to decrement

      if (inventoryId) {
        const inv = await tx.inventory.findUnique({
          where: { id: inventoryId },
          select: { quantity: true },
        });
        if (inv) {
          const newQty = Math.max(0, (inv.quantity || 0) - quantity);
          await tx.inventory.update({ where: { id: inventoryId }, data: { quantity: newQty } });
          await tx.timelineItem.create({
            data: {
              message: `Stock deducted: ${quantity} units for Delivery Order ${documentName || documentId.substring(0, 8)}`,
              inventoryId,
              documentId,
              pdfUrl: null,
            },
          });
        }
      } else if (assetId) {
        const asset = await tx.asset.findUnique({
          where: { id: assetId },
          select: { quantity: true },
        });
        if (asset) {
          const newQty = Math.max(0, (asset.quantity || 0) - quantity);
          await tx.asset.update({ where: { id: assetId }, data: { quantity: newQty } });
        }
      }
      return true;
    });
  }

  /**
   * Advance ONE scanned item through the per-item delivery lifecycle. Resolves
   * the target DocumentItem on the DO from the scanned unit (inventoryId FK,
   * else itemId for un-backfilled/asset-level rows). Duplicate-SKU tiebreak:
   * among rows whose CURRENT status is the action's predecessor, pick the
   * lowest lineNumber — i.e. the LEAST-advanced eligible copy — so repeated
   * scans of the same SKU advance the copies one at a time.
   *
   *   start   not_delivered → delivering    (deliveringAt)
   *   ack     delivering    → not_installed  (deliveredAt) + DEDUCT STOCK (3c)
   *   install not_installed → completed      (completedAt) + completion gate
   *   skip    not_installed → completed      (completedAt, installSkipped) + gate
   */
  async advanceDeliveryItem(
    documentId: string,
    inventoryId: string,
    action: 'start' | 'ack' | 'install' | 'skip',
    organizationId: string,
  ) {
    const document = await this.prisma.document.findFirst({
      where: { id: documentId, organizationId },
      select: { id: true, name: true },
    });
    if (!document) {
      throw new HttpException('Delivery Order not found', HttpStatus.NOT_FOUND);
    }

    const predecessor: Record<typeof action, DeliveryStatus> = {
      start: DeliveryStatus.not_delivered,
      ack: DeliveryStatus.delivering,
      install: DeliveryStatus.not_installed,
      skip: DeliveryStatus.not_installed,
    };

    // Resolve the scanned unit's parent asset so we also match SKU-level DOs
    // (DocumentItem rows can reference the specific Inventory unit OR the parent
    // Asset — see getScanContext's itemFilter). Match: inventoryId FK, OR itemId
    // == unit (un-backfilled INVENTORY rows), OR an ASSET row for the parent.
    const unit = await this.prisma.inventory.findUnique({
      where: { id: inventoryId },
      select: { assetId: true },
    });
    const itemMatch: any[] = [{ inventoryId }, { itemId: inventoryId }];
    if (unit?.assetId) itemMatch.push({ itemId: unit.assetId, itemType: ItemType.ASSET });

    const rows = await this.prisma.documentItem.findMany({
      where: { documentId, OR: itemMatch },
    });
    const target = rows
      .filter((r) => r.deliveryStatus === predecessor[action])
      .sort((a, b) => (a.lineNumber ?? 0) - (b.lineNumber ?? 0))[0];

    if (!target) {
      // Nothing eligible — already advanced past this step, or the scanned unit
      // isn't on this DO. No-op (keeps repeated scans safe).
      console.warn(
        `advanceDeliveryItem: no eligible row for doc ${documentId}, unit ${inventoryId}, action ${action}`,
      );
      return null;
    }

    const now = new Date();
    if (action === 'start') {
      await this.prisma.documentItem.update({
        where: { id: target.id },
        data: { deliveryStatus: DeliveryStatus.delivering, deliveringAt: now },
      });
    } else if (action === 'ack') {
      await this.prisma.documentItem.update({
        where: { id: target.id },
        data: { deliveryStatus: DeliveryStatus.not_installed, deliveredAt: now },
      });
      // Per-item deduction happens HERE (idempotent), not in a whole-DO loop.
      await this.deductDocumentItemStock(target, documentId, document.name, organizationId);
    } else if (action === 'install') {
      await this.prisma.documentItem.update({
        where: { id: target.id },
        data: { deliveryStatus: DeliveryStatus.completed, completedAt: now },
      });
      await this.maybeCompleteDeliveryOrderAndInvoice(documentId, organizationId);
    } else if (action === 'skip') {
      await this.prisma.documentItem.update({
        where: { id: target.id },
        data: { deliveryStatus: DeliveryStatus.completed, installSkipped: true, completedAt: now },
      });
      await this.maybeCompleteDeliveryOrderAndInvoice(documentId, organizationId);
    }

    return this.prisma.documentItem.findUnique({ where: { id: target.id } });
  }

  /**
   * Completion gate (Phase 4a), DEADLOCK-SAFE. After any item reaches
   * completed, check whether ALL DELIVERABLE items are completed. Service items
   * (isService=true) are EXCLUDED from the gate (treated as auto-complete). A DO
   * with no deliverable items (all-service) completes immediately. On
   * satisfaction the DO is marked terminal and an invoice is fired (idempotent).
   *
   * NOTE: DocumentStatus has no `completed` value; `delivered_installed` is the
   * terminal DO status (already written by the DO_INSTALL sign() path), so that
   * is what "DO complete" maps to here.
   *
   * ONE-WAY: completion → invoice is never auto-unwound (reversal = manual
   * credit note).
   */
  private async maybeCompleteDeliveryOrderAndInvoice(
    documentId: string,
    organizationId: string,
  ) {
    const items = await this.prisma.documentItem.findMany({
      where: { documentId },
      select: { isService: true, deliveryStatus: true },
    });
    const deliverable = items.filter((i) => !i.isService);
    const allDone =
      deliverable.length === 0 ||
      deliverable.every((i) => i.deliveryStatus === DeliveryStatus.completed);
    if (!allDone) return;

    await this.prisma.document.update({
      where: { id: documentId },
      data: { status: DocumentStatus.delivered_installed },
    });

    await this.createInvoiceFromDeliveryOrder(documentId, organizationId);
  }

  /**
   * Create an invoice from a completed DO (Phase 4c) — IDEMPOTENT.
   * Idempotency guard: skip if an INVOICE already references this DO via
   * config.sourceDocumentId (JSON path). Document has no sourceDocumentId column
   * and no VOID status, so the existence of any such INVOICE means "already
   * invoiced". The new invoice carries config.sourceDocumentId = DO.id so both
   * the guard and the DO↔invoice link work.
   */
  async createInvoiceFromDeliveryOrder(documentId: string, organizationId: string) {
    const existing = await this.prisma.document.findFirst({
      where: {
        organizationId,
        type: 'INVOICE',
        config: { path: ['sourceDocumentId'], equals: documentId },
      },
      select: { id: true },
    });
    if (existing) {
      console.log(`🧾 DO→INVOICE: invoice ${existing.id} already exists for DO ${documentId}; skipping.`);
      return existing;
    }

    const doDoc = await this.prisma.document.findFirst({
      where: { id: documentId, organizationId },
    });
    if (!doDoc) {
      throw new HttpException('Delivery Order not found', HttpStatus.NOT_FOUND);
    }
    const doConfig: any = doDoc.config || {};

    const templateId = await this.resolveTemplateIdForType('INVOICE', organizationId);

    // Carry the DO config forward (items/customer/etc.), stamp the source link
    // + a fresh date. config.items remains the source of truth downstream.
    const invoiceConfig = {
      ...doConfig,
      date: new Date().toISOString(),
      sourceDocumentId: documentId,
      sourceDocumentNumber: doDoc.name ?? undefined,
      sourceDocumentType: 'DELIVERY_ORDER',
    };

    const invoice = await this.createBasicDocument(
      templateId,
      'INVOICE',
      organizationId,
      invoiceConfig,
      doDoc.projectId ?? undefined,
    );
    console.log(`🧾 DO→INVOICE: created invoice ${invoice.id} from DO ${documentId}`);
    return invoice;
  }

  /**
   * Resolve exactly ONE template id for a type, mirroring createFromExtraction's
   * priority: active selection (primary → isDefault → newest among selected),
   * else the cross-org default / org's own default-active-newest.
   */
  private async resolveTemplateIdForType(type: string, organizationId: string): Promise<string> {
    const selections = await this.prisma.organizationActiveTemplate.findMany({
      where: { organizationId, type },
    });
    if (selections.length > 0) {
      const primary = selections.find((s) => s.isPrimary);
      if (primary) return primary.templateId;
      const sel = await this.prisma.documentTemplate.findFirst({
        where: { id: { in: selections.map((s) => s.templateId) } },
        select: { id: true },
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
      });
      return sel?.id ?? selections[0].templateId;
    }
    // Org's own active template first; seeded cross-org standard only when the
    // org has nothing of its own (consistent with the create picker's fallback).
    const tmpl =
      (await this.prisma.documentTemplate.findFirst({
        where: { type, organizationId, isActive: true },
        select: { id: true },
        orderBy: [{ createdAt: 'desc' }],
      })) ??
      (await this.prisma.documentTemplate.findFirst({
        where: { OR: [{ type, isDefault: true }, { type, organizationId }] },
        select: { id: true },
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
      }));
    if (!tmpl) {
      throw new HttpException(`No document template found for type ${type}`, HttpStatus.NOT_FOUND);
    }
    return tmpl.id;
  }

  /**
   * Office BULK-COMPLETE (Phase 4b) — required for non-taggable items the field
   * can't scan. Marks every deliverable item on the DO → completed, deducting
   * each via the SAME idempotent per-item path (deductedAt guards double-deduct
   * for items already scanned). Service items are skipped. Then the completion
   * gate fires → DO completes → invoice.
   */
  async bulkCompleteDeliveryOrder(documentId: string, organizationId: string) {
    const document = await this.prisma.document.findFirst({
      where: { id: documentId, organizationId },
      select: { id: true, name: true, type: true },
    });
    if (!document) {
      throw new HttpException('Document not found', HttpStatus.NOT_FOUND);
    }
    if (document.type !== 'DO' && document.type !== 'DELIVERY_ORDER') {
      throw new HttpException('This endpoint is only for Delivery Orders', HttpStatus.BAD_REQUEST);
    }

    const items = await this.prisma.documentItem.findMany({ where: { documentId } });
    let deductedCount = 0;
    for (const item of items) {
      if (item.isService) continue; // services aren't delivered/deducted
      const didDeduct = await this.deductDocumentItemStock(
        item,
        documentId,
        document.name,
        organizationId,
      );
      if (didDeduct) deductedCount++;
      if (item.deliveryStatus !== DeliveryStatus.completed) {
        await this.prisma.documentItem.update({
          where: { id: item.id },
          data: { deliveryStatus: DeliveryStatus.completed, completedAt: new Date() },
        });
      }
    }

    await this.maybeCompleteDeliveryOrderAndInvoice(documentId, organizationId);

    return {
      success: true,
      message: 'Delivery Order bulk-completed',
      itemCount: items.length,
      deductedCount,
    };
  }

  /**
   * Confirm a Delivery Order and always deduct stock
   * DO confirmation always triggers stock deduction
   */
  async confirmDeliveryOrder(
    documentId: string,
    confirmData: { fromDONo: string; toDONo: string },
    organizationId: string,
    actor?: DocumentActor,
  ) {
    try {
      console.log('📦 DO CONFIRM: Starting confirmation for document:', documentId);

      // Get the document
      const document = await this.prisma.document.findFirst({
        where: {
          id: documentId,
          organizationId,
        },
      });

      if (!document) {
        throw new HttpException('Document not found', HttpStatus.NOT_FOUND);
      }

      // Validate it's a Delivery Order
      if (document.type !== 'DO' && document.type !== 'DELIVERY_ORDER') {
        throw new HttpException(
          'This endpoint is only for Delivery Orders',
          HttpStatus.BAD_REQUEST
        );
      }

      // Confirming a DO no longer deducts stock. Deduction happens ONLY per-item:
      // on Acknowledge (advanceDeliveryItem action==='ack') and via bulk-complete
      // — so an item that was never delivered is never deducted. The idempotent
      // deductedAt guard on deductDocumentItemStock still protects those paths.
      const config: any = document.config;

      // Update document with confirmation data and set status to confirmed
      const updatedConfig = {
        ...config,
        fromDONo: confirmData.fromDONo,
        toDONo: confirmData.toDONo,
        confirmedAt: new Date().toISOString(),
        // Confirm no longer deducts — stock deducts per-item on delivery.
        stockDeducted: false,
      };

      const updatedDocument = await this.prisma.document.update({
        where: {
          id: documentId,
          organizationId,
        },
        data: {
          config: updatedConfig,
          status: 'confirmed',
        },
      });

      console.log('✅ DO CONFIRM: Document confirmed successfully');

      void this.logDocumentEvent({
        documentId,
        organizationId,
        action: 'APPROVED',
        detail: `${updatedDocument.name || confirmData.toDONo} confirmed`,
        documentName: updatedDocument.name || confirmData.toDONo,
        actor,
      });

      return {
        success: true,
        document: updatedDocument,
        stockDeducted: false,
        message: 'Delivery Order confirmed',
      };
    } catch (error) {
      console.error('❌ DO CONFIRM: Error:', error);
      throw new HttpException(
        error.message || 'Failed to confirm Delivery Order',
        error.status || HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  /**
   * Confirm an Invoice document.
   * Stock deduction occurs only if the invoice was NOT extracted from a DO (standalone invoice)
   */
  async confirmInvoice(
    documentId: string,
    confirmData: { fromInvoiceNo: string; toInvoiceNo: string },
    organizationId: string,
    actor?: DocumentActor,
  ) {
    try {
      console.log('🧾 INVOICE CONFIRM: Starting confirmation for document:', documentId);

      // Get the document
      const document = await this.prisma.document.findFirst({
        where: {
          id: documentId,
          organizationId,
        },
      });

      if (!document) {
        throw new HttpException('Document not found', HttpStatus.NOT_FOUND);
      }

      // Validate it's an Invoice
      const invoiceTypes = ['INVOICE', 'TI', 'TI2'];
      if (!invoiceTypes.includes(document.type)) {
        throw new HttpException(
          'This endpoint is only for Invoices',
          HttpStatus.BAD_REQUEST
        );
      }

      // Get items from document config
      const config: any = document.config;
      const items = config?.items || [];
      console.log('🧾 INVOICE CONFIRM: Processing', items.length, 'items');

      // Check if invoice was extracted from a DO (has sourceDocumentId in config or baseDocumentId)
      const sourceDocumentId = config?.sourceDocumentId || document.baseDocumentId;
      const isExtractedFromDO = !!sourceDocumentId;
      console.log('🧾 INVOICE CONFIRM: Source document ID:', sourceDocumentId);
      console.log('🧾 INVOICE CONFIRM: Is extracted from DO:', isExtractedFromDO);

      // Only deduct stock if invoice was NOT extracted from a DO (standalone invoice)
      // If extracted from DO, stock was already deducted when DO was confirmed
      const shouldDeductStock = !isExtractedFromDO;

      if (shouldDeductStock) {
        console.log('🧾 INVOICE CONFIRM: Deducting stock (standalone invoice, not extracted from DO)');

        await Promise.all(
          items.map(async (item: any) => {
            if (!item.inventoryItemId) {
              console.warn('⚠️ INVOICE CONFIRM: Item missing inventoryItemId, skipping');
              return;
            }

            const quantity = parseFloat(item.quantity) || 0;
            if (quantity <= 0) {
              console.warn('⚠️ INVOICE CONFIRM: Item has no quantity, skipping:', item.inventoryItemId);
              return;
            }

            // Try to find in Inventory table first (Asset Tracking Mode ON)
            let inventory = await this.prisma.inventory.findUnique({
              where: { id: item.inventoryItemId },
            });

            if (inventory) {
              // Deduct from inventory quantity
              const currentQty = inventory.quantity || 0;
              const newQty = Math.max(0, currentQty - quantity); // Don't go below 0

              await this.prisma.inventory.update({
                where: { id: item.inventoryItemId },
                data: { quantity: newQty },
              });

              console.log(`✅ INVOICE CONFIRM: Updated inventory ${item.inventoryItemId}: ${currentQty} - ${quantity} = ${newQty}`);

              // Create timeline entry for the stock deduction
              await this.prisma.timelineItem.create({
                data: {
                  message: `Stock deducted: ${quantity} units for Invoice ${document.name || documentId.substring(0, 8)}`,
                  inventoryId: item.inventoryItemId,
                  documentId: documentId,
                  pdfUrl: null,
                },
              });
            } else {
              // Try to find in Asset table (Products Mode - Asset Tracking OFF)
              const asset = await this.prisma.asset.findUnique({
                where: { id: item.inventoryItemId },
              });

              if (asset) {
                // Deduct from asset quantity
                const currentQty = asset.quantity || 0;
                const newQty = Math.max(0, currentQty - quantity); // Don't go below 0

                await this.prisma.asset.update({
                  where: { id: item.inventoryItemId },
                  data: { quantity: newQty },
                });

                console.log(`✅ INVOICE CONFIRM: Updated asset ${item.inventoryItemId}: ${currentQty} - ${quantity} = ${newQty}`);
              } else {
                console.warn('⚠️ INVOICE CONFIRM: Neither inventory nor asset found:', item.inventoryItemId);
              }
            }
          })
        );

        console.log('✅ INVOICE CONFIRM: Stock deduction completed');
      } else {
        console.log('🧾 INVOICE CONFIRM: Skipping stock deduction (invoice extracted from DO)');
      }

      // Update document with confirmation data and set status to confirmed
      const updatedConfig = {
        ...config,
        fromInvoiceNo: confirmData.fromInvoiceNo,
        toInvoiceNo: confirmData.toInvoiceNo,
        confirmedAt: new Date().toISOString(),
        stockDeducted: shouldDeductStock,
      };

      // Propagate project + deployment link from source DO when the invoice
      // doesn't already carry one. Source DO is the authoritative anchor.
      let inheritedProjectId: string | undefined;
      let inheritedDeploymentId: string | undefined;
      if (sourceDocumentId && (!document.projectId || !document.projectDeploymentId)) {
        try {
          const sourceDoc = await this.prisma.document.findFirst({
            where: { id: sourceDocumentId, organizationId },
            select: { projectId: true, projectDeploymentId: true },
          });
          if (sourceDoc) {
            if (!document.projectId && sourceDoc.projectId) inheritedProjectId = sourceDoc.projectId;
            if (!document.projectDeploymentId && sourceDoc.projectDeploymentId) {
              inheritedDeploymentId = sourceDoc.projectDeploymentId;
            }
            if (inheritedProjectId || inheritedDeploymentId) {
              console.log('🧾 INVOICE CONFIRM: Inheriting project/deployment from DO', {
                projectId: inheritedProjectId,
                projectDeploymentId: inheritedDeploymentId,
              });
            }
          }
        } catch (err) {
          console.warn('🧾 INVOICE CONFIRM: Could not inherit project link from DO', err);
        }
      }

      const updatedDocument = await this.prisma.document.update({
        where: {
          id: documentId,
          organizationId,
        },
        data: {
          config: updatedConfig,
          status: 'confirmed',
          ...(inheritedProjectId ? { projectId: inheritedProjectId } : {}),
          ...(inheritedDeploymentId ? { projectDeploymentId: inheritedDeploymentId } : {}),
        },
      });

      console.log('✅ INVOICE CONFIRM: Document confirmed successfully');

      void this.logDocumentEvent({
        documentId,
        organizationId,
        action: 'APPROVED',
        detail: `${updatedDocument.name || confirmData.toInvoiceNo} confirmed`,
        documentName: updatedDocument.name || confirmData.toInvoiceNo,
        actor,
      });

      // Save price history (best-effort)
      try {
        await this.priceHistoryService.savePriceHistoryFromDocument(documentId, organizationId);
        console.log('✅ INVOICE CONFIRM: Price history saved');
      } catch (e) {
        console.error('❌ INVOICE CONFIRM: Price history failed', e);
      }

      // Auto-post the invoice to the General Ledger (best-effort)
      console.log('📒 [GL auto-post] entering auto-post block for invoice', documentId);
      try {
        // Idempotency: if a journal entry already exists for this invoice, skip.
        const existingEntry = await this.prisma.journalEntry.findFirst({
          where: { organizationId, sourceDocumentId: documentId, type: 'INVOICE', status: { not: 'VOID' } },
          select: { id: true, journalNumber: true },
        });
        if (existingEntry) {
          console.log('📒 [GL auto-post] entry already exists for this invoice — skipping', existingEntry);
          return {
            success: true,
            document: updatedDocument,
            stockDeducted: shouldDeductStock,
            message: shouldDeductStock ? 'Invoice confirmed and stock deducted' : 'Invoice confirmed',
          };
        }

        const customer = config?.customer;
        const customerName = customer?.name || config?.customerName;
        const itemsForTotal = config?.items || [];

        // Prefer the explicit totals AIMS already computes on the document config.
        const net = parseFloat(config?.subTotal ?? config?.summary?.subTotal ?? 'NaN');
        const tax = parseFloat(config?.gstAmount ?? config?.summary?.taxAmount ?? config?.tax?.amount ?? 'NaN');
        const gross = parseFloat(config?.nettTotal ?? config?.summary?.grandTotal ?? 'NaN');

        // Fallbacks if those fields aren't set: compute from items + org tax rate.
        const fallbackNet = itemsForTotal.reduce((sum: number, item: any) => {
          const amt = parseFloat(item.amount) || (parseFloat(item.quantity) * parseFloat(item.unitPrice)) || 0;
          return sum + amt;
        }, 0);
        const org = await this.prisma.organization.findUnique({ where: { id: organizationId }, select: { taxRate: true } });
        const orgRate = (org?.taxRate ?? 0) / 100;

        const netAmount = !Number.isNaN(net) ? net : fallbackNet;
        const taxAmount = !Number.isNaN(tax) ? tax : netAmount * orgRate;
        const grossAmount = !Number.isNaN(gross) ? gross : netAmount + taxAmount;

        console.log('📒 [GL auto-post] computed amounts', {
          docId: documentId,
          invoiceNumber: updatedDocument.name,
          customerName,
          itemCount: itemsForTotal.length,
          net: netAmount,
          tax: taxAmount,
          gross: grossAmount,
        });

        if (grossAmount <= 0) {
          console.warn('📒 [GL auto-post] grossAmount <= 0, skipping');
        } else {
          const entry = await this.journalAutoPost.postFromInvoice({
            organizationId,
            documentId,
            invoiceNumber: updatedDocument.name || config?.documentNumber,
            entryDate: config?.date ? new Date(config.date) : new Date(),
            customerName,
            netAmount,
            taxAmount,
            grossAmount,
            // Per-line revenue accounts from the Revenue Master File (config.items[].accountCode).
            revenueLines: itemsForTotal.map((it: any) => ({
              accountCode: it.accountCode || it.revenueAccountCode || null,
              amount: parseFloat(it.amount) || (parseFloat(it.quantity) * parseFloat(it.unitPrice)) || 0,
            })),
          });
          if (entry) {
            console.log('✅ [GL auto-post] journal entry created', {
              journalNumber: entry.journalNumber,
              entryId: entry.id,
              totalDebit: entry.totalDebit,
              totalCredit: entry.totalCredit,
            });
          } else {
            console.warn('⚠️ [GL auto-post] postFromInvoice returned null — see warnings above');
          }
        }
      } catch (error) {
        console.error('❌ [GL auto-post] failed for invoice', documentId, error);
      }

      return {
        success: true,
        document: updatedDocument,
        stockDeducted: shouldDeductStock,
        message: shouldDeductStock
          ? 'Invoice confirmed and stock deducted'
          : 'Invoice confirmed',
      };
    } catch (error) {
      console.error('❌ INVOICE CONFIRM: Error:', error);
      throw new HttpException(
        error.message || 'Failed to confirm Invoice',
        error.status || HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  /**
   * Get payment summary for an invoice
   * Returns total amount, amount paid, and remaining balance
   */
  async getPaymentSummary(documentId: string, organizationId: string) {
    try {
      // Get the document
      const document = await this.prisma.document.findFirst({
        where: {
          id: documentId,
          organizationId,
        },
      });

      if (!document) {
        throw new HttpException('Document not found', HttpStatus.NOT_FOUND);
      }

      // Validate it's an invoice
      const invoiceTypes = ['INVOICE', 'TI', 'TI2'];
      if (!invoiceTypes.includes(document.type)) {
        throw new HttpException(
          'Payment summary is only available for invoices',
          HttpStatus.BAD_REQUEST,
        );
      }

      const config: any = document.config;
      const items = config?.items || [];

      // Native invoices total up their line items. Xero-imported invoices have
      // no line items — their authoritative gross/outstanding live on the
      // config (xeroGross / xeroBalance), set during migration + AR reconcile.
      const itemsTotal = items.reduce((sum: number, item: any) => {
        const amount =
          parseFloat(item.amount) ||
          parseFloat(item.quantity) * parseFloat(item.unitPrice) ||
          0;
        return sum + amount;
      }, 0);
      const isXero = !!config?.xeroImported;
      const invoiceAmount = isXero ? Number(config.xeroGross ?? itemsTotal) : itemsTotal;

      // Native Payment rows recorded against this invoice.
      const payments = await this.prisma.payment.findMany({
        where: { documentId, organizationId },
      });
      const nativePaid = payments.reduce((sum, payment) => sum + parseFloat(payment.amount.toString()), 0);

      // For Xero invoices, outstanding = xeroBalance minus any NEW native
      // payments recorded since migration. For native invoices it's the usual
      // gross minus payments.
      let totalPaid: number;
      let remainingBalance: number;
      if (isXero) {
        const xeroBalance = Number(config.xeroBalance ?? 0);
        remainingBalance = xeroBalance - nativePaid;
        totalPaid = invoiceAmount - remainingBalance;
      } else {
        totalPaid = nativePaid;
        remainingBalance = invoiceAmount - totalPaid;
      }

      return {
        success: true,
        invoiceAmount: parseFloat(invoiceAmount.toFixed(2)),
        totalPaid: parseFloat(totalPaid.toFixed(2)),
        remainingBalance: parseFloat(remainingBalance.toFixed(2)),
        invoiceNumber: document.name || `INV-${documentId.substring(0, 8)}`,
        status: document.status,
      };
    } catch (error) {
      console.error('Error getting payment summary:', error);
      throw new HttpException(
        error.message || 'Failed to get payment summary',
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
