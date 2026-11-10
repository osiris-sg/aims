/**
 * Round BP item 7 — Dashboard "Unpaid / 未払い・未入金" (Sayaka + Take): what ADH still has to pay and what customers
 * still owe ADH, with due dates, sorted by due date, totals per currency. Unpaid = no payment (date) recorded.
 *
 *   To pay     PI deposits (order step 1: the PI's Amount Payable, due "Instrument to be received by" / PI date + term),
 *              CI balances (shipment step 6: CI amount − the deposit on the order's first shipment, due per the step rule),
 *              import tax (step 8, due at clearance), Mitsui Soko / logistics (step 12, once a vendor invoice is filed).
 *   To receive final customer invoices (Invoice #1 / #2, Kato / Hoei single, 正誤差額 / 実費差分) − what is recorded
 *              (the receipt step's payment, or allocations), due = the invoice's お支払い期限.
 *
 * Mark paid = the step's payment (date, amount, account, proof on the step's proof slot) — the same record the step
 * card writes; an invoice with no receipt step of its own (a correction) gets an IN payment allocated to it.
 * Amounts only: no margin / profit (ADH Sales sees this card).
 */
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { tradeToday, shipmentRef } from './shipments.rules';
import { TradeActor } from './shipments.request';
import { TradeDueService } from './trade-due.service';
import { TradeStepsService } from './trade-steps.service';
import { generatedInvoiceTotal } from './trade-payments.service';
import { depositOf } from './shipments.rules';
import { stepPaymentOf, STEP_PAYMENT, ACCOUNTS, PaymentAccount } from './trade-payments';
import { receiptNotTracked } from './trade-alerts';

export type UnpaidKind = 'DEPOSIT' | 'CI' | 'IMPORT_TAX' | 'LOGISTICS' | 'INVOICE';
export interface UnpaidRow {
  key: string;
  side: 'pay' | 'receive';
  kind: UnpaidKind;
  ref: string;
  orderId: string | null;
  shipmentId: string | null;
  counterparty: string | null;
  documentNo: string | null;
  /** Still owed (null = not known yet, e.g. no CI amount). */
  amount: number | null;
  currency: string;
  dueDate: string | null;
  /** Days until due (negative = overdue). */
  daysLeft: number | null;
  status: 'overdue' | 'due' | 'no date' | 'partly paid';
  /** Already recorded against it (partly paid). */
  paid: number;
  note: string | null;
  /** Mark paid: the step whose payment records it, or the invoice. */
  stepId: string | null;
  generatedDocId: string | null;
  proofDocType: string;
}

const day = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString().slice(0, 10) : null);
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
const r2 = (n: number) => Math.round(n * 100) / 100;
const orderRef = (o: { orderNo?: number | null } | null | undefined) => (o?.orderNo ? `#${o.orderNo}` : '—');

/** Status + days left of a row (pure; tested). */
export function unpaidState(dueDate: string | null, today: string, paid: number): { daysLeft: number | null; status: UnpaidRow['status'] } {
  const daysLeft = dueDate ? daysBetween(today, dueDate) : null;
  const status = daysLeft !== null && daysLeft < 0 ? 'overdue' : paid > 0 ? 'partly paid' : dueDate ? 'due' : 'no date';
  return { daysLeft, status };
}

/** Rows by due date (no date last), then ref; totals per currency (pure; tested). */
export function sortAndTotal(rows: UnpaidRow[]): { rows: UnpaidRow[]; totals: Record<string, number> } {
  const sorted = [...rows].sort((a, b) => (a.dueDate ?? '9999') .localeCompare(b.dueDate ?? '9999') || a.ref.localeCompare(b.ref, 'en', { numeric: true }));
  const totals: Record<string, number> = {};
  for (const r of sorted) if (r.amount !== null) totals[r.currency] = r2((totals[r.currency] ?? 0) + r.amount);
  return { rows: sorted, totals };
}

@Injectable()
export class TradeUnpaidService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly due: TradeDueService,
    private readonly steps: TradeStepsService,
  ) {}

  async list(organizationId: string, today = tradeToday()) {
    // Step due dates exactly as the step cards show them (rules + dates set by hand).
    const open = await this.due.openItems(organizationId, today).catch(() => [] as Awaited<ReturnType<TradeDueService['openItems']>>);
    const dueOf = new Map(open.map((i) => [i.stepId, i.due]));
    const pay: UnpaidRow[] = [];
    const row = (r: Omit<UnpaidRow, 'daysLeft' | 'status'>): UnpaidRow => ({ ...r, ...unpaidState(r.dueDate, today, r.paid) });

    // ── To pay: steps that pay, still open, no payment recorded ──
    const steps: any[] = await this.prisma.tradeStep.findMany({
      where: {
        organizationId,
        code: { in: ['PI_PAYMENT', 'CI_PAYMENT', 'TAX_FUNDS', 'LOGISTICS_PAYMENT'] },
        notApplicable: false,
        status: { not: 'DONE' },
        OR: [
          { orderId: { not: null }, order: { isTest: false, status: 'OPEN' } },
          { shipmentId: { not: null }, shipment: { status: 'OPEN', order: { isTest: false, status: 'OPEN' } } },
        ],
      },
      select: {
        id: true,
        code: true,
        payment: true,
        order: { select: { id: true, orderNo: true, piNo: true, piDate: true, piAmount: true, depositPct: true, depositAmount: true, depositDueDate: true, depositPaidAt: true, currency: true, supplier: { select: { name: true } } } },
        shipment: {
          select: {
            id: true,
            seqNo: true,
            ciNumber: true,
            ciAmount: true,
            currency: true,
            costs: true,
            order: { select: { id: true, orderNo: true, depositAmount: true, piAmount: true, depositPct: true, supplier: { select: { name: true } }, shipments: { where: { status: { not: 'CANCELLED' } }, orderBy: { seqNo: 'asc' }, select: { id: true } } } },
            fileLinks: { where: { hiddenAt: null, file: { docType: 'VENDOR_INVOICE' } }, select: { file: { select: { fileName: true } } } },
          },
        },
      },
    });
    for (const s of steps) {
      if (stepPaymentOf(s.payment)) continue;
      const spec = STEP_PAYMENT[s.code];
      const dueDate = dueOf.get(s.id) ?? null;
      if (s.code === 'PI_PAYMENT' && s.order) {
        const o = s.order;
        if (o.depositPaidAt || (!o.piNo && o.depositAmount === null)) continue; // paid outside the step / no PI yet
        const amount = o.depositAmount !== null ? Number(o.depositAmount) : depositOf(o.piAmount, o.depositPct ?? 10);
        pay.push(row({ key: `step:${s.id}`, side: 'pay', kind: 'DEPOSIT', ref: orderRef(o), orderId: o.id, shipmentId: null, counterparty: o.supplier?.name ?? null, documentNo: o.piNo ? `PI ${o.piNo}` : null, amount, currency: o.currency ?? 'USD', dueDate: dueDate ?? day(o.depositDueDate), paid: 0, note: 'PI deposit', stepId: s.id, generatedDocId: null, proofDocType: spec.proofDocType }));
      } else if (s.code === 'CI_PAYMENT' && s.shipment) {
        const sh = s.shipment;
        const o = sh.order;
        const dep = o?.depositAmount !== null && o?.depositAmount !== undefined ? Number(o.depositAmount) : depositOf(o?.piAmount, o?.depositPct ?? 10);
        // The deposit comes off the order's first shipment's CI (as the Admin dashboard).
        const first = o?.shipments?.[0]?.id === sh.id;
        const amount = sh.ciAmount === null ? null : r2(Math.max(0, Number(sh.ciAmount) - (first ? (dep ?? 0) : 0)));
        pay.push(row({ key: `step:${s.id}`, side: 'pay', kind: 'CI', ref: shipmentRef(o?.orderNo, sh.seqNo), orderId: o?.id ?? null, shipmentId: sh.id, counterparty: o?.supplier?.name ?? null, documentNo: sh.ciNumber ? `CI ${sh.ciNumber}` : null, amount, currency: sh.currency ?? 'USD', dueDate, paid: 0, note: sh.ciAmount === null ? 'CI amount not in yet' : first && dep ? `CI ${Number(sh.ciAmount).toFixed(2)} − deposit ${Number(dep).toFixed(2)}` : 'CI balance', stepId: s.id, generatedDocId: null, proofDocType: spec.proofDocType }));
      } else if (s.code === 'TAX_FUNDS' && s.shipment) {
        const sh = s.shipment;
        const c = (sh.costs ?? {}) as Record<string, unknown>;
        const amount = typeof c.importTaxActual === 'number' ? c.importTaxActual : typeof c.importTaxEstimate === 'number' ? (c.importTaxEstimate as number) : null;
        pay.push(row({ key: `step:${s.id}`, side: 'pay', kind: 'IMPORT_TAX', ref: shipmentRef(sh.order?.orderNo, sh.seqNo), orderId: sh.order?.id ?? null, shipmentId: sh.id, counterparty: 'Customs (税関)', documentNo: null, amount, currency: 'JPY', dueDate, paid: 0, note: amount === null ? 'amount: the estimate on step 7' : typeof c.importTaxActual === 'number' ? 'import permit' : 'estimate', stepId: s.id, generatedDocId: null, proofDocType: spec.proofDocType }));
      } else if (s.code === 'LOGISTICS_PAYMENT' && s.shipment) {
        const sh = s.shipment;
        // Only once Mitsui Soko's invoice is filed (before that there is nothing to pay yet).
        if (!sh.fileLinks?.length) continue;
        const a = ((sh.costs ?? {}) as { actual?: Record<string, unknown> }).actual ?? {};
        const nums = Object.values(a).filter((v): v is number => typeof v === 'number');
        pay.push(row({ key: `step:${s.id}`, side: 'pay', kind: 'LOGISTICS', ref: shipmentRef(sh.order?.orderNo, sh.seqNo), orderId: sh.order?.id ?? null, shipmentId: sh.id, counterparty: 'Mitsui Soko (三井倉庫)', documentNo: sh.fileLinks.map((l: any) => l.file.fileName).join(', ').slice(0, 80), amount: nums.length ? nums.reduce((x, y) => x + y, 0) : null, currency: 'JPY', dueDate, paid: 0, note: nums.length ? 'step 12 actuals' : 'amount: on the vendor invoice', stepId: s.id, generatedDocId: null, proofDocType: spec.proofDocType }));
      }
    }

    // ── To receive: final customer invoices minus what is recorded ──
    const receive: UnpaidRow[] = [];
    const allocs: Array<{ targetType: string; targetId: string | null; amount: unknown }> = await this.prisma.tradePaymentAllocation.findMany({ where: { organizationId, targetType: 'INVOICE' }, select: { targetType: true, targetId: true, amount: true } });
    const allocated = new Map<string, number>();
    for (const a of allocs) if (a.targetId) allocated.set(a.targetId, (allocated.get(a.targetId) ?? 0) + Number(a.amount));
    const invs: any[] = await this.prisma.tradeGeneratedDoc.findMany({
      where: { organizationId, status: 'FINAL', docType: { in: ['INVOICE_1', 'INVOICE_2', 'INVOICE_SINGLE', 'INVOICE_ADJUSTMENT'] } },
      select: {
        id: true,
        docType: true,
        number: true,
        header: true,
        rows: true,
        orderId: true,
        shipmentId: true,
        order: { select: { id: true, orderNo: true, status: true, isTest: true, customer: { select: { name: true } } } },
        shipment: { select: { seqNo: true, orderId: true, order: { select: { id: true, orderNo: true, status: true, isTest: true, customer: { select: { name: true } } } } } },
      },
    });
    const orderIds = [...new Set(invs.map((g) => g.orderId ?? g.shipment?.orderId).filter(Boolean))] as string[];
    const receipts: any[] = orderIds.length ? await this.prisma.tradeStep.findMany({ where: { organizationId, orderId: { in: orderIds }, code: { in: ['INVOICE_1', 'INVOICE_2'] } }, select: { id: true, orderId: true, code: true, payment: true, skipReason: true, notApplicable: true, requiredDocTypes: true } }) : [];
    for (const g of invs) {
      const order = g.order ?? g.shipment?.order ?? null;
      if (order?.isTest) continue;
      const total = generatedInvoiceTotal(g);
      if (!(total > 0)) continue; // credits are settled against the next invoice
      const orderId = order?.id ?? null;
      // The step that records this invoice's receipt: the one that requires its document (Kato: step 2), else by kind.
      const own = receipts.filter((r) => r.orderId === orderId && !r.notApplicable);
      const step = g.docType === 'INVOICE_ADJUSTMENT' ? null : (own.find((r) => (r.requiredDocTypes ?? []).includes(g.docType)) ?? own.find((r) => r.code === (g.docType === 'INVOICE_1' ? 'INVOICE_1' : 'INVOICE_2')) ?? null);
      const paid = r2((stepPaymentOf(step?.payment)?.amount ?? 0) + (allocated.get(g.id) ?? 0));
      if (receiptNotTracked({ orderStatus: order?.status ?? null, stepSkipReason: step?.skipReason ?? null, paid })) continue;
      const left = r2(total - paid);
      if (left <= 0.005) continue;
      const kind = g.docType === 'INVOICE_1' ? 'Invoice #1' : g.docType === 'INVOICE_2' ? 'Invoice #2' : g.docType === 'INVOICE_ADJUSTMENT' ? ((g.header as any)?.variant === 'actuals' ? '実費差分' : '正誤差額') : 'Invoice';
      receive.push(
        row({
          key: `doc:${g.id}`,
          side: 'receive',
          kind: 'INVOICE',
          ref: g.shipment && !g.orderId ? shipmentRef(order?.orderNo, g.shipment.seqNo) : orderRef(order),
          orderId,
          shipmentId: g.shipmentId ?? null,
          counterparty: order?.customer?.name ?? null,
          documentNo: `${kind} ${g.number ?? ''}`.trim(),
          amount: left,
          currency: (g.header as any)?.currency ?? 'USD',
          dueDate: (g.header as any)?.variant === 'correction' || (g.header as any)?.variant === 'actuals' ? null : day((g.header as any)?.dueDate),
          paid,
          note: (g.header as any)?.variant ? 'pay with the next invoice' : null,
          stepId: step?.id ?? null,
          generatedDocId: g.id,
          proofDocType: 'PAYMENT_PROOF',
        }),
      );
    }
    const p = sortAndTotal(pay);
    const r = sortAndTotal(receive);
    return { today, pay: p.rows, payTotals: p.totals, receive: r.rows, receiveTotals: r.totals };
  }

  /**
   * Mark paid: { key, paidAt, amount?, account?, proofFileId? } — a step row records the step's payment (as the step
   * card); an invoice row records it on its receipt step, or (a correction / 実費差分 with none) as an IN payment
   * allocated to the invoice. Returns what was recorded.
   */
  async markPaid(organizationId: string, body: { key?: string; paidAt?: string; amount?: unknown; account?: string; proofFileId?: string | null }, actor: TradeActor) {
    const list = await this.list(organizationId);
    const r = [...list.pay, ...list.receive].find((x) => x.key === body.key);
    if (!r) throw new NotFoundException('That item is no longer unpaid');
    const paidAt = String(body.paidAt ?? '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(paidAt)) throw new BadRequestException('Enter the date it was paid (YYYY-MM-DD)');
    const amount = body.amount === undefined || body.amount === null || body.amount === '' ? r.amount : Number(body.amount);
    if (amount === null || !Number.isFinite(amount) || amount <= 0) throw new BadRequestException('Enter the amount paid');
    const account = (ACCOUNTS as string[]).includes(String(body.account)) ? (body.account as PaymentAccount) : 'OTHER';
    if (r.stepId) {
      await this.steps.setPayment(organizationId, r.stepId, { payment: { amount, currency: r.currency, paidAt, account, proofFileId: body.proofFileId ?? null } });
      return { key: r.key, recorded: 'step', stepId: r.stepId, amount, currency: r.currency, paidAt, account, ref: r.ref, documentNo: r.documentNo, counterparty: r.counterparty };
    }
    if (r.generatedDocId) {
      // A correction / 実費差分 invoice has no receipt step: its receipt is an IN payment allocated to it (the Payments
      // module's rows — retired for entry, still read as "received" everywhere).
      if (body.proofFileId) {
        const f = await this.prisma.tradeFile.findFirst({ where: { id: body.proofFileId, organizationId }, select: { id: true } });
        if (!f) throw new BadRequestException('Proof file not found');
      }
      const pmt = await this.prisma.tradePayment.create({
        data: {
          organizationId,
          direction: 'IN',
          paidAt: new Date(paidAt),
          amount,
          currency: r.currency,
          account,
          counterpartyType: 'CUSTOMER',
          counterpartyName: r.counterparty,
          reference: r.documentNo,
          notes: 'Marked paid on the Dashboard (Unpaid)',
          proofFileId: body.proofFileId ?? null,
          createdById: actor.id ?? null,
          createdByName: actor.name ?? null,
          allocations: { create: [{ organizationId, targetType: 'INVOICE', targetId: r.generatedDocId, targetLabel: r.documentNo, amount, orderId: r.orderId, shipmentId: r.shipmentId }] },
        },
        select: { id: true },
      });
      return { key: r.key, recorded: 'payment', paymentId: pmt.id, amount, currency: r.currency, paidAt, account, ref: r.ref, documentNo: r.documentNo, counterparty: r.counterparty };
    }
    throw new BadRequestException('This item has nothing to record the payment on');
  }
}
