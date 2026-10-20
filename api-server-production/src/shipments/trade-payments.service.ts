import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { TradeActor } from './shipments.request';
import { orderLabel, shipmentRef, supplierOrderLabel, tradeToday } from './shipments.rules';
import { Db, pageArgs } from './trade-config.service';
import { invoiceTotals, toInvoiceLines } from './trade-invoice';
import { singleTotals, toSingleLines } from './trade-invoice-single';
import { allocationState, AllocationTarget, cleanPayment, invoiceCash, paidByTarget } from './trade-payments';

const PAYMENT_SELECT = {
  id: true,
  direction: true,
  paidAt: true,
  amount: true,
  currency: true,
  account: true,
  counterpartyType: true,
  counterpartyId: true,
  counterpartyName: true,
  reference: true,
  notes: true,
  proofFileId: true,
  createdByName: true,
  createdAt: true,
  updatedAt: true,
  allocations: { orderBy: { createdAt: 'asc' as const }, select: { id: true, targetType: true, targetId: true, targetLabel: true, amount: true, orderId: true, shipmentId: true, supplierOrderId: true } },
};

const n = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number(v));
const shape = (p: any) => {
  const st = allocationState(Number(p.amount), p.allocations);
  return { ...p, amount: Number(p.amount), allocations: p.allocations.map((a: any) => ({ ...a, amount: Number(a.amount) })), allocated: st.allocated, unallocated: st.unallocated };
};

/** Invoice totals for a finalized in-app 請求書 (Invoice #1 / #2 / single), in its currency (USD). */
export function generatedInvoiceTotal(g: { docType: string; header: any; rows: unknown }): number {
  if (g.docType === 'INVOICE_SINGLE') {
    const h = g.header ?? {};
    return singleTotals(toSingleLines(g.rows), Number(h.taxRate ?? 10), h.fxRate ?? null).usd.total;
  }
  return invoiceTotals(toInvoiceLines(g.rows), Number(g.header?.taxRate ?? 10), null, g.header?.variant === 'final' ? 'final' : undefined).total;
}

const RETIRED = 'Payments are recorded on the steps now (amount, date, account, proof) — the Payments module is retired';

/**
 * Payments (2026-10, retired in round H): cash in / cash out with allocations
 * to PIs, CIs, invoices, vendor invoices and import tax. Read-only now — the
 * rows stay (hidden); steps 1, 6, 8, 12 and the invoice receipts carry their
 * own payment fields (TradeStep.payment).
 */
@Injectable()
export class TradePaymentsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(organizationId: string, q: { direction?: string; account?: string; from?: string; to?: string; unallocated?: string; orderId?: string; q?: string; page?: string; pageSize?: string }) {
    const { page, pageSize, skip, take } = pageArgs(q.page, q.pageSize);
    const paidAt: Record<string, Date> = {};
    if (q.from) paidAt.gte = new Date(q.from);
    if (q.to) paidAt.lte = new Date(`${q.to}T23:59:59.999Z`);
    const text = q.q?.trim();
    const where = {
      organizationId,
      ...(q.direction === 'IN' || q.direction === 'OUT' ? { direction: q.direction } : {}),
      ...(q.account ? { account: q.account } : {}),
      ...(Object.keys(paidAt).length ? { paidAt } : {}),
      ...(q.orderId ? { allocations: { some: { orderId: q.orderId } } } : {}),
      ...(text
        ? {
            OR: [
              { counterpartyName: { contains: text, mode: 'insensitive' as const } },
              { reference: { contains: text, mode: 'insensitive' as const } },
              { notes: { contains: text, mode: 'insensitive' as const } },
              { allocations: { some: { targetLabel: { contains: text, mode: 'insensitive' as const } } } },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.tradePayment.findMany({ where, orderBy: [{ paidAt: 'desc' }, { createdAt: 'desc' }], skip, take, select: PAYMENT_SELECT }),
      this.prisma.tradePayment.count({ where }),
    ]);
    let items = rows.map(shape);
    if (q.unallocated === 'true') items = items.filter((p: { unallocated: number }) => p.unallocated > 0.004);
    return { items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
  }

  async get(organizationId: string, id: string) {
    const p = await this.prisma.tradePayment.findFirst({ where: { id, organizationId }, select: PAYMENT_SELECT });
    if (!p) throw new NotFoundException('Payment not found');
    return shape(p);
  }

  async create(organizationId: string, body: Record<string, unknown>, actor: TradeActor) {
    if (RETIRED) throw new BadRequestException(RETIRED);
    const c = cleanPayment(body, (m) => {
      throw new BadRequestException(m);
    });
    const id = await this.prisma.$transaction(async (tx: Db) => {
      const allocations = await this.resolveTargets(tx, organizationId, c.allocations);
      await this.assertProof(tx, organizationId, body.proofFileId);
      const p = await tx.tradePayment.create({
        data: {
          organizationId,
          direction: c.direction,
          paidAt: c.paidAt,
          amount: c.amount,
          currency: c.currency,
          account: c.account,
          ...this.extra(body),
          createdById: actor.id,
          createdByName: actor.name,
          allocations: { create: allocations.map((a) => ({ ...a, organizationId })) },
        },
        select: { id: true },
      });
      await this.sideEffects(tx, organizationId, c.paidAt, allocations);
      return p.id as string;
    });
    return this.get(organizationId, id);
  }

  /** Edit a payment; `allocations`, when sent, replaces the whole list ("Allocate"). */
  async update(organizationId: string, id: string, body: Record<string, unknown>) {
    if (RETIRED) throw new BadRequestException(RETIRED);
    const cur = await this.prisma.tradePayment.findFirst({ where: { id, organizationId }, select: PAYMENT_SELECT });
    if (!cur) throw new NotFoundException('Payment not found');
    const merged = {
      direction: body.direction ?? cur.direction,
      paidAt: body.paidAt ?? cur.paidAt.toISOString().slice(0, 10),
      amount: body.amount ?? Number(cur.amount),
      currency: body.currency ?? cur.currency,
      account: body.account ?? cur.account,
      allocations: body.allocations ?? cur.allocations.map((a: any) => ({ targetType: a.targetType, targetId: a.targetId, amount: Number(a.amount), targetLabel: a.targetLabel })),
    };
    const c = cleanPayment(merged, (m) => {
      throw new BadRequestException(m);
    });
    await this.prisma.$transaction(async (tx: Db) => {
      const allocations = await this.resolveTargets(tx, organizationId, c.allocations);
      if (body.proofFileId !== undefined) await this.assertProof(tx, organizationId, body.proofFileId);
      await tx.tradePayment.update({
        where: { id, organizationId },
        data: { direction: c.direction, paidAt: c.paidAt, amount: c.amount, currency: c.currency, account: c.account, ...this.extra(body) },
      });
      if (body.allocations !== undefined) {
        await tx.tradePaymentAllocation.deleteMany({ where: { organizationId, paymentId: id } });
        if (allocations.length) await tx.tradePaymentAllocation.createMany({ data: allocations.map((a) => ({ ...a, organizationId, paymentId: id })) });
        await this.sideEffects(tx, organizationId, c.paidAt, allocations);
      }
    });
    return this.get(organizationId, id);
  }

  async remove(organizationId: string, id: string) {
    if (RETIRED) throw new BadRequestException(RETIRED);
    const p = await this.prisma.tradePayment.findFirst({ where: { id, organizationId }, select: { id: true } });
    if (!p) throw new NotFoundException('Payment not found');
    await this.prisma.tradePayment.delete({ where: { id, organizationId } }); // allocations cascade
    return { id, deleted: true };
  }

  /**
   * What can be paid: supplier orders (PI deposit), shipments (CI, import
   * tax, vendor invoices) and finalized customer invoices — with what is
   * expected and already allocated. `direction` IN lists invoices only.
   */
  async targets(organizationId: string, q: { direction?: string; q?: string }) {
    const text = (q.q ?? '').trim().toLowerCase();
    const allocs: Array<{ targetType: string; targetId: string | null; amount: unknown }> = await this.prisma.tradePaymentAllocation.findMany({
      where: { organizationId },
      select: { targetType: true, targetId: true, amount: true },
    });
    const out: Array<{ targetType: AllocationTarget; targetId: string; label: string; currency: string; expected: number | null; paid: number; orderId: string | null; shipmentId: string | null }> = [];
    if (q.direction !== 'IN') {
      const paidPi = paidByTarget(allocs, 'PI');
      const paidCi = paidByTarget(allocs, 'CI');
      const paidTax = paidByTarget(allocs, 'IMPORT_TAX');
      const paidVendor = paidByTarget(allocs, 'VENDOR_INVOICE');
      const sos: any[] = await this.prisma.supplierOrder.findMany({
        where: { organizationId, status: { not: 'CANCELLED' } },
        orderBy: [{ year: 'desc' }, { soNo: 'desc' }],
        take: 200,
        select: { id: true, soNo: true, piNo: true, currency: true, depositAmount: true, piAmount: true, contract: { select: { contractNo: true } }, customerOrders: { select: { year: true, orderNo: true } } },
      });
      for (const so of sos) {
        out.push({
          targetType: 'PI',
          targetId: so.id,
          label: `${supplierOrderLabel(so)}${so.contract ? ` · ${so.contract.contractNo}` : ''}${so.customerOrders.length ? ` · ${so.customerOrders.map(orderLabel).join(', ')}` : ''} (deposit)`,
          currency: so.currency,
          expected: n(so.depositAmount),
          paid: paidPi.get(so.id) ?? 0,
          orderId: null,
          shipmentId: null,
        });
      }
      const ships: any[] = await this.prisma.shipment.findMany({
        where: { organizationId, status: { not: 'CANCELLED' }, orderId: { not: null } },
        orderBy: { createdAt: 'desc' },
        take: 300,
        select: { id: true, seqNo: true, blNumber: true, ciNumber: true, ciAmount: true, currency: true, costs: true, orderId: true, order: { select: { orderNo: true } } },
      });
      for (const s of ships) {
        const ref = shipmentRef(s.order?.orderNo, s.seqNo);
        const costs = (s.costs ?? {}) as Record<string, number | null>;
        out.push({ targetType: 'CI', targetId: s.id, label: `${ref} CI${s.ciNumber ? ` ${s.ciNumber}` : ''}${s.blNumber ? ` · B/L ${s.blNumber}` : ''}`, currency: s.currency, expected: n(s.ciAmount), paid: paidCi.get(s.id) ?? 0, orderId: s.orderId, shipmentId: s.id });
        out.push({ targetType: 'IMPORT_TAX', targetId: s.id, label: `${ref} import tax`, currency: 'JPY', expected: n(costs.importTaxActual), paid: paidTax.get(s.id) ?? 0, orderId: s.orderId, shipmentId: s.id });
        out.push({ targetType: 'VENDOR_INVOICE', targetId: s.id, label: `${ref} Mitsui Soko / logistics`, currency: 'JPY', expected: null, paid: paidVendor.get(s.id) ?? 0, orderId: s.orderId, shipmentId: s.id });
      }
    }
    if (q.direction !== 'OUT') {
      for (const inv of await this.openInvoices(organizationId, allocs)) {
        out.push({ targetType: 'INVOICE', targetId: inv.id, label: inv.label, currency: 'USD', expected: inv.total, paid: inv.paid, orderId: inv.orderId, shipmentId: inv.shipmentId });
      }
    }
    return out.filter((t) => !text || t.label.toLowerCase().includes(text)).slice(0, 300);
  }

  /** Finalized customer invoices with their totals and what's been received. */
  private async openInvoices(organizationId: string, allocs: Array<{ targetType: string; targetId: string | null; amount: unknown }>, where: Record<string, unknown> = {}) {
    const paid = paidByTarget(allocs, 'INVOICE');
    const gens: any[] = await this.prisma.tradeGeneratedDoc.findMany({
      where: { organizationId, status: 'FINAL', docType: { in: ['INVOICE_1', 'INVOICE_2', 'INVOICE_SINGLE'] }, ...where },
      orderBy: { updatedAt: 'desc' },
      take: 300,
      select: {
        id: true,
        docType: true,
        number: true,
        header: true,
        rows: true,
        orderId: true,
        shipmentId: true,
        coversShipmentIds: true,
        order: { select: { orderNo: true, customer: { select: { name: true } } } },
        shipment: { select: { seqNo: true, orderId: true, order: { select: { orderNo: true, customer: { select: { name: true } } } } } },
      },
    });
    return gens.map((g) => {
      const total = generatedInvoiceTotal(g);
      const kind = g.docType === 'INVOICE_1' ? 'Invoice #1' : g.docType === 'INVOICE_2' ? 'Invoice #2' : 'Invoice';
      const ref = g.order ? orderLabel(g.order) : g.shipment ? shipmentRef(g.shipment.order?.orderNo, g.shipment.seqNo) : '';
      const customer = g.order?.customer?.name ?? g.shipment?.order?.customer?.name ?? null;
      return {
        id: g.id,
        docType: g.docType,
        number: g.number,
        label: `${kind} ${g.number ?? ''} · ${ref}${customer ? ` · ${customer}` : ''}${total < 0 ? ' (credit note)' : ''}`.replace(/\s+/g, ' ').trim(),
        total,
        paid: paid.get(g.id) ?? 0,
        dueDate: (g.header?.dueDate as string | undefined) ?? null,
        orderId: g.orderId ?? g.shipment?.orderId ?? null,
        shipmentId: g.shipmentId ?? null,
        coversShipmentIds: g.coversShipmentIds as string[],
      };
    });
  }

  /**
   * One order's cash: out (PI deposit, CI, import tax, logistics) vs in (its
   * customer invoices), each invoice with outstanding and an overdue flag.
   */
  async forOrder(organizationId: string, orderId: string) {
    const o = await this.prisma.tradeOrder.findFirst({ where: { id: orderId, organizationId }, select: { id: true, supplierOrderId: true, shipments: { select: { id: true } } } });
    if (!o) throw new NotFoundException('Order not found');
    const shipIds = o.shipments.map((s: { id: string }) => s.id);
    const allocRows: any[] = await this.prisma.tradePaymentAllocation.findMany({
      where: {
        organizationId,
        OR: [{ orderId }, ...(shipIds.length ? [{ shipmentId: { in: shipIds } }] : []), ...(o.supplierOrderId ? [{ supplierOrderId: o.supplierOrderId }] : [])],
      },
      select: { id: true, targetType: true, targetId: true, targetLabel: true, amount: true, payment: { select: { id: true, direction: true, paidAt: true, currency: true, account: true, reference: true } } },
    });
    const allAllocs: Array<{ targetType: string; targetId: string | null; amount: unknown }> = await this.prisma.tradePaymentAllocation.findMany({ where: { organizationId, targetType: 'INVOICE' }, select: { targetType: true, targetId: true, amount: true } });
    const invoices = (await this.openInvoices(organizationId, allAllocs, { OR: [{ orderId }, ...(shipIds.length ? [{ shipmentId: { in: shipIds } }, { coversShipmentIds: { hasSome: shipIds } }] : [])] })).map((i) => ({
      ...i,
      ...invoiceCash(i.total, i.paid, i.dueDate, tradeToday()),
    }));
    const lines = allocRows.map((a) => ({
      paymentId: a.payment.id,
      direction: a.payment.direction as 'IN' | 'OUT',
      paidAt: a.payment.paidAt,
      account: a.payment.account,
      currency: a.payment.currency,
      reference: a.payment.reference,
      targetType: a.targetType,
      label: a.targetLabel,
      amount: Number(a.amount),
    }));
    const sumBy = (dir: 'IN' | 'OUT') => {
      const m: Record<string, number> = {};
      for (const l of lines.filter((x) => x.direction === dir)) m[l.currency] = Math.round(((m[l.currency] ?? 0) + l.amount) * 100) / 100;
      return m;
    };
    return { orderId, cashOut: lines.filter((l) => l.direction === 'OUT'), cashIn: lines.filter((l) => l.direction === 'IN'), totals: { out: sumBy('OUT'), in: sumBy('IN') }, invoices };
  }

  // ── helpers ─────────────────────────────────────────────────────────────
  private extra(body: Record<string, unknown>) {
    const out: Record<string, unknown> = {};
    for (const k of ['counterpartyType', 'counterpartyName', 'reference', 'notes'] as const) {
      if (body[k] !== undefined) out[k] = body[k] === null || body[k] === '' ? null : String(body[k]).slice(0, k === 'notes' ? 2000 : 300);
    }
    if (body.counterpartyId !== undefined) out.counterpartyId = typeof body.counterpartyId === 'string' && /^[0-9a-f-]{36}$/i.test(body.counterpartyId) ? body.counterpartyId : null;
    if (body.proofFileId !== undefined) out.proofFileId = typeof body.proofFileId === 'string' && body.proofFileId ? body.proofFileId : null;
    return out;
  }

  private async assertProof(db: Db, organizationId: string, proofFileId: unknown) {
    if (!proofFileId) return;
    const f = await db.tradeFile.findFirst({ where: { id: String(proofFileId), organizationId }, select: { id: true } });
    if (!f) throw new BadRequestException('The proof file was not found');
  }

  /** Each allocation's target must exist; its order / shipment / supplier order is stored for the per-order view. */
  private async resolveTargets(db: Db, organizationId: string, list: Array<{ targetType: AllocationTarget; targetId: string | null; amount: number; targetLabel: string | null }>) {
    const out: Array<{ targetType: string; targetId: string | null; targetLabel: string | null; amount: number; orderId: string | null; shipmentId: string | null; supplierOrderId: string | null }> = [];
    for (const [i, a] of list.entries()) {
      if (!a.targetId) {
        out.push({ ...a, orderId: null, shipmentId: null, supplierOrderId: null });
        continue;
      }
      if (a.targetType === 'PI') {
        const so = await db.supplierOrder.findFirst({ where: { id: a.targetId, organizationId }, select: { id: true, soNo: true, piNo: true } });
        if (!so) throw new BadRequestException(`allocation ${i + 1}: supplier order not found`);
        out.push({ ...a, targetLabel: a.targetLabel ?? `${supplierOrderLabel(so)} deposit`, orderId: null, shipmentId: null, supplierOrderId: so.id });
      } else if (a.targetType === 'INVOICE') {
        const g = await db.tradeGeneratedDoc.findFirst({ where: { id: a.targetId, organizationId }, select: { id: true, number: true, docType: true, orderId: true, shipmentId: true, shipment: { select: { orderId: true } } } });
        if (!g) throw new BadRequestException(`allocation ${i + 1}: invoice not found`);
        out.push({ ...a, targetLabel: a.targetLabel ?? `${g.docType === 'INVOICE_1' ? 'Invoice #1' : g.docType === 'INVOICE_2' ? 'Invoice #2' : 'Invoice'} ${g.number ?? ''}`.trim(), orderId: g.orderId ?? g.shipment?.orderId ?? null, shipmentId: g.shipmentId ?? null, supplierOrderId: null });
      } else {
        const s = await db.shipment.findFirst({ where: { id: a.targetId, organizationId }, select: { id: true, seqNo: true, orderId: true, ciNumber: true, order: { select: { orderNo: true } } } });
        if (!s) throw new BadRequestException(`allocation ${i + 1}: shipment not found`);
        const ref = shipmentRef(s.order?.orderNo, s.seqNo);
        const what = a.targetType === 'CI' ? `CI${s.ciNumber ? ` ${s.ciNumber}` : ''}` : a.targetType === 'IMPORT_TAX' ? 'import tax' : 'vendor invoice';
        out.push({ ...a, targetLabel: a.targetLabel ?? `${ref} ${what}`, orderId: s.orderId, shipmentId: s.id, supplierOrderId: null });
      }
    }
    return out;
  }

  /** A PI deposit paid → the supplier order's "deposit paid on" date (only when empty). */
  private async sideEffects(db: Db, organizationId: string, paidAt: Date, allocations: Array<{ targetType: string; supplierOrderId: string | null }>) {
    for (const a of allocations) {
      if (a.targetType === 'PI' && a.supplierOrderId) {
        await db.supplierOrder.updateMany({ where: { id: a.supplierOrderId, organizationId, depositPaidAt: null }, data: { depositPaidAt: paidAt } });
      }
    }
  }
}

