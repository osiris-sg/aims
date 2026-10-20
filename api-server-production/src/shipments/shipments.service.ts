import { BadRequestException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { TradeAlertsService } from './trade-alerts.service';
import { etaTrail, withEtaChange } from './trade-alerts';
import { carrierOf } from './trade-carrier';
import { PrismaService } from '../common/prisma.service';
import { CreateShipmentDto, ListShipmentsQuery, UpdateShipmentDto } from './dto/shipment.dto';
import { CONTRACT_LINE_SELECT, FILE_LINK_SELECT, shapeFileLinks, STEP_SELECT, STEP_SUMMARY_SELECT } from './trade-selects';
import { TradeActor } from './shipments.request';
import { blockingSteps, currentStepOf, freeTimeLeft, lineLabel, orderLabel, progressOf, SHIPMENT_TABS, ShipmentTab, shipmentRef, shipmentTab, stepLabels, tradeToday } from './shipments.rules';
import { alertRulesOf } from './trade-alerts';
import { actualsTable, cleanCosts, estimate, ShipmentCosts } from './trade-estimator';
import { ORDER_SUMMARY_SELECT } from './trade-selects';
import { latestBlCheck } from './trade-extract.service';
import { Db, DOC_LINK_SELECT, isUniqueViolation, optText, pageArgs, TradeConfigService } from './trade-config.service';

/** Shipments: one per Bill of Lading, under an order ("#19-1"; before orders: under a contract). */
@Injectable()
export class ShipmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: TradeConfigService,
    // Optional: unit tests and the smoke run build the service without it.
    @Optional() private readonly alerts?: TradeAlertsService,
  ) {}

  async list(organizationId: string, query: ListShipmentsQuery) {
    const { page, pageSize, skip, take } = pageArgs(query.page, query.pageSize);
    const q = query.q?.trim();
    // "#19", "19-1", "#19-1": an order number (the shipment number narrows it after).
    const refM = q ? /^#?(\d{1,5})(?:-(\d{1,3}))?$/.exec(q) : null;
    const bucketStatus = query.bucket === 'pending' ? { status: 'OPEN' as const } : query.bucket === 'completed' ? { status: { in: ['COMPLETED', 'CANCELLED'] as Array<'COMPLETED' | 'CANCELLED'> } } : {};
    const where = {
      organizationId,
      ...(query.contractId ? { contractId: query.contractId } : {}),
      ...(query.orderId ? { orderId: query.orderId } : {}),
      ...(query.customerId ? { customerId: query.customerId } : {}),
      ...(query.uninvoiced === 'true' ? { id: { notIn: await this.invoicedShipmentIds(organizationId) } } : {}),
      // Round N: shipments of test orders only with "Show test orders" (or on their own order's page).
      ...(query.includeTest === 'true' || query.orderId ? {} : { NOT: { order: { isTest: true } } }),
      ...bucketStatus,
      ...(query.status ? { status: query.status as 'OPEN' | 'COMPLETED' | 'CANCELLED' } : {}),
      ...(q
        ? {
            OR: [
              ...(refM ? [{ order: { orderNo: Number(refM[1]) }, ...(refM[2] ? { seqNo: Number(refM[2]) } : {}) }] : []),
              { blNumber: { contains: q, mode: 'insensitive' as const } },
              { vessel: { contains: q, mode: 'insensitive' as const } },
              { voyageNo: { contains: q, mode: 'insensitive' as const } },
              { contract: { contractNo: { contains: q, mode: 'insensitive' as const } } },
            ],
          }
        : {}),
    };
    const select = {
      id: true,
      blNumber: true,
      vessel: true,
      voyageNo: true,
      etd: true,
      eta: true,
      actualArrivalDate: true,
      dischargeDate: true,
      detFreeDays: true,
      demFreeDays: true,
      shippingLine: true,
      netWeightMt: true,
      status: true,
      createdAt: true,
      contractId: true,
      orderId: true,
      seqNo: true,
      contract: { select: { id: true, contractNo: true } },
      order: { select: { id: true, year: true, orderNo: true, grade: true, product: true, size: true, qtyMt: true } },
      contractLine: { select: CONTRACT_LINE_SELECT },
      customer: { select: { id: true, name: true } },
      steps: { select: STEP_SUMMARY_SELECT },
    };
    const orderBy = [{ eta: { sort: 'desc' as const, nulls: 'last' as const } }, { createdAt: 'desc' as const }];
    const today = tradeToday();
    const rules = query.tab ? alertRulesOf((await this.prisma.tradeSetting.findUnique({ where: { organizationId }, select: { alertRules: true } }))?.alertRules) : null;
    const shape = ({ steps, ...s }: any) => ({
      ...s,
      contractNo: s.contract?.contractNo ?? null,
      orderLabel: orderLabel(s.order),
      ref: shipmentRef(s.order?.orderNo, s.seqNo),
      customerName: s.customer?.name ?? null,
      productLine: s.order ? lineLabel({ grade: s.order.grade, product: s.order.product, sizeSpec: s.order.size, quantityMt: s.order.qtyMt }) : s.contractLine ? lineLabel(s.contractLine) : null,
      progress: progressOf(steps ?? []),
      currentStep: currentStepOf(steps ?? []),
      carrier: carrierOf(s.blNumber, s.shippingLine)?.name ?? s.shippingLine ?? null,
      ...(rules
        ? (() => {
            const tab = shipmentTab({ ...s, steps: steps ?? [] }, today);
            return { tab, freeTime: tab === 'arrived' || tab === 'in_transit' ? freeTimeLeft(s, rules, today) : null };
          })()
        : {}),
    });
    // The Shipments list (round H): tabs are derived (arrival, steps), so they're counted in memory over the org's B/Ls.
    if (query.tab) {
      const { status: _st, ...noStatus } = where as Record<string, unknown>;
      void _st;
      const all = (await this.prisma.shipment.findMany({ where: noStatus, orderBy, select })).map(shape).filter((x: any) => x.status !== 'CANCELLED');
      const tabs = Object.fromEntries(SHIPMENT_TABS.map((t) => [t, all.filter((x: any) => x.tab === t).length])) as Record<ShipmentTab, number>;
      const hit = all.filter((x: any) => x.tab === query.tab);
      return { items: hit.slice(skip, skip + take), total: hit.length, page, pageSize, totalPages: Math.ceil(hit.length / pageSize), counts: await this.bucketCounts(organizationId, where), tabs };
    }
    // "Current step" is derived from the steps, so that filter runs in memory
    // over the org's (small) shipment list before paging.
    if (query.currentStep) {
      const all = (await this.prisma.shipment.findMany({ where, orderBy, select })).map(shape);
      const want = query.currentStep;
      const hit = all.filter((s: any) => (want === 'COMPLETED' ? s.currentStep === null && s.progress.total > 0 : s.currentStep?.code === want));
      return { items: hit.slice(skip, skip + take), total: hit.length, page, pageSize, totalPages: Math.ceil(hit.length / pageSize), counts: await this.bucketCounts(organizationId, where) };
    }
    const [rows, total, counts] = await Promise.all([
      this.prisma.shipment.findMany({ where, orderBy, skip, take, select }),
      this.prisma.shipment.count({ where }),
      this.bucketCounts(organizationId, where),
    ]);
    const items = rows.map(shape);
    return { items, total, page, pageSize, totalPages: Math.ceil(total / pageSize), counts };
  }

  /** Shipments already billed by a FINAL Invoice #2 / single invoice (own record or "covers"). */
  async invoicedShipmentIds(organizationId: string): Promise<string[]> {
    const gens: Array<{ shipmentId: string | null; coversShipmentIds: string[] }> = await this.prisma.tradeGeneratedDoc.findMany({
      where: { organizationId, status: 'FINAL', docType: { in: ['INVOICE_2', 'INVOICE_SINGLE'] } },
      select: { shipmentId: true, coversShipmentIds: true },
    });
    return [...new Set(gens.flatMap((g) => [g.shipmentId, ...(g.coversShipmentIds ?? [])]).filter((x): x is string => !!x))];
  }

  /** Tab counts (Pending / Completed) under the other filters. */
  private async bucketCounts(organizationId: string, where: Record<string, unknown>) {
    const { status: _s, ...rest } = where as { status?: unknown };
    const [pending, completed] = await Promise.all([
      this.prisma.shipment.count({ where: { ...rest, organizationId, status: 'OPEN' } }),
      this.prisma.shipment.count({ where: { ...rest, organizationId, status: { in: ['COMPLETED', 'CANCELLED'] } } }),
    ]);
    return { pending, completed };
  }

  /** Detail; with an actor, auto-complete runs first (e.g. an invoice confirmed in the invoice editor). */
  async getById(organizationId: string, id: string, actor?: TradeActor) {
    if (actor) await this.config.syncSteps(this.prisma, organizationId, [{ shipmentId: id }], actor);
    const s = await this.prisma.shipment.findFirst({
      where: { id, organizationId },
      include: {
        contract: {
          select: {
            id: true,
            contractNo: true,
            piNumber: true,
            status: true,
            deliveryMonth: true,
            lines: { orderBy: { sortOrder: 'asc' }, select: CONTRACT_LINE_SELECT },
            supplier: { select: { id: true, name: true } },
            customer: { select: { id: true, name: true } },
          },
        },
        order: { select: { ...ORDER_SUMMARY_SELECT, customer: { select: { id: true, name: true } } } },
        contractLine: { select: CONTRACT_LINE_SELECT },
        customer: { select: { id: true, name: true, customerCode: true } },
        steps: { orderBy: { sortOrder: 'asc' }, select: STEP_SELECT },
        fileLinks: { orderBy: { createdAt: 'desc' }, select: FILE_LINK_SELECT },
        docLinks: { orderBy: { createdAt: 'desc' }, select: DOC_LINK_SELECT },
      },
    });
    if (!s) throw new NotFoundException('Shipment not found');
    // Telex code / SI delivery dates / in-app tax estimate meet those documents too.
    const { steps, docLinks } = await this.config.decorateRecord(organizationId, s, this.prisma, await this.config.shipmentFieldTypes(this.prisma, organizationId, id));
    const blCheck = await latestBlCheck(this.prisma, organizationId, id);
    // Steps 7 / 8 / 12: the cost + import tax estimate and the actuals, with the customer's truck size and customs rate.
    const settings = await this.config.getSettings(organizationId);
    const profile = await this.config.profileOf(organizationId, s.order?.customerId ?? s.customerId);
    const costs = (s.costs ?? {}) as ShipmentCosts;
    const est = estimate(s, costs, settings.estimatorRates, profile);
    return {
      ...s,
      steps,
      docLinks,
      fileLinks: shapeFileLinks(s.fileLinks),
      ref: shipmentRef(s.order?.orderNo, s.seqNo),
      orderLabel: orderLabel(s.order),
      profile,
      estimate: est,
      actuals: actualsTable(est, costs, settings.estimatorRates),
      productLine: s.order ? lineLabel({ grade: s.order.grade, product: s.order.product, sizeSpec: s.order.size, quantityMt: s.order.qtyMt }) : s.contractLine ? lineLabel(s.contractLine) : null,
      progress: progressOf(s.steps),
      currentStep: currentStepOf(s.steps),
      blCheck,
      /** "8/6 → 8/16 → 8/17" — every ETA the shipment has had. */
      etaTrail: etaTrail(s.etaHistory),
      carrier: carrierOf(s.blNumber, s.shippingLine),
    };
  }

  async create(organizationId: string, dto: CreateShipmentDto, actor: TradeActor) {
    const blNumber = optText(dto.blNumber) ?? null;
    try {
      const id = await this.prisma.$transaction((tx: Db) => this.createInTx(tx, organizationId, dto, actor));
      await this.config.syncSteps(this.prisma, organizationId, [{ shipmentId: id }], actor);
      return this.getById(organizationId, id);
    } catch (e) {
      if (isUniqueViolation(e)) throw new BadRequestException(`B/L number "${blNumber}" is already used by another shipment`);
      throw e;
    }
  }

  /**
   * One shipment row + its steps, inside the caller's transaction. Used by
   * "Add shipment" and by a new contract (its shipment #1, B/L pending): the
   * B/L, vessel and weights are filled in on shipment step 2.
   */
  async createInTx(tx: Db, organizationId: string, dto: CreateShipmentDto, actor: TradeActor): Promise<string> {
    const blNumber = optText(dto.blNumber) ?? null;
    if (!dto.orderId && !dto.contractId) throw new BadRequestException('A shipment belongs to an order — pass orderId');
    const order = dto.orderId
      ? await tx.tradeOrder.findFirst({
          where: { id: dto.orderId, organizationId },
          select: { id: true, orderNo: true, status: true, customerId: true, supplierId: true, contractId: true, currency: true, deliveryMonth: true, product: true, grade: true, size: true },
        })
      : null;
    if (dto.orderId && !order) throw new BadRequestException('Order not found in this organization');
    if (order && order.status === 'CANCELLED') throw new BadRequestException(`Order #${order.orderNo} is cancelled — reopen it before adding shipments`);
    const contractId = order ? order.contractId : dto.contractId;
    const contract = contractId
      ? await tx.contract.findFirst({
          where: { id: contractId, organizationId },
          select: { id: true, contractNo: true, status: true, customerId: true, supplierId: true, currency: true, deliveryMonth: true, lines: { orderBy: { sortOrder: 'asc' }, select: CONTRACT_LINE_SELECT } },
        })
      : null;
    if (contractId && !contract) throw new BadRequestException('Contract not found in this organization');
    if (!order && contract?.status === 'CANCELLED') {
      throw new BadRequestException(`Contract ${contract.contractNo} is cancelled — reopen it before adding shipments`);
    }
    const customerId = dto.customerId || order?.customerId || contract?.customerId || null;
    if (dto.customerId) await this.assertCustomer(tx, organizationId, dto.customerId);
    if (blNumber) await this.assertBlFree(tx, organizationId, blNumber);
    // The contract line: as asked, else the one of the order's grade, else the contract's only line.
    const lines = contract?.lines ?? [];
    const line = dto.contractLineId ? pickLine(lines, dto.contractLineId) : order ? (lines.find((l: { grade: string | null }) => order.grade && l.grade === order.grade) ?? (lines.length === 1 ? lines[0] : null)) : pickLine(lines, null);
    const fields = this.fields(dto);
    // Commodity / size from the order (else the product line); delivery month from the order / contract.
    if (dto.commodity === undefined) fields.commodity = order && (order.product || order.grade) ? [order.product, order.grade].filter(Boolean).join(' ') : line ? commodityOf(line) : null;
    if (dto.sizeSpec === undefined) fields.sizeSpec = order?.size ?? line?.sizeSpec ?? null;
    if (dto.deliveryMonth === undefined) fields.deliveryMonth = order?.deliveryMonth ?? contract?.deliveryMonth ?? null;
    // Shipment number within the order ("#19-1", "#19-2" …) — part of its documents' IDs.
    const parent = order ? { orderId: order.id } : { contractId: contract!.id };
    const last: { seqNo: number | null } | null = await tx.shipment.findFirst({ where: { organizationId, ...parent }, orderBy: { seqNo: { sort: 'desc', nulls: 'last' } }, select: { seqNo: true } });
    const created = await tx.shipment.create({
      data: {
        organizationId,
        seqNo: (last?.seqNo ?? 0) + 1,
        orderId: order?.id ?? null,
        contractId: contract?.id ?? null,
        contractLineId: line?.id ?? null,
        customerId,
        blNumber,
        currency: dto.currency || order?.currency || contract?.currency || 'USD',
        ...fields,
        createdById: actor.id,
      },
      select: { id: true },
    });
    const supplierId = order?.supplierId ?? contract?.supplierId ?? null;
    await this.config.snapshotSteps(
      tx,
      organizationId,
      'SHIPMENT',
      { shipmentId: created.id },
      await this.config.profileOf(organizationId, customerId, tx),
      await this.config.supplierProfileOf(organizationId, supplierId, tx),
    );
    if (dto.blDraftFileId) await this.config.linkSourceFile(tx, organizationId, dto.blDraftFileId, 'BL_DRAFT', { shipmentId: created.id }, 'BL_DRAFT_APPROVAL');
    return created.id as string;
  }

  async update(organizationId: string, id: string, dto: UpdateShipmentDto, actor: TradeActor | null = null) {
    const blNumber = optText(dto.blNumber);
    let etaMoved = false;
    try {
      await this.prisma.$transaction(async (tx: Db) => {
        const existing = await tx.shipment.findFirst({
          where: { id, organizationId },
          select: { id: true, blNumber: true, costs: true, eta: true, etaHistory: true, contract: { select: { lines: { select: { id: true, grade: true, sizeSpec: true } } } } },
        });
        if (!existing) throw new NotFoundException('Shipment not found');
        etaMoved = dto.eta !== undefined && (existing.eta ? existing.eta.toISOString().slice(0, 10) : null) !== (dto.eta ? String(dto.eta).slice(0, 10) : null);
        if (dto.contractLineId !== undefined) {
          const lines = existing.contract?.lines ?? [];
          if (dto.contractLineId === null || dto.contractLineId === '') {
            // Under an order the product comes from the order; the contract line is optional.
          } else if (!lines.some((l: { id: string }) => l.id === dto.contractLineId)) {
            throw new BadRequestException("That product line is not on this shipment's contract");
          }
        }
        if (dto.customerId) await this.assertCustomer(tx, organizationId, dto.customerId);
        if (blNumber && blNumber !== existing.blNumber) await this.assertBlFree(tx, organizationId, blNumber, id);
        await tx.shipment.update({
          where: { id, organizationId },
          data: {
            ...(blNumber !== undefined ? { blNumber } : {}),
            ...(dto.contractLineId !== undefined ? { contractLineId: dto.contractLineId || null } : {}),
            ...(dto.customerId !== undefined ? { customerId: dto.customerId || null } : {}),
            ...(dto.currency ? { currency: dto.currency } : {}),
            ...this.fields(dto),
            ...(dto.costs !== undefined ? { costs: mergeCosts(existing.costs, dto.costs) as any } : {}),
            ...(dto.status === 'CANCELLED' ? { status: 'CANCELLED' } : {}),
            // Every ETA move is kept ("8/6 → 8/16 → 8/17") and re-schedules the reminders.
            ...(etaMoved
              ? { etaHistory: withEtaChange(existing.etaHistory, existing.eta, dto.eta ? new Date(dto.eta) : null, actor?.name ?? null, dto.etaSource ?? 'MANUAL') as any }
              : {}),
            ...(dto.dischargeDate !== undefined ? { dischargeDate: dto.dischargeDate ? new Date(dto.dischargeDate) : null } : {}),
            ...(dto.storageStartDate !== undefined ? { storageStartDate: dto.storageStartDate ? new Date(dto.storageStartDate) : null } : {}),
            ...(dto.detFreeDays !== undefined ? { detFreeDays: dto.detFreeDays } : {}),
            ...(dto.demFreeDays !== undefined ? { demFreeDays: dto.demFreeDays } : {}),
            ...(dto.warehouse !== undefined ? { warehouse: optText(dto.warehouse) ?? null } : {}),
            ...(dto.supplierOrderId !== undefined ? { supplierOrderId: dto.supplierOrderId || null } : {}),
          },
        });
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw new BadRequestException(`B/L number "${blNumber}" is already used by another shipment`);
      throw e;
    }
    // Step 2's B/L fields (requiredFields) complete it once its B/L draft is there too.
    await this.config.syncSteps(this.prisma, organizationId, [{ shipmentId: id }], actor, { fields: Object.keys(dto) });
    // Dates the reminders hang off moved: re-plan them now (best effort).
    if (etaMoved || dto.dischargeDate !== undefined || dto.detFreeDays !== undefined || dto.demFreeDays !== undefined) await this.alerts?.refresh(organizationId);
    return this.getById(organizationId, id);
  }

  async remove(organizationId: string, id: string) {
    await this.prisma.$transaction(async (tx: Db) => {
      const s = await tx.shipment.findFirst({ where: { id, organizationId }, select: { id: true } });
      if (!s) throw new NotFoundException('Shipment not found');
      // Steps and file links cascade; the files themselves stay in the Documents library.
      await tx.shipment.delete({ where: { id, organizationId } });
    });
    return { id, deleted: true };
  }

  async complete(organizationId: string, id: string) {
    await this.prisma.$transaction(async (tx: Db) => {
      const s = await tx.shipment.findFirst({
        where: { id, organizationId },
        select: {
          blNumber: true,
          status: true,
          steps: { orderBy: { sortOrder: 'asc' }, select: { id: true, title: true, displayNo: true, sortOrder: true, status: true, isOngoing: true, requiredDocTypes: true } },
        },
      });
      if (!s) throw new NotFoundException('Shipment not found');
      const label = s.blNumber ? `shipment ${s.blNumber}` : 'this shipment';
      if (s.status === 'COMPLETED') throw new BadRequestException(`${cap(label)} is already completed`);
      if (s.status === 'CANCELLED') throw new BadRequestException(`${cap(label)} is cancelled — reopen it first`);
      const blocking = blockingSteps(s.steps);
      if (blocking.length) {
        throw new BadRequestException(`Cannot complete ${label}: these steps are not done: ${blocking.map((x) => stepLabels(s.steps).get(x.id)).join(', ')}`);
      }
      await tx.shipment.update({ where: { id, organizationId }, data: { status: 'COMPLETED' } });
    });
    return this.getById(organizationId, id);
  }

  /**
   * Back to OPEN. A shipment can't be worked on under a completed contract, so
   * a COMPLETED contract is reopened with it (reported as reopenedContract so
   * the portal can say so); a cancelled contract is left alone.
   */
  async reopen(organizationId: string, id: string, actor: TradeActor | null = null) {
    let reopenedContract: string | null = null;
    await this.prisma.$transaction(async (tx: Db) => {
      const s = await tx.shipment.findFirst({
        where: { id, organizationId },
        select: { blNumber: true, status: true, contract: { select: { id: true, contractNo: true, status: true } }, order: { select: { id: true, orderNo: true, status: true } } },
      });
      if (!s) throw new NotFoundException('Shipment not found');
      if (s.status === 'OPEN') throw new BadRequestException(`${s.blNumber ? `Shipment ${s.blNumber}` : 'This shipment'} is already open`);
      await tx.shipment.update({ where: { id, organizationId }, data: { status: 'OPEN' } });
      // Under an order: a completed order reopens with its shipment (reported as reopenedContract, "#19", for the toast).
      if (s.order) {
        if (s.order.status === 'COMPLETED') {
          await tx.tradeOrder.update({ where: { id: s.order.id, organizationId }, data: { status: 'OPEN' } });
          reopenedContract = `#${s.order.orderNo}`;
        }
      } else if (s.contract?.status === 'COMPLETED') {
        await tx.contract.update({ where: { id: s.contract.id, organizationId }, data: { status: 'OPEN' } });
        reopenedContract = s.contract.contractNo;
      }
    });
    return { ...(await this.getById(organizationId, id, actor ?? undefined)), reopenedContract };
  }

  // ── helpers ─────────────────────────────────────────────────────────────
  private async assertCustomer(db: Db, organizationId: string, customerId: string) {
    const c = await db.customer.findFirst({ where: { id: customerId, organizationId }, select: { id: true } });
    if (!c) throw new BadRequestException('Customer not found in this organization');
  }

  private async assertBlFree(db: Db, organizationId: string, blNumber: string, exceptId?: string) {
    const dup = await db.shipment.findFirst({
      where: { organizationId, blNumber, ...(exceptId ? { NOT: { id: exceptId } } : {}) },
      select: { id: true },
    });
    if (dup) throw new BadRequestException(`B/L number "${blNumber}" is already used by another shipment`);
  }

  /** Optional columns shared by create and update; undefined = leave unchanged. */
  private fields(dto: Partial<CreateShipmentDto>) {
    const out: Record<string, unknown> = {};
    const texts = [
      'vessel',
      'voyageNo',
      'shippingLine',
      'deliveryMonth',
      'portOfLoading',
      'portOfDischarge',
      'hsCode',
      'countryOfOrigin',
      'commodity',
      'sizeSpec',
      'ciNumber',
      'telexReleaseCode',
      'notes',
    ] as const;
    for (const k of texts) {
      const v = optText(dto[k]);
      if (v !== undefined) out[k] = v;
    }
    for (const k of ['netWeightMt', 'grossWeightMt', 'totalBundles', 'totalPieces', 'containerCount', 'ciAmount'] as const) {
      if (dto[k] !== undefined) out[k] = dto[k];
    }
    for (const k of ['etd', 'eta', 'actualArrivalDate'] as const) {
      if (dto[k] !== undefined) out[k] = dto[k] ? new Date(dto[k] as string) : null;
    }
    return out;
  }
}

type LineRow = { id: string; grade: string | null; product: string | null; sizeSpec: string | null };

/**
 * The line a new shipment ships: the one asked for, else the contract's only
 * line; with several lines and none asked for it stays empty and is picked on
 * shipment step 2 (a required field there).
 */
export function pickLine<L extends LineRow>(lines: L[], requested: string | null | undefined): L | null {
  if (requested) {
    const l = lines.find((x) => x.id === requested);
    if (!l) throw new BadRequestException("That product line is not on this shipment's contract");
    return l;
  }
  return lines.length === 1 ? lines[0] : null;
}

/** "Aluminium Billet 6063" — the line's product + grade, as the shipment's commodity. */
export const commodityOf = (l: { product: string | null; grade: string | null }) => [l.product, l.grade].filter(Boolean).join(' ') || null;

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Merge a costs patch (validated) into the stored costs; `actual` merges one level deep. */
export function mergeCosts(current: unknown, patch: unknown): ShipmentCosts {
  const cur = (current && typeof current === 'object' ? current : {}) as ShipmentCosts;
  const p = cleanCosts(patch, (m) => {
    throw new BadRequestException(m);
  });
  return { ...cur, ...p, ...(p.actual ? { actual: { ...(cur.actual ?? {}), ...p.actual } } : {}) };
}
