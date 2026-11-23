import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException, Optional, forwardRef } from '@nestjs/common';
import { InventoryStatus, ItemType, Prisma } from '@prisma/client';
import { PrismaService } from 'src/common/prisma.service';
import { isOrgFeatureEnabled } from 'src/common/org-features';
import { hasAdminRole } from 'src/common/admin-role';
import { ActionLogService } from '../action-log/action-log.service';
import { DocumentsService } from '../documents/documents.service';
import {
  DELIVERY_UNIT_SWAP_FLAG,
  OPEN_RUN_STATUSES,
  SwapRefusal,
  invoiceMentionsUnit,
  rewriteDoItemsForSwap,
  swapRefusal,
  swapSummary,
  swappedInStatus,
} from './unit-swap';

export interface SwapActor {
  id?: string;
  name?: string;
  email?: string;
  isOsirisAdmin?: boolean;
}

const INVOICE_TYPES = ['INVOICE', 'TI', 'TI2'];
const DRAFT_STATUSES = ['draft', 'unconfirmed'] as const;

function refuse(r: SwapRefusal): never {
  if (r.status === 403) throw new ForbiddenException(r.message);
  if (r.status === 404) throw new NotFoundException(r.message);
  throw new BadRequestException(r.message);
}

/**
 * Swap unit on a delivered run (enableDeliveryUnitSwap, Admin only). Rules in
 * unit-swap.ts; this file reads the facts and writes everything in ONE
 * transaction (see swapUnit).
 */
@Injectable()
export class UnitSwapService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => DocumentsService))
    private readonly documentsService: DocumentsService,
    // Global module; optional so hand-built instances (scripts) still work.
    @Optional() private readonly actionLog?: ActionLogService,
  ) {}

  private async isAdmin(organizationId: string, actor: SwapActor): Promise<boolean> {
    return !!actor.isOsirisAdmin || (await hasAdminRole(this.prisma as any, organizationId, actor.id));
  }

  /** Open runs a unit sits on, by run number (optionally leaving one run out). */
  private async openRunsOf(organizationId: string, inventoryId: string, exceptRunId?: string): Promise<number[]> {
    const rows = await this.prisma.deliveryItem.findMany({
      where: {
        inventoryId,
        ...(exceptRunId ? { deliveryId: { not: exceptRunId } } : {}),
        delivery: { is: { organizationId, status: { in: [...OPEN_RUN_STATUSES] } } },
      },
      select: { delivery: { select: { deliveryNumber: true } } },
    });
    return rows.map((r) => r.delivery.deliveryNumber);
  }

  private async loadLine(organizationId: string, deliveryId: string, itemId: string) {
    const run = await this.prisma.delivery.findFirst({
      where: { id: deliveryId, organizationId },
      select: { id: true, deliveryNumber: true, status: true, direction: true, projectId: true, documentId: true },
    });
    if (!run) throw new NotFoundException('Delivery not found');
    const line = await this.prisma.deliveryItem.findFirst({
      where: { id: itemId, deliveryId },
      select: { id: true, inventoryId: true, assetId: true, deliveryStatus: true, documentId: true },
    });
    const oldUnit = line?.inventoryId
      ? await this.prisma.inventory.findFirst({
          where: { id: line.inventoryId, organizationId },
          select: { id: true, sku: true, assetId: true, status: true, organizationId: true, asset: { select: { name: true } } },
        })
      : null;
    const doId = line?.documentId ?? run.documentId ?? null;
    const doc = doId
      ? await this.prisma.document.findFirst({ where: { id: doId, organizationId }, select: { id: true, name: true, projectId: true, config: true } })
      : null;
    const projectId = run.projectId ?? doc?.projectId ?? null;
    const oldAssignment =
      oldUnit && projectId
        ? await this.prisma.assignment.findFirst({
            where: { projectId, inventoryId: oldUnit.id, endDate: null },
            select: { id: true, projectId: true, projectDeploymentId: true, documentId: true, startDate: true },
          })
        : null;
    return { run, line, oldUnit, doc, projectId, oldAssignment };
  }

  /**
   * Swap-in choices for the dialog: in-stock units of the line's product that
   * are on no open run. Same flag + Admin gate as the swap itself.
   */
  async candidates(organizationId: string, deliveryId: string, itemId: string, actor: SwapActor) {
    if (!(await isOrgFeatureEnabled(this.prisma, organizationId, DELIVERY_UNIT_SWAP_FLAG))) {
      throw new ForbiddenException('Swap unit is not turned on for this organisation');
    }
    if (!(await this.isAdmin(organizationId, actor))) throw new ForbiddenException('Only an Admin can swap a unit');
    const { line, oldUnit } = await this.loadLine(organizationId, deliveryId, itemId);
    if (!line || !oldUnit?.assetId) return { current: null, units: [] };
    const units = await this.prisma.inventory.findMany({
      where: { organizationId, assetId: oldUnit.assetId, status: InventoryStatus.instock, id: { not: oldUnit.id } },
      select: { id: true, sku: true, serialNumber: true },
      orderBy: { sku: 'asc' },
      take: 500,
    });
    const busy = units.length
      ? await this.prisma.deliveryItem.findMany({
          where: { inventoryId: { in: units.map((u) => u.id) }, delivery: { is: { organizationId, status: { in: [...OPEN_RUN_STATUSES] } } } },
          select: { inventoryId: true },
        })
      : [];
    const busyIds = new Set(busy.map((b) => b.inventoryId));
    return {
      current: { id: oldUnit.id, sku: oldUnit.sku, product: oldUnit.asset?.name ?? null },
      units: units.filter((u) => !busyIds.has(u.id)),
    };
  }

  /**
   * One transaction:
   *  - old unit -> instock; its open Assignment on the project gets endDate=now
   *    (row kept, so the project history shows it was there);
   *  - new unit -> rental (sold when the old unit was a sale) with an Assignment
   *    on the same project + projectDeploymentId + documentId. startDate = the
   *    old assignment's startDate (else now): the hire is the same hire, which
   *    started on the delivery; the swap date is on the old row's endDate and on
   *    both units' timelines. No billing reads assignment dates (recurring
   *    invoices anchor on the deployment). @@unique(projectId, inventoryId):
   *    an ended row of the new unit on this project is reopened, not duplicated;
   *  - DeliveryItem.inventoryId -> new unit;
   *  - this line's proof MSRs -> new unit (signature / status untouched);
   *  - the DO's config.items line + DocumentItem row -> new unit and serial
   *    (DO status, number and signatures untouched);
   *  - a TimelineItem on each unit naming the swap and the reason.
   * Invoices are not touched; the drafts still naming the old unit are returned.
   */
  async swapUnit(
    organizationId: string,
    deliveryId: string,
    itemId: string,
    body: { newInventoryId?: string | null; reason?: string | null },
    actor: SwapActor,
  ) {
    const flagOn = await isOrgFeatureEnabled(this.prisma, organizationId, DELIVERY_UNIT_SWAP_FLAG);
    if (!flagOn) refuse({ status: 403, message: 'Swap unit is not turned on for this organisation' });
    const isAdmin = await this.isAdmin(organizationId, actor);
    if (!isAdmin) refuse({ status: 403, message: 'Only an Admin can swap a unit' });

    const { run, line, oldUnit, doc, projectId, oldAssignment } = await this.loadLine(organizationId, deliveryId, itemId);
    const newInventoryId = String(body?.newInventoryId ?? '').trim();
    const reason = String(body?.reason ?? '').trim();
    const newUnit = newInventoryId
      ? await this.prisma.inventory.findFirst({
          where: { id: newInventoryId, organizationId },
          select: { id: true, sku: true, assetId: true, status: true, organizationId: true },
        })
      : null;
    const refusal = swapRefusal({
      organizationId,
      flagOn,
      isAdmin,
      reason,
      newInventoryId,
      run: { deliveryNumber: run.deliveryNumber, status: run.status, direction: run.direction },
      line: line ? { inventoryId: line.inventoryId, deliveryStatus: line.deliveryStatus } : null,
      oldUnit,
      newUnit,
      oldUnitOtherOpenRuns: oldUnit ? await this.openRunsOf(organizationId, oldUnit.id, run.id) : [],
      newUnitOpenRuns: newUnit ? await this.openRunsOf(organizationId, newUnit.id) : [],
      hasOpenAssignment: !!oldAssignment,
    });
    if (refusal) refuse(refusal);
    // Narrowed by swapRefusal; restated for the compiler.
    if (!line || !oldUnit || !newUnit || !oldAssignment || !projectId) throw new BadRequestException('This line cannot be swapped');

    const now = new Date();
    const fromSku = oldUnit.sku ?? null;
    const toSku = newUnit.sku ?? null;
    const product = oldUnit.asset?.name ?? null;
    const runLabel = `Delivery #${run.deliveryNumber}${doc?.name ? ` (${doc.name})` : ''}`;
    const ids = { oldInventoryId: oldUnit.id, oldSku: fromSku, newInventoryId: newUnit.id, newSku: toSku, deliveryItemId: line.id };

    const result = await this.prisma.$transaction(async (tx) => {
      // Guarded flips: a unit that changed status since the checks fails the swap.
      const out = await tx.inventory.updateMany({
        where: { id: newUnit.id, organizationId, status: InventoryStatus.instock },
        data: { status: swappedInStatus(oldUnit.status) as InventoryStatus },
      });
      if (out.count !== 1) throw new BadRequestException(`${toSku ?? 'The new unit'} is no longer in stock`);
      const back = await tx.inventory.updateMany({
        where: { id: oldUnit.id, organizationId, status: { in: [InventoryStatus.rental, InventoryStatus.sold] } },
        data: { status: InventoryStatus.instock },
      });
      if (back.count !== 1) throw new BadRequestException(`${fromSku ?? 'The unit'} is no longer out on this delivery`);

      await tx.assignment.update({ where: { id: oldAssignment.id }, data: { endDate: now } });
      const assignmentData = {
        projectDeploymentId: oldAssignment.projectDeploymentId,
        documentId: oldAssignment.documentId,
        startDate: oldAssignment.startDate ?? now,
        endDate: null,
      };
      const newAssignment = await tx.assignment.upsert({
        where: { projectId_inventoryId: { projectId, inventoryId: newUnit.id } },
        update: assignmentData,
        create: { projectId, inventoryId: newUnit.id, ...assignmentData },
        select: { id: true },
      });

      const moved = await tx.deliveryItem.updateMany({ where: { id: line.id, inventoryId: oldUnit.id }, data: { inventoryId: newUnit.id } });
      if (moved.count !== 1) throw new BadRequestException('The line changed while swapping. Reload and try again');

      const msr = await tx.maintenanceServiceReport.updateMany({
        where: {
          organizationId,
          inventoryId: oldUnit.id,
          OR: [
            { deliveryItemId: line.id },
            { deliveryId: run.id, deliveryItemId: null },
            ...(doc ? [{ documentId: doc.id, deliveryItemId: null }] : []),
          ],
        },
        data: { inventoryId: newUnit.id },
      });

      let doLines: number[] = [];
      let docItems = 0;
      if (doc) {
        const fresh = await tx.document.findUnique({ where: { id: doc.id }, select: { config: true } });
        const cfg = ((fresh?.config as any) ?? {}) as Record<string, any>;
        const rewrite = rewriteDoItemsForSwap(cfg.items, ids);
        doLines = rewrite.changed;
        if (rewrite.changed.length) {
          await tx.document.update({ where: { id: doc.id }, data: { config: { ...cfg, items: rewrite.items } as Prisma.InputJsonValue } });
        }
        // The DocumentItem twin (syncDocumentItems pairs rows by itemId from
        // config.items[].inventoryItemId): repoint it, delivery columns kept.
        const rows = await tx.documentItem.findMany({
          where: { documentId: doc.id, OR: [{ inventoryId: oldUnit.id }, { itemId: oldUnit.id, itemType: ItemType.INVENTORY }] },
          select: { id: true, sku: true },
        });
        for (const r of rows) {
          await tx.documentItem.update({
            where: { id: r.id },
            data: { itemId: newUnit.id, inventoryId: newUnit.id, ...(r.sku && r.sku === fromSku ? { sku: toSku } : {}) },
          });
        }
        docItems = rows.length;
      }

      await tx.timelineItem.create({
        data: { message: `Swapped out of ${runLabel} for ${toSku ?? 'another unit'}, back in stock. Reason: ${reason}`, inventoryId: oldUnit.id, documentId: doc?.id ?? null, pdfUrl: null },
      });
      await tx.timelineItem.create({
        data: { message: `Swapped into ${runLabel} in place of ${fromSku ?? 'another unit'}. Reason: ${reason}`, inventoryId: newUnit.id, documentId: doc?.id ?? null, pdfUrl: null },
      });
      return { newAssignmentId: newAssignment.id, msrRows: msr.count, doLines, docItems };
    });

    // Drafts (never touched) on this DO / deployment that still name the old unit.
    const draftWhere: Prisma.DocumentWhereInput = {
      organizationId,
      type: { in: INVOICE_TYPES },
      status: { in: [...DRAFT_STATUSES] },
      OR: [
        ...(doc ? [{ config: { path: ['sourceDocumentId'], equals: doc.id } }] : []),
        ...(oldAssignment.projectDeploymentId ? [{ projectDeploymentId: oldAssignment.projectDeploymentId }] : []),
      ],
    };
    const drafts = (draftWhere.OR as any[]).length
      ? await this.prisma.document.findMany({ where: draftWhere, select: { id: true, name: true, config: true } })
      : [];
    const draftInvoicesToCheck = drafts.filter((d) => invoiceMentionsUnit(d.config, oldUnit.id, fromSku)).map((d) => ({ id: d.id, name: d.name }));

    const summary = swapSummary({ runNumber: run.deliveryNumber, fromSku, toSku, doName: doc?.name ?? null, draftInvoices: draftInvoicesToCheck });
    await this.actionLog?.log({
      actorType: 'USER',
      actorId: actor.id || 'unknown',
      actorName: actor.name ?? null,
      actorEmail: actor.email ?? null,
      organizationId,
      channel: 'portal',
      method: 'POST',
      path: `/deliveries/${run.id}/items/${line.id}/swap-unit`,
      action: 'SWAP_UNIT',
      resource: 'deliveries',
      resourceId: run.id,
      details: {
        runNumber: run.deliveryNumber,
        doName: doc?.name ?? null,
        product,
        fromSerial: fromSku,
        toSerial: toSku,
        reason,
        draftInvoicesToCheck: draftInvoicesToCheck.map((d) => d.name ?? d.id),
      },
    });
    if (doc) {
      await this.documentsService.logUnitSwapHistory({
        documentId: doc.id,
        organizationId,
        documentName: doc.name ?? undefined,
        detail: `Unit swapped on Delivery #${run.deliveryNumber}: ${fromSku ?? 'old unit'} -> ${toSku ?? 'new unit'}${product ? ` (${product})` : ''}. Reason: ${reason}`,
        actor: { id: actor.id, name: actor.name, email: actor.email },
      });
    }

    return {
      ok: true,
      deliveryNumber: run.deliveryNumber,
      doName: doc?.name ?? null,
      product,
      fromSerial: fromSku,
      toSerial: toSku,
      reason,
      doLineUpdated: result.doLines.length > 0,
      proofReportsMoved: result.msrRows,
      draftInvoicesToCheck,
      summary,
    };
  }
}
