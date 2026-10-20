import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { orderLabel, shipmentRef, tradeToday } from './shipments.rules';
import { TradeConfigService } from './trade-config.service';
import { marginAt } from './trade-contract';
import { cashByMonth, orderMargin, pipelineGrid, PipelineOrder } from './trade-dashboard';
import { stockLine } from './trade-stock';
import { STEP_PAYMENT, stepCash } from './trade-payments';
import { addMonths, OrdersService } from './orders.service';

const STEP_FIELDS = { displayNo: true, code: true, title: true, status: true, notApplicable: true, isOngoing: true };

/**
 * Management view and staff home (2026-10): the pipeline grid by delivery
 * month (everyone with shipments:read), money — cash in / out by month,
 * margin and profit per order and month, open credits (shipments:money, the
 * "ADH Manager" role) — and warehouse stock.
 */
@Injectable()
export class TradeDashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: TradeConfigService,
    private readonly orders: OrdersService,
  ) {}

  /** Orders delivering from 3 months ago on (cancelled ones left out), as the Excel's grid. */
  async pipeline(organizationId: string) {
    const from = addMonths(tradeToday().slice(0, 7), -3);
    const rows: any[] = await this.prisma.tradeOrder.findMany({
      where: { organizationId, isTest: false, status: { not: 'CANCELLED' }, OR: [{ deliveryMonth: { gte: from } }, { deliveryMonth: null }, { status: 'OPEN' }] },
      orderBy: [{ deliveryMonth: 'asc' }, { orderNo: 'asc' }],
      take: 200,
      select: {
        id: true,
        year: true,
        orderNo: true,
        status: true,
        deliveryMonth: true,
        customer: { select: { name: true } },
        steps: { select: STEP_FIELDS },
        shipments: { where: { status: { not: 'CANCELLED' } }, select: { id: true, steps: { select: STEP_FIELDS } } },
      },
    });
    const due: Array<{ orderId: string | null; shipmentId: string | null; supplierOrderId: string | null }> = await this.prisma.tradeAlert.findMany({
      where: { organizationId, status: 'DUE' },
      select: { orderId: true, shipmentId: true, supplierOrderId: true },
    });
    const overdue = new Set(due.flatMap((a) => [a.orderId, a.shipmentId, a.supplierOrderId]).filter((x): x is string => !!x));
    const orders: PipelineOrder[] = rows.map((o) => ({
      id: o.id,
      label: orderLabel(o),
      deliveryMonth: o.deliveryMonth,
      customerName: o.customer?.name ?? null,
      status: o.status,
      steps: [
        ...o.steps.map((s: any) => ({ ...s, recordId: o.id })),
        ...o.shipments.flatMap((sh: any) => sh.steps.map((s: any) => ({ ...s, recordId: sh.id }))),
      ],
      overdueRecords: overdue,
    }));
    return pipelineGrid(orders);
  }

  /** Money (ADH Manager): cash by month, margin + profit per order and month, open credits. */
  async money(organizationId: string) {
    const since = new Date(`${addMonths(tradeToday().slice(0, 7), -12)}-01T00:00:00Z`);
    // Cash in / out (round H): the payments recorded on the steps (1, 6, 8, 12 out; 2, 11 in).
    const paying: Array<{ code: string; payment: unknown }> = await this.prisma.tradeStep.findMany({
      where: { organizationId, code: { in: Object.keys(STEP_PAYMENT) } },
      select: { code: true, payment: true },
    });
    const payments = stepCash(paying).filter((p) => p.paidAt >= since);
    const orders: any[] = await this.prisma.tradeOrder.findMany({
      where: { organizationId, isTest: false, status: { not: 'CANCELLED' } },
      orderBy: [{ year: 'desc' }, { orderNo: 'desc' }],
      take: 60,
      select: { id: true, year: true, orderNo: true, status: true, shipMonth: true, deliveryMonth: true, qtyMt: true, clientPremium: true, supplierPremium: true, upcharge: true, customer: { select: { name: true } }, contract: { select: { premiumSchedule: true } } },
    });
    const perOrder = [];
    for (const o of orders) {
      const r = await this.orders.reconciliation(organizationId, o.id).catch(() => null);
      perOrder.push({
        id: o.id,
        label: orderLabel(o),
        customerName: o.customer?.name ?? null,
        deliveryMonth: o.deliveryMonth,
        status: o.status,
        qtyMt: o.qtyMt === null ? null : Number(o.qtyMt),
        margin: orderMargin(o, marginAt(o.contract?.premiumSchedule, o.shipMonth ?? o.deliveryMonth)),
        profit: r?.profit ?? null,
        profitStatus: r?.profitStatus ?? 'FORMULA_PENDING',
      });
    }
    const byMonth: Record<string, { margin: number; profit: number; profitPending: boolean; orders: number }> = {};
    for (const o of perOrder) {
      const m = o.deliveryMonth ?? '—';
      const slot = (byMonth[m] ??= { margin: 0, profit: 0, profitPending: false, orders: 0 });
      slot.orders++;
      slot.margin = Math.round((slot.margin + (o.margin ?? 0)) * 100) / 100;
      slot.profit = Math.round((slot.profit + (o.profit ?? 0)) * 100) / 100;
      if (o.profitStatus !== 'MANUAL') slot.profitPending = true;
    }
    const credits: any[] = await this.prisma.tradeCredit.findMany({ where: { organizationId, status: 'OPEN' }, orderBy: { createdAt: 'desc' } });
    const customers: Array<{ id: string; name: string }> = credits.length ? await this.prisma.customer.findMany({ where: { organizationId, id: { in: credits.map((c) => c.customerId) } }, select: { id: true, name: true } }) : [];
    return {
      cashByMonth: cashByMonth(payments),
      orders: perOrder,
      byMonth,
      openCredits: credits.map((c) => ({ id: c.id, sourceNumber: c.sourceNumber, amount: Number(c.amount), currency: c.currency, customerName: customers.find((x) => x.id === c.customerId)?.name ?? null, createdAt: c.createdAt })),
    };
  }

  /** Warehouse stock: shipments in store (bundles in − delivered), periods and storage fee estimate, by warehouse. */
  async stock(organizationId: string) {
    const settings = await this.config.getSettings(organizationId);
    const rate = settings.estimatorRates.storagePerMt;
    const ships: any[] = await this.prisma.shipment.findMany({
      where: { organizationId, status: { not: 'CANCELLED' }, orderId: { not: null }, OR: [{ storageStartDate: { not: null } }, { warehouse: { not: null } }] },
      select: {
        id: true,
        seqNo: true,
        blNumber: true,
        warehouse: true,
        portOfDischarge: true,
        totalBundles: true,
        netWeightMt: true,
        storageStartDate: true,
        order: { select: { orderNo: true, customer: { select: { name: true } } } },
        generatedDocs: { where: { docType: 'SHIPPING_INSTRUCTIONS' }, select: { rows: true } },
      },
    });
    const today = tradeToday();
    const lines = ships.map((s) =>
      stockLine(
        {
          id: s.id,
          ref: shipmentRef(s.order?.orderNo, s.seqNo),
          blNumber: s.blNumber,
          customerName: s.order?.customer?.name ?? null,
          warehouse: s.warehouse,
          port: s.portOfDischarge,
          totalBundles: s.totalBundles,
          netWeightMt: s.netWeightMt === null ? null : Number(s.netWeightMt),
          storageStartDate: s.storageStartDate,
          siRows: s.generatedDocs.map((g: { rows: unknown }) => g.rows),
        },
        today,
        rate,
      ),
    );
    const byWarehouse = new Map<string, typeof lines>();
    for (const l of lines) byWarehouse.set(l.warehouse, [...(byWarehouse.get(l.warehouse) ?? []), l]);
    return {
      ratePerMtPerPeriod: rate,
      warehouses: [...byWarehouse.entries()].map(([warehouse, items]) => ({
        warehouse,
        bundlesInStock: items.reduce((s, l) => s + (l.bundlesInStock ?? 0), 0),
        netMtInStock: Math.round(items.reduce((s, l) => s + (l.netMtInStock ?? 0), 0) * 1000) / 1000,
        storageFeeEstimate: items.reduce((s, l) => s + (l.storageFeeEstimate ?? 0), 0),
        items,
      })),
    };
  }
}
