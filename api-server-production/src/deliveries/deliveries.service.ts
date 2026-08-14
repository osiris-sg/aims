import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DeliveryStatus, DeploymentStatus, DeploymentType, InventoryStatus, Prisma } from '@prisma/client';
import { PrismaService } from 'src/common/prisma.service';
import { isUnconfirmedDoc } from 'src/common/doc-status';
import { DocumentsService } from '../documents/documents.service';
import { ProjectsService } from '../projects/projects.service';
import { CreateDeliveryDto } from './dto/create-delivery.dto';
import { AddDeliveryItemDto } from './dto/add-delivery-item.dto';
import { ScheduleDeliveryDto, ClaimScheduledDto } from './dto/schedule-delivery.dto';

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

  /**
   * Non-blocking reserve for the DO-first arm (U1+items): claim
   * instock → reserved if possible, otherwise log and carry on — the daily
   * rider flow is NEVER blocked by run bookkeeping. The ack-time deduction
   * predicate already covers reserved, so a claimed unit deducts identically.
   */
  private async reserveUnitNonBlocking(inventoryId: string, deliveryNumber: number): Promise<void> {
    try {
      const claim = await this.prisma.inventory.updateMany({
        where: { id: inventoryId, status: InventoryStatus.instock },
        data: { status: InventoryStatus.reserved },
      });
      if (claim.count > 0) {
        await this.prisma.timelineItem.create({
          data: {
            message: `Unit reserved for Delivery #${deliveryNumber} (DO-first delivery started)`,
            inventoryId,
            pdfUrl: null,
          },
        });
      } else {
        this.logger.warn(`reserveUnitNonBlocking: unit ${inventoryId} not instock — proceeding unreserved`);
      }
    } catch (err: any) {
      this.logger.warn(`reserveUnitNonBlocking failed for ${inventoryId}: ${err?.message}`);
    }
  }

  /**
   * U1+items: every DO-first delivery gets a Delivery run with BORN-LINKED
   * items (DeliveryItem.documentId = the DO from birth). Find-or-create keyed
   * THROUGH THE ITEMS ({org, rider, in_progress, items.some(documentId)}) —
   * Delivery.documentId stays frozen. Run + first item are created in ONE
   * transaction: an item-less shell can never exist (it would sit in_progress
   * forever — the fold ignores empty runs). Returns the run id, or null when
   * the unit is already held by another open run (we never steal units across
   * runs; the DO_START still advances the DocumentItem ledger as today).
   * Callers treat every failure as best-effort (documentId-only MSR fallback).
   */
  async ensureOpenRunForDo(
    documentId: string,
    organizationId: string,
    riderUserId: string,
    riderName: string | null,
    unit: { assetId: string; inventoryId: string },
  ): Promise<string | null> {
    const existing = await this.prisma.delivery.findFirst({
      where: {
        organizationId,
        riderUserId,
        status: 'in_progress',
        items: { some: { documentId } },
      },
      select: { id: true, deliveryNumber: true },
    });

    // Unit already on ANY open run? Repeat scan of this DO's own run is
    // idempotent (return it); held elsewhere → skip run bookkeeping entirely.
    const held = await this.prisma.deliveryItem.findFirst({
      where: {
        inventoryId: unit.inventoryId,
        delivery: { organizationId, status: { in: ['in_progress', 'delivered'] } },
      },
      select: { id: true, deliveryId: true },
    });
    if (held) {
      if (existing && held.deliveryId === existing.id) return existing.id;
      this.logger.warn(
        `ensureOpenRunForDo: unit ${unit.inventoryId} already on open run ${held.deliveryId} — skipping`,
      );
      return null;
    }

    const asset = await this.prisma.asset.findFirst({
      where: { id: unit.assetId, organizationId },
      select: { name: true },
    });

    if (existing) {
      try {
        await this.prisma.deliveryItem.create({
          data: {
            deliveryId: existing.id,
            assetId: unit.assetId,
            inventoryId: unit.inventoryId,
            description: asset?.name,
            quantity: 1,
            documentId, // born-linked
          },
        });
      } catch (err) {
        // P2002 (deliveryId,inventoryId): raced with a duplicate scan — fine.
        if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')) throw err;
      }
      await this.reserveUnitNonBlocking(unit.inventoryId, existing.deliveryNumber);
      return existing.id;
    }

    // Fresh run: populate from the DO; run + born-linked first item in ONE tx.
    const doc = await this.prisma.document.findFirst({
      where: { id: documentId, organizationId, type: { in: ['DELIVERY_ORDER', 'DO'] } },
      select: { id: true, projectId: true, config: true },
    });
    if (!doc) return null;
    const config: any = doc.config ?? {};
    const customerId: string | undefined = config.customerId ?? config.customer?.id ?? undefined;
    const siteAddress: string | undefined = config.deliveryTo ?? undefined;

    for (let attempt = 0; attempt < 2; attempt++) {
      const latest = await this.prisma.delivery.findFirst({
        where: { organizationId },
        orderBy: { deliveryNumber: 'desc' },
        select: { deliveryNumber: true },
      });
      const deliveryNumber = (latest?.deliveryNumber ?? 0) + 1;
      try {
        const created = await this.prisma.delivery.create({
          data: {
            organizationId,
            deliveryNumber,
            riderUserId,
            riderName: riderName ?? undefined,
            projectId: doc.projectId ?? undefined,
            customerId,
            siteAddress,
            items: {
              create: [
                {
                  assetId: unit.assetId,
                  inventoryId: unit.inventoryId,
                  description: asset?.name,
                  quantity: 1,
                  documentId, // born-linked
                },
              ],
            },
          },
          select: { id: true, deliveryNumber: true },
        });
        await this.reserveUnitNonBlocking(unit.inventoryId, created.deliveryNumber);
        return created.id;
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002' && attempt === 0) {
          // deliveryNumber race — or a concurrent DO_START created the run.
          const raced = await this.prisma.delivery.findFirst({
            where: { organizationId, riderUserId, status: 'in_progress', items: { some: { documentId } } },
            select: { id: true, deliveryNumber: true },
          });
          if (raced) {
            try {
              await this.prisma.deliveryItem.create({
                data: {
                  deliveryId: raced.id,
                  assetId: unit.assetId,
                  inventoryId: unit.inventoryId,
                  description: asset?.name,
                  quantity: 1,
                  documentId,
                },
              });
            } catch (err2) {
              if (!(err2 instanceof Prisma.PrismaClientKnownRequestError && err2.code === 'P2002')) throw err2;
            }
            await this.reserveUnitNonBlocking(unit.inventoryId, raced.deliveryNumber);
            return raced.id;
          }
          continue;
        }
        throw err;
      }
    }
    return null;
  }

  // ── create / basket ──────────────────────────────────────────────────────

  /**
   * Office: pre-create a SCHEDULED run. Asset-only items (inventoryId null,
   * quantity from the office), no rider yet (status `scheduled`, riderUserId
   * null). NOTHING is reserved — no specific unit is earmarked, so there is no
   * hold to release if the run is cancelled or never picked up. A rider claims
   * it later by scanning a matching unit (claimScheduled).
   */
  async createScheduled(dto: ScheduleDeliveryDto, organizationId: string) {
    if (!dto.items?.length) throw new BadRequestException('At least one item is required');
    const assetIds = [...new Set(dto.items.map((i) => i.assetId))];
    const assets = await this.prisma.asset.findMany({
      where: { id: { in: assetIds }, organizationId, deletedAt: null },
      select: { id: true, name: true },
    });
    const assetById = new Map(assets.map((a) => [a.id, a]));
    for (const it of dto.items) {
      if (!assetById.has(it.assetId)) throw new NotFoundException(`Asset ${it.assetId} not found in this organization`);
    }

    // Per-org serial with P2002 retry (same pattern as create()).
    for (let attempt = 0; attempt < 3; attempt++) {
      const latest = await this.prisma.delivery.findFirst({
        where: { organizationId },
        orderBy: { deliveryNumber: 'desc' },
        select: { deliveryNumber: true },
      });
      const deliveryNumber = (latest?.deliveryNumber ?? 0) + 1;
      try {
        return await this.prisma.delivery.create({
          data: {
            organizationId,
            deliveryNumber,
            status: 'scheduled',
            riderUserId: null,
            riderName: null,
            scheduledFor: new Date(dto.scheduledFor),
            projectId: dto.projectId,
            customerId: dto.customerId,
            items: {
              create: dto.items.map((it) => ({
                assetId: it.assetId,
                inventoryId: null, // asset-only — bound when a rider scans a unit
                quantity: it.quantity,
                description: assetById.get(it.assetId)!.name,
              })),
            },
          },
          include: { items: true },
        });
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') continue;
        throw err;
      }
    }
    throw new BadRequestException('Could not allocate a delivery number — please retry');
  }

  /**
   * Field: a rider claims a scheduled run by scanning a unit whose ASSET matches
   * one of its open (inventoryId-null) scheduled items. Reserves the unit
   * (instock → reserved), binds it into the slot, sets the rider, and starts the
   * run (scheduled → in_progress). The rider then proceeds through the normal
   * per-item flow (photo/DO_START → ack → …) in the run basket.
   *
   * Quantity > 1: the open slot is SPLIT — its quantity is decremented and a new
   * qty-1 item carrying this unit is created, so each physical unit gets its own
   * DeliveryItem (needed for per-unit start/ack/deduction). The remaining
   * unbound quantity stays claimable by the next scan. Several different assets:
   * each has its own item; a scan only matches the slot with the same assetId.
   */
  async claimScheduled(
    deliveryId: string,
    dto: ClaimScheduledDto,
    organizationId: string,
    riderUserId: string,
  ) {
    const run = await this.prisma.delivery.findFirst({
      where: { id: deliveryId, organizationId },
      include: { items: true },
    });
    if (!run) throw new NotFoundException('Delivery not found');
    if (run.status !== 'scheduled') {
      throw new BadRequestException(`Delivery #${run.deliveryNumber} is not scheduled (status: ${run.status})`);
    }
    const slot = run.items.find((i) => i.assetId === dto.assetId && !i.inventoryId);
    if (!slot) {
      throw new BadRequestException('No open scheduled slot for this asset on this run');
    }
    const unit = await this.prisma.inventory.findFirst({
      where: { id: dto.inventoryId, assetId: dto.assetId, organizationId },
      select: { id: true, sku: true, status: true },
    });
    if (!unit) throw new NotFoundException('Scanned unit not found under this asset');

    // Reserve first (guarded instock → reserved): if the unit isn't available,
    // fail before mutating the run (matches create()'s reserve-before-create).
    await this.reserveUnit(dto.inventoryId, organizationId, run.deliveryNumber);

    await this.prisma.$transaction(async (tx) => {
      if ((slot.quantity ?? 1) > 1) {
        // Split: shrink the open slot, mint a bound qty-1 item for this unit.
        await tx.deliveryItem.update({ where: { id: slot.id }, data: { quantity: (slot.quantity ?? 1) - 1 } });
        await tx.deliveryItem.create({
          data: { deliveryId, assetId: dto.assetId, inventoryId: dto.inventoryId, quantity: 1, description: slot.description },
        });
      } else {
        await tx.deliveryItem.update({ where: { id: slot.id }, data: { inventoryId: dto.inventoryId } });
      }
      // Claim the run: assign the rider + start it. Only the FIRST claimant sets
      // the rider; a run already claimed by an earlier scan stays with that
      // rider (status is no longer `scheduled`, so a second claim is rejected
      // above and the unit routes through the normal open-run path instead).
      await tx.delivery.update({
        where: { id: deliveryId },
        data: { riderUserId, ...(dto.riderName ? { riderName: dto.riderName } : {}), status: 'in_progress', startedAt: new Date() },
      });
    });

    return { deliveryId, deliveryNumber: run.deliveryNumber, claimed: true };
  }

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

    // FREE-TYPED line: no assetId → a description-only record, no catalog lookup,
    // no reservation, no unit. Resolved to a real asset/unit office-side later.
    if (!dto.assetId) {
      const description = dto.description?.trim();
      if (!description) throw new BadRequestException('A description is required for a free-typed item');
      return this.prisma.deliveryItem.create({
        data: {
          deliveryId,
          assetId: null,
          inventoryId: null,
          description,
          quantity: dto.quantity ?? 1,
        },
      });
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
    // filter(Boolean): free-typed items have assetId null — never query for them.
    const assetIds = [...new Set(delivery.items.map((i) => i.assetId).filter((v): v is string => !!v))];
    const [units, assets, activeAssignments, reports] = await Promise.all([
      invIds.length
        ? this.prisma.inventory.findMany({
            where: { id: { in: invIds } },
            select: { id: true, sku: true, serialNumber: true, status: true },
          })
        : Promise.resolve([]),
      this.prisma.asset.findMany({ where: { id: { in: assetIds } }, select: { id: true, name: true, skuKey: true } }),
      // Active ProjectDeployment per unit (endDate=null assignment) — drives the
      // office RENTAL/SALE toggle. Null-deployment units can't be set to SALE
      // (nothing to write to) until they're assigned to a project.
      invIds.length
        ? this.prisma.assignment.findMany({
            where: { inventoryId: { in: invIds }, endDate: null, projectDeploymentId: { not: null } },
            orderBy: { startDate: 'desc' },
            select: { inventoryId: true, projectDeployment: { select: { id: true, type: true } } },
          })
        : Promise.resolve([]),
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
    // inventoryId → active ProjectDeployment (id + type). A unit has at most one
    // active assignment (fieldDeploy soft-closes the rest); take the newest to
    // be safe. Absent → the unit isn't on a project, so SALE is unavailable.
    const deploymentByInv = new Map<string, { id: string; type: string }>();
    for (const a of activeAssignments) {
      if (a.inventoryId && a.projectDeployment && !deploymentByInv.has(a.inventoryId)) {
        deploymentByInv.set(a.inventoryId, a.projectDeployment);
      }
    }
    // Derived run-level document: exactly one distinct DO across linked items.
    const distinctDocs = [...new Map(
      delivery.items.filter((i) => i.document).map((i) => [i.document!.id, i.document!]),
    ).values()];
    const runDoc = distinctDocs.length === 1 ? distinctDocs[0] : null;
    // Draft invoice auto-created from that DO on run completion (sourceDocumentId
    // link) — powers the field "what happened" result panel. Null until the
    // completion wrapper has run (or for office-linked/DO-first runs).
    const invoice = runDoc
      ? await this.prisma.document.findFirst({
          where: {
            organizationId,
            type: 'INVOICE',
            config: { path: ['sourceDocumentId'], equals: runDoc.id },
          },
          select: { id: true, name: true, status: true },
        })
      : null;
    return {
      ...delivery,
      document: runDoc,
      invoice,
      items: delivery.items.map((i) => ({
        ...i,
        inventory: i.inventoryId ? unitById.get(i.inventoryId) ?? null : null,
        asset: assetById.get(i.assetId) ?? null,
        // Active ProjectDeployment for the RENTAL/SALE toggle (null → unassigned,
        // SALE disabled). Type mirrors ProjectDeployment.type.
        deployment: i.inventoryId ? deploymentByInv.get(i.inventoryId) ?? null : null,
      })),
      reports,
    };
  }

  /**
   * Office action (Deliveries page): set a delivered unit's commercial intent
   * (RENTAL vs SALE) for a delivery-run item. Writes ONLY the item's active
   * ProjectDeployment.type — never Inventory.status. The reserved → rental/sold
   * flip stays with DO-confirm (deductDocumentItemStock) and the standalone ack
   * (advanceDeliveryItem), both of which READ this type, so there is exactly one
   * flip path and no duplication. SALE requires the unit to already be on a
   * project (a ProjectDeployment to write); RENTAL is the default.
   */
  async setItemDeploymentType(
    deliveryId: string,
    inventoryId: string,
    type: 'RENTAL' | 'SALE',
    organizationId: string,
  ) {
    // Org-scope + membership check: the unit must be an item on THIS run.
    const item = await this.prisma.deliveryItem.findFirst({
      where: { inventoryId, delivery: { id: deliveryId, organizationId } },
      select: { id: true },
    });
    if (!item) throw new NotFoundException('Delivery item not found for this unit');

    const assignment = await this.prisma.assignment.findFirst({
      where: { inventoryId, endDate: null, projectDeploymentId: { not: null } },
      orderBy: { startDate: 'desc' },
      select: { projectDeploymentId: true },
    });
    if (!assignment?.projectDeploymentId) {
      throw new BadRequestException(
        'Unit is not assigned to a project yet — assign it to a project before choosing Sale',
      );
    }

    const deploymentType = type === 'SALE' ? DeploymentType.SALE : DeploymentType.RENTAL;
    await this.prisma.projectDeployment.update({
      where: { id: assignment.projectDeploymentId },
      data: { type: deploymentType },
    });
    return { inventoryId, deploymentId: assignment.projectDeploymentId, type: deploymentType };
  }

  async list(
    organizationId: string,
    opts: {
      unlinked?: boolean;
      status?: string;
      page?: number;
      limit?: number;
      // Rider "resume unfinished" view: mine → scope to this rider's own runs;
      // unfinished → status in {in_progress, delivered} (exclude terminal).
      mine?: boolean;
      riderUserId?: string;
      unfinished?: boolean;
    } = {},
  ) {
    const page = Math.max(1, opts.page ?? 1);
    const limit = Math.min(100, Math.max(1, opts.limit ?? 20));
    // "Unlinked" is per-item now: a run stays in the queue while ANY item has
    // no DO. Cancelled runs drop out of the queue view (their items will never
    // be linked) unless the caller asked for them by status explicitly.
    const where: Prisma.DeliveryWhereInput = {
      organizationId,
      ...(opts.mine && opts.riderUserId ? { riderUserId: opts.riderUserId } : {}),
      ...(opts.unlinked ? { items: { some: { documentId: null } } } : {}),
      ...(opts.status
        ? { status: opts.status as any }
        : opts.unfinished
          ? { status: { in: ['in_progress', 'delivered'] as any } }
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
              inventoryId: true,
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
    // Enrich items with unit sku/serial (DeliveryItem.inventoryId is a scalar
    // column, no relation — one batch lookup, same pattern as findById). Powers
    // the resume list's "LION375-001 +2" row label and SKU/serial search.
    const invIds = [
      ...new Set(docs.flatMap((d) => d.items.map((i) => i.inventoryId).filter((v): v is string => !!v))),
    ];
    const units = invIds.length
      ? await this.prisma.inventory.findMany({
          where: { id: { in: invIds } },
          select: { id: true, sku: true, serialNumber: true },
        })
      : [];
    const unitById = new Map(units.map((u) => [u.id, u]));
    const enriched = docs.map((d) => ({
      ...d,
      items: d.items.map((i) => ({
        ...i,
        sku: i.inventoryId ? (unitById.get(i.inventoryId)?.sku ?? null) : null,
        serialNumber: i.inventoryId ? (unitById.get(i.inventoryId)?.serialNumber ?? null) : null,
      })),
    }));
    return { docs: enriched, total, page, limit };
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

    // Hand-off flip (assign-at-start deferral): at ACK the unit has been handed
    // over, so flip reserved → rental/sold per its active ProjectDeployment.type
    // (default rental when unassigned — a delivered unit is a rental). Idempotent:
    // only from instock/reserved, so it's a no-op if a DO deduction or a prior
    // ack already moved it. Standalone arm only — DO-first uses dualAdvance, which
    // owns the deduction flip.
    if (action === 'ack') {
      const activeAssignment = await this.prisma.assignment.findFirst({
        where: { inventoryId, endDate: null, projectDeploymentId: { not: null } },
        orderBy: { startDate: 'desc' },
        select: { projectDeployment: { select: { type: true } } },
      });
      const flipTo =
        activeAssignment?.projectDeployment?.type === DeploymentType.SALE
          ? InventoryStatus.sold
          : InventoryStatus.rental;
      await this.prisma.inventory.updateMany({
        where: {
          id: inventoryId,
          organizationId,
          status: { in: [InventoryStatus.instock, InventoryStatus.reserved] },
        },
        data: { status: flipTo },
      });
    }

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
      select: {
        id: true,
        status: true,
        completedAt: true,
        items: { select: { deliveryStatus: true } },
      },
    });
    // `scheduled` is guarded like `cancelled`: an unclaimed scheduled run must
    // never be folded into in_progress by a stray recompute (its asset-only
    // items are not_delivered). The rider's claim transitions it explicitly.
    if (
      !delivery ||
      delivery.status === 'cancelled' ||
      delivery.status === 'scheduled' ||
      delivery.items.length === 0
    )
      return;

    // Fold over ALL items — unit-backed AND free-typed. Free-typed lines are
    // full delivery participants now (marked delivered via markFreeTypedDelivered),
    // so a run isn't `completed` until they are too. Monotonic in practice: a
    // free-typed line is added only pre-ack (run still in_progress) and only ever
    // advances, so this never downgrades a run.
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
      // Standalone completion hook: the FIRST time a run reaches `completed`,
      // auto-create a real DO from it, commit it, and fire a DRAFT invoice.
      // Guarded to genuine standalone runs inside the wrapper; best-effort so a
      // failure never rolls back the run's completion.
      if (target === 'completed') {
        await this.autoCreateDoOnRunCompletion(deliveryId, organizationId);
      }
    }
  }

  /**
   * Standalone completion → real DO + commit + DRAFT invoice.
   *
   * When a STANDALONE run (no DO yet) reaches `completed`, mint a real Delivery
   * Order from it, commit it (stamp DocumentItems completed from the run, deduct
   * stock, Document.status → delivered_installed), and fire the completion gate
   * so an INVOICE is auto-created — as an UNCONFIRMED DRAFT the office prices
   * before confirming (zero-value lines are expected; there is no pricing source
   * in the field).
   *
   * ADDITIVE + STANDALONE-ONLY. The completion gate is fired HERE, not inside
   * the shared `commitLinkedDeliveryItems` — so the DO-first / office-confirm
   * callers of that committer are byte-identical (no auto-invoice on their
   * path). Only a whole, still-unlinked run at completion takes this route; the
   * office "Create DO from selected" button and per-item linking are untouched.
   *
   * Best-effort: every failure is logged, never thrown — the rider's completion
   * must not roll back. The field result panel derives what actually happened
   * from persisted state (findById returns the DO + the draft invoice).
   */
  private async autoCreateDoOnRunCompletion(deliveryId: string, organizationId: string) {
    try {
      const delivery = await this.prisma.delivery.findFirst({
        where: { id: deliveryId, organizationId },
        select: { id: true, deliveryNumber: true, items: { select: { documentId: true } } },
      });
      if (!delivery || delivery.items.length === 0) return;
      // Only genuine standalone runs: EVERY item still unlinked. A DO-first run
      // (born-linked items) or an office-linked run already has its DO — skip.
      if (delivery.items.some((i) => i.documentId)) return;

      // 1. Real DO from the run (createDoFromDelivery links the run's items).
      const created = await this.createDoFromDelivery(deliveryId, organizationId);
      const doId = (created as { createdDocumentId?: string })?.createdDocumentId;
      if (!doId) return;

      // 2. Commit immediately (the reversal): stamp DocumentItems completed from
      //    the run, deduct stock, set delivered_installed. Uses the shared
      //    committer unchanged; we simply call it for a just-completed run rather
      //    than deferring to a manual confirm.
      await this.documentsService.commitLinkedDeliveryItems(doId, organizationId);

      // 3. Fire the completion gate → DRAFT (unconfirmed) invoice, idempotent.
      await this.documentsService.maybeCompleteDeliveryOrderAndInvoice(doId, organizationId);

      this.logger.log(
        `Delivery #${delivery.deliveryNumber}: completion auto-created DO ${doId} + draft invoice`,
      );
    } catch (err: any) {
      this.logger.error(
        `autoCreateDoOnRunCompletion failed for delivery ${deliveryId}: ${err?.message}`,
        err?.stack,
      );
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
   * This is the OFFICE's manual per-item link (and the target of "Create DO
   * from selected"): it does NOT fire the completion gate / auto-invoice —
   * commitment defers to the DO's own confirm. That is separate from a
   * STANDALONE run that COMPLETES, which now auto-creates + commits its own DO
   * and fires a draft invoice (see autoCreateDoOnRunCompletion). Does not
   * create/modify MSRs; Delivery.documentId (legacy run-level link) stays frozen.
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

    // Stamp the run's proof MSRs for the linked units onto the DO, so a DO
    // created from a standalone delivery surfaces the SAME photo set as a
    // native DO. The DO photo view (documents.getById → maintenanceReports)
    // joins on MSR.documentId; standalone MSRs carry deliveryId with
    // documentId=null, so without this they never appear. Scoped to the linked
    // units' DO_* proof reports; documentId:null guard = exactly-once (a
    // re-link, or an already-DO-first MSR, is untouched). NOTE: a bare
    // documentId update does NOT re-run applyDeliveryItemTransition (that fires
    // only on MSR create/sign), so the delivery state machine / deduction are
    // unaffected — this is a reporting-link only.
    const linkedInventoryIds = selection
      .map((i) => i.inventoryId)
      .filter((v): v is string => !!v);
    if (linkedInventoryIds.length) {
      await this.prisma.maintenanceServiceReport.updateMany({
        where: {
          deliveryId,
          organizationId,
          inventoryId: { in: linkedInventoryIds },
          kind: { in: ['DO_START', 'DO_ACK', 'DO_INSTALL'] as any },
          documentId: null,
        },
        data: { documentId },
      });
    }

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

    // Enrich lines with the unit's real serial + the asset's model (skuKey) so
    // the DO preview can render the office's grouped format. ONE config line is
    // kept per unit — per-unit DocumentItems are load-bearing for the DO's
    // exactly-once stock deduction (deductDocumentItemStock matches by
    // inventoryId), so lines must NOT be collapsed here; the preview groups
    // consecutive same-asset lines for display via the `deliveryGroup` marker.
    const invIds = selection.map((i) => i.inventoryId).filter((v): v is string => !!v);
    const units = invIds.length
      ? await this.prisma.inventory.findMany({
          where: { id: { in: invIds } },
          select: { id: true, sku: true, serialNumber: true, year: true, assetId: true, asset: { select: { skuKey: true, name: true } } },
        })
      : [];
    const unitById = new Map(units.map((u) => [u.id, u]));

    // Per-unit commercial intent (RENTAL/SALE) for the line verb ("Rental of…"
    // vs "Sale of…"). Read from each unit's active ProjectDeployment.type — the
    // same source the office Rental/Sale toggle writes. Default RENTAL when a
    // unit isn't on a deployment.
    const activeAssignments = invIds.length
      ? await this.prisma.assignment.findMany({
          where: { inventoryId: { in: invIds }, endDate: null, projectDeploymentId: { not: null } },
          orderBy: { startDate: 'desc' },
          select: { inventoryId: true, projectDeployment: { select: { type: true } } },
        })
      : [];
    const depTypeByInv = new Map<string, string>();
    for (const a of activeAssignments) {
      if (a.inventoryId && a.projectDeployment && !depTypeByInv.has(a.inventoryId)) {
        depTypeByInv.set(a.inventoryId, a.projectDeployment.type);
      }
    }

    // Attention / Mobile from the customer's PRIMARY contact (isPrimary=true).
    // Only when a contact is explicitly flagged primary — never guess among
    // several. Mobile prefers the contact's own phone, else the customer
    // mainline. Name-without-phone sets Attention only (the DO header hides the
    // blank Mobile row independently). Shape matches what the Biofuel DO header
    // reads: config.attention.{name, phoneNumber}.
    let attention: { name: string; phoneNumber?: string } | undefined;
    if (delivery.customerId) {
      const primary = await this.prisma.customerContact.findFirst({
        where: { customerId: delivery.customerId, isPrimary: true },
        select: { name: true, phone: true },
      });
      if (primary?.name) {
        const phone = primary.phone || delivery.customer?.phone || undefined;
        attention = { name: primary.name, ...(phone ? { phoneNumber: phone } : {}) };
      }
    }

    const config: Record<string, any> = {
      items: selection.map((i) => {
        const u = i.inventoryId ? unitById.get(i.inventoryId) : null;
        const depType = i.inventoryId ? depTypeByInv.get(i.inventoryId) : undefined;
        return {
          // Per-line description is the product name; the preview builds the
          // "Rental/Sale of N units of … / Model: … / Year: … / S/No.: …" block
          // from the group.
          description: i.description ?? u?.asset?.name ?? u?.sku ?? '',
          quantity: i.quantity,
          unitPrice: 0,
          amount: 0,
          ...(i.inventoryId
            ? {
                inventoryItemId: i.inventoryId,
                // S/No. = Inventory.sku. This fleet is identifier-as-SKU: the
                // tech-entered nameplate identifier (e.g. MG20250057, AIS2026032)
                // is stored in `sku`; `serialNumber` is null for ~92% of units.
                // So `sku` is the real-world serial the office writes on the DO.
                // Omit when the unit somehow has no sku (preview drops the row).
                ...(u?.sku ? { serialNumbers: [u.sku] } : {}),
                // Model → both the display group's "Model:" row (skuKey) AND the
                // document's Product Code column (itemCode), mirroring /submit so
                // the code column isn't blank on delivery-created DOs.
                ...(u?.asset?.skuKey ? { skuKey: u.asset.skuKey, itemCode: u.asset.skuKey } : {}),
                // Manufacture year — display-only; the preview emits "Year:" when
                // a group's units agree. Omitted when null (the common case today).
                ...(u?.year != null ? { year: u.year } : {}),
                // Per-asset group key + commercial verb — display-only, consumed
                // by the preview's grouping (createDoFromDelivery is the only writer).
                ...(u?.assetId ? { deliveryGroup: u.assetId } : {}),
                ...(depType ? { deploymentType: depType } : {}),
              }
            : {}),
        };
      }),
      ...(delivery.siteAddress ? { deliveryTo: delivery.siteAddress } : {}),
      ...(attention ? { attention } : {}),
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
    dto: { projectId: string; inventoryId: string },
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
    // Assign is now the LAST step of STARTING a delivery (moved off after-ack
    // 2026-08): the unit is `delivering` (DO_START fired), not yet acknowledged.
    // Guard = the delivery has started (item ≥ delivering). We deliberately no
    // longer require a DO_ACK — that comes later, at hand-off.
    if (RANK[item.deliveryStatus] < RANK[DeliveryStatus.delivering]) {
      throw new BadRequestException('Start the unit’s delivery before assigning');
    }

    const project = await this.prisma.project.findFirst({
      where: { id: dto.projectId, organizationId },
      select: { id: true, customerId: true },
    });
    if (!project) throw new NotFoundException('Project not found in this organization');

    // No `type` → fieldDeploy defaults to RENTAL (rental-vs-sale is an office/DO
    // decision). deferStatusFlip: the unit is still on the truck (reserved) — the
    // Assignment + ProjectDeployment are created now, but the status flip to
    // rental/sold is deferred to the ack-time hand-off (advanceDeliveryItem).
    const result = await this.projectsService.fieldDeploy(dto.projectId, organizationId, {
      inventoryId: dto.inventoryId,
      assetId: item.assetId,
      autoBind: false,
      deferStatusFlip: true,
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
   * Mark a FREE-TYPED item delivered. Free-typed lines (assetId AND inventoryId
   * both null) have no unit to scan, so they can't ride the MSR-driven unit
   * machine (advanceDeliveryItem, keyed by inventoryId). Instead the rider taps
   * one "Mark delivered" button in the basket, keyed by DeliveryItem.id, which
   * advances the line straight to `completed` — no delivering/not_installed
   * hops, no install prompt, no MSR (MSR requires an assetId), no signature (the
   * run's customer signature on a unit's DO_ACK already covers the hand-over).
   * NO stock work: there's no unit to reserve/flip/deduct.
   *
   * deliveredAt is left NULL on purpose — completion here is a bookkeeping tick,
   * not a unit hand-off, so it never trips cancel()'s "physically delivered"
   * block. The item-null guard makes this endpoint unable to touch a unit row.
   */
  async markFreeTypedDelivered(deliveryId: string, itemId: string, organizationId: string) {
    const delivery = await this.prisma.delivery.findFirst({
      where: { id: deliveryId, organizationId },
      select: { id: true, status: true },
    });
    if (!delivery) throw new NotFoundException('Delivery not found');
    if (delivery.status === 'cancelled') {
      throw new BadRequestException('Cannot mark items on a cancelled delivery');
    }

    const item = await this.prisma.deliveryItem.findFirst({
      where: { id: itemId, deliveryId },
      select: { id: true, assetId: true, inventoryId: true, deliveryStatus: true },
    });
    if (!item) throw new NotFoundException('Item is not on this delivery');
    // Guard: ONLY genuinely free-typed lines. A unit row must go through the
    // scan-driven ack flow so its stock/flip side-effects fire — never here.
    if (item.assetId !== null || item.inventoryId !== null) {
      throw new BadRequestException('This action is only for free-typed items — scan the unit to deliver it');
    }
    if (item.deliveryStatus === DeliveryStatus.completed) {
      throw new BadRequestException('Item is already delivered');
    }

    await this.prisma.deliveryItem.update({
      where: { id: item.id },
      data: { deliveryStatus: DeliveryStatus.completed, completedAt: new Date() },
    });
    await this.recomputeRunStatus(deliveryId, organizationId);
    return this.prisma.deliveryItem.findUnique({ where: { id: item.id } });
  }

  /**
   * Append condition photos to a unit's EXISTING DO_START report — the rider
   * captured more after starting the delivery. Never creates a second DO_START;
   * pushes the new S3 keys onto the one report's photos array. Allowed while the
   * run is open (not cancelled) and the item isn't completed, and only after the
   * unit's delivery has actually started (a DO_START exists).
   */
  async addItemPhotos(
    deliveryId: string,
    dto: { inventoryId: string; photos: string[] },
    organizationId: string,
  ) {
    const delivery = await this.prisma.delivery.findFirst({
      where: { id: deliveryId, organizationId },
      include: { items: true },
    });
    if (!delivery) throw new NotFoundException('Delivery not found');
    if (delivery.status === 'cancelled') throw new BadRequestException('Cannot add photos to a cancelled delivery');
    const item = delivery.items.find((i) => i.inventoryId === dto.inventoryId);
    if (!item) throw new NotFoundException('Unit is not on this delivery');
    if (item.deliveryStatus === DeliveryStatus.completed) {
      throw new BadRequestException('Unit is already completed');
    }
    const keys = (dto.photos ?? []).map((k) => String(k).trim()).filter(Boolean);
    if (!keys.length) throw new BadRequestException('No photos to add');

    // The unit's DO_START (earliest, in case of legacy duplicates). Its photos
    // are the outbound condition evidence we append to.
    const start = await this.prisma.maintenanceServiceReport.findFirst({
      where: { deliveryId, inventoryId: dto.inventoryId, kind: 'DO_START' as any },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (!start) {
      throw new BadRequestException('Start the unit’s delivery before adding photos');
    }
    const updated = await this.prisma.maintenanceServiceReport.update({
      where: { id: start.id },
      data: { photos: { push: keys } },
      select: { id: true, photos: true },
    });
    return { reportId: updated.id, added: keys.length, total: updated.photos.length };
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
    // Scheduled runs cancel freely (asset-only, nothing reserved → nothing to
    // release); in_progress runs cancel only when nothing is delivered/linked
    // (guarded below).
    if (delivery.status !== 'in_progress' && delivery.status !== 'scheduled') {
      throw new BadRequestException(`Only scheduled or in_progress deliveries can be cancelled (status: ${delivery.status})`);
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
      if (!item.inventoryId) continue;
      // Assign-at-start edge: a started unit may carry a start-time Assignment +
      // ProjectDeployment (deferred flip → still reserved, never rental). Cancel
      // undoes them so the released unit carries no lingering project link.
      // Nothing was delivered/linked (guarded above), so the unit's only active
      // assignment is this run's start-time one.
      const activeAssignments = await this.prisma.assignment.findMany({
        where: { inventoryId: item.inventoryId, endDate: null },
        select: { id: true, projectDeploymentId: true },
      });
      if (activeAssignments.length) {
        await this.prisma.assignment.updateMany({
          where: { id: { in: activeAssignments.map((a) => a.id) } },
          data: { endDate: new Date() },
        });
        const depIds = activeAssignments.map((a) => a.projectDeploymentId).filter((v): v is string => !!v);
        if (depIds.length) {
          await this.prisma.projectDeployment.updateMany({
            where: { id: { in: depIds }, status: DeploymentStatus.ACTIVE },
            data: { status: DeploymentStatus.CANCELLED },
          });
        }
      }
      await this.releaseUnit(item.inventoryId, delivery.deliveryNumber);
    }
    return this.prisma.delivery.update({
      where: { id: deliveryId },
      data: { status: 'cancelled' },
    });
  }
}
