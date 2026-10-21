/**
 * Round T — loads the facts for the Admin dashboard (shipments:money) from the same places the rest of
 * the shipments flow reads: step payments (cash), FINAL generated invoices + their receipt steps
 * (expected vs received), PI deposits and CI balances still to pay, each order's reconciliation
 * (sell / buy / costs / profit) and margin, shipments' net tonnage by arrival month.
 */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { orderLabel, shipmentRef, tradeToday, depositOf, lineLabel } from './shipments.rules';
import { marginAt } from './trade-contract';
import { orderMargin } from './trade-dashboard';
import { STEP_PAYMENT, stepCash, stepPaymentOf } from './trade-payments';
import { generatedInvoiceTotal } from './trade-payments.service';
import { depositDueDate } from './trade-deposit';
import { receiptNotTracked } from './trade-alerts';
import { OrdersService } from './orders.service';
import { adminDashboard, AdminFacts, CashFact, InvoiceFact, OrderFact, OutKind, SupplierDueFact, TonnageFact } from './trade-admin-dashboard';

const OUT_KIND: Record<string, OutKind> = { PI_PAYMENT: 'DEPOSIT', CI_PAYMENT: 'CI', TAX_FUNDS: 'IMPORT_TAX', LOGISTICS_PAYMENT: 'LOGISTICS' };

@Injectable()
export class TradeAdminDashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrdersService,
  ) {}

  async facts(organizationId: string, today = tradeToday()): Promise<AdminFacts> {
    const test = { order: { isTest: false } };
    // Cash: every step payment, tagged by what it paid for.
    const paying: Array<{ code: string; payment: unknown }> = await this.prisma.tradeStep.findMany({
      where: { organizationId, code: { in: Object.keys(STEP_PAYMENT) }, OR: [{ orderId: { not: null }, order: { isTest: false } }, { shipmentId: { not: null }, shipment: test }, { supplierOrderId: { not: null } }] },
      select: { code: true, payment: true },
    });
    const cash: CashFact[] = paying.flatMap((s) => stepCash([s]).map((c) => ({ ...c, kind: c.direction === 'IN' ? ('RECEIPT' as const) : (OUT_KIND[s.code] ?? 'OTHER') })));

    // Invoices issued (FINAL) with what the receipt step says was received.
    const receipts: Array<{ orderId: string | null; code: string; payment: unknown; skipReason: string | null }> = await this.prisma.tradeStep.findMany({ where: { organizationId, orderId: { not: null }, shipmentId: null, code: { in: ['INVOICE_1', 'INVOICE_2'] } }, select: { orderId: true, code: true, payment: true, skipReason: true } });
    const receiptStep = (orderId: string | null, code: string) => receipts.find((r) => r.orderId === orderId && r.code === code);
    const invs: any[] = await this.prisma.tradeGeneratedDoc.findMany({
      where: { organizationId, status: 'FINAL', docType: { in: ['INVOICE_1', 'INVOICE_2', 'INVOICE_SINGLE'] } },
      select: { id: true, docType: true, number: true, header: true, rows: true, orderId: true, shipmentId: true, createdAt: true, order: { select: { status: true, orderNo: true, isTest: true, customer: { select: { name: true } } } }, shipment: { select: { orderId: true, order: { select: { status: true, orderNo: true, isTest: true, customer: { select: { name: true } } } } } } },
    });
    const invoices: InvoiceFact[] = [];
    for (const g of invs) {
      const order = g.order ?? g.shipment?.order ?? null;
      if (order?.isTest) continue;
      const total = generatedInvoiceTotal(g);
      const orderId = g.orderId ?? g.shipment?.orderId ?? null;
      const step = receiptStep(orderId, g.docType === 'INVOICE_1' ? 'INVOICE_1' : 'INVOICE_2');
      const paid = stepPaymentOf(step?.payment)?.amount ?? 0;
      invoices.push({ id: g.id, number: g.number ?? 'invoice', customerName: order?.customer?.name ?? null, orderLabel: order ? orderLabel(order) : null, issueDate: g.header?.issueDate ? new Date(g.header.issueDate) : g.createdAt, dueDate: g.header?.dueDate ? new Date(g.header.dueDate) : null, total, paid, currency: 'USD', imported: receiptNotTracked({ orderStatus: order?.status ?? null, stepSkipReason: step?.skipReason ?? null, paid }) });
    }

    // Still to pay Vedanta: PI deposits (order step 1) and CI balances (shipment step 6).
    const supplierDue: SupplierDueFact[] = [];
    const deposits: any[] = await this.prisma.tradeOrder.findMany({
      where: { organizationId, status: 'OPEN', isTest: false, piDate: { not: null } },
      select: { id: true, year: true, orderNo: true, piNo: true, piDate: true, piAmount: true, depositPct: true, depositAmount: true, depositPaidAt: true, depositDueDays: true, depositDueUnit: true, steps: { where: { code: 'PI_PAYMENT' }, select: { status: true, notApplicable: true, payment: true } } },
    });
    for (const o of deposits) {
      const st = o.steps[0];
      if (!st || st.notApplicable) continue;
      const due = depositDueDate(o.piDate, o.depositDueDays ?? 5, o.depositDueUnit ?? 'BUSINESS');
      const amount = o.depositAmount !== null && o.depositAmount !== undefined ? Number(o.depositAmount) : depositOf(o.piAmount, o.depositPct ?? 10);
      supplierDue.push({ kind: 'DEPOSIT', label: `${orderLabel(o)}${o.piNo ? ` PI ${o.piNo}` : ''} deposit`, amount, currency: 'USD', dueDate: due ? new Date(due) : null, paid: !!o.depositPaidAt || !!stepPaymentOf(st.payment) || st.status === 'DONE' });
    }
    const ciShips: any[] = await this.prisma.shipment.findMany({
      where: { organizationId, status: 'OPEN', ciAmount: { not: null }, order: { isTest: false } },
      select: { id: true, seqNo: true, ciAmount: true, eta: true, order: { select: { orderNo: true, depositAmount: true, piAmount: true, depositPct: true, shipments: { select: { id: true } } } }, steps: { where: { code: 'CI_PAYMENT' }, select: { status: true, notApplicable: true, payment: true } } },
    });
    for (const s of ciShips) {
      const st = s.steps[0];
      if (!st || st.notApplicable) continue;
      const dep = s.order?.depositAmount !== null && s.order?.depositAmount !== undefined ? Number(s.order.depositAmount) : depositOf(s.order?.piAmount, s.order?.depositPct ?? 10);
      // The deposit comes off the order's first shipment's CI; later shipments owe their full CI.
      const first = s.order?.shipments?.[0]?.id === s.id;
      const amount = Math.max(0, Number(s.ciAmount) - (first ? (dep ?? 0) : 0));
      supplierDue.push({ kind: 'CI', label: `${shipmentRef(s.order?.orderNo, s.seqNo)} CI balance`, amount, currency: 'USD', dueDate: s.eta ? new Date(s.eta) : null, paid: !!stepPaymentOf(st.payment) || st.status === 'DONE' });
    }

    // Per order: sell / buy / costs / margin / profit.
    const rows: any[] = await this.prisma.tradeOrder.findMany({
      where: { organizationId, isTest: false, status: { not: 'CANCELLED' } },
      orderBy: [{ year: 'desc' }, { orderNo: 'desc' }],
      take: 80,
      select: { id: true, year: true, orderNo: true, status: true, shipMonth: true, deliveryMonth: true, grade: true, product: true, size: true, qtyMt: true, clientPremium: true, supplierPremium: true, upcharge: true, customer: { select: { name: true } }, contract: { select: { premiumSchedule: true } }, shipments: { select: { ciAmount: true, netWeightMt: true } } },
    });
    const orders: OrderFact[] = [];
    for (const o of rows) {
      const r: any = await this.orders.reconciliation(organizationId, o.id).catch(() => null);
      const sell = r?.docs ? (r.docs.single ? Number(r.docs.single.total ?? 0) : Number(r.docs.invoice1?.total ?? 0) + Number(r.docs.invoice2?.total ?? 0)) || null : null;
      const buy = o.shipments.some((s: any) => s.ciAmount !== null) ? o.shipments.reduce((a: number, s: any) => a + Number(s.ciAmount ?? 0), 0) : null;
      const inp = r?.inputs ?? {};
      const costsJpy = [inp.importTaxActualJpy ?? r?.importTax?.actualJpy, inp.mitsuiActualsJpy, inp.otherCostsJpy].some((v) => typeof v === 'number') ? [inp.importTaxActualJpy ?? r?.importTax?.actualJpy, inp.mitsuiActualsJpy, inp.otherCostsJpy].reduce((a: number, v: unknown) => a + (typeof v === 'number' ? v : 0), 0) : null;
      const costsUsd = typeof inp.otherCostsUsd === 'number' ? inp.otherCostsUsd : null;
      orders.push({ id: o.id, label: orderLabel(o), customerName: o.customer?.name ?? null, product: lineLabel({ grade: o.grade, product: o.product, sizeSpec: o.size, quantityMt: null }) || null, qtyMt: o.qtyMt === null ? null : Number(o.qtyMt), status: o.status, deliveryMonth: o.deliveryMonth, sellUsd: sell, buyUsd: buy, costsJpy, costsUsd, margin: orderMargin(o, marginAt(o.contract?.premiumSchedule, o.shipMonth ?? o.deliveryMonth)), profit: r?.profit ?? null, profitStatus: r?.profitStatus ?? 'FORMULA_PENDING' });
    }

    const arrived: any[] = await this.prisma.shipment.findMany({ where: { organizationId, status: { not: 'CANCELLED' }, order: { isTest: false }, OR: [{ actualArrivalDate: { not: null } }, { eta: { not: null } }] }, select: { netWeightMt: true, actualArrivalDate: true, eta: true } });
    const tonnage: TonnageFact[] = arrived.filter((s) => s.netWeightMt !== null).map((s) => ({ month: new Date(s.actualArrivalDate ?? s.eta).toISOString().slice(0, 7), netMt: Number(s.netWeightMt) }));
    return { today, cash, invoices, supplierDue, orders, tonnage };
  }

  async admin(organizationId: string) {
    return adminDashboard(await this.facts(organizationId));
  }
}
