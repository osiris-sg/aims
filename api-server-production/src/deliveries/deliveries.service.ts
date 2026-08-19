import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { AssetClass, DeliveryDirection, DeliveryStatus, DeploymentStatus, DeploymentType, InventoryStatus, Prisma } from '@prisma/client';
import { PrismaService } from 'src/common/prisma.service';
import { isUnconfirmedDoc } from 'src/common/doc-status';
import { resolveLineAssetClass } from 'src/common/asset-class';
import { DocumentsService } from '../documents/documents.service';
import { ProjectsService } from '../projects/projects.service';
import { CreateDeliveryDto } from './dto/create-delivery.dto';
import { AddDeliveryItemDto } from './dto/add-delivery-item.dto';
import { ScheduleDeliveryDto, ClaimScheduledDto } from './dto/schedule-delivery.dto';
import { ScheduleReturnDto } from './dto/schedule-return.dto';

// Item-lifecycle rank for folds/comparisons. Shared enum with DocumentItem:
// not_delivered → delivering → not_installed → completed (monotonic).
const RANK: Record<DeliveryStatus, number> = {
  [DeliveryStatus.not_delivered]: 0,
  [DeliveryStatus.delivering]: 1,
  [DeliveryStatus.not_installed]: 2,
  [DeliveryStatus.completed]: 3,
};

/** Thrown to skip DO creation for a draft; caught by the same best-effort catch. */
class SkipDraftDo extends Error {}

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
  /** Resolve ONE DELIVERY_ORDER template id for the org (mirrors createDoFromDelivery). */
  private async resolveDeliveryOrderTemplateId(organizationId: string): Promise<string> {
    const type = 'DELIVERY_ORDER';
    const selections = await this.prisma.organizationActiveTemplate.findMany({ where: { organizationId, type } });
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
    return tmpl.id;
  }

  /**
   * Attention snapshot for a DO from the PROJECT's contacts (ProjectContact →
   * CustomerContact, OSI-84). "First" = the contact flagged primary where one
   * exists, else the earliest-attached (link createdAt asc). Returns the frozen
   * `{ name, phoneNumber?, email? }` shape config.attention uses; undefined when
   * the project has no contacts. Used by both the scheduled DO and the
   * completion-created DO so the two derive attention identically.
   */
  private async projectFirstContactAttention(
    projectId: string | null | undefined,
    organizationId: string,
  ): Promise<{ name: string; phoneNumber?: string; email?: string } | undefined> {
    if (!projectId) return undefined;
    const links = await this.prisma.projectContact.findMany({
      where: { projectId, project: { is: { organizationId } } },
      orderBy: { createdAt: 'asc' },
      select: { customerContact: { select: { name: true, phone: true, email: true, isPrimary: true } } },
    });
    const contacts = links.map((l) => l.customerContact).filter((c): c is NonNullable<typeof c> => !!c?.name);
    if (contacts.length === 0) return undefined;
    const chosen = contacts.find((c) => c.isPrimary) ?? contacts[0];
    return {
      name: chosen.name,
      ...(chosen.phone ? { phoneNumber: chosen.phone } : {}),
      ...(chosen.email ? { email: chosen.email } : {}),
    };
  }

  /**
   * Resolve the Attention snapshot for a scheduled DO: the office dialog's value
   * wins (item 2 — prefilled from the project's contacts but editable), else it
   * is derived from the project's first contact. Trims and drops a blank name.
   */
  private async resolveScheduleAttention(
    dto: ScheduleDeliveryDto,
    organizationId: string,
  ): Promise<{ name: string; phoneNumber?: string; email?: string } | undefined> {
    const typed = dto.attention;
    if (typed?.name?.trim()) {
      return {
        name: typed.name.trim(),
        ...(typed.phoneNumber?.trim() ? { phoneNumber: typed.phoneNumber.trim() } : {}),
        ...(typed.email?.trim() ? { email: typed.email.trim() } : {}),
      };
    }
    return this.projectFirstContactAttention(dto.projectId, organizationId);
  }

  /**
   * Build the draft-DO config fragment for a scheduled delivery (items + header
   * fields). Shared by createScheduled and updateScheduled so the two never drift.
   * Catalog lines are EXPANDED to N x qty-1 asset slots (each unit binds its own
   * slot + stamps its own serial); free-typed lines stay a single description row.
   */
  private buildScheduledDoConfig(params: {
    items: ScheduleDeliveryDto['items'];
    assetById: Map<string, { id: string; name: string; skuKey: string | null }>;
    projectName: string;
    deliveryAddress: string;
    poNumber?: string;
    machineLocation?: string;
    customer: { id: string; name: string; customerCode: string | null; address: string | null; email: string | null } | null;
    // Frozen per-document Attention snapshot (name/phone/email). From the office
    // dialog when it sent one, else derived from the project's first contact.
    attention?: { name: string; phoneNumber?: string; email?: string };
  }): Record<string, any> {
    const { items, assetById, projectName, deliveryAddress, poNumber, machineLocation, customer, attention } = params;
    return {
      items: items.flatMap((it) => {
        if (!it.assetId) {
          return [{ description: it.description?.trim() ?? '', quantity: it.quantity, unitPrice: 0, amount: 0 }];
        }
        const a = assetById.get(it.assetId)!;
        return Array.from({ length: it.quantity }, () => ({
          assetId: it.assetId,
          sku: a.skuKey,
          itemCode: a.skuKey,
          skuKey: a.skuKey,
          description: a.name,
          quantity: 1,
          unitPrice: 0,
          amount: 0,
          deliveryGroup: it.assetId,
        }));
      }),
      ...(poNumber ? { poNo: poNumber } : {}),
      projectName,
      documentInfo: { projectName },
      ...(attention?.name ? { attention } : {}),
      ...(deliveryAddress ? { deliveryTo: deliveryAddress } : {}),
      ...(machineLocation?.trim() ? { machineLocation: machineLocation.trim() } : {}),
      ...(customer
        ? {
            customerId: customer.id,
            customerName: customer.name,
            ...(customer.customerCode ? { customerCode: customer.customerCode } : {}),
            ...(customer.address ? { customerAddress: customer.address } : {}),
            ...(customer.email ? { customerEmail: customer.email } : {}),
          }
        : {}),
    };
  }

  async createScheduled(dto: ScheduleDeliveryDto, organizationId: string) {
    // A DRAFT is a partly-filled schedule the office can come back to. Saved
    // with whatever exists, however little, and NOT a real scheduled run:
    // excluded from every rider-facing query and from claim / merge / fold /
    // cancel, and it mints NO Delivery Order. The DO is created when the draft
    // is PROMOTED to a real schedule (updateScheduled).
    const isDraft = dto.isDraft === true;
    if (!isDraft && !dto.items?.length) throw new BadRequestException('At least one item is required');
    // projectId is REQUIRED (post-assign matching keys on it). Validate it up
    // front and derive the customer from the project when the office didn't send
    // one — the scheduled run must carry BOTH so the draft DO gets a customer and
    // the rider's project pick can later resolve back to this run.
    const project = dto.projectId
      ? await this.prisma.project.findFirst({
          where: { id: dto.projectId, organizationId },
          select: { id: true, name: true, customerId: true },
        })
      : null;
    if (!project && !isDraft) throw new NotFoundException('Project not found in this organization');
    const customerId = dto.customerId ?? project?.customerId ?? undefined;
    // Delivery address: what the office typed (dto.address) wins; else default to
    // the project NAME (for this fleet the project name IS its site address).
    // Lands on the DO's Deliver To.
    const deliveryAddress = (dto.address?.trim() || project?.name || '').trim();
    const assetIds = [...new Set((dto.items ?? []).map((i) => i.assetId).filter((v): v is string => !!v))];
    const assets = await this.prisma.asset.findMany({
      where: { id: { in: assetIds }, organizationId, deletedAt: null },
      select: { id: true, name: true, skuKey: true },
    });
    const assetById = new Map(assets.map((a) => [a.id, a]));
    // Each line is EITHER a catalog product (assetId) OR a FREE-TYPED line
    // (description only, no assetId). Free-typed slots carry through to the DO as
    // a description line but can never be unit-bound by a rider (nothing to match).
    for (const it of dto.items) {
      if (it.assetId && !assetById.has(it.assetId)) throw new NotFoundException(`Asset ${it.assetId} not found in this organization`);
      if (!it.assetId && !it.description?.trim()) throw new BadRequestException('A free-typed item needs a description');
    }
    const lineDescription = (it: { assetId?: string; description?: string }) =>
      it.assetId ? assetById.get(it.assetId)!.name : (it.description?.trim() ?? '');

    // 1. Create the scheduled run (asset-only items). Per-org serial + P2002 retry.
    let run: Prisma.DeliveryGetPayload<{ include: { items: true } }> | null = null;
    for (let attempt = 0; attempt < 3 && !run; attempt++) {
      const latest = await this.prisma.delivery.findFirst({
        where: { organizationId },
        orderBy: { deliveryNumber: 'desc' },
        select: { deliveryNumber: true },
      });
      const deliveryNumber = (latest?.deliveryNumber ?? 0) + 1;
      try {
        run = await this.prisma.delivery.create({
          data: {
            organizationId,
            deliveryNumber,
            status: 'scheduled',
            riderUserId: null,
            riderName: null,
            isDraft,
            scheduledFor: dto.scheduledFor ? new Date(dto.scheduledFor) : null,
            projectId: dto.projectId ?? null,
            customerId,
            ...(deliveryAddress ? { siteAddress: deliveryAddress } : {}),
            items: {
              // A qty-N catalog line becomes N qty-1 SLOTS, so every position the
              // rider walks is a real row that can carry its own status and
              // skippedAt. This also matches what the draft DO already does with
              // its lines, so DeliveryItem and the DO config finally agree.
              // Free-typed lines have no unit to bind and stay a single row.
              create: (dto.items ?? []).flatMap((it, lineIdx) => {
                const base = {
                  assetId: it.assetId ?? null, // null = free-typed (never unit-bound)
                  inventoryId: null as string | null, // bound when a rider scans a unit
                  description: lineDescription(it),
                  // Only a free-typed line stores its own class; a catalog line
                  // reads it off the asset, so leave that null.
                  assetClass: it.assetId ? null : it.assetClass ?? AssetClass.EQUIPMENT,
                };
                if (!it.assetId) return [{ ...base, quantity: it.quantity, sortOrder: lineIdx * 100 }];
                return Array.from({ length: Math.max(1, it.quantity) }, (_, n) => ({
                  ...base,
                  quantity: 1,
                  // Gaps of 100 leave room to insert without renumbering.
                  sortOrder: lineIdx * 100 + n,
                }));
              }),
            },
          },
          include: { items: true },
        });
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') continue;
        throw err;
      }
    }
    if (!run) throw new BadRequestException('Could not allocate a delivery number — please retry');

    // 2. Create the DRAFT DO immediately (asset-level lines, PO number, customer),
    //    and born-link the run's items to it (DeliveryItem.documentId). The office
    //    prices it before the rider goes out; completion commits THIS DO rather
    //    than creating a new one. Best-effort: if DO creation fails the run stays
    //    unlinked and the Stage-2 completion auto-create is the fallback.
    let documentId: string | undefined;
    // NO DO FOR A DRAFT. A draft is not a commitment: minting a Delivery Order
    // for one would leave an orphan document behind every abandoned draft, and
    // would consume a DO-PENDING placeholder number for a run that may never
    // happen. The DO is created at PROMOTION instead (updateScheduled).
    try {
      if (isDraft) throw new SkipDraftDo();
      const templateId = await this.resolveDeliveryOrderTemplateId(organizationId);
      const customer = customerId
        ? await this.prisma.customer.findFirst({
            where: { id: customerId, organizationId },
            select: { id: true, name: true, customerCode: true, email: true, phone: true, address: true },
          })
        : null;
      const attention = await this.resolveScheduleAttention(dto, organizationId);
      const doConfig = this.buildScheduledDoConfig({
        items: dto.items,
        assetById,
        projectName: project.name,
        deliveryAddress,
        poNumber: dto.poNumber,
        machineLocation: dto.machineLocation,
        customer,
        attention,
      });
      // OSI-83: a scheduled DRAFT must NOT consume a real DO number — mint a
      // per-org placeholder (DO-PENDING-NN); the real number is claimed when the
      // office confirms the DO. Max-of-existing so it survives arbitrary padding.
      const pendings = await this.prisma.document.findMany({
        where: { organizationId, name: { startsWith: 'DO-PENDING-' } },
        select: { name: true },
      });
      const maxPending = pendings.reduce((mx, d) => {
        const mm = d.name?.match(/-(\d+)$/);
        return mm ? Math.max(mx, parseInt(mm[1], 10)) : mx;
      }, 0);
      const placeholderName = `DO-PENDING-${String(maxPending + 1).padStart(2, '0')}`;
      const doc = await this.documentsService.createBasicDocument(templateId, 'DELIVERY_ORDER', organizationId, doConfig, dto.projectId, undefined, placeholderName);
      documentId = doc.id;
      await this.prisma.deliveryItem.updateMany({ where: { deliveryId: run.id }, data: { documentId: doc.id } });
    } catch (err: any) {
      // A draft deliberately skipped the DO; that is not a failure.
      if (!(err instanceof SkipDraftDo)) {
        this.logger.error(`createScheduled: draft DO creation failed for delivery ${run.id}: ${err?.message}`, err?.stack);
      }
    }

    return { ...run, documentId };
  }

  /**
   * Office: edit a still-SCHEDULED delivery run (items, date, PO, address, machine
   * location, customer/project). ONLY while `scheduled` and nothing has been
   * bound — once a rider starts (status flips off `scheduled`) this is rejected,
   * because bound units + in-flight proof can't be safely swapped. Replaces the
   * item set and REGENERATES the born-linked draft DO from the new form.
   */
  async updateScheduled(id: string, dto: ScheduleDeliveryDto, organizationId: string) {
    const run = await this.prisma.delivery.findFirst({
      where: { id, organizationId },
      include: { items: { select: { id: true, documentId: true } } },
    });
    if (!run) throw new NotFoundException('Delivery not found');
    if (run.status !== 'scheduled') {
      throw new BadRequestException(
        `Only a scheduled run can be edited (this one is ${run.status}). Once a rider starts, it can no longer be changed.`,
      );
    }
    if (run.direction === DeliveryDirection.RETURN) {
      throw new BadRequestException('This endpoint edits scheduled deliveries, not returns.');
    }
    // PROMOTION: saving a COMPLETE form with isDraft absent/false turns a draft
    // into a real scheduled run, which is also the moment its DO is minted (a
    // draft has none). Saving an incomplete form again just keeps it a draft.
    const willBeDraft = dto.isDraft === true;
    if (!willBeDraft && !dto.items?.length) throw new BadRequestException('At least one item is required');

    const project = dto.projectId
      ? await this.prisma.project.findFirst({
          where: { id: dto.projectId, organizationId },
          select: { id: true, name: true, customerId: true },
        })
      : null;
    if (!project && !willBeDraft) throw new NotFoundException('Project not found in this organization');
    const customerId = dto.customerId ?? project?.customerId ?? undefined;
    const deliveryAddress = (dto.address?.trim() || project?.name || '').trim();
    const assetIds = [...new Set((dto.items ?? []).map((i) => i.assetId).filter((v): v is string => !!v))];
    const assets = await this.prisma.asset.findMany({
      where: { id: { in: assetIds }, organizationId, deletedAt: null },
      select: { id: true, name: true, skuKey: true },
    });
    const assetById = new Map(assets.map((a) => [a.id, a]));
    for (const it of dto.items ?? []) {
      if (it.assetId && !assetById.has(it.assetId)) throw new NotFoundException(`Asset ${it.assetId} not found in this organization`);
      if (!it.assetId && !it.description?.trim()) throw new BadRequestException('A free-typed item needs a description');
    }
    const lineDescription = (it: { assetId?: string; description?: string }) =>
      it.assetId ? assetById.get(it.assetId)!.name : (it.description?.trim() ?? '');
    const documentId = run.items.find((i) => i.documentId)?.documentId ?? null;

    // Swap the item set (scheduled = nothing bound) + update the run's fields.
    await this.prisma.$transaction(async (tx) => {
      await tx.deliveryItem.deleteMany({ where: { deliveryId: id } });
      // Same qty-N -> N qty-1 slot expansion as createScheduled: the rider walks
      // one row per unit, so editing a run must not collapse them back.
      await tx.deliveryItem.createMany({
        data: (dto.items ?? []).flatMap((it, lineIdx) => {
          const base = {
            deliveryId: id,
            assetId: it.assetId ?? null,
            inventoryId: null,
            description: lineDescription(it),
            assetClass: it.assetId ? null : it.assetClass ?? AssetClass.EQUIPMENT,
            ...(documentId ? { documentId } : {}),
          };
          if (!it.assetId) return [{ ...base, quantity: it.quantity, sortOrder: lineIdx * 100 }];
          return Array.from({ length: Math.max(1, it.quantity) }, (_, n) => ({
            ...base,
            quantity: 1,
            sortOrder: lineIdx * 100 + n,
          }));
        }),
      });
      await tx.delivery.update({
        where: { id },
        data: {
          isDraft: willBeDraft,
          scheduledFor: dto.scheduledFor ? new Date(dto.scheduledFor) : null,
          projectId: dto.projectId ?? null,
          customerId,
          siteAddress: deliveryAddress || null,
        },
      });
    });

    // Attention snapshot for whichever DO path runs below (dialog value wins,
    // else the project's first contact) — resolved once for both mint + regen.
    const scheduledAttention = await this.resolveScheduleAttention(dto, organizationId);

    // PROMOTION MINT: a draft carries no DO, so the first save that makes it a
    // real schedule is what creates one. Same placeholder-numbered draft DO the
    // create path would have made, just deferred until the office commits.
    if (!willBeDraft && !documentId) {
      try {
        const templateId = await this.resolveDeliveryOrderTemplateId(organizationId);
        const customer = customerId
          ? await this.prisma.customer.findFirst({
              where: { id: customerId, organizationId },
              select: { id: true, name: true, customerCode: true, address: true, email: true },
            })
          : null;
        const doConfig = this.buildScheduledDoConfig({
          items: dto.items ?? [],
          assetById,
          projectName: project?.name ?? '',
          deliveryAddress,
          poNumber: dto.poNumber,
          machineLocation: dto.machineLocation,
          customer: customer
            ? { id: customer.id, name: customer.name, customerCode: customer.customerCode, address: customer.address, email: customer.email }
            : null,
          attention: scheduledAttention,
        });
        const pending = await this.prisma.document.findMany({
          where: { organizationId, name: { startsWith: 'DO-PENDING-' } },
          select: { name: true },
        });
        const maxPending = pending.reduce((mx, d) => {
          const mm = d.name?.match(/-(\d+)$/);
          return mm ? Math.max(mx, parseInt(mm[1], 10)) : mx;
        }, 0);
        const placeholderName = `DO-PENDING-${String(maxPending + 1).padStart(2, '0')}`;
        const doc = await this.documentsService.createBasicDocument(
          templateId, 'DELIVERY_ORDER', organizationId, doConfig, dto.projectId, undefined, placeholderName,
        );
        await this.prisma.deliveryItem.updateMany({ where: { deliveryId: id }, data: { documentId: doc.id } });
      } catch (err: any) {
        this.logger.error(`updateScheduled: DO mint on promotion failed for delivery ${id}: ${err?.message}`, err?.stack);
      }
    }

    // Regenerate the born-linked draft DO from the new form (merge over the DO's
    // existing config so logo/stamp/template layout survive). Best-effort.
    if (documentId) {
      try {
        const customer = customerId
          ? await this.prisma.customer.findFirst({
              where: { id: customerId, organizationId },
              select: { id: true, name: true, customerCode: true, address: true, email: true },
            })
          : null;
        const fragment = this.buildScheduledDoConfig({
          items: dto.items,
          assetById,
          projectName: project.name,
          deliveryAddress,
          poNumber: dto.poNumber,
          machineLocation: dto.machineLocation,
          customer,
          attention: scheduledAttention,
        });
        // On edit a CLEARED PO / machine location must actually clear on the DO
        // (a plain config merge would keep the old value), so set them explicitly.
        fragment.poNo = dto.poNumber?.trim() ? dto.poNumber.trim() : null;
        fragment.machineLocation = dto.machineLocation?.trim() ? dto.machineLocation.trim() : null;
        // Same for Attention: set explicitly so a re-derived (or cleared) value
        // replaces the old snapshot rather than merging under it.
        fragment.attention = scheduledAttention ?? null;
        await this.documentsService.replaceScheduledDoConfig(documentId, organizationId, fragment, dto.projectId);
      } catch (err: any) {
        this.logger.error(`updateScheduled: draft DO regen failed for run ${id}: ${err?.message}`, err?.stack);
      }
    }

    return this.prisma.delivery.findUniqueOrThrow({ where: { id }, include: { items: true } });
  }

  /**
   * Office: pre-create a scheduled RETURN run to collect specific units. Unlike a
   * scheduled delivery, a return targets KNOWN units, so each is unit-bound from
   * birth (inventoryId set). NO document is created (the RDO is minted only at
   * completion) and nothing is reserved (the units are already out on rental).
   * projectId is set only when every unit shares ONE active project; mixed → null
   * (per-project RDO splitting is deferred).
   */
  async createScheduledReturn(dto: ScheduleReturnDto, organizationId: string) {
    const inventoryIds = [...new Set(dto.inventoryIds)];
    if (!inventoryIds.length) throw new BadRequestException('At least one unit is required');

    const customer = await this.prisma.customer.findFirst({
      where: { id: dto.customerId, organizationId },
      select: { id: true },
    });
    if (!customer) throw new NotFoundException('Customer not found in this organization');

    // Units must be org-scoped AND currently on rental (only an out-on-rental unit
    // can be collected back).
    const units = await this.prisma.inventory.findMany({
      where: { id: { in: inventoryIds }, organizationId },
      select: { id: true, assetId: true, status: true, sku: true, asset: { select: { name: true } } },
    });
    if (units.length !== inventoryIds.length) {
      throw new NotFoundException('One or more units were not found in this organization');
    }
    const notRental = units.filter((u) => u.status !== InventoryStatus.rental);
    if (notRental.length) {
      throw new BadRequestException(
        `Only units currently on rental can be scheduled for return. Not on rental: ${notRental.map((u) => u.sku).join(', ')}`,
      );
    }

    // Reject a unit already sitting on an OPEN (scheduled) return run.
    const already = await this.prisma.deliveryItem.findMany({
      where: {
        inventoryId: { in: inventoryIds },
        delivery: { organizationId, direction: DeliveryDirection.RETURN, status: 'scheduled', isDraft: false },
      },
      select: { inventoryId: true },
    });
    if (already.length) {
      const skus = units.filter((u) => already.some((a) => a.inventoryId === u.id)).map((u) => u.sku);
      throw new BadRequestException(`Already on a scheduled return: ${skus.join(', ')}`);
    }

    // Active project per unit → one shared projectId when all match, null when mixed.
    const assignments = await this.prisma.assignment.findMany({
      where: { inventoryId: { in: inventoryIds }, endDate: null },
      select: { inventoryId: true, projectId: true },
      orderBy: { startDate: 'desc' },
    });
    const projectByUnit = new Map<string, string | null>();
    for (const a of assignments) {
      if (a.inventoryId && !projectByUnit.has(a.inventoryId)) projectByUnit.set(a.inventoryId, a.projectId ?? null);
    }
    const distinctProjects = [...new Set(inventoryIds.map((id) => projectByUnit.get(id) ?? null))];
    const sharedProjectId = distinctProjects.length === 1 && distinctProjects[0] ? distinctProjects[0] : null;

    const unitById = new Map(units.map((u) => [u.id, u]));

    // One Delivery (RETURN, scheduled) + one unit-bound item per unit. Per-org
    // serial with P2002 retry (same pattern as createScheduled).
    let run: Prisma.DeliveryGetPayload<{ include: { items: true } }> | null = null;
    for (let attempt = 0; attempt < 3 && !run; attempt++) {
      const latest = await this.prisma.delivery.findFirst({
        where: { organizationId },
        orderBy: { deliveryNumber: 'desc' },
        select: { deliveryNumber: true },
      });
      const deliveryNumber = (latest?.deliveryNumber ?? 0) + 1;
      try {
        run = await this.prisma.delivery.create({
          data: {
            organizationId,
            deliveryNumber,
            direction: DeliveryDirection.RETURN,
            status: 'scheduled',
            riderUserId: null,
            riderName: null,
            scheduledFor: new Date(dto.scheduledFor),
            customerId: dto.customerId,
            projectId: sharedProjectId,
            ...(dto.notes?.trim() ? { notes: dto.notes.trim() } : {}),
            items: {
              // Returns are already one unit per row; stamp the walk order so the
              // rider steps through them in the order the office picked them.
              create: inventoryIds.map((id, idx) => {
                const u = unitById.get(id)!;
                return {
                  assetId: u.assetId,
                  inventoryId: id,
                  quantity: 1,
                  description: u.asset?.name ?? u.sku ?? 'Unit',
                  sortOrder: idx * 100,
                };
              }),
            },
          },
          include: { items: true },
        });
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') continue;
        throw err;
      }
    }
    if (!run) throw new BadRequestException('Could not allocate a delivery number — please retry');
    return run;
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
    // A draft is an unfinished office note, not work: never claimable.
    if (run.isDraft) {
      throw new BadRequestException(`Delivery #${run.deliveryNumber} is still a draft and cannot be started`);
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
        // Split: shrink the open slot, mint a bound qty-1 item for this unit. The
        // new item INHERITS the slot's documentId so a scheduled (born-linked)
        // run stays fully linked — the completion hook routes it to commit-only.
        await tx.deliveryItem.update({ where: { id: slot.id }, data: { quantity: (slot.quantity ?? 1) - 1 } });
        await tx.deliveryItem.create({
          data: {
            deliveryId,
            assetId: dto.assetId,
            inventoryId: dto.inventoryId,
            quantity: 1,
            description: slot.description,
            documentId: slot.documentId, // born-linked preserved
          },
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

    // Bind this unit into the scheduled DO's matching ASSET-level slot (turns an
    // asset-level line into a serial-bound one), if the run has a pre-created DO.
    // Best-effort: commitLinkedDeliveryItems re-binds any stragglers at completion.
    if (slot.documentId) {
      try {
        await this.documentsService.bindUnitToUnboundDoSlot(slot.documentId, organizationId, {
          id: dto.inventoryId,
          assetId: dto.assetId,
          sku: unit.sku,
        });
      } catch (err: any) {
        this.logger.warn(`claimScheduled: DO slot bind failed for unit ${dto.inventoryId}: ${err?.message}`);
      }
    }

    return { deliveryId, deliveryNumber: run.deliveryNumber, claimed: true };
  }

  async create(dto: CreateDeliveryDto, organizationId: string, riderUserId: string) {
    const asset = await this.prisma.asset.findFirst({
      where: { id: dto.assetId, organizationId },
      select: { id: true, name: true },
    });
    if (!asset) throw new NotFoundException('Asset not found in this organization');

    // RETURN (reverse delivery): the unit is already OUT on rental, so we DON'T
    // reserve (reserve is an instock→reserved claim). Guard it's genuinely a
    // rental — a SOLD unit is a commercial reversal (credit note), not a return.
    const isReturn = dto.direction === 'RETURN';
    if (isReturn && dto.inventoryId) {
      const unit = await this.prisma.inventory.findFirst({
        where: { id: dto.inventoryId, organizationId },
        select: { status: true },
      });
      if (!unit) throw new NotFoundException('Unit not found in this organization');
      if (unit.status === InventoryStatus.sold) {
        throw new BadRequestException(
          'This unit was sold — process a Credit Note to take it back, then it can be re-received into stock. It cannot be returned as a rental.',
        );
      }
      if (unit.status !== InventoryStatus.rental) {
        throw new BadRequestException(`Only a unit currently out on rental can be returned (this one is ${unit.status}).`);
      }

      // Join-on-scan: if this unit sits on an office-scheduled RETURN run (still
      // scheduled, or already claimed and in_progress from an earlier unit's
      // scan), fulfil THAT run instead of minting an ad-hoc one. Early collection
      // joins silently. The first scan claims the run (scheduled → in_progress +
      // rider); later scans continue in the same basket. The unit's item already
      // exists (born unit-bound), so the DO_START MSR just advances it.
      const scheduled = await this.prisma.deliveryItem.findFirst({
        where: {
          inventoryId: dto.inventoryId,
          delivery: {
            organizationId,
            direction: DeliveryDirection.RETURN,
            status: { in: ['scheduled', 'in_progress'] },
            isDraft: false,
          },
        },
        select: { deliveryId: true, delivery: { select: { status: true } } },
      });
      if (scheduled) {
        if (scheduled.delivery.status === 'scheduled') {
          return this.prisma.delivery.update({
            where: { id: scheduled.deliveryId },
            data: {
              status: 'in_progress',
              riderUserId,
              ...(dto.riderName ? { riderName: dto.riderName } : {}),
              startedAt: new Date(),
            },
            include: { items: true },
          });
        }
        // Already claimed by an earlier scan on this run — continue there.
        return this.prisma.delivery.findUniqueOrThrow({
          where: { id: scheduled.deliveryId },
          include: { items: true },
        });
      }
    }

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
      if (attempt === 0 && dto.inventoryId && !isReturn) {
        await this.reserveUnit(dto.inventoryId, organizationId, deliveryNumber);
      }
      try {
        delivery = await this.prisma.delivery.create({
          data: {
            organizationId,
            deliveryNumber,
            direction: isReturn ? DeliveryDirection.RETURN : DeliveryDirection.OUTBOUND,
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
        // Creation failed for real — don't strand the reservation (RETURN never
        // reserved, so there's nothing to release).
        if (dto.inventoryId && !isReturn) await this.releaseUnit(dto.inventoryId, 0).catch(() => undefined);
        throw err;
      }
    }
    if (!delivery) throw new Error('Failed to assign a unique delivery number after retries');
    return delivery;
  }

  /**
   * Walk position for a row APPENDED to a run after scheduling (a field add).
   * Lands after everything the office declared so the rider's own additions come
   * last in the walk instead of jumping the queue. Rows predating sortOrder sit
   * at 0, so this still returns a sane 100 for them.
   */
  private async nextSortOrder(deliveryId: string): Promise<number> {
    const last = await this.prisma.deliveryItem.findFirst({
      where: { deliveryId },
      orderBy: { sortOrder: 'desc' },
      select: { sortOrder: true },
    });
    return (last?.sortOrder ?? 0) + 100;
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

    // Once ANY unit on this run has been handed over, the run is closed to
    // genuinely NEW units — that is the deliberate ad-hoc lock. It is NOT closed
    // to the office's own declared quantity: an unfilled scheduled slot is not an
    // addition, so filling slot 3 of 5 stays legal after slots 1 and 2 are
    // acknowledged. The client hides the generic add controls on the same rule;
    // this guard is what makes it real against a stale or replayed client.
    const acknowledgedCount = await this.prisma.deliveryItem.count({
      where: {
        deliveryId,
        deliveryStatus: { in: [DeliveryStatus.not_installed, DeliveryStatus.completed] },
      },
    });
    const anyAcknowledged = acknowledgedCount > 0;

    // FREE-TYPED line: no assetId → a description-only record, no catalog lookup,
    // no reservation, no unit. Resolved to a real asset/unit office-side later.
    if (!dto.assetId) {
      const description = dto.description?.trim();
      if (!description) throw new BadRequestException('A description is required for a free-typed item');
      if (anyAcknowledged) {
        throw new BadRequestException(
          'This delivery has already been handed over, so new items cannot be added to it.',
        );
      }
      const quantity = dto.quantity ?? 1;
      // If this run is DO-linked (scheduled / merged), a field-added free-typed
      // line must ALSO reach the DO — mirror the schedule path: born-link the item
      // to the run's DO and append a description line to it. Otherwise (unlinked
      // run) it stays office-resolved later. (Fixes the "N of N+1 linked" drift.)
      const linked = await this.prisma.deliveryItem.findFirst({
        where: { deliveryId, documentId: { not: null } },
        select: { documentId: true },
      });
      const documentId = linked?.documentId ?? null;
      const created = await this.prisma.deliveryItem.create({
        data: {
          deliveryId,
          assetId: null,
          inventoryId: null,
          description,
          quantity,
          sortOrder: await this.nextSortOrder(deliveryId),
          // Free-typed lines carry their OWN class (there is no asset to read it
          // from). Omitted → EQUIPMENT, the stricter photo rule.
          assetClass: dto.assetClass ?? AssetClass.EQUIPMENT,
          ...(documentId ? { documentId } : {}),
        },
      });
      if (documentId) {
        try {
          await this.documentsService.appendFreeTypedLineToDocument(documentId, organizationId, { description, quantity });
        } catch (err: any) {
          this.logger.warn(`addItem: appending free-typed line to DO ${documentId} failed: ${err?.message}`);
        }
      }
      return created;
    }

    const asset = await this.prisma.asset.findFirst({
      where: { id: dto.assetId, organizationId },
      select: { id: true, name: true },
    });
    if (!asset) throw new NotFoundException('Asset not found in this organization');

    // SLOT-AWARE (2026-08): an OPEN office-scheduled slot for the same asset
    // (inventoryId null — a scheduled run's remaining quantity) means this unit
    // FILLS a declared slot rather than being a new addition. Looked up BEFORE
    // the reservation so it can serve the post-ack guard too, and so a rejected
    // add never leaves a unit reserved.
    const openSlot = dto.inventoryId
      ? await this.prisma.deliveryItem.findFirst({
          where: { deliveryId, assetId: dto.assetId, inventoryId: null, quantity: { gte: 1 } },
          // Fill the EARLIEST open slot in walk order, so a scan lands on the
          // position the rider is actually standing at. SKIPPED slots sort last:
          // without that, the next scan would silently refill the slot just
          // passed over and skipping would achieve nothing. (id is the tiebreak
          // for rows predating sortOrder, which all sit at 0.)
          orderBy: [{ skippedAt: { sort: 'asc', nulls: 'first' } }, { sortOrder: 'asc' }, { id: 'asc' }],
          select: { id: true, quantity: true, documentId: true, description: true, sortOrder: true },
        })
      : null;

    // Post-hand-over, only a declared slot may still be filled. Anything else
    // (a brand-new unit, an asset-only line) is an addition and is refused.
    if (anyAcknowledged && !openSlot) {
      throw new BadRequestException(
        'This delivery has already been handed over, so new units cannot be added. Only the units the office scheduled can still be loaded.',
      );
    }

    if (dto.inventoryId) {
      await this.reserveUnit(dto.inventoryId, organizationId, delivery.deliveryNumber);

      // BIND this unit into the open slot rather than creating a parallel item.
      // Keeps the run's scheduled count honest and inherits the slot's DO link
      // so completion still routes to commit-only.
      if (openSlot) {
        let bound;
        try {
          bound = await this.prisma.$transaction(async (tx) => {
            if ((openSlot.quantity ?? 1) > 1) {
              // Split: shrink the slot, mint a bound qty-1 item that inherits the
              // slot's DO link. Remaining quantity stays fillable by the next scan.
              await tx.deliveryItem.update({ where: { id: openSlot.id }, data: { quantity: (openSlot.quantity ?? 1) - 1 } });
              return tx.deliveryItem.create({
                data: {
                  deliveryId,
                  assetId: dto.assetId,
                  inventoryId: dto.inventoryId,
                  description: openSlot.description ?? asset.name,
                  quantity: 1,
                  documentId: openSlot.documentId,
                  // The bound row TAKES the slot's place in the walk (it is that
                  // slot, made concrete), so it inherits the position rather than
                  // appending. Only reachable for legacy qty>1 slots.
                  sortOrder: openSlot.sortOrder,
                },
              });
            }
            // Last unit for this asset: bind the slot in place (keeps its DO link).
            return tx.deliveryItem.update({ where: { id: openSlot.id }, data: { inventoryId: dto.inventoryId } });
          });
        } catch (err) {
          if (dto.inventoryId) await this.releaseUnit(dto.inventoryId, delivery.deliveryNumber).catch(() => undefined);
          if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
            throw new BadRequestException('Unit already scanned into this delivery');
          }
          throw err;
        }
        // Serial-bind into the DO's asset slot (best-effort; commitLinkedDeliveryItems
        // re-binds at completion, so a failure here loses nothing).
        if (openSlot.documentId) {
          try {
            const unit = await this.prisma.inventory.findFirst({ where: { id: dto.inventoryId, organizationId }, select: { sku: true } });
            if (unit) {
              await this.documentsService.bindUnitToUnboundDoSlot(openSlot.documentId, organizationId, {
                id: dto.inventoryId,
                assetId: dto.assetId,
                sku: unit.sku,
              });
            }
          } catch (err: any) {
            this.logger.warn(`addItem: DO slot bind failed for unit ${dto.inventoryId}: ${err?.message}`);
          }
        }
        return bound;
      }
    }
    try {
      return await this.prisma.deliveryItem.create({
        data: {
          deliveryId,
          assetId: dto.assetId,
          inventoryId: dto.inventoryId,
          description: dto.description ?? asset.name,
          quantity: dto.quantity ?? 1,
          sortOrder: await this.nextSortOrder(deliveryId),
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
        // Walk order. Rows created before sortOrder existed all sit at 0, so id
        // is the tiebreak that keeps their order stable rather than arbitrary.
        items: {
          include: { document: { select: { id: true, name: true, type: true, status: true } } },
          orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
        },
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
      this.prisma.asset.findMany({ where: { id: { in: assetIds } }, select: { id: true, name: true, skuKey: true, assetClass: true } }),
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
    // PO number off the DO's config (rendered as "Your PO No." on the DO) — shown
    // inline on the rider's scheduled-run screen alongside a "View full DO" link.
    const runDocCfg = runDoc
      ? ((await this.prisma.document.findUnique({ where: { id: runDoc.id }, select: { config: true } }))?.config as any)
      : null;
    const runDocPoNo = runDocCfg?.poNo ?? null;
    // Machine location off the same DO config — powers the edit-scheduled prefill.
    const runDocMachineLocation = runDocCfg?.machineLocation ?? null;
    // Attention snapshot off the same DO config — lets the edit-scheduled dialog
    // rehydrate the frozen value so a manual edit survives a re-edit.
    const runDocAttention = runDocCfg?.attention ?? null;
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
      document: runDoc ? { ...runDoc, poNo: runDocPoNo, machineLocation: runDocMachineLocation, attention: runDocAttention } : null,
      invoice,
      items: delivery.items.map((i) => ({
        ...i,
        inventory: i.inventoryId ? unitById.get(i.inventoryId) ?? null : null,
        asset: assetById.get(i.assetId) ?? null,
        // Active ProjectDeployment for the RENTAL/SALE toggle (null → unassigned,
        // SALE disabled). Type mirrors ProjectDeployment.type.
        deployment: i.inventoryId ? deploymentByInv.get(i.inventoryId) ?? null : null,
        // Resolved Equipment/Accessory for THIS line: the line's own class when
        // free-typed, else the asset's, else EQUIPMENT. Pre-resolved server-side
        // so the field never has to reimplement the fallback chain.
        effectiveAssetClass: resolveLineAssetClass(
          i.assetClass,
          i.assetId ? assetById.get(i.assetId)?.assetClass ?? null : null,
        ),
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
      // Office only. Drafts are invisible everywhere by default so no rider
      // query can ever surface one.
      includeDrafts?: boolean;
    } = {},
  ) {
    const page = Math.max(1, opts.page ?? 1);
    const limit = Math.min(100, Math.max(1, opts.limit ?? 20));
    // "Unlinked" is per-item now: a run stays in the queue while ANY item has
    // no DO. Cancelled runs drop out of the queue view (their items will never
    // be linked) unless the caller asked for them by status explicitly.
    const where: Prisma.DeliveryWhereInput = {
      // DRAFTS ARE HIDDEN BY DEFAULT. Every rider-facing read goes through here,
      // so this one line keeps drafts out of the scheduled list, the resume
      // view and the unlinked queue at once.
      ...(opts.includeDrafts ? {} : { isDraft: false }),
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
              assetId: true,
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
    // Per-run DO summary (id, name, poNo) — the scheduled-run screen shows the PO
    // number inline + a "View full DO" link. Scheduled runs have exactly one DO.
    const docIds = [
      ...new Set(docs.flatMap((d) => d.items.map((i) => i.documentId).filter((v): v is string => !!v))),
    ];
    const docRows = docIds.length
      ? await this.prisma.document.findMany({ where: { id: { in: docIds } }, select: { id: true, name: true, config: true } })
      : [];
    const poNoByDoc = new Map(docRows.map((dc) => [dc.id, (dc.config as any)?.poNo ?? null]));
    const enriched = docs.map((d) => {
      const distinct = [...new Map(d.items.filter((i) => i.document).map((i) => [i.document!.id, i.document!])).values()];
      const runDoc = distinct.length === 1 ? distinct[0] : null;
      return {
        ...d,
        document: runDoc ? { ...runDoc, poNo: poNoByDoc.get(runDoc.id) ?? null } : null,
        items: d.items.map((i) => ({
          ...i,
          sku: i.inventoryId ? (unitById.get(i.inventoryId)?.sku ?? null) : null,
          serialNumber: i.inventoryId ? (unitById.get(i.inventoryId)?.serialNumber ?? null) : null,
        })),
      };
    });
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
        ? // Starting CLEARS a skip: the rider came back to it, so it belongs in
          // Delivering, not Skipped. One place, because 'start' is the only door
          // into delivering.
          { deliveryStatus: DeliveryStatus.delivering, deliveringAt: now, skippedAt: null }
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
        direction: true,
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
      // Completion hook: the FIRST time a run reaches `completed`. Exactly ONE
      // of two mutually-exclusive branches runs, routed by whether the run is
      // already linked to a DO:
      //   • LINKED (scheduled — born-linked to its pre-created draft DO) →
      //     commit-only: commit that existing DO + fire the invoice. NEVER
      //     creates a DO (autoCreate's own guard would also skip it).
      //   • UNLINKED (unscheduled) → Stage-2 create-and-commit, unchanged.
      // They can't double-fire: the dispatch picks one, and the linked run's
      // documentId makes autoCreate a no-op even if reached.
      if (target === 'completed') {
        // ⚠️ Direction branch FIRST: a RETURN run must NEVER hit the OUTBOUND DO
        // path (its items carry no documentId, so the unlinked branch would
        // wrongly mint a DO). A return produces an RDO only — the stock flip +
        // off-hire already happened per unit at collection-ack.
        if (delivery.direction === DeliveryDirection.RETURN) {
          await this.completeReturnRun(deliveryId, organizationId);
        } else {
          const linkedItem = await this.prisma.deliveryItem.findFirst({
            where: { deliveryId, documentId: { not: null } },
            select: { documentId: true },
          });
          if (linkedItem?.documentId) {
            await this.commitScheduledRunOnCompletion(deliveryId, organizationId, linkedItem.documentId);
          } else {
            await this.autoCreateDoOnRunCompletion(deliveryId, organizationId);
          }
        }
      }
    }
  }

  /**
   * Completion for a run ALREADY linked to a DO (scheduled runs, born-linked to
   * their pre-created draft DO). Commits that EXISTING DO — stamp DocumentItems
   * completed, bind any still-unbound units into their asset slots, deduct stock,
   * set delivered_installed — then fire the (idempotent) invoice from the now
   * office-priced DO. Link-and-commit, NOT create-and-commit: no new DO is made.
   * Best-effort: failures are logged, never roll back the run's completion.
   */
  private async commitScheduledRunOnCompletion(deliveryId: string, organizationId: string, documentId: string) {
    try {
      await this.documentsService.commitLinkedDeliveryItems(documentId, organizationId);
      await this.documentsService.maybeCompleteDeliveryOrderAndInvoice(documentId, organizationId);
      this.logger.log(`Delivery ${deliveryId}: completion committed pre-created DO ${documentId} + invoice`);
    } catch (err: any) {
      this.logger.error(
        `commitScheduledRunOnCompletion failed for delivery ${deliveryId}, DO ${documentId}: ${err?.message}`,
        err?.stack,
      );
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
      // project rides along so the DO can carry its NAME (the template renders
      // config.projectName; Document.projectId alone never reaches the preview).
      include: { items: true, customer: true, project: { select: { id: true, name: true } } },
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

    // Attention / Mobile from the PROJECT's first contact (primary where one is
    // flagged, else earliest-attached), widened to name/phone/email. Falls back
    // to the customer's primary contact when the project has none (preserving
    // prior behaviour). Mobile prefers the contact's own phone, else the customer
    // mainline. Frozen onto config.attention (the DO header reads .name and
    // .phoneNumber; .email rides along for downstream email flows).
    let attention: { name: string; phoneNumber?: string; email?: string } | undefined =
      await this.projectFirstContactAttention(delivery.projectId, organizationId);
    if (!attention && delivery.customerId) {
      const primary = await this.prisma.customerContact.findFirst({
        where: { customerId: delivery.customerId, isPrimary: true },
        select: { name: true, phone: true, email: true },
      });
      if (primary?.name) {
        const phone = primary.phone || delivery.customer?.phone || undefined;
        attention = {
          name: primary.name,
          ...(phone ? { phoneNumber: phone } : {}),
          ...(primary.email ? { email: primary.email } : {}),
        };
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
      // Project NAME on the config, both flat and under documentInfo, exactly as
      // createScheduled writes it. Document.projectId is set below but the DO
      // template renders from config.projectName, so a completion-created DO
      // showed a blank Project row without this.
      ...(delivery.project?.name
        ? { projectName: delivery.project.name, documentInfo: { projectName: delivery.project.name } }
        : {}),
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

    // Post-assign scheduled-run matching (move-and-discard): the project the
    // rider just picked is what resolves which office-scheduled run this unit
    // fulfils — NOT the scan. If a match exists, the unit (item + DO_START proof
    // + reservation) is MOVED into that run and this ad-hoc run is discarded;
    // the client must then navigate to the returned runId. Best-effort: any
    // failure leaves the successful assignment in place and the rider on THIS
    // run (the safe no-match state).
    let mergedInto: { deliveryId: string; deliveryNumber: number } | null = null;
    if (item.inventoryId && item.assetId) {
      try {
        mergedInto = await this.tryMergeIntoScheduledRun(
          deliveryId,
          { id: item.id, assetId: item.assetId, inventoryId: item.inventoryId },
          project.id,
          organizationId,
          { userId: delivery.riderUserId, name: delivery.riderName },
        );
      } catch (err: any) {
        this.logger.error(
          `assignItem: scheduled-run merge failed for unit ${item.inventoryId} on run ${deliveryId}: ${err?.message}`,
          err?.stack,
        );
      }
    }

    const runId = mergedInto?.deliveryId ?? deliveryId;
    return {
      ...result,
      projectId: project.id,
      customerId: project.customerId ?? null,
      // The run the client should land on: the scheduled run if we merged (this
      // ad-hoc run no longer exists), else this run.
      runId,
      merged: !!mergedInto,
      ...(mergedInto ? { mergedIntoDeliveryNumber: mergedInto.deliveryNumber } : {}),
    };
  }

  /**
   * Post-assign scheduled-run matching (2026-08, "move and discard").
   *
   * After a rider assigns a just-started unit to a project (assignItem), see if
   * that PROJECT has a `scheduled` run with an OPEN asset-level slot for this
   * unit's asset. If so, MOVE this unit out of its throwaway ad-hoc run and INTO
   * the scheduled run's slot — carrying the live DeliveryItem (its
   * deliveryStatus + deliveringAt), the DO_START MSR (photo + GPS proof), and the
   * reservation — then claim the scheduled run for this rider and discard the
   * now-empty ad-hoc run. The rider continues in the scheduled run's basket,
   * which already carries the office's draft DO + PO + remaining slots.
   *
   * Matching: `scheduled` Delivery, projectId = the assigned project, with a
   * DeliveryItem where assetId = this unit's asset and inventoryId is null. Two
   * candidates → oldest scheduledFor first. No candidate → returns null (the
   * unit stays on its ad-hoc run, unchanged).
   *
   * ── Atomicity (the unit must NEVER be orphaned between two runs and the
   *    reservation must NEVER be lost) ──
   * The move is ONE interactive $transaction on a single database, so it commits
   * whole or rolls back whole:
   *   1. reparent this unit's item → scheduled run (+ inherit the slot's DO link)
   *   2. consume the slot (qty 1 → delete; qty>1 → decrement)
   *   3. re-point this unit's DO_START MSR(s) → scheduled run
   *   4. claim the scheduled run (rider + status in_progress)
   *   5. delete the ad-hoc run — ONLY if it has no items left (guards multi-unit
   *      runs), and only AFTER 1+3 moved its item + MSR away, so the DeliveryItem
   *      cascade deletes nothing and MSR.delivery's SetNull never fires.
   * On ANY failure the tx rolls back to exactly the state assignItem left: the
   * unit on its ad-hoc run, still `reserved`, MSR intact — the same safe state as
   * "no match". The reservation is never touched by the move (the unit stays
   * `reserved` the whole time; nothing calls release), so it can't be lost.
   *
   * The DO asset-slot serial-bind runs AFTER commit, best-effort — exactly like
   * claimScheduled — because it mutates DocumentItems through a separate path.
   * commitLinkedDeliveryItems re-binds any straggler at completion, so a failure
   * here loses nothing: the item is already linked to the DO by documentId.
   */
  private async tryMergeIntoScheduledRun(
    adhocRunId: string,
    item: { id: string; assetId: string; inventoryId: string },
    projectId: string,
    organizationId: string,
    rider: { userId: string | null; name: string | null },
  ): Promise<{ deliveryId: string; deliveryNumber: number } | null> {
    // 1. A scheduled run for this project with an open slot for this asset.
    const slot = await this.prisma.deliveryItem.findFirst({
      where: {
        assetId: item.assetId,
        inventoryId: null,
        delivery: { organizationId, status: 'scheduled', projectId, isDraft: false },
      },
      orderBy: { delivery: { scheduledFor: 'asc' } }, // two matches → oldest first
      select: {
        id: true,
        quantity: true,
        documentId: true,
        delivery: { select: { id: true, deliveryNumber: true, riderName: true } },
      },
    });
    if (!slot?.delivery) return null;
    const schedRunId = slot.delivery.id;
    if (schedRunId === adhocRunId) return null; // never merge a run into itself

    await this.prisma.$transaction(async (tx) => {
      // 1) Reparent this unit's live item into the scheduled run, inheriting the
      //    slot's DO link. Same row → deliveryStatus + deliveringAt come along.
      //    Unique (deliveryId, inventoryId) is safe: the slot held no unit.
      await tx.deliveryItem.update({
        where: { id: item.id },
        data: { deliveryId: schedRunId, documentId: slot.documentId },
      });
      // 2) Consume the slot.
      if ((slot.quantity ?? 1) > 1) {
        await tx.deliveryItem.update({ where: { id: slot.id }, data: { quantity: (slot.quantity ?? 1) - 1 } });
      } else {
        await tx.deliveryItem.delete({ where: { id: slot.id } });
      }
      // 3) Move this unit's DO_START proof to the scheduled run (GpsPings hang
      //    off the MSR, so they follow it). Scoped to this unit only.
      await tx.maintenanceServiceReport.updateMany({
        where: { deliveryId: adhocRunId, inventoryId: item.inventoryId },
        data: { deliveryId: schedRunId },
      });
      // 4) Claim the scheduled run. It has no rider yet; set ours + start it.
      await tx.delivery.update({
        where: { id: schedRunId },
        data: {
          status: 'in_progress',
          startedAt: new Date(),
          ...(rider.userId ? { riderUserId: rider.userId } : {}),
          ...(slot.delivery!.riderName || !rider.name ? {} : { riderName: rider.name }),
        },
      });
      // 5) Discard the now-empty ad-hoc run. Re-check items so a multi-unit
      //    ad-hoc run (rider added others) is never deleted out from under them.
      const remaining = await tx.deliveryItem.count({ where: { deliveryId: adhocRunId } });
      if (remaining === 0) await tx.delivery.delete({ where: { id: adhocRunId } });
    });

    // Serial-bind the unit into the DO's asset slot (post-commit, best-effort).
    if (slot.documentId) {
      try {
        const unit = await this.prisma.inventory.findFirst({
          where: { id: item.inventoryId, organizationId },
          select: { id: true, sku: true },
        });
        if (unit) {
          await this.documentsService.bindUnitToUnboundDoSlot(slot.documentId, organizationId, {
            id: item.inventoryId,
            assetId: item.assetId,
            sku: unit.sku,
          });
        }
      } catch (err: any) {
        this.logger.warn(`tryMergeIntoScheduledRun: DO slot bind failed for unit ${item.inventoryId}: ${err?.message}`);
      }
    }

    return { deliveryId: schedRunId, deliveryNumber: slot.delivery.deliveryNumber };
  }

  /**
   * Rider says installation isn't needed (delivery-first #3): the item goes
   * straight to completed with installSkipped=true and NO signature — the run
   * fold (recomputeRunStatus) already counts completed regardless of the
   * flag, so a fully-skipped run completes normally. Run-scoped twin of the
   * DO-first POST /maintenance-reports/do-skip-install/:doId.
   */
  /**
   * "Acknowledge all" (2026-08): capture ONE customer signature + one photo + GPS
   * and apply the SAME proof to EVERY unit currently `delivering` on the run, so a
   * rider with N units doesn't walk the ack flow N times. ONE DO_ACK MSR per unit
   * (each carrying the shared proof) keeps per-item state transitions correct —
   * each unit advances delivering → not_installed via advanceDeliveryItem('ack'),
   * which also does the reserved → rental/sold hand-off flip. The per-unit ack
   * stays available for partial deliveries.
   */
  async acknowledgeAll(
    deliveryId: string,
    dto: {
      signature?: string;
      recipientName?: string;
      photos?: string[];
      latitude?: number;
      longitude?: number;
      technicianName?: string;
      // Unified bulk flow (2026-08): the rider runs the SAME single-item proof
      // once (photos + ack + optional install), then fans it across every
      // delivering unit. When installNeeded is true, each OUTBOUND unit is
      // installed (not skipped) and gets its own DO_INSTALL MSR carrying the
      // shared install photos. Returns ignore install entirely.
      installNeeded?: boolean;
      installPhotos?: string[];
    },
    organizationId: string,
    technicianUserId: string,
  ) {
    const run = await this.prisma.delivery.findFirst({
      where: { id: deliveryId, organizationId },
      select: { id: true, status: true, direction: true, items: { select: { inventoryId: true, assetId: true, deliveryStatus: true } } },
    });
    if (!run) throw new NotFoundException('Delivery not found');
    if (run.status === 'cancelled') throw new BadRequestException('Cannot deliver on a cancelled delivery');
    const isReturn = run.direction === DeliveryDirection.RETURN;
    // Only units mid-flow (started, not yet acknowledged/collected) with a unit.
    const pending = run.items.filter(
      (i) => i.inventoryId && i.assetId && i.deliveryStatus === DeliveryStatus.delivering,
    );
    if (pending.length === 0) throw new BadRequestException('No units are awaiting delivery on this run');

    const now = new Date();
    let acknowledged = 0;
    for (const it of pending) {
      // Reuse the DO_ACK MSR kind for returns too (no new enum value) — the run's
      // direction distinguishes a collection from a delivery hand-off.
      await this.prisma.maintenanceServiceReport.create({
        data: {
          organizationId,
          technicianUserId,
          assetId: it.assetId!,
          inventoryId: it.inventoryId!,
          deliveryId,
          kind: 'DO_ACK',
          status: dto.signature ? 'completed' : 'draft',
          description: isReturn ? 'Return collected (bulk)' : 'Delivery acknowledged (bulk)',
          ...(dto.signature ? { signature: dto.signature, signedAt: now } : {}),
          ...(dto.recipientName ? { signedByName: dto.recipientName } : {}),
          ...(dto.photos?.length ? { photos: dto.photos } : {}),
          ...(dto.latitude != null ? { latitude: dto.latitude } : {}),
          ...(dto.longitude != null ? { longitude: dto.longitude } : {}),
          ...(dto.technicianName ? { technicianName: dto.technicianName } : {}),
        },
      });
      // RETURN: collect (delivering → completed, SKIP install), flip rental →
      // instock, and off-hire the deployment (last-unit guard). OUTBOUND bulk
      // "Deliver all" = a signed hand-off with NO per-unit installation: ack
      // (delivering → not_installed) THEN skip-install (→ completed), so every
      // unit COMPLETES and the run's completion hook auto-creates the DO + draft
      // invoice — the same end state as the per-unit "No install" path. A unit
      // that genuinely needs installing uses the per-unit flow instead.
      let updated: unknown;
      if (isReturn) {
        updated = await this.collectReturnUnit(deliveryId, it.inventoryId!, organizationId);
      } else {
        updated = await this.advanceDeliveryItem(deliveryId, it.inventoryId!, 'ack', organizationId);
        if (updated) {
          if (dto.installNeeded) {
            // Unified bulk WITH install: not_installed → completed via 'install'
            // (installSkipped stays false) + a DO_INSTALL MSR per unit carrying
            // the shared install photos, mirroring the single-item install step.
            await this.advanceDeliveryItem(deliveryId, it.inventoryId!, 'install', organizationId);
            await this.prisma.maintenanceServiceReport.create({
              data: {
                organizationId,
                technicianUserId,
                assetId: it.assetId!,
                inventoryId: it.inventoryId!,
                deliveryId,
                kind: 'DO_INSTALL',
                status: 'completed',
                description: 'Installed (bulk)',
                ...(dto.installPhotos?.length ? { photos: dto.installPhotos } : {}),
                ...(dto.signature ? { signature: dto.signature, signedAt: now } : {}),
                ...(dto.recipientName ? { signedByName: dto.recipientName } : {}),
                ...(dto.latitude != null ? { latitude: dto.latitude } : {}),
                ...(dto.longitude != null ? { longitude: dto.longitude } : {}),
                ...(dto.technicianName ? { technicianName: dto.technicianName } : {}),
              },
            });
          } else {
            await this.advanceDeliveryItem(deliveryId, it.inventoryId!, 'skip', organizationId);
          }
        }
      }
      if (updated) acknowledged++;
    }
    await this.recomputeRunStatus(deliveryId, organizationId);
    return { acknowledged, total: pending.length };
  }

  /**
   * Collect ONE unit on a RETURN run with proof (#3a per-unit "End Return"):
   * the return twin of the per-unit outbound ack. Writes a single DO_ACK MSR for
   * this unit (signature + photos + GPS), collects it (delivering → completed,
   * rental → instock, off-hire on last unit), then refolds the run. Returns skip
   * install, so there is no install branch here. Idempotent: a unit already
   * collected returns acknowledged:0.
   */
  async acknowledgeReturnUnit(
    deliveryId: string,
    inventoryId: string,
    dto: { signature?: string; recipientName?: string; photos?: string[]; latitude?: number; longitude?: number; technicianName?: string },
    organizationId: string,
    technicianUserId: string,
  ) {
    const run = await this.prisma.delivery.findFirst({
      where: { id: deliveryId, organizationId },
      select: { id: true, status: true, direction: true, items: { select: { inventoryId: true, assetId: true, deliveryStatus: true } } },
    });
    if (!run) throw new NotFoundException('Delivery not found');
    if (run.status === 'cancelled') throw new BadRequestException('Cannot collect on a cancelled delivery');
    if (run.direction !== DeliveryDirection.RETURN) {
      throw new BadRequestException('This endpoint collects units on RETURN runs only');
    }
    const item = run.items.find(
      (i) => i.inventoryId === inventoryId && i.assetId && i.deliveryStatus === DeliveryStatus.delivering,
    );
    if (!item) {
      // Already collected / not started / not on this run — idempotent no-op.
      return { acknowledged: 0 };
    }

    const now = new Date();
    await this.prisma.maintenanceServiceReport.create({
      data: {
        organizationId,
        technicianUserId,
        assetId: item.assetId!,
        inventoryId,
        deliveryId,
        kind: 'DO_ACK',
        status: dto.signature ? 'completed' : 'draft',
        description: 'Return collected',
        ...(dto.signature ? { signature: dto.signature, signedAt: now } : {}),
        ...(dto.recipientName ? { signedByName: dto.recipientName } : {}),
        ...(dto.photos?.length ? { photos: dto.photos } : {}),
        ...(dto.latitude != null ? { latitude: dto.latitude } : {}),
        ...(dto.longitude != null ? { longitude: dto.longitude } : {}),
        ...(dto.technicianName ? { technicianName: dto.technicianName } : {}),
      },
    });
    const updated = await this.collectReturnUnit(deliveryId, inventoryId, organizationId);
    await this.recomputeRunStatus(deliveryId, organizationId);
    return { acknowledged: updated ? 1 : 0 };
  }

  /**
   * Collect ONE unit on a RETURN run at collection-ack: advance the item
   * delivering → completed (returns have NO install step), flip the unit
   * rental → instock (guarded/idempotent), and off-hire its deployment when it's
   * the LAST active rental unit on that deployment (partial returns never stop
   * billing for units still on site). A pure release — nothing was reserved.
   */
  private async collectReturnUnit(deliveryId: string, inventoryId: string, organizationId: string) {
    const item = await this.prisma.deliveryItem.findFirst({
      where: { deliveryId, inventoryId, deliveryStatus: DeliveryStatus.delivering },
      select: { id: true },
    });
    if (!item) return null; // already collected / not eligible — idempotent
    const now = new Date();
    await this.prisma.deliveryItem.update({
      where: { id: item.id },
      data: { deliveryStatus: DeliveryStatus.completed, deliveredAt: now, completedAt: now },
    });
    // rental → instock (guarded so a re-run / non-rental is a no-op).
    await this.prisma.inventory.updateMany({
      where: { id: inventoryId, organizationId, status: InventoryStatus.rental },
      data: { status: InventoryStatus.instock },
    });
    await this.offHireDeploymentOnReturn(inventoryId, organizationId);
    return this.prisma.deliveryItem.findUnique({ where: { id: item.id } });
  }

  /**
   * Off-hire the returned unit's active deployment — but ONLY when no other unit
   * on that same deployment is still out (`rental`). Reuses projects.offHire
   * (marks OFF_HIRED + deactivates chained recurring-invoice templates so rent
   * stops at the return date). Best-effort.
   */
  private async offHireDeploymentOnReturn(inventoryId: string, organizationId: string) {
    try {
      const assignment = await this.prisma.assignment.findFirst({
        where: { inventoryId, endDate: null, projectDeploymentId: { not: null } },
        orderBy: { startDate: 'desc' },
        select: { projectDeploymentId: true },
      });
      const depId = assignment?.projectDeploymentId;
      if (!depId) return;
      // Last-unit guard: any OTHER unit on this deployment still out on rental?
      const siblings = await this.prisma.assignment.findMany({
        where: { projectDeploymentId: depId, endDate: null, inventoryId: { not: inventoryId } },
        select: { inventoryId: true },
      });
      const sibIds = siblings.map((s) => s.inventoryId).filter((v): v is string => !!v);
      const stillOut = sibIds.length
        ? await this.prisma.inventory.count({ where: { id: { in: sibIds }, status: InventoryStatus.rental } })
        : 0;
      if (stillOut > 0) return; // partial return — keep billing for the rest
      await this.projectsService.offHireDeployment(depId, organizationId);
    } catch (err: any) {
      this.logger.warn(`offHireDeploymentOnReturn failed for unit ${inventoryId}: ${err?.message}`);
    }
  }

  /** Resolve ONE RETURN_DELIVERY_ORDER (RDO) template id for the org. */
  private async resolveReturnDeliveryOrderTemplateId(organizationId: string): Promise<string> {
    const type = 'RETURN_DELIVERY_ORDER';
    const selections = await this.prisma.organizationActiveTemplate.findMany({ where: { organizationId, type } });
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
    const tmpl =
      (await this.prisma.documentTemplate.findFirst({ where: { type, organizationId, isActive: true }, select: { id: true }, orderBy: [{ createdAt: 'desc' }] })) ??
      (await this.prisma.documentTemplate.findFirst({ where: { OR: [{ type, isDefault: true }, { type, organizationId }] }, select: { id: true }, orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }] }));
    if (!tmpl) throw new NotFoundException('No RETURN_DELIVERY_ORDER template found for this organization');
    return tmpl.id;
  }

  /**
   * RETURN-run completion: create an RDO (Return Delivery Order) from the
   * collected units — the mirror of autoCreateDoOnRunCompletion, but GOODS-ONLY.
   * No stock deduction (the rental → instock flip happened per unit at collect-
   * ack), no invoice, NO GL (RETURN_DELIVERY_ORDER isn't a GL-posting type). The
   * grouped per-unit lines mirror the DO format so the printed RDO reads the same.
   * Best-effort + idempotent (skips if the run already produced a document).
   */
  private async completeReturnRun(deliveryId: string, organizationId: string) {
    try {
      const run = await this.prisma.delivery.findFirst({
        where: { id: deliveryId, organizationId },
        select: {
          id: true, deliveryNumber: true, projectId: true, siteAddress: true,
          customer: { select: { id: true, name: true } },
          items: { select: { assetId: true, inventoryId: true, description: true, quantity: true, documentId: true } },
        },
      });
      if (!run) return;
      if (run.items.some((i) => i.documentId)) return; // already has a doc — idempotent
      const collected = run.items.filter((i) => i.inventoryId && i.assetId);
      if (collected.length === 0) return;

      const templateId = await this.resolveReturnDeliveryOrderTemplateId(organizationId);
      const invIds = collected.map((i) => i.inventoryId!) as string[];
      const units = await this.prisma.inventory.findMany({
        where: { id: { in: invIds } },
        select: { id: true, sku: true, year: true, assetId: true, asset: { select: { skuKey: true, name: true } } },
      });
      const unitById = new Map(units.map((u) => [u.id, u]));
      const items = collected.map((i) => {
        const u = unitById.get(i.inventoryId!);
        return {
          description: i.description ?? u?.asset?.name ?? u?.sku ?? '',
          quantity: i.quantity ?? 1,
          unitPrice: 0,
          amount: 0,
          inventoryItemId: i.inventoryId,
          ...(u?.sku ? { serialNumbers: [u.sku] } : {}),
          ...(u?.asset?.skuKey ? { skuKey: u.asset.skuKey, itemCode: u.asset.skuKey } : {}),
          ...(u?.year != null ? { year: u.year } : {}),
          ...(u?.assetId ? { deliveryGroup: u.assetId } : {}),
        };
      });
      const config: Record<string, any> = {
        items,
        ...(run.siteAddress ? { deliveryTo: run.siteAddress } : {}),
        ...(run.customer ? { customerId: run.customer.id, customerName: run.customer.name, customer: { id: run.customer.id, name: run.customer.name } } : {}),
        note: `Return of ${collected.length} unit(s) collected on delivery run #${run.deliveryNumber}.`,
      };
      const doc = await this.documentsService.createBasicDocument(templateId, 'RETURN_DELIVERY_ORDER', organizationId, config, run.projectId ?? undefined);
      await this.prisma.deliveryItem.updateMany({ where: { deliveryId: run.id }, data: { documentId: doc.id } });
      this.logger.log(`Return run #${run.deliveryNumber}: created RDO ${doc.id} for ${collected.length} unit(s) (goods-only, no GL).`);
    } catch (err: any) {
      this.logger.error(`completeReturnRun failed for delivery ${deliveryId}: ${err?.message}`, err?.stack);
    }
  }

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
   * WALK-THROUGH SKIP: the rider consciously passes an item over and moves to
   * the next one. Keyed by DeliveryItem.id, not inventoryId, because an unfilled
   * scheduled slot has no unit yet and a free-typed line never will — both are
   * skippable positions in the walk.
   *
   * Only stamps `skippedAt`; deliveryStatus stays `not_delivered`. That is the
   * whole point of a separate column: `not_delivered` alone cannot tell "passed
   * over" from "not reached yet", and the basket's Delivering / Skipped split
   * needs exactly that distinction. Nothing is stocked, flipped or proven — a
   * skip is a navigation decision, and the item stays fully startable later.
   */
  async skipItem(deliveryId: string, itemId: string, organizationId: string) {
    const delivery = await this.prisma.delivery.findFirst({
      where: { id: deliveryId, organizationId },
      select: { id: true, status: true },
    });
    if (!delivery) throw new NotFoundException('Delivery not found');
    if (delivery.status === 'cancelled') throw new BadRequestException('Cannot skip items on a cancelled delivery');

    const item = await this.prisma.deliveryItem.findFirst({
      where: { id: itemId, deliveryId },
      select: { id: true, deliveryStatus: true, skippedAt: true },
    });
    if (!item) throw new NotFoundException('Item is not on this delivery');
    // Only something not yet begun can be passed over. Once it is delivering or
    // beyond, the rider is committed to it and must finish or cancel the run.
    if (item.deliveryStatus !== DeliveryStatus.not_delivered) {
      throw new BadRequestException('This item has already been started, so it can no longer be skipped');
    }
    // Idempotent: a replayed tap is not an error.
    if (item.skippedAt) return item;

    return this.prisma.deliveryItem.update({
      where: { id: item.id },
      data: { skippedAt: new Date() },
    });
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
      // skippedAt cleared for the same reason as 'start': the rider came back.
      data: { deliveryStatus: DeliveryStatus.completed, completedAt: new Date(), skippedAt: null },
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
    // A draft reserved nothing and minted no DO, so there is nothing for this
    // unwinding path to do. Discarding a draft is a plain delete, not a cancel.
    if (delivery.isDraft) {
      throw new BadRequestException('This is a draft. Discard it instead of cancelling.');
    }

    // Scheduled runs: asset-only, nothing reserved/delivered, born-linked to
    // their OWN pre-created draft DO. Cancelling deletes that draft DO iff it's
    // still unconfirmed (Cascade drops its DocumentItems; DeliveryItem.documentId
    // is SetNull); if the office already confirmed it, leave the DO and just
    // cancel the run, surfacing a note. Handled BEFORE the in_progress
    // delivered/linked guards below (those would otherwise block on the born-link).
    if (delivery.status === 'scheduled') {
      const docId = delivery.items.map((i) => i.documentId).find((v): v is string => !!v);
      let note: string | undefined;
      if (docId) {
        const doc = await this.prisma.document.findFirst({
          where: { id: docId, organizationId },
          select: { id: true, name: true, status: true },
        });
        if (doc && isUnconfirmedDoc(doc.status)) {
          await this.prisma.document.delete({ where: { id: docId } });
        } else if (doc) {
          note = `Draft DO ${doc.name ?? doc.id} was already confirmed — left in place; only the run was cancelled.`;
        }
      }
      const updated = await this.prisma.delivery.update({ where: { id: deliveryId }, data: { status: 'cancelled' } });
      return note ? { ...updated, note } : updated;
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
