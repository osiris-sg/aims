import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DeliveryStatus, InventoryStatus, Prisma } from '@prisma/client';
import { PrismaService } from 'src/common/prisma.service';
import { DocumentsService } from '../documents/documents.service';
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
   * Attach run ITEMS to an existing DO (per-item linking — one run's items may
   * fulfil different DOs). For the selection: writes DeliveryItem.documentId,
   * stamps item states onto the DO's DocumentItems (never regressing a
   * more-advanced row), mirrors Document.status by fold, and runs the DO's OWN
   * exactly-once deduction for already-delivered units (reserved units flip
   * via the widened predicate). Does NOT create/modify MSRs and does NOT fire
   * the completion gate / auto-invoice (backburnered by design).
   * Delivery.documentId (legacy run-level link) is frozen — never written.
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

    // Per-item link write. The documentId:null guard keeps a concurrent link
    // of the same item exactly-once (loser writes nothing).
    await this.prisma.deliveryItem.updateMany({
      where: { id: { in: selection.map((i) => i.id) }, documentId: null },
      data: { documentId },
    });

    // Bind each delivered unit into an unbound asset-level slot on this DO
    // FIRST (shared auto-bind helper — same semantics as tag-time binding).
    // Without this, asset-level rows would get status stamped below but be
    // invisible to the unit-keyed deduction matcher — the Layer-2 gap. Bound
    // rows become ordinary unit rows, so stamping + deduction just work.
    const unitSkus = await this.prisma.inventory.findMany({
      where: { id: { in: selection.map((i) => i.inventoryId).filter((v): v is string => !!v) } },
      select: { id: true, sku: true },
    });
    const skuById = new Map(unitSkus.map((u) => [u.id, u.sku]));
    for (const item of selection) {
      if (!item.inventoryId) continue;
      await this.documentsService
        .bindUnitToUnboundDoSlot(documentId, organizationId, {
          id: item.inventoryId,
          assetId: item.assetId,
          sku: skuById.get(item.inventoryId) ?? null,
        })
        .catch((err) => this.logger.warn(`link: auto-bind failed for unit ${item.inventoryId}: ${err?.message}`));
    }

    // Stamp item states across (unit-level match, incl. asset-level DO rows —
    // same matching family as documents.advanceDeliveryItem). Only ever
    // advances a DO row; a more-advanced DO row is left alone.
    for (const item of selection) {
      if (!item.inventoryId) continue;
      const itemMatch: Prisma.DocumentItemWhereInput[] = [
        { inventoryId: item.inventoryId },
        { itemId: item.inventoryId },
        { itemId: item.assetId, itemType: 'ASSET' },
      ];
      const rows = await this.prisma.documentItem.findMany({ where: { documentId, OR: itemMatch } });
      const docRow = rows
        .filter((r) => RANK[r.deliveryStatus] < RANK[item.deliveryStatus])
        .sort((a, b) => RANK[a.deliveryStatus] - RANK[b.deliveryStatus])[0];
      if (!docRow) continue;
      await this.prisma.documentItem.update({
        where: { id: docRow.id },
        data: {
          deliveryStatus: item.deliveryStatus,
          deliveringAt: item.deliveringAt ?? docRow.deliveringAt,
          deliveredAt: item.deliveredAt ?? docRow.deliveredAt,
          completedAt: item.completedAt ?? docRow.completedAt,
          installSkipped: item.installSkipped || docRow.installSkipped,
        },
      });
    }

    // The DO's own deduction for units the SELECTION already delivered (ack'd
    // or beyond). Exactly-once via the DocumentItem deductedAt claim; the
    // unit's reserved status flips to rental/sold through the widened predicate.
    const deliveredUnitIds = selection
      .filter((i) => i.inventoryId && RANK[i.deliveryStatus] >= RANK[DeliveryStatus.not_installed])
      .map((i) => i.inventoryId as string);
    const deducted = await this.documentsService.deductLinkedDeliveryUnits(
      documentId,
      organizationId,
      deliveredUnitIds,
    );

    // Mirror Document.status from the DO's (post-stamp) item fold. No
    // downgrade: delivered_installed is terminal. Completion gate NOT fired.
    if (document.status !== 'delivered_installed') {
      const docItems = await this.prisma.documentItem.findMany({
        where: { documentId },
        select: { deliveryStatus: true, isService: true },
      });
      const deliverable = docItems.filter((i) => !i.isService);
      if (deliverable.length > 0) {
        if (deliverable.every((i) => i.deliveryStatus === DeliveryStatus.completed)) {
          await this.prisma.document.update({ where: { id: documentId }, data: { status: 'delivered_installed' } });
        } else if (deliverable.some((i) => RANK[i.deliveryStatus] >= RANK[DeliveryStatus.not_installed])) {
          await this.prisma.document.update({ where: { id: documentId }, data: { status: 'delivered_not_installed' } });
        }
      }
    }

    this.logger.log(
      `Delivery #${delivery.deliveryNumber}: ${selection.length} item(s) linked to DO ${document.name ?? documentId} (deducted ${deducted} unit(s))`,
    );
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
