import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DeliveryStatus, InventoryStatus, Prisma } from '@prisma/client';
import { PrismaService } from 'src/common/prisma.service';
import { isUnconfirmedDoc } from 'src/common/doc-status';
import { DocumentsService } from '../documents/documents.service';
import { ProjectsService } from '../projects/projects.service';
import { CreateDeliveryDto } from './dto/create-delivery.dto';
import { AddDeliveryItemDto } from './dto/add-delivery-item.dto';

// Item-lifecycle rank for folds/comparisons. Shared enum with DocumentItem:
// not_delivered → delivering → not_installed → completed (monotonic).
const RANK: Record<DeliveryStatus, number> = {
  [DeliveryStatus.not_delivered]: 0,
  [DeliveryStatus.delivering]: 1,
  [DeliveryStatus.not_installed]: 2,
  [DeliveryStatus.completed]: 3,
};

@Injectable()
export class DeliveriesService {
  private readonly logger = new Logger(DeliveriesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly documentsService: DocumentsService,
    private readonly projectsService: ProjectsService,
  ) {}

  // ── reservation ──────────────────────────────────────────────────────────

  /**
   * Atomically reserve a unit for a run: instock → reserved. The single
   * updateMany is BOTH the availability check and the anti-double-scan guard —
   * a unit already reserved/rental/sold simply doesn't match, claim count 0,
   * and the add is rejected. Timeline entry for audit.
   */
  private async reserveUnit(inventoryId: string, organizationId: string, deliveryNumber: number) {
    const unit = await this.prisma.inventory.findFirst({
      where: { id: inventoryId, organizationId },
      select: { id: true, sku: true, status: true },
    });
    if (!unit) throw new NotFoundException('Inventory unit not found in this organization');

    const claim = await this.prisma.inventory.updateMany({
      where: { id: inventoryId, status: InventoryStatus.instock },
      data: { status: InventoryStatus.reserved },
    });
    if (claim.count === 0) {
      throw new BadRequestException(
        `Unit ${unit.sku} is not available (status: ${unit.status}) — already reserved or deployed`,
      );
    }
    await this.prisma.timelineItem.create({
      data: {
        message: `Unit reserved for Delivery #${deliveryNumber} (delivering out)`,
        inventoryId,
        pdfUrl: null,
      },
    });
  }

  /** Guarded restore (cancel / never-delivered): reserved → instock. */
  private async releaseUnit(inventoryId: string, deliveryNumber: number) {
    const restored = await this.prisma.inventory.updateMany({
      where: { id: inventoryId, status: InventoryStatus.reserved },
      data: { status: InventoryStatus.instock },
    });
    if (restored.count > 0) {
      await this.prisma.timelineItem.create({
        data: {
          message: `Reservation released — Delivery #${deliveryNumber} cancelled`,
          inventoryId,
          pdfUrl: null,
        },
      });
    }
  }

  // ── create / basket ──────────────────────────────────────────────────────

  async create(dto: CreateDeliveryDto, organizationId: string, riderUserId: string) {
    const asset = await this.prisma.asset.findFirst({
      where: { id: dto.assetId, organizationId },
      select: { id: true, name: true },
    });
    if (!asset) throw new NotFoundException('Asset not found in this organization');

    // Per-org serial with P2002 retry (same pattern as MSR.reportNumber).
    const computeNextNumber = async () => {
      const latest = await this.prisma.delivery.findFirst({
        where: { organizationId },
        orderBy: { deliveryNumber: 'desc' },
        select: { deliveryNumber: true },
      });
      return (latest?.deliveryNumber ?? 0) + 1;
    };

    let delivery: Prisma.DeliveryGetPayload<object> | null = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      const deliveryNumber = await computeNextNumber();
      // Reserve BEFORE creating the run so an unavailable unit fails cleanly
      // with nothing to roll back (first attempt only — the retry is purely a
      // serial-number race, the unit is already ours).
      if (attempt === 0 && dto.inventoryId) {
        await this.reserveUnit(dto.inventoryId, organizationId, deliveryNumber);
      }
      try {
        delivery = await this.prisma.delivery.create({
          data: {
            organizationId,
            deliveryNumber,
            riderUserId,
            riderName: dto.riderName,
            projectId: dto.projectId,
            customerId: dto.customerId,
            siteAddress: dto.siteAddress,
            notes: dto.notes,
            items: {
              create: [
                {
                  assetId: dto.assetId,
                  inventoryId: dto.inventoryId,
                  description: dto.description ?? asset.name,
                  quantity: dto.quantity ?? 1,
                },
              ],
            },
          },
          include: { items: true },
        });
        break;
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002' && attempt === 0) {
          continue; // serial collision — recompute and retry once
        }
        // Creation failed for real — don't strand the reservation.
        if (dto.inventoryId) await this.releaseUnit(dto.inventoryId, 0).catch(() => undefined);
        throw err;
      }
    }
    if (!delivery) throw new Error('Failed to assign a unique delivery number after retries');
    return delivery;
  }

  async addItem(deliveryId: string, dto: AddDeliveryItemDto, organizationId: string) {
    const delivery = await this.prisma.delivery.findFirst({
      where: { id: deliveryId, organizationId },
      select: { id: true, status: true, deliveryNumber: true },
    });
    if (!delivery) throw new NotFoundException('Delivery not found');
    if (delivery.status !== 'in_progress') {
      throw new BadRequestException(`Cannot add items to a ${delivery.status} delivery`);
    }
    const asset = await this.prisma.asset.findFirst({
      where: { id: dto.assetId, organizationId },
      select: { id: true, name: true },
    });
    if (!asset) throw new NotFoundException('Asset not found in this organization');

    if (dto.inventoryId) {
      await this.reserveUnit(dto.inventoryId, organizationId, delivery.deliveryNumber);
    }
    try {
      return await this.prisma.deliveryItem.create({
        data: {
          deliveryId,
          assetId: dto.assetId,
          inventoryId: dto.inventoryId,
          description: dto.description ?? asset.name,
          quantity: dto.quantity ?? 1,
        },
      });
    } catch (err) {
      // Duplicate unit in this run (unique deliveryId+inventoryId) — release
      // the fresh reservation? NO: the duplicate means THIS run already holds
      // the unit's reservation via the earlier row; but the claim above just
      // flipped instock→reserved, which can only succeed if it wasn't reserved
      // — i.e. the earlier row's reservation was released out-of-band. Restore
      // to instock to stay consistent, then surface a clear error.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        if (dto.inventoryId) await this.releaseUnit(dto.inventoryId, delivery.deliveryNumber).catch(() => undefined);
        throw new BadRequestException('Unit already scanned into this delivery');
      }
      if (dto.inventoryId) await this.releaseUnit(dto.inventoryId, delivery.deliveryNumber).catch(() => undefined);
      throw err;
    }
  }

  // ── reads ────────────────────────────────────────────────────────────────

  async findById(id: string, organizationId: string) {
    // Per-item linking: each item carries its own DO. Delivery.documentId is
    // frozen legacy — never read; the run-level `document` in the response is
    // DERIVED (single distinct DO across linked items, else null) for
    // backward-compatible consumers (basket header, detail chip).
    const delivery = await this.prisma.delivery.findFirst({
      where: { id, organizationId },
      include: {
        items: { include: { document: { select: { id: true, name: true, type: true, status: true } } } },
        // Current drop target — prefills the in-flow assignment picker.
        project: { select: { id: true, name: true } },
        customer: { select: { id: true, name: true } },
      },
    });
    if (!delivery) throw new NotFoundException('Delivery not found');

    // Enrich items with unit/asset display fields (plain-UUID columns, no FK).
    const invIds = delivery.items.map((i) => i.inventoryId).filter((v): v is string => !!v);
    const assetIds = [...new Set(delivery.items.map((i) => i.assetId))];
    const [units, assets, reports] = await Promise.all([
      invIds.length
        ? this.prisma.inventory.findMany({
            where: { id: { in: invIds } },
            select: { id: true, sku: true, serialNumber: true, status: true },
          })
        : Promise.resolve([]),
      this.prisma.asset.findMany({ where: { id: { in: assetIds } }, select: { id: true, name: true, skuKey: true } }),
      // Proof lives on the MSR rows grouped by deliveryId.
      this.prisma.maintenanceServiceReport.findMany({
        where: { deliveryId: id },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          kind: true,
          status: true,
          description: true,
          photos: true,
          signature: true,
          signedByName: true,
          signedAt: true,
          latitude: true,
          longitude: true,
          technicianName: true,
          inventoryId: true,
          createdAt: true,
        },
      }),
    ]);
    const unitById = new Map(units.map((u) => [u.id, u]));
    const assetById = new Map(assets.map((a) => [a.id, a]));
    // Derived run-level document: exactly one distinct DO across linked items.
    const distinctDocs = [...new Map(
      delivery.items.filter((i) => i.document).map((i) => [i.document!.id, i.document!]),
    ).values()];
    return {
      ...delivery,
      document: distinctDocs.length === 1 ? distinctDocs[0] : null,
      items: delivery.items.map((i) => ({
        ...i,
        inventory: i.inventoryId ? unitById.get(i.inventoryId) ?? null : null,
        asset: assetById.get(i.assetId) ?? null,
      })),
      reports,
    };
  }

  async list(
    organizationId: string,
    opts: { unlinked?: boolean; status?: string; page?: number; limit?: number } = {},
  ) {
    const page = Math.max(1, opts.page ?? 1);
    const limit = Math.min(100, Math.max(1, opts.limit ?? 20));
    // "Unlinked" is per-item now: a run stays in the queue while ANY item has
    // no DO. Cancelled runs drop out of the queue view (their items will never
    // be linked) unless the caller asked for them by status explicitly.
    const where: Prisma.DeliveryWhereInput = {
      organizationId,
      ...(opts.unlinked ? { items: { some: { documentId: null } } } : {}),
      ...(opts.status
        ? { status: opts.status as any }
        : opts.unlinked
          ? { status: { not: 'cancelled' as any } }
          : {}),
    };
    const [docs, total] = await Promise.all([
      this.prisma.delivery.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          items: {
            select: {
              id: true,
              deliveryStatus: true,
              documentId: true,
              document: { select: { id: true, name: true } },
            },
          },
          project: { select: { id: true, name: true } },
          customer: { select: { id: true, name: true } },
        },
      }),
      this.prisma.delivery.count({ where }),
    ]);
    return { docs, total, page, limit };
  }

  // ── state machine (mirrors documents.advanceDeliveryItem, minus commerce) ─

  /**
   * Advance ONE unit through the run's item lifecycle. Same steps as the DO
   * path (start/ack/install/skip) but with NO stock deduction, NO unit status
   * flip, NO Document.status writes — commerce stays on the DO. Recomputes the
   * run's fold status afterwards.
   */
  async advanceDeliveryItem(
    deliveryId: string,
    inventoryId: string,
    action: 'start' | 'ack' | 'install' | 'skip',
    organizationId: string,
  ) {
    const delivery = await this.prisma.delivery.findFirst({
      where: { id: deliveryId, organizationId },
      select: { id: true },
    });
    if (!delivery) throw new NotFoundException('Delivery not found');

    const predecessor: Record<typeof action, DeliveryStatus> = {
      start: DeliveryStatus.not_delivered,
      ack: DeliveryStatus.delivering,
      install: DeliveryStatus.not_installed,
      skip: DeliveryStatus.not_installed,
    };

    const target = await this.prisma.deliveryItem.findFirst({
      where: { deliveryId, inventoryId, deliveryStatus: predecessor[action] },
    });
    if (!target) {
      // Already advanced past this step, or the unit isn't on this run —
      // repeated scans stay safe (same posture as the DO path).
      this.logger.warn(
        `advanceDeliveryItem: no eligible row for delivery ${deliveryId}, unit ${inventoryId}, action ${action}`,
      );
      return null;
    }

    const now = new Date();
    const data: Prisma.DeliveryItemUpdateInput =
      action === 'start'
        ? { deliveryStatus: DeliveryStatus.delivering, deliveringAt: now }
        : action === 'ack'
          ? { deliveryStatus: DeliveryStatus.not_installed, deliveredAt: now }
          : action === 'install'
            ? { deliveryStatus: DeliveryStatus.completed, completedAt: now }
            : { deliveryStatus: DeliveryStatus.completed, installSkipped: true, completedAt: now };
    await this.prisma.deliveryItem.update({ where: { id: target.id }, data });

    await this.recomputeRunStatus(deliveryId, organizationId);
    return this.prisma.deliveryItem.findUnique({ where: { id: target.id } });
  }

  /**
   * Fold the item states into the run status: all completed → completed
   * (stamping completedAt once); all ≥ not_installed → delivered; else
   * in_progress. Item states only ever advance, so the fold is monotonic —
   * it can't downgrade a run. Cancelled runs are never touched.
   */
  async recomputeRunStatus(deliveryId: string, organizationId: string) {
    const delivery = await this.prisma.delivery.findFirst({
      where: { id: deliveryId, organizationId },
      select: { id: true, status: true, completedAt: true, items: { select: { deliveryStatus: true } } },
    });
    if (!delivery || delivery.status === 'cancelled' || delivery.items.length === 0) return;

    const ranks = delivery.items.map((i) => RANK[i.deliveryStatus]);
    const target =
      ranks.every((r) => r >= RANK[DeliveryStatus.completed])
        ? ('completed' as const)
        : ranks.every((r) => r >= RANK[DeliveryStatus.not_installed])
          ? ('delivered' as const)
          : ('in_progress' as const);

    if (target !== delivery.status) {
      await this.prisma.delivery.update({
        where: { id: deliveryId },
        data: {
          status: target,
          ...(target === 'completed' && !delivery.completedAt ? { completedAt: new Date() } : {}),
        },
      });
    }
  }

  // ── office: link / create-DO / cancel ────────────────────────────────────

  /**
   * Resolve which items a link/create-DO call operates on. Explicit itemIds
   * must all belong to the run and be unlinked (per-item "already linked"
   * guard — replaces the old run-level documentId guard). Omitted itemIds =
   * every currently-unlinked item (backward-compatible whole-run call).
   */
  private resolveLinkSelection<T extends { id: string; documentId: string | null }>(
    items: T[],
    itemIds?: string[],
  ): T[] {
    if (itemIds?.length) {
      const byId = new Map(items.map((i) => [i.id, i]));
      const ids = [...new Set(itemIds)];
      const missing = ids.filter((id) => !byId.has(id));
      if (missing.length) {
        throw new NotFoundException(`Item(s) not on this delivery: ${missing.join(', ')}`);
      }
      const alreadyLinked = ids.filter((id) => byId.get(id)!.documentId);
      if (alreadyLinked.length) {
        throw new BadRequestException('One or more selected items are already linked to a Delivery Order');
      }
      return ids.map((id) => byId.get(id)!);
    }
    const unlinked = items.filter((i) => !i.documentId);
    if (!unlinked.length) {
      throw new BadRequestException('Every item on this delivery is already linked to a Delivery Order');
    }
    return unlinked;
  }

  /**
   * Attach run ITEMS to a DO (per-item linking — one run's items may fulfil
   * different DOs). Two-layer model (delivery-first #5):
   *
   *   PLACEMENT (always): write DeliveryItem.documentId for the selection.
   *   COMMITMENT (bind + stamp + deduct + status mirror, all idempotent —
   *   documents.commitLinkedDeliveryItems): runs immediately ONLY when the
   *   target DO is already confirmed-or-beyond. Linking to a draft/unconfirmed
   *   DO places the items and defers commitment to the DO's confirm hook —
   *   stock is NEVER deducted against an uncommitted draft; the units stay
   *   reserved until confirm-time deduction flips them.
   *
   * Does NOT create/modify MSRs and does NOT fire the completion gate /
   * auto-invoice (backburnered by design). Delivery.documentId (legacy
   * run-level link) is frozen — never written.
   */
  async link(deliveryId: string, documentId: string, organizationId: string, itemIds?: string[]) {
    const delivery = await this.prisma.delivery.findFirst({
      where: { id: deliveryId, organizationId },
      include: { items: true },
    });
    if (!delivery) throw new NotFoundException('Delivery not found');
    if (delivery.status === 'cancelled') throw new BadRequestException('Cannot link a cancelled delivery');
    const selection = this.resolveLinkSelection(delivery.items, itemIds);
    const document = await this.prisma.document.findFirst({
      where: { id: documentId, organizationId, type: { in: ['DELIVERY_ORDER', 'DO'] } },
      select: { id: true, name: true, status: true },
    });
    if (!document) throw new NotFoundException('Delivery Order not found in this organization');

    // Per-item link write (placement). The documentId:null guard keeps a
    // concurrent link of the same item exactly-once (loser writes nothing).
    await this.prisma.deliveryItem.updateMany({
      where: { id: { in: selection.map((i) => i.id) }, documentId: null },
      data: { documentId },
    });

    const deferred = isUnconfirmedDoc(document.status);
    let deducted = 0;
    if (deferred) {
      this.logger.log(
        `Delivery #${delivery.deliveryNumber}: ${selection.length} item(s) placed on ${document.status} DO ` +
          `${document.name ?? documentId} — commitment deferred to confirm`,
      );
    } else {
      deducted = await this.documentsService.commitLinkedDeliveryItems(
        documentId,
        organizationId,
        selection.map((i) => i.id),
      );
      this.logger.log(
        `Delivery #${delivery.deliveryNumber}: ${selection.length} item(s) linked to DO ${document.name ?? documentId} (deducted ${deducted} unit(s))`,
      );
    }
    return this.findById(deliveryId, organizationId);
  }

  /**
   * Create a DO pre-filled from the SELECTED items (or all unlinked items),
   * then auto-link that selection. Template resolution mirrors the headless
   * upload path: per-org selection (isPrimary first) → org isActive →
   * isDefault/org any. Repeatable: remaining unlinked items can go to another
   * DO in a later call (per-item linking).
   */
  async createDoFromDelivery(
    deliveryId: string,
    organizationId: string,
    documentTemplateId?: string,
    itemIds?: string[],
  ) {
    const delivery = await this.prisma.delivery.findFirst({
      where: { id: deliveryId, organizationId },
      include: { items: true, customer: true },
    });
    if (!delivery) throw new NotFoundException('Delivery not found');
    if (delivery.status === 'cancelled') throw new BadRequestException('Cannot create a DO for a cancelled delivery');
    const selection = this.resolveLinkSelection(delivery.items, itemIds);

    let templateId = documentTemplateId;
    if (!templateId) {
      const type = 'DELIVERY_ORDER';
      const selections = await this.prisma.organizationActiveTemplate.findMany({
        where: { organizationId, type },
      });
      if (selections.length > 0) {
        const primary = selections.find((s) => s.isPrimary);
        if (primary) templateId = primary.templateId;
        else {
          const sel = await this.prisma.documentTemplate.findFirst({
            where: { id: { in: selections.map((s) => s.templateId) } },
            select: { id: true },
            orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
          });
          templateId = sel?.id ?? selections[0].templateId;
        }
      } else {
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
        if (!tmpl) throw new NotFoundException('No DELIVERY_ORDER template found for this organization');
        templateId = tmpl.id;
      }
    }

    // Enrich lines with unit SKUs for readable descriptions.
    const invIds = selection.map((i) => i.inventoryId).filter((v): v is string => !!v);
    const units = invIds.length
      ? await this.prisma.inventory.findMany({ where: { id: { in: invIds } }, select: { id: true, sku: true } })
      : [];
    const skuById = new Map(units.map((u) => [u.id, u.sku]));

    const config: Record<string, any> = {
      items: selection.map((i) => ({
        description: i.description ?? (i.inventoryId ? skuById.get(i.inventoryId) : '') ?? '',
        quantity: i.quantity,
        unitPrice: 0,
        amount: 0,
        ...(i.inventoryId ? { inventoryItemId: i.inventoryId, serialNumbers: [skuById.get(i.inventoryId)].filter(Boolean) } : {}),
      })),
      ...(delivery.siteAddress ? { deliveryTo: delivery.siteAddress } : {}),
      ...(delivery.customer
        ? {
            customerId: delivery.customer.id,
            customerName: delivery.customer.name,
            customer: { id: delivery.customer.id, name: delivery.customer.name },
          }
        : {}),
      sourceDeliveryId: delivery.id, // audit breadcrumb
    };

    const doc = await this.documentsService.createBasicDocument(
      templateId,
      'DELIVERY_ORDER',
      organizationId,
      config,
      delivery.projectId ?? undefined,
    );

    const linked = await this.link(deliveryId, doc.id, organizationId, selection.map((i) => i.id));
    // The run-level `document` in the response is derived (single-distinct) and
    // can be null on a multi-DO run — return the created DO id explicitly so
    // the office UI can route into the editor.
    return { ...linked, createdDocumentId: doc.id };
  }

  // ── field: in-flow assignment / skip-install ─────────────────────────────

  /**
   * Assign an acknowledged unit to a project from INSIDE the delivery flow
   * (delivery-first #4). Delegates to projects.fieldDeploy — the SAME service
   * path as the walk-around Assign page — so Assignment + ProjectDeployment +
   * the unit's rental/sold status flip stay single-sourced. autoBind is
   * explicitly false (and the helper's own pre-status-instock gate would stop
   * it anyway — the unit is `reserved` here): on a delivery-first run, DO slot
   * binding belongs to the link/commit step, and on a DO-first run the slot
   * was already claimed at DO_START. No double-bind by construction.
   * Also stamps the run's projectId/customerId (the "current drop target"
   * defaults the next item's picker + the create-DO prefill).
   */
  async assignItem(
    deliveryId: string,
    dto: { projectId: string; inventoryId: string; type?: 'RENTAL' | 'SALE' },
    organizationId: string,
  ) {
    const delivery = await this.prisma.delivery.findFirst({
      where: { id: deliveryId, organizationId },
      include: { items: true },
    });
    if (!delivery) throw new NotFoundException('Delivery not found');
    if (delivery.status === 'cancelled') throw new BadRequestException('Cannot assign on a cancelled delivery');
    const item = delivery.items.find((i) => i.inventoryId === dto.inventoryId);
    if (!item) throw new NotFoundException('Unit is not on this delivery');
    if (!item.deliveredAt) {
      throw new BadRequestException('Assign after the unit is acknowledged (delivered)');
    }

    const project = await this.prisma.project.findFirst({
      where: { id: dto.projectId, organizationId },
      select: { id: true, customerId: true },
    });
    if (!project) throw new NotFoundException('Project not found in this organization');

    const result = await this.projectsService.fieldDeploy(dto.projectId, organizationId, {
      inventoryId: dto.inventoryId,
      assetId: item.assetId,
      type: dto.type,
      autoBind: false,
    });

    await this.prisma.delivery.update({
      where: { id: deliveryId },
      data: { projectId: project.id, customerId: project.customerId ?? null },
    });
    return { ...result, projectId: project.id, customerId: project.customerId ?? null };
  }

  /**
   * Rider says installation isn't needed (delivery-first #3): the item goes
   * straight to completed with installSkipped=true and NO signature — the run
   * fold (recomputeRunStatus) already counts completed regardless of the
   * flag, so a fully-skipped run completes normally. Run-scoped twin of the
   * DO-first POST /maintenance-reports/do-skip-install/:doId.
   */
  async skipInstall(deliveryId: string, inventoryId: string, organizationId: string) {
    const updated = await this.advanceDeliveryItem(deliveryId, inventoryId, 'skip', organizationId);
    if (!updated) {
      throw new BadRequestException(
        'Nothing to skip — the unit is not awaiting installation on this delivery',
      );
    }
    return updated;
  }

  /**
   * Cancel an in-progress run that hasn't delivered anything: restore every
   * reserved unit to instock and mark the run cancelled. Blocked once any
   * item has deliveredAt — a physically delivered unit can't be un-delivered
   * from the office.
   */
  async cancel(deliveryId: string, organizationId: string) {
    const delivery = await this.prisma.delivery.findFirst({
      where: { id: deliveryId, organizationId },
      include: { items: true },
    });
    if (!delivery) throw new NotFoundException('Delivery not found');
    if (delivery.status !== 'in_progress') {
      throw new BadRequestException(`Only in_progress deliveries can be cancelled (status: ${delivery.status})`);
    }
    const deliveredItem = delivery.items.find((i) => i.deliveredAt !== null);
    if (deliveredItem) {
      throw new BadRequestException(
        'Cannot cancel: at least one item is already delivered. Link the delivery to a DO instead.',
      );
    }
    // Guard 2 (the gap the per-item spec closed): a linked item's unit is
    // bound into a DO slot — releasing its reservation here would strand the
    // binding. Unlink (delete the DO / its line) before cancelling.
    const linkedItem = delivery.items.find((i) => i.documentId !== null);
    if (linkedItem) {
      throw new BadRequestException(
        'Cannot cancel: at least one item is already linked to a Delivery Order.',
      );
    }

    for (const item of delivery.items) {
      if (item.inventoryId) await this.releaseUnit(item.inventoryId, delivery.deliveryNumber);
    }
    return this.prisma.delivery.update({
      where: { id: deliveryId },
      data: { status: 'cancelled' },
    });
  }
}
