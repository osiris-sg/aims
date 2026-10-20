import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { CreateOrderDto, ListOrdersQuery, MonthlyOrdersDto, UpdateOrderDto } from './dto/order.dto';
import { CreateShipmentDto } from './dto/shipment.dto';
import { TradeActor } from './shipments.request';
import { blockingSteps, currentStepOf, depositOf, monthsLabel, monthShort, orderCurrentStep, orderLabel, progressOf, shipmentRef, stepLabels, tradeToday } from './shipments.rules';
import { Db, DOC_LINK_SELECT, isUniqueViolation, optText, pageArgs, TradeConfigService } from './trade-config.service';
import { DEFAULT_DEPOSIT_DUE, depositDueDate } from './trade-deposit';
import { amountOf, invoiceTotals, toInvoiceLines } from './trade-invoice';
import { SgjpItem, sgjpTotals } from './trade-logistics-docs';
import { cleanReconcileInputs, reconcile, ReconcileDocs, ReconcileInputs } from './trade-reconcile';
import { CONTRACT_LINE_SELECT, FILE_LINK_SELECT, shapeFileLinks, STEP_SELECT, STEP_SUMMARY_SELECT } from './trade-selects';
import { ShipmentsService } from './shipments.service';
import { premiumAt } from './trade-contract';
import { stepPaymentOf } from './trade-payments';

const PARTY = { select: { id: true, name: true, customerCode: true } };
const SUPPLIER = { select: { id: true, name: true, supplierCode: true } };

/** "6063 · 203MM · 300 MT" — the order's product as one label. */
export function orderProductLabel(o: { product?: string | null; grade?: string | null; size?: string | null; qtyMt?: unknown }): string {
  const qty = o.qtyMt === null || o.qtyMt === undefined || o.qtyMt === '' ? null : `${Number(o.qtyMt).toLocaleString('en-US', { maximumFractionDigits: 3 })} MT`;
  return [o.grade || o.product || null, o.size || null, qty].filter(Boolean).join(' · ');
}

/** "2026-07" + 2 → "2026-09" (ship in July, deliver in September). */
export function addMonths(month: string, k: number): string {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7)) - 1 + k;
  const yy = y + Math.floor(m / 12);
  const mm = ((m % 12) + 12) % 12;
  return `${yy}-${String(mm + 1).padStart(2, '0')}`;
}

/** "Sep 2026 — 4 orders, 600 MT" (the Orders list's month header). */
export function monthHeader(month: string | null, orders: number, qtyMt: number | null): string {
  const m = /^(\d{4})-(\d{2})$/.exec(month ?? '');
  const name = m ? `${monthShort(month).slice(0, 3)} ${m[1]}` : 'No ship month';
  const qty = qtyMt ? `, ${qtyMt.toLocaleString('en-US', { maximumFractionDigits: 3 })} MT` : '';
  return `${name} — ${orders} order${orders === 1 ? '' : 's'}${qty}`;
}

/**
 * Orders (ADH's "#19"): Contract (yearly LTC, optional) → Order → Shipment
 * (one per B/L, "#19-1"). One order process (2026-10, round H): the order
 * holds the Vedanta side (PI, deposit, supplier premium) and the customer side
 * (PO, client premium) as plain fields, and its own steps 0 Check contract,
 * 1 PI payment, 2 Invoice #1, 11 Invoice #2 / single invoice and 13
 * reconciliation; shipments hold steps 3–10, 12 and 14. Supplier orders are
 * no longer made (the table stays, unused).
 */
@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: TradeConfigService,
    private readonly shipments: ShipmentsService,
  ) {}

  async list(organizationId: string, query: ListOrdersQuery) {
    const { page, pageSize, skip, take } = pageArgs(query.page, query.pageSize);
    const q = query.q?.trim();
    const qNo = q && /^#?\d+(-\d+)?$/.test(q) ? Number(q.replace('#', '').split('-')[0]) : null;
    const bucket = query.bucket === 'completed' ? { status: { in: ['COMPLETED', 'CANCELLED'] as Array<'COMPLETED' | 'CANCELLED'> } } : query.bucket === 'pending' ? { status: 'OPEN' as const } : {};
    const base = {
      organizationId,
      ...(query.customerId ? { customerId: query.customerId } : {}),
      ...(query.contractId ? { contractId: query.contractId } : {}),
      ...(q
        ? {
            OR: [
              ...(qNo ? [{ orderNo: qNo }] : []),
              { piNo: { contains: q, mode: 'insensitive' as const } },
              { grade: { contains: q, mode: 'insensitive' as const } },
              { contract: { contractNo: { contains: q, mode: 'insensitive' as const } } },
              { customer: { name: { contains: q, mode: 'insensitive' as const } } },
              { shipments: { some: { blNumber: { contains: q, mode: 'insensitive' as const } } } },
              { shipments: { some: { vessel: { contains: q, mode: 'insensitive' as const } } } },
            ],
          }
        : {}),
    };
    const where = { ...base, ...bucket };
    const [rows, total, pending, completed, months] = await Promise.all([
      this.prisma.tradeOrder.findMany({
        where,
        // Grouped by ship month (newest first) — the list shows a header per month.
        orderBy: [{ shipMonth: { sort: 'desc', nulls: 'last' } }, { year: 'desc' }, { orderNo: 'desc' }],
        skip,
        take,
        include: {
          customer: PARTY,
          supplier: SUPPLIER,
          contract: { select: { id: true, contractNo: true } },
          steps: { select: STEP_SUMMARY_SELECT },
          shipments: {
            orderBy: [{ seqNo: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }],
            select: { id: true, seqNo: true, blNumber: true, vessel: true, voyageNo: true, eta: true, status: true, netWeightMt: true, steps: { select: STEP_SUMMARY_SELECT } },
          },
        },
      }),
      this.prisma.tradeOrder.count({ where }),
      this.prisma.tradeOrder.count({ where: { ...base, status: 'OPEN' } }),
      this.prisma.tradeOrder.count({ where: { ...base, status: { in: ['COMPLETED', 'CANCELLED'] } } }),
      this.prisma.tradeOrder.groupBy({ by: ['shipMonth'], where, _count: { _all: true }, _sum: { qtyMt: true } }),
    ]);
    const items = rows.map(({ steps, shipments, ...o }: any) => {
      const ships = shipments.map(({ steps: ss, ...s }: any) => ({
        ...s,
        ref: shipmentRef(o.orderNo, s.seqNo),
        progress: progressOf(ss),
        currentStep: currentStepOf(ss),
      }));
      const own = orderCurrentStep(null, steps, shipments);
      return {
        ...o,
        label: orderLabel(o),
        contractNo: o.contract?.contractNo ?? null,
        customerName: o.customer?.name ?? null,
        monthsLabel: monthsLabel(o.shipMonth, o.deliveryMonth),
        productLabel: orderProductLabel(o),
        shipmentCount: ships.length,
        shipments: ships,
        progress: progressOf(steps),
        currentStep: own,
      };
    });
    // Month headers count the whole filtered list, not just this page.
    const monthTotals = (months as Array<{ shipMonth: string | null; _count: { _all: number }; _sum: { qtyMt: unknown } }>)
      .map((m) => {
        const qty = m._sum.qtyMt === null || m._sum.qtyMt === undefined ? null : Number(m._sum.qtyMt);
        return { month: m.shipMonth, orders: m._count._all, qtyMt: qty, label: monthHeader(m.shipMonth, m._count._all, qty) };
      })
      .sort((a, b) => (b.month ?? '').localeCompare(a.month ?? ''));
    return { items, total, page, pageSize, totalPages: Math.ceil(total / pageSize), counts: { pending, completed }, months: monthTotals };
  }

  /** Detail; with an actor, auto-complete runs first on the order and its shipments. */
  async getById(organizationId: string, id: string, actor?: TradeActor) {
    if (actor) {
      const ships: Array<{ id: string }> = await this.prisma.shipment.findMany({ where: { organizationId, orderId: id }, select: { id: true } });
      await this.config.syncSteps(this.prisma, organizationId, [{ orderId: id }, ...ships.map((x) => ({ shipmentId: x.id }))], actor);
    }
    const o = await this.prisma.tradeOrder.findFirst({
      where: { id, organizationId },
      include: {
        customer: { select: { id: true, name: true, customerCode: true, currency: true, jpName: true } },
        supplier: { select: { id: true, name: true, supplierCode: true, currency: true } },
        contract: { select: { id: true, contractNo: true, status: true, qpBasis: true, premiumSchedule: true, lines: { orderBy: { sortOrder: 'asc' }, select: CONTRACT_LINE_SELECT } } },
        shipments: {
          orderBy: [{ seqNo: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }],
          select: {
            id: true,
            seqNo: true,
            blNumber: true,
            vessel: true,
            voyageNo: true,
            etd: true,
            eta: true,
            netWeightMt: true,
            grossWeightMt: true,
            ciAmount: true,
            status: true,
            createdAt: true,
            steps: { select: STEP_SUMMARY_SELECT },
          },
        },
        steps: { orderBy: { sortOrder: 'asc' }, select: STEP_SELECT },
        fileLinks: { orderBy: { createdAt: 'desc' }, select: FILE_LINK_SELECT },
        docLinks: { orderBy: { createdAt: 'desc' }, select: DOC_LINK_SELECT },
      },
    });
    if (!o) throw new NotFoundException('Order not found');
    const { shipments, ...rest } = o as any;
    // Step 11 (Invoice #2 / single invoice) is satisfied by its shipments' invoices.
    const { steps, docLinks } = await this.config.decorateRecord(organizationId, o as any, this.prisma, await this.config.orderInvoiceTypes(this.prisma, organizationId, o.id));
    const profile = await this.config.profileOf(organizationId, o.customerId);
    const supplierProfile = await this.config.supplierProfileOf(organizationId, o.supplierId);
    return {
      ...rest,
      label: orderLabel(o),
      supplierProfile,
      steps,
      docLinks,
      fileLinks: shapeFileLinks(o.fileLinks),
      profile,
      depositDueDate: depositDueDate(o.piDate, o.depositDueDays, o.depositDueUnit),
      monthsLabel: monthsLabel(o.shipMonth, o.deliveryMonth),
      productLabel: orderProductLabel(o),
      progress: progressOf(o.steps),
      currentStep: orderCurrentStep(null, o.steps, shipments),
      shipments: shipments.map(({ steps: ss, ...s }: any) => ({ ...s, ref: shipmentRef(o.orderNo, s.seqNo), progress: progressOf(ss), currentStep: currentStepOf(ss) })),
    };
  }

  /** The next free order number for a year (the New Order form's default). */
  async nextOrderNo(organizationId: string, year: number, db: Db = this.prisma): Promise<number> {
    const last: { orderNo: number } | null = await db.tradeOrder.findFirst({ where: { organizationId, year }, orderBy: { orderNo: 'desc' }, select: { orderNo: true } });
    return (last?.orderNo ?? 0) + 1;
  }

  async create(organizationId: string, dto: CreateOrderDto, actor: TradeActor) {
    try {
      const id = await this.prisma.$transaction((tx: Db) => this.createInTx(tx, organizationId, dto, actor), { timeout: 30_000 });
      return this.getById(organizationId, id, actor);
    } catch (e) {
      if (isUniqueViolation(e)) throw new BadRequestException('That order number is already used this year');
      throw e;
    }
  }

  /**
   * Create an order inside a transaction: steps 0, 1, 2, 11, 13 snapshotted
   * with the customer's and the supplier's profile (no PI → step 1 N/A), the
   * PI file on step 1 and the contract file on step 0.
   */
  async createInTx(tx: Db, organizationId: string, dto: CreateOrderDto, actor: TradeActor): Promise<string> {
        const contract = dto.contractId
          ? await tx.contract.findFirst({
              where: { id: dto.contractId, organizationId },
              select: {
                id: true,
                contractNo: true,
                customerId: true,
                supplierId: true,
                currency: true,
                incoterm: true,
                destinationPort: true,
                consignee: true,
                notifyParty: true,
                lines: { orderBy: { sortOrder: 'asc' }, select: CONTRACT_LINE_SELECT },
              },
            })
          : null;
        if (dto.contractId && !contract) throw new BadRequestException('Contract not found in this organization');
        const customerId = dto.customerId ?? contract?.customerId;
        const supplierId = dto.supplierId ?? contract?.supplierId;
        if (!customerId) throw new BadRequestException('Pick the customer (or a contract)');
        if (!supplierId) throw new BadRequestException('Pick the supplier (or a contract)');
        await this.assertParties(tx, organizationId, supplierId, customerId);
        const year = dto.year ?? (dto.shipMonth ? Number(dto.shipMonth.slice(0, 4)) : Number(tradeToday().slice(0, 4)));
        const orderNo = dto.orderNo ?? (await this.nextOrderNo(organizationId, year, tx));
        const dup = await tx.tradeOrder.findFirst({ where: { organizationId, year, orderNo }, select: { id: true } });
        if (dup) throw new BadRequestException(`Order #${orderNo} already exists for ${year}`);
        // Premiums default from the contract line of the same grade (else its only line); typed values win.
        const line = defaultLine((contract?.lines ?? []) as ContractLineRow[], dto.grade);
        const settings = await this.config.getSettings(organizationId, tx);
        const fields = this.fields(dto);
        const created = await tx.tradeOrder.create({
          data: {
            organizationId,
            year,
            orderNo,
            contractId: contract?.id ?? null,
            customerId,
            supplierId,
            product: optText(dto.product) ?? line?.product ?? null,
            grade: optText(dto.grade) ?? line?.grade ?? null,
            size: optText(dto.size) ?? line?.sizeSpec ?? null,
            tolPct: dto.tolPct ?? line?.tolerancePct ?? 5,
            supplierPremium: dto.supplierPremium ?? line?.supplierPremium ?? null,
            clientPremium: dto.clientPremium ?? line?.billetPremium ?? line?.clientPremium ?? null,
            upcharge: dto.upcharge ?? line?.upcharge ?? null,
            currency: dto.currency ?? contract?.currency ?? 'USD',
            incoterm: optText(dto.incoterm) ?? contract?.incoterm ?? 'CIF',
            destinationPort: optText(dto.destinationPort) ?? contract?.destinationPort ?? null,
            consignee: dto.consignee === undefined ? (contract?.consignee ?? settings.defaultConsignee) : optText(dto.consignee),
            notifyParty: dto.notifyParty === undefined ? (contract?.notifyParty ?? settings.defaultNotifyParty) : optText(dto.notifyParty),
            depositDueDays: dto.depositDueDays ?? DEFAULT_DEPOSIT_DUE.days,
            depositDueUnit: dto.depositDueUnit ?? DEFAULT_DEPOSIT_DUE.unit,
            ...omit(fields, [
              'product',
              'grade',
              'size',
              'tolPct',
              'supplierPremium',
              'clientPremium',
              'upcharge',
              'currency',
              'incoterm',
              'destinationPort',
              'consignee',
              'notifyParty',
              'depositDueDays',
              'depositDueUnit',
            ]),
            ...(dto.depositAmount === undefined ? { depositAmount: depositOf(dto.piAmount, dto.depositPct ?? 10) } : {}),
            createdById: actor.id,
          },
          select: { id: true },
        });
        const profile = await this.config.profileOf(organizationId, customerId, tx);
        const sp = await this.config.supplierProfileOf(organizationId, supplierId, tx);
        await this.config.snapshotSteps(tx, organizationId, 'ORDER', { orderId: created.id }, profile, sp);
        if (dto.piFileId) await this.config.linkSourceFile(tx, organizationId, dto.piFileId, 'PI', { orderId: created.id }, 'PI_PAYMENT');
        if (dto.contractFileId) await this.config.linkSourceFile(tx, organizationId, dto.contractFileId, 'CONTRACT', { orderId: created.id }, 'CHECK_CONTRACT');
        return created.id as string;
  }

  /**
   * "+ New monthly order": the month's quantities per customer × grade × size
   * × contract — one order per row, all shipping in `month` (delivery = +2
   * unless typed), premiums from the contract's schedule / line for the month.
   * One transaction: a bad row creates nothing.
   */
  async createMonthly(organizationId: string, dto: MonthlyOrdersDto, actor: TradeActor) {
    const ids: string[] = [];
    await this.prisma.$transaction(
      async (tx: Db) => {
        const year = Number(dto.month.slice(0, 4));
        for (const [i, r] of dto.rows.entries()) {
          const contract = await tx.contract.findFirst({ where: { id: r.contractId, organizationId }, select: { id: true, supplierId: true, grade: true, premiumSchedule: true } });
          if (!contract) throw new BadRequestException(`Row ${i + 1}: contract not found`);
          if (!(await tx.customer.findFirst({ where: { id: r.customerId, organizationId }, select: { id: true } }))) throw new BadRequestException(`Row ${i + 1}: customer not found`);
          const grade = optText(r.grade) ?? contract.grade ?? null;
          const sched = premiumAt(contract.premiumSchedule, dto.month, grade || undefined);
          ids.push(
            await this.createInTx(
              tx,
              organizationId,
              {
                year,
                orderNo: await this.nextOrderNo(organizationId, year, tx),
                contractId: contract.id,
                customerId: r.customerId,
                supplierId: contract.supplierId,
                shipMonth: dto.month,
                deliveryMonth: r.deliveryMonth ?? addMonths(dto.month, 2),
                grade: grade ?? undefined,
                size: optText(r.size) ?? undefined,
                qtyMt: r.qtyMt,
                clientPremium: r.clientPremium ?? sched?.clientPremium ?? undefined,
                supplierPremium: sched?.supplierPremium ?? undefined,
                upcharge: sched?.upcharge ?? undefined,
              },
              actor,
            ),
          );
        }
      },
      { timeout: 60_000 },
    );
    await this.config.syncSteps(
      this.prisma,
      organizationId,
      ids.map((orderId) => ({ orderId })),
      actor,
    );
    const rows: Array<{ id: string; year: number; orderNo: number; qtyMt: unknown; grade: string | null; customer: { name: string } }> = await this.prisma.tradeOrder.findMany({
      where: { organizationId, id: { in: ids } },
      orderBy: { orderNo: 'asc' },
      select: { id: true, year: true, orderNo: true, qtyMt: true, grade: true, customer: { select: { name: true } } },
    });
    return { month: dto.month, created: rows.map((o) => ({ id: o.id, label: orderLabel(o), customerName: o.customer.name, grade: o.grade, qtyMt: o.qtyMt === null ? null : Number(o.qtyMt) })) };
  }

  async update(organizationId: string, id: string, dto: UpdateOrderDto, actor: TradeActor | null = null) {
    await this.prisma.$transaction(async (tx: Db) => {
      const existing = await tx.tradeOrder.findFirst({ where: { id, organizationId }, select: { id: true, year: true, orderNo: true, customerId: true } });
      if (!existing) throw new NotFoundException('Order not found');
      if (dto.supplierId || dto.customerId) await this.assertParties(tx, organizationId, dto.supplierId, dto.customerId);
      if (dto.contractId) {
        const c = await tx.contract.findFirst({ where: { id: dto.contractId, organizationId }, select: { id: true } });
        if (!c) throw new BadRequestException('Contract not found in this organization');
      }
      const year = dto.year ?? existing.year;
      const orderNo = dto.orderNo ?? existing.orderNo;
      if (year !== existing.year || orderNo !== existing.orderNo) {
        const dup = await tx.tradeOrder.findFirst({ where: { organizationId, year, orderNo, NOT: { id } }, select: { id: true } });
        if (dup) throw new BadRequestException(`Order #${orderNo} already exists for ${year}`);
      }
      await tx.tradeOrder.update({
        where: { id, organizationId },
        data: {
          ...(dto.year !== undefined ? { year } : {}),
          ...(dto.orderNo !== undefined ? { orderNo } : {}),
          ...(dto.contractId !== undefined ? { contractId: dto.contractId || null } : {}),
          ...(dto.customerId ? { customerId: dto.customerId } : {}),
          ...(dto.supplierId ? { supplierId: dto.supplierId } : {}),
          ...this.fields(dto),
          ...(dto.status === 'CANCELLED' ? { status: 'CANCELLED' } : {}),
        },
      });
      // Shipments carry the order's contract (denormalised) for their documents.
      if (dto.contractId !== undefined) await tx.shipment.updateMany({ where: { organizationId, orderId: id }, data: { contractId: dto.contractId || null } });
      if (dto.customerId && dto.customerId !== existing.customerId) await this.config.applyProfileToCustomer(tx, organizationId, dto.customerId);
      // Another supplier: its profile decides step 1 (no PI → N/A).
      if (dto.supplierId) {
        const p = await this.config.profileOf(organizationId, dto.customerId ?? existing.customerId, tx);
        await this.config.applyProfile(tx, organizationId, { orderId: id }, 'ORDER', p, await this.config.supplierProfileOf(organizationId, dto.supplierId, tx));
      }
    });
    await this.config.syncSteps(this.prisma, organizationId, [{ orderId: id }], actor, { fields: Object.keys(dto) });
    return this.getById(organizationId, id);
  }

  async remove(organizationId: string, id: string) {
    await this.prisma.$transaction(async (tx: Db) => {
      const o = await tx.tradeOrder.findFirst({
        where: { id, organizationId },
        select: { id: true, orderNo: true, shipments: { select: { id: true, seqNo: true, blNumber: true, _count: { select: { fileLinks: true, docLinks: true, generatedDocs: true } } } } },
      });
      if (!o) throw new NotFoundException('Order not found');
      const used = o.shipments.filter((x: any) => x._count.fileLinks + x._count.docLinks + x._count.generatedDocs > 0);
      if (used.length)
        throw new BadRequestException(`Order #${o.orderNo} has shipment(s) with documents (${used.map((x: any) => shipmentRef(o.orderNo, x.seqNo) || x.blNumber).join(', ')}) — delete them first`);
      if (o.shipments.length) await tx.shipment.deleteMany({ where: { organizationId, orderId: id } });
      await tx.tradeOrder.delete({ where: { id, organizationId } });
    });
    return { id, deleted: true };
  }

  async complete(organizationId: string, id: string) {
    await this.prisma.$transaction(async (tx: Db) => {
      const o = await tx.tradeOrder.findFirst({
        where: { id, organizationId },
        select: {
          orderNo: true,
          status: true,
          steps: { orderBy: { sortOrder: 'asc' }, select: { id: true, title: true, displayNo: true, sortOrder: true, status: true, isOngoing: true, notApplicable: true, requiredDocTypes: true } },
          shipments: { select: { seqNo: true, status: true } },
        },
      });
      if (!o) throw new NotFoundException('Order not found');
      if (o.status === 'COMPLETED') throw new BadRequestException(`Order #${o.orderNo} is already completed`);
      if (o.status === 'CANCELLED') throw new BadRequestException(`Order #${o.orderNo} is cancelled — reopen it first`);
      const open = o.shipments.filter((x: { status: string }) => x.status === 'OPEN');
      if (open.length) throw new BadRequestException(`Cannot complete order #${o.orderNo}: complete its shipment(s) first — ${open.map((x: any) => shipmentRef(o.orderNo, x.seqNo)).join(', ')}`);
      const blocking = blockingSteps(o.steps);
      if (blocking.length) throw new BadRequestException(`Cannot complete order #${o.orderNo}: these steps are not done: ${blocking.map((s) => stepLabels(o.steps).get(s.id)).join(', ')}`);
      await tx.tradeOrder.update({ where: { id, organizationId }, data: { status: 'COMPLETED' } });
    });
    return this.getById(organizationId, id);
  }

  async reopen(organizationId: string, id: string, actor: TradeActor | null = null) {
    const o = await this.prisma.tradeOrder.findFirst({ where: { id, organizationId }, select: { orderNo: true, status: true } });
    if (!o) throw new NotFoundException('Order not found');
    if (o.status === 'OPEN') throw new BadRequestException(`Order #${o.orderNo} is already open`);
    await this.prisma.tradeOrder.update({ where: { id, organizationId }, data: { status: 'OPEN' } });
    return this.getById(organizationId, id, actor ?? undefined);
  }

  /** "Add shipment": the next B/L under the order (#19-2), B/L pending. */
  async addShipment(organizationId: string, orderId: string, dto: Omit<CreateShipmentDto, 'orderId' | 'contractId'>, actor: TradeActor) {
    return this.shipments.create(organizationId, { ...dto, orderId } as CreateShipmentDto, actor);
  }

  // ── step 13: reconciliation ─────────────────────────────────────────────
  async reconciliation(organizationId: string, id: string) {
    const o = await this.prisma.tradeOrder.findFirst({
      where: { id, organizationId },
      select: {
        id: true,
        orderNo: true,
        piAmount: true,
        depositPct: true,
        depositAmount: true,
        reconciliation: true,
        customerId: true,
        steps: { select: { code: true, payment: true } },
        shipments: { select: { id: true, ciAmount: true, costs: true, steps: { select: { code: true, payment: true } } } },
      },
    });
    if (!o) throw new NotFoundException('Order not found');
    const docs = await this.reconcileDocs(
      organizationId,
      o.id,
      o.shipments.map((s: { id: string }) => s.id),
    );
    // Paid on the steps (round H): step 1 deposit, step 6 CI per shipment, step 12 logistics (JPY); else the documents' figures.
    const paid = paidOnSteps(o.steps, o.shipments);
    const ci = paid.ciUsd ?? o.shipments.reduce((sum: number | null, s: { ciAmount: unknown }) => (s.ciAmount === null || s.ciAmount === undefined ? sum : (sum ?? 0) + Number(s.ciAmount)), null as number | null);
    const deposit = paid.depositUsd ?? (o.depositAmount !== null && o.depositAmount !== undefined ? Number(o.depositAmount) : depositOf(o.piAmount, o.depositPct ?? 10));
    // Import tax from the shipments' estimator (step 8) unless typed here.
    const shipCosts = o.shipments.map((s: { costs: unknown }) => (s.costs ?? {}) as Record<string, number | null>);
    const sumOf = (k: string) => shipCosts.reduce((a: number | null, c: Record<string, number | null>) => (c[k] === null || c[k] === undefined ? a : (a ?? 0) + Number(c[k])), null as number | null);
    const fx = shipCosts.map((c: Record<string, number | null>) => c.fxRate).find((v: unknown) => typeof v === 'number') ?? null;
    const inputs = (o.reconciliation ?? {}) as ReconcileInputs;
    const merged: ReconcileInputs = { importTaxActualJpy: sumOf('importTaxActual'), mitsuiActualsJpy: paid.logisticsJpy, ...stripNulls(inputs) };
    const result = reconcile(merged, docs, { piDeposit: deposit, ciAmount: ci, fxRate: fx as number | null });
    // Invoice #2 / single invoices issued on ESTIMATED costs: step 13 shows their variance once actuals are in.
    const shipIds = o.shipments.map((s: { id: string }) => s.id);
    const estimated: Array<{ id: string; number: string | null; docType: string; header: any }> = shipIds.length
      ? await this.prisma.tradeGeneratedDoc.findMany({
          where: { organizationId, status: 'FINAL', docType: { in: ['INVOICE_2', 'INVOICE_SINGLE'] }, OR: [{ shipmentId: { in: shipIds } }, { coversShipmentIds: { hasSome: shipIds } }] },
          select: { id: true, number: true, docType: true, header: true },
        })
      : [];
    return {
      orderId: o.id,
      label: orderLabel(o),
      ...result,
      paid,
      estimatedInvoices: estimated.filter((g) => g.header?.costsBasis === 'ESTIMATED').map((g) => ({ id: g.id, number: g.number, docType: g.docType })),
    };
  }

  async updateReconciliation(organizationId: string, id: string, body: unknown) {
    const o = await this.prisma.tradeOrder.findFirst({ where: { id, organizationId }, select: { reconciliation: true } });
    if (!o) throw new NotFoundException('Order not found');
    const patch = cleanReconcileInputs(body, (m) => {
      throw new BadRequestException(m);
    });
    await this.prisma.tradeOrder.update({ where: { id, organizationId }, data: { reconciliation: { ...((o.reconciliation as object) ?? {}), ...patch } as any } });
    return this.reconciliation(organizationId, id);
  }

  /** Invoice #1 (order), SG→JP IV (shipments), Invoice #2 / single invoice (covering the order's shipments) — FINAL documents only. */
  private async reconcileDocs(organizationId: string, orderId: string, shipmentIds: string[]): Promise<ReconcileDocs> {
    const gens: Array<{ docType: string; number: string | null; header: any; rows: unknown; orderId: string | null; shipmentId: string | null; coversShipmentIds: string[] }> =
      await this.prisma.tradeGeneratedDoc.findMany({
        where: {
          organizationId,
          status: 'FINAL',
          OR: [{ orderId }, ...(shipmentIds.length ? [{ shipmentId: { in: shipmentIds } }, { coversShipmentIds: { hasSome: shipmentIds } }] : [])],
        },
        select: { docType: true, number: true, header: true, rows: true, orderId: true, shipmentId: true, coversShipmentIds: true },
      });
    const totals = (g: { header: any; rows: unknown }) => invoiceTotals(toInvoiceLines(g.rows), Number(g.header?.taxRate ?? 10), null, g.header?.variant === 'final' ? 'final' : undefined);
    const inv1 = gens.find((g) => g.docType === 'INVOICE_1');
    const t1 = inv1 ? totals(inv1) : null;
    const sgjp = gens.filter((g) => g.docType === 'SGJP_IV_PL');
    const sgjpTotal = sgjp.length ? sgjp.reduce((s, g) => s + sgjpTotals((Array.isArray(g.rows) ? g.rows : []) as SgjpItem[]).amount, 0) : null;
    const inv2 = gens.filter((g) => g.docType === 'INVOICE_2');
    const single = gens.find((g) => g.docType === 'INVOICE_SINGLE');
    const inv2Totals = inv2.map(totals);
    return {
      invoice1: inv1 && t1 ? { number: inv1.number, goods: t1.subtotal, tax: t1.tax, total: t1.total } : null,
      sgjpTotal: sgjpTotal === null ? null : Math.round(sgjpTotal * 100) / 100,
      invoice2: inv2.length
        ? {
            numbers: inv2.map((g) => g.number ?? '').filter(Boolean),
            lines: inv2.flatMap((g) => toInvoiceLines(g.rows).map((l) => ({ description: l.description, amount: amountOf(l) }))),
            total: round2(inv2Totals.reduce((s, t) => s + t.total, 0)),
            tax: round2(inv2Totals.reduce((s, t) => s + t.tax, 0)),
            taxable: round2(inv2Totals.reduce((s, t) => s + t.taxable, 0)),
            nonTaxable: round2(inv2Totals.reduce((s, t) => s + t.nonTaxable, 0)),
          }
        : null,
      single: single ? { number: single.number, total: totals(single).total, tax: totals(single).tax } : null,
    };
  }

  // ── helpers ─────────────────────────────────────────────────────────────
  private async assertParties(db: Db, organizationId: string, supplierId?: string, customerId?: string) {
    if (supplierId && !(await db.supplier.findFirst({ where: { id: supplierId, organizationId }, select: { id: true } }))) throw new BadRequestException('Supplier not found in this organization');
    if (customerId && !(await db.customer.findFirst({ where: { id: customerId, organizationId }, select: { id: true } }))) throw new BadRequestException('Customer not found in this organization');
  }

  /** Optional columns shared by create and update; undefined = leave unchanged. */
  private fields(dto: Partial<CreateOrderDto>) {
    const out: Record<string, unknown> = {};
    for (const k of ['shipMonth', 'deliveryMonth', 'product', 'grade', 'size', 'piNo', 'incoterm', 'destinationPort', 'consignee', 'notifyParty', 'notes', 'customerPoNo'] as const) {
      const v = optText(dto[k]);
      if (v !== undefined) out[k] = v;
    }
    for (const k of ['qtyMt', 'tolPct', 'supplierPremium', 'clientPremium', 'upcharge', 'piAmount', 'depositPct', 'depositAmount', 'depositDueDays'] as const) {
      if (dto[k] !== undefined) out[k] = dto[k];
    }
    if (dto.depositDueUnit !== undefined) out.depositDueUnit = dto.depositDueUnit || null;
    for (const k of ['piDate', 'depositPaidAt', 'customerPoDate'] as const) if (dto[k] !== undefined) out[k] = dto[k] ? new Date(dto[k] as string) : null;
    if (dto.currency) out.currency = dto.currency;
    if (dto.checkFields !== undefined) out.checkFields = [...new Set(dto.checkFields.map((x) => x.trim()).filter(Boolean))];
    return out;
  }
}

/** The contract line an order defaults from: same grade, else the contract's only line. */
export function defaultLine<L extends { grade: string | null }>(lines: L[], grade: string | null | undefined): L | null {
  const g = (grade ?? '').trim();
  if (g) {
    const hit = lines.find((l) => (l.grade ?? '').trim() === g);
    if (hit) return hit;
  }
  return lines.length === 1 ? lines[0] : null;
}

type ContractLineRow = {
  id: string;
  grade: string | null;
  product: string | null;
  sizeSpec: string | null;
  tolerancePct: unknown;
  supplierPremium: unknown;
  clientPremium: unknown;
  billetPremium: unknown;
  upcharge: unknown;
};

/**
 * What the steps say was paid / received (round H): step 1 (deposit, USD),
 * step 6 per shipment (CI, USD), step 8 (import tax funded, JPY), step 12
 * (transport & storage, JPY), steps 2 / 11 (received from the customer, USD).
 * null = nothing recorded.
 */
export function paidOnSteps(orderSteps: Array<{ code: string; payment: unknown }>, shipments: Array<{ steps: Array<{ code: string; payment: unknown }> }>) {
  const all = [...orderSteps, ...shipments.flatMap((s) => s.steps)];
  const sum = (codes: string[], currency?: string) => {
    const ps = all.filter((s) => codes.includes(s.code)).map((s) => stepPaymentOf(s.payment)).filter((p): p is NonNullable<typeof p> => !!p && (!currency || p.currency === currency));
    return ps.length ? round2(ps.reduce((a, p) => a + p.amount, 0)) : null;
  };
  return {
    depositUsd: sum(['PI_PAYMENT'], 'USD'),
    ciUsd: sum(['CI_PAYMENT'], 'USD'),
    importTaxFundedJpy: sum(['TAX_FUNDS'], 'JPY'),
    logisticsJpy: sum(['LOGISTICS_PAYMENT'], 'JPY'),
    receivedUsd: sum(['INVOICE_1', 'INVOICE_2'], 'USD'),
  };
}

const omit = (o: Record<string, unknown>, keys: string[]) => Object.fromEntries(Object.entries(o).filter(([k]) => !keys.includes(k)));
const stripNulls = <T extends object>(o: T): Partial<T> => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== undefined)) as Partial<T>;
const round2 = (v: number) => Math.round(v * 100) / 100;
