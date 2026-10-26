import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { CreateSupplierOrderDto, DeclarationDto, ListSupplierOrdersQuery, UpdateSupplierOrderDto } from './dto/supplier-order.dto';
import { TradeActor } from './shipments.request';
import { blockingSteps, currentStepOf, depositOf, orderLabel, progressOf, shipmentRef, stepLabels, supplierOrderLabel, tradeToday } from './shipments.rules';
import { Db, optText, pageArgs, TradeConfigService } from './trade-config.service';
import { premiumAt } from './trade-contract';
import { FILE_LINK_SELECT, shapeFileLinks, STEP_SELECT, STEP_SUMMARY_SELECT } from './trade-selects';
import { addMonths, OrdersService } from './orders.service';

export { addMonths };

const SUPPLIER = { select: { id: true, name: true, supplierCode: true } };
const RETIRED = 'Supplier orders are no longer used — the PI, deposit and supplier premium are on the order (steps 0 / 1)';

/**
 * Supplier orders (2026-10, round E): what ADH buys — Vedanta's monthly
 * declaration turned into one PI per contract / customer. Steps 0 (check
 * contract) and 1 (PI payment) live here; customer orders (TradeOrder) are
 * bought under one, and their shipments' CI payments (step 6) are shown
 * with it.
 */
@Injectable()
export class SupplierOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: TradeConfigService,
    private readonly orders: OrdersService,
  ) {}

  async list(organizationId: string, query: ListSupplierOrdersQuery) {
    const { page, pageSize, skip, take } = pageArgs(query.page, query.pageSize);
    const q = query.q?.trim();
    const bucket = query.bucket === 'completed' ? { status: { in: ['COMPLETED', 'CANCELLED'] as Array<'COMPLETED' | 'CANCELLED'> } } : query.bucket === 'pending' ? { status: 'OPEN' as const } : {};
    const base = {
      organizationId,
      ...(query.supplierId ? { supplierId: query.supplierId } : {}),
      ...(query.contractId ? { contractId: query.contractId } : {}),
      ...(query.declarationMonth ? { declarationMonth: query.declarationMonth } : {}),
      ...(q
        ? {
            OR: [
              { piNo: { contains: q, mode: 'insensitive' as const } },
              { grade: { contains: q, mode: 'insensitive' as const } },
              { contract: { contractNo: { contains: q, mode: 'insensitive' as const } } },
              { customerOrders: { some: { customer: { name: { contains: q, mode: 'insensitive' as const } } } } },
            ],
          }
        : {}),
    };
    const where = { ...base, ...bucket };
    const [rows, total, pending, completed] = await Promise.all([
      this.prisma.supplierOrder.findMany({
        where,
        orderBy: [{ year: 'desc' }, { soNo: 'desc' }],
        skip,
        take,
        include: {
          supplier: SUPPLIER,
          contract: { select: { id: true, contractNo: true } },
          steps: { select: STEP_SUMMARY_SELECT },
          customerOrders: { orderBy: { orderNo: 'asc' }, select: { id: true, year: true, orderNo: true, status: true, qtyMt: true, customer: { select: { id: true, name: true } } } },
        },
      }),
      this.prisma.supplierOrder.count({ where }),
      this.prisma.supplierOrder.count({ where: { ...base, status: 'OPEN' } }),
      this.prisma.supplierOrder.count({ where: { ...base, status: { in: ['COMPLETED', 'CANCELLED'] } } }),
    ]);
    const items = rows.map(({ steps, customerOrders, ...so }: any) => ({
      ...so,
      label: supplierOrderLabel(so),
      contractNo: so.contract?.contractNo ?? null,
      customerOrders: customerOrders.map((o: any) => ({ ...o, label: orderLabel(o), customerName: o.customer?.name ?? null })),
      progress: progressOf(steps),
      currentStep: currentStepOf(steps),
    }));
    return { items, total, page, pageSize, totalPages: Math.ceil(total / pageSize), counts: { pending, completed } };
  }

  /** Detail: own steps (0, 1) with requirements, files, the customer orders and their shipments' CI payment (step 6). */
  async getById(organizationId: string, id: string, actor?: TradeActor) {
    if (actor) await this.config.syncSteps(this.prisma, organizationId, [{ supplierOrderId: id }], actor);
    const so = await this.prisma.supplierOrder.findFirst({
      where: { id, organizationId },
      include: {
        supplier: { select: { id: true, name: true, supplierCode: true, currency: true } },
        contract: { select: { id: true, contractNo: true, status: true, qpBasis: true, premiumSchedule: true } },
        steps: { orderBy: { sortOrder: 'asc' }, select: STEP_SELECT },
        fileLinks: { where: { hiddenAt: null }, orderBy: { createdAt: 'desc' }, select: FILE_LINK_SELECT },
        customerOrders: {
          orderBy: { orderNo: 'asc' },
          select: {
            id: true,
            year: true,
            orderNo: true,
            status: true,
            qtyMt: true,
            grade: true,
            shipMonth: true,
            deliveryMonth: true,
            clientPremium: true,
            customer: { select: { id: true, name: true } },
            shipments: {
              orderBy: [{ seqNo: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }],
              select: { id: true, seqNo: true, blNumber: true, ciAmount: true, ciNumber: true, status: true, steps: { where: { code: 'CI_PAYMENT' }, select: STEP_SUMMARY_SELECT } },
            },
          },
        },
      },
    });
    if (!so) throw new NotFoundException('Supplier order not found');
    const { steps } = await this.config.decorateRecord(organizationId, { ...so, docLinks: [] } as any);
    const supplierProfile = await this.config.supplierProfileOf(organizationId, so.supplierId);
    const { customerOrders, ...rest } = so as any;
    return {
      ...rest,
      label: supplierOrderLabel(so),
      steps,
      fileLinks: shapeFileLinks(so.fileLinks),
      supplierProfile,
      depositAmount: so.depositAmount ?? depositOf(so.piAmount, so.depositPct ?? 10),
      progress: progressOf(so.steps),
      currentStep: currentStepOf(so.steps),
      customerOrders: customerOrders.map((o: any) => ({
        ...o,
        label: orderLabel(o),
        customerName: o.customer?.name ?? null,
        shipments: o.shipments.map(({ steps: ss, ...s }: any) => ({ ...s, ref: shipmentRef(o.orderNo, s.seqNo), ciPayment: ss[0] ?? null })),
      })),
    };
  }

  /** Retired (round H): supplier orders are no longer made — the PI is on the order. */
  async create(_organizationId: string, _dto: CreateSupplierOrderDto, _actor: TradeActor): Promise<never> {
    throw new BadRequestException(RETIRED);
  }

  async update(organizationId: string, id: string, dto: UpdateSupplierOrderDto, actor: TradeActor | null = null) {
    const existing = await this.prisma.supplierOrder.findFirst({ where: { id, organizationId }, select: { id: true, supplierId: true } });
    if (!existing) throw new NotFoundException('Supplier order not found');
    const data: Record<string, unknown> = {};
    for (const k of ['declarationMonth', 'product', 'grade', 'size', 'qpBasis', 'piNo', 'notes'] as const) {
      const v = optText(dto[k]);
      if (v !== undefined) data[k] = v;
    }
    for (const k of ['qtyMt', 'provisionalPricePerMt', 'supplierPremium', 'piAmount', 'depositPct', 'depositAmount'] as const) if (dto[k] !== undefined) data[k] = dto[k];
    for (const k of ['piDate', 'depositPaidAt'] as const) if (dto[k] !== undefined) data[k] = dto[k] ? new Date(dto[k] as string) : null;
    if (dto.currency) data.currency = dto.currency;
    if (dto.contractId !== undefined) {
      if (dto.contractId && !(await this.prisma.contract.findFirst({ where: { id: dto.contractId, organizationId }, select: { id: true } }))) throw new BadRequestException('Contract not found in this organization');
      data.contractId = dto.contractId || null;
    }
    if (dto.supplierId && dto.supplierId !== existing.supplierId) {
      if (!(await this.prisma.supplier.findFirst({ where: { id: dto.supplierId, organizationId }, select: { id: true } }))) throw new BadRequestException('Supplier not found in this organization');
      data.supplierId = dto.supplierId;
    }
    if (dto.status === 'CANCELLED') data.status = 'CANCELLED';
    await this.prisma.supplierOrder.update({ where: { id, organizationId }, data });
    if (data.supplierId) await this.config.applyProfileToSupplier(this.prisma, organizationId, data.supplierId as string);
    if (dto.customerOrderIds) await this.prisma.$transaction((tx: Db) => this.linkInTx(tx, organizationId, id, dto.customerOrderIds!));
    await this.config.syncSteps(this.prisma, organizationId, [{ supplierOrderId: id }], actor, { fields: Object.keys(dto) });
    return this.getById(organizationId, id);
  }

  /** Link customer orders (a customer order belongs to one supplier order; linking moves it). */
  async link(_organizationId: string, _id: string, _orderIds: string[]): Promise<never> {
    throw new BadRequestException(RETIRED);
  }

  private async linkInTx(tx: Db, organizationId: string, id: string, orderIds: string[]) {
    const so = await tx.supplierOrder.findFirst({ where: { id, organizationId }, select: { supplierId: true } });
    if (!so) throw new NotFoundException('Supplier order not found');
    const found: Array<{ id: string; orderNo: number; supplierId: string }> = await tx.tradeOrder.findMany({
      where: { organizationId, id: { in: orderIds } },
      select: { id: true, orderNo: true, supplierId: true },
    });
    if (found.length !== new Set(orderIds).size) throw new BadRequestException('One or more customer orders were not found in this organization');
    const other = found.filter((o) => o.supplierId !== so.supplierId);
    if (other.length) throw new BadRequestException(`Order ${other.map((o) => `#${o.orderNo}`).join(', ')} is bought from another supplier`);
    await tx.tradeOrder.updateMany({ where: { organizationId, id: { in: orderIds } }, data: { supplierOrderId: id } });
  }

  async unlink(organizationId: string, id: string, orderId: string) {
    const r = await this.prisma.tradeOrder.updateMany({ where: { organizationId, id: orderId, supplierOrderId: id }, data: { supplierOrderId: null } });
    if (!r.count) throw new NotFoundException('That customer order is not linked to this supplier order');
    return this.getById(organizationId, id);
  }

  async remove(organizationId: string, id: string) {
    const so = await this.prisma.supplierOrder.findFirst({ where: { id, organizationId }, select: { soNo: true, piNo: true, _count: { select: { fileLinks: true, customerOrders: true } } } });
    if (!so) throw new NotFoundException('Supplier order not found');
    if (so._count.fileLinks) throw new BadRequestException(`${supplierOrderLabel(so)} has documents — remove them first`);
    if (so._count.customerOrders) throw new BadRequestException(`${supplierOrderLabel(so)} still has customer orders — unlink them first`);
    await this.prisma.supplierOrder.delete({ where: { id, organizationId } });
    return { id, deleted: true };
  }

  async complete(organizationId: string, id: string) {
    const so = await this.prisma.supplierOrder.findFirst({
      where: { id, organizationId },
      select: { soNo: true, piNo: true, status: true, steps: { orderBy: { sortOrder: 'asc' }, select: { id: true, title: true, displayNo: true, sortOrder: true, status: true, isOngoing: true, notApplicable: true, requiredDocTypes: true } } },
    });
    if (!so) throw new NotFoundException('Supplier order not found');
    if (so.status !== 'OPEN') throw new BadRequestException(`${supplierOrderLabel(so)} is ${so.status.toLowerCase()}`);
    const blocking = blockingSteps(so.steps);
    if (blocking.length) throw new BadRequestException(`Cannot complete ${supplierOrderLabel(so)}: these steps are not done: ${blocking.map((s) => stepLabels(so.steps).get(s.id)).join(', ')}`);
    await this.prisma.supplierOrder.update({ where: { id, organizationId }, data: { status: 'COMPLETED' } });
    return this.getById(organizationId, id);
  }

  async reopen(organizationId: string, id: string, actor: TradeActor | null = null) {
    const so = await this.prisma.supplierOrder.findFirst({ where: { id, organizationId }, select: { status: true, soNo: true, piNo: true } });
    if (!so) throw new NotFoundException('Supplier order not found');
    if (so.status === 'OPEN') throw new BadRequestException(`${supplierOrderLabel(so)} is already open`);
    await this.prisma.supplierOrder.update({ where: { id, organizationId }, data: { status: 'OPEN' } });
    return this.getById(organizationId, id, actor ?? undefined);
  }

  /** Retired (round H): "+ New monthly order" on Orders makes the month's orders. */
  async declare(_organizationId: string, _dto: DeclarationDto, _actor: TradeActor): Promise<never> {
    throw new BadRequestException(RETIRED);
  }
}
