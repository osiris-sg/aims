import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { TradeConfigService } from './trade-config.service';
import { profileFor } from './trade-profile';
import { aimsDepositOf, ciBalanceOf, ciVersionsByShipment } from './trade-ci';
import { importTaxEstimate } from './trade-estimator';
import { generatedInvoiceTotal } from './trade-payments.service';
import { shipmentRef } from './shipments.rules';
import { invoiceTotals, toInvoiceLines } from './trade-invoice';
import { LOT_ACCOUNTS, LotInput, LotPreview, lotPreview, patternFor } from './lot-accounting';

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const CURRENCIES = ['USD', 'JPY'];
const num = (v: unknown): number | null => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

/** Accounts a lot posting uses, for the preview's account names. */
const ACCOUNT_CODES = Object.values(LOT_ACCOUNTS);

/**
 * Round BW — ADH's books, step 1 + 2: monthly FX rates (typed by ADH), the provisional chart, and the per-order
 * "Accounting preview" (lot-accounting.ts). Nothing here posts a journal.
 */
@Injectable()
export class LotAccountingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: TradeConfigService,
  ) {}

  // ── FX rates ──
  async fxRates(organizationId: string) {
    const rows = await this.prisma.fxRate.findMany({ where: { organizationId }, orderBy: [{ month: 'desc' }, { currency: 'asc' }] });
    return rows.map((r) => ({ ...r, rate: Number(r.rate) }));
  }

  async saveFxRate(organizationId: string, dto: { month?: string; currency?: string; rate?: unknown; note?: string | null }, actor: { id?: string | null; name?: string | null }) {
    const month = String(dto.month ?? '').trim();
    const currency = String(dto.currency ?? '').trim().toUpperCase();
    const rate = num(dto.rate);
    if (!MONTH.test(month)) throw new BadRequestException('Month must be YYYY-MM');
    if (!CURRENCIES.includes(currency)) throw new BadRequestException('Currency must be USD or JPY');
    if (rate === null || rate <= 0 || rate > 100000) throw new BadRequestException('Rate must be a positive number (1 SGD = rate in the currency)');
    const note = dto.note ? String(dto.note).slice(0, 300) : null;
    const data = { rate, note, enteredById: actor.id ?? null, enteredByName: actor.name ?? null, enteredAt: new Date() };
    const row = await this.prisma.fxRate.upsert({
      where: { organizationId_month_currency: { organizationId, month, currency } },
      create: { organizationId, month, currency, baseCurrency: 'SGD', ...data },
      update: data,
    });
    return { ...row, rate: Number(row.rate) };
  }

  // ── Chart (provisional) ──
  async chart(organizationId: string) {
    const rows = await this.prisma.chartOfAccount.findMany({
      where: { organizationId },
      orderBy: { code: 'asc' },
      select: { id: true, code: true, name: true, accountType: true, description: true, isActive: true, isSystem: true },
    });
    return rows.map((r) => ({ ...r, provisional: /^provisional\b/i.test(r.description ?? '') }));
  }

  async updateAccount(organizationId: string, id: string, dto: { code?: string; name?: string }) {
    const acct = await this.prisma.chartOfAccount.findFirst({ where: { id, organizationId } });
    if (!acct) throw new NotFoundException('Account not found');
    const code = dto.code === undefined ? acct.code : String(dto.code).trim();
    const name = dto.name === undefined ? acct.name : String(dto.name).trim();
    if (!/^[A-Za-z0-9.-]{1,20}$/.test(code)) throw new BadRequestException('Code: 1–20 letters, digits, "." or "-"');
    if (!name || name.length > 120) throw new BadRequestException('Name is required (up to 120 characters)');
    if (code !== acct.code) {
      const clash = await this.prisma.chartOfAccount.findFirst({ where: { organizationId, code, id: { not: id } }, select: { id: true } });
      if (clash) throw new BadRequestException(`Code ${code} is already used`);
      const posted = await this.prisma.journalEntryLine.count({ where: { accountId: id } });
      if (posted) throw new BadRequestException('This account already has journal lines; its code cannot change');
    }
    return this.prisma.chartOfAccount.update({ where: { id }, data: { code, name } });
  }

  // ── Preview ──
  /**
   * SUS Invoice #1 amounts typed by ADH Admin (USD) when AIMS has no FINAL Invoice #1 for the order. Never guessed:
   * both principal and tax must be typed. { principal: null } clears them.
   */
  async saveInvoice1(organizationId: string, orderId: string, dto: { principal?: unknown; tax?: unknown; number?: string | null }, actor: { id?: string | null; name?: string | null }) {
    const order = await this.prisma.tradeOrder.findFirst({ where: { id: orderId, organizationId }, select: { id: true, booksInput: true } });
    if (!order) throw new NotFoundException('Order not found');
    const prev = ((order.booksInput as Record<string, unknown> | null) ?? {}) as Record<string, unknown>;
    if (dto.principal === null) {
      const { invoice1: _drop, ...rest } = prev;
      await this.prisma.tradeOrder.update({ where: { id: order.id }, data: { booksInput: rest as any } });
      return { invoice1: null };
    }
    const principal = num(dto.principal);
    const tax = num(dto.tax);
    if (principal === null || principal <= 0 || principal > 1e10) throw new BadRequestException('Principal (USD) must be a positive number');
    if (tax === null || tax < 0 || tax > 1e10) throw new BadRequestException('Tax (USD) must be 0 or more');
    const r2 = (n: number) => Math.round(n * 100) / 100;
    const invoice1 = { principal: r2(principal), tax: r2(tax), number: dto.number ? String(dto.number).trim().slice(0, 60) || null : null, byId: actor.id ?? null, byName: actor.name ?? null, at: new Date().toISOString() };
    await this.prisma.tradeOrder.update({ where: { id: order.id }, data: { booksInput: { ...prev, invoice1 } as any } });
    return { invoice1 };
  }

  async preview(organizationId: string, orderId: string): Promise<LotPreview & { accounts: Record<string, string>; customer: string | null; rateEnteredBy: string | null; invoice1InAims: boolean }> {
    const order = await this.prisma.tradeOrder.findFirst({
      where: { id: orderId, organizationId },
      include: {
        customer: { select: { id: true, name: true } },
        supplier: { select: { name: true } },
        supplierOrder: { select: { piAmount: true, depositPct: true, depositAmount: true, _count: { select: { customerOrders: true } } } },
        shipments: { where: { status: { not: 'CANCELLED' } }, orderBy: { seqNo: 'asc' }, select: { id: true, seqNo: true, netWeightMt: true, ciAmount: true, costs: true, deliveryMonth: true } },
      },
    });
    if (!order) throw new NotFoundException('Order not found');
    const shipIds = order.shipments.map((s) => s.id);
    const [settings, versions, steps, docs, chart] = await Promise.all([
      this.config.getSettings(organizationId),
      ciVersionsByShipment(this.prisma, organizationId, shipIds),
      this.prisma.tradeStep.findMany({
        where: { organizationId, OR: [{ orderId: order.id }, { shipmentId: { in: shipIds } }, ...(order.supplierOrderId ? [{ supplierOrderId: order.supplierOrderId }] : [])] },
        select: { code: true, status: true, shipmentId: true, notApplicable: true },
      }),
      this.prisma.tradeGeneratedDoc.findMany({
        where: { organizationId, status: 'FINAL', docType: { in: ['INVOICE_1', 'INVOICE_SINGLE'] }, OR: [{ orderId: order.id }, { shipmentId: { in: shipIds } }] },
        select: { docType: true, number: true, header: true, rows: true },
      }),
      this.prisma.chartOfAccount.findMany({ where: { organizationId, code: { in: ACCOUNT_CODES } }, select: { code: true, name: true } }),
    ]);
    const profile = profileFor(settings.customerProfiles, order.customerId) as ReturnType<typeof profileFor> & { company?: { country?: string } };
    const pattern = patternFor({ billingMode: profile.billingMode, country: profile.company?.country ?? null });
    const deliveryMonth = order.deliveryMonth ?? order.shipments.find((s) => s.deliveryMonth)?.deliveryMonth ?? null;
    const fx = deliveryMonth ? await this.prisma.fxRate.findFirst({ where: { organizationId, month: deliveryMonth, currency: 'USD' } }) : null;

    const done = (code: string, shipmentId?: string) => {
      const list = steps.filter((s) => s.code === code && !s.notApplicable && (shipmentId === undefined || s.shipmentId === shipmentId));
      return list.length > 0 && list.every((s) => s.status === 'DONE');
    };
    const ref = (seq: number | null) => shipmentRef(order.orderNo, seq);
    const shipments: LotInput['shipments'] = order.shipments.map((s) => {
      const costs = (s.costs ?? {}) as Record<string, unknown>;
      const bal = ciBalanceOf(num(s.ciAmount), versions.get(s.id) ?? []);
      const cif = num(costs.cifUsd);
      const rate = num(costs.fxRate);
      const actual = num(costs.importTaxActual);
      const est = importTaxEstimate(cif, rate, num(costs.customsAddOnJpy) ?? 0)?.total ?? null;
      return {
        ref: ref(s.seqNo),
        netMt: num(s.netWeightMt),
        ci: bal ? { ciNumber: bal.ciNumber, subTotal: bal.amount, advance: bal.advance, total: bal.payable } : null,
        sgjpTotal: cif,
        importTaxJpy: actual ?? est,
        customsRate: rate,
      };
    });
    const dep = aimsDepositOf(order as any, order.supplierOrder as any);
    // Invoice #1 (SUS advance invoice): AIMS's FINAL one in USD wins; else what ADH Admin typed; else none.
    const inv1 = docs.find((d) => d.docType === 'INVOICE_1' && ((d.header as any)?.currency ?? 'USD') === 'USD');
    const inv1Totals = inv1 ? invoiceTotals(toInvoiceLines(inv1.rows), Number((inv1.header as any)?.taxRate ?? 10), null) : null;
    const typed = ((order.booksInput as any)?.invoice1 ?? null) as { principal: number; tax: number; number: string | null; byName: string | null; at: string } | null;
    const invoice1: LotInput['invoice1'] = inv1Totals
      ? { principal: inv1Totals.subtotal, tax: inv1Totals.tax, number: inv1!.number ?? null, source: 'aims' }
      : typed && Number.isFinite(Number(typed.principal)) && Number.isFinite(Number(typed.tax))
        ? { principal: Number(typed.principal), tax: Number(typed.tax), number: typed.number ?? null, source: 'typed', by: [typed.byName, typed.at?.slice(0, 10)].filter(Boolean).join(' · ') || null }
        : null;
    const single = docs.filter((d) => d.docType === 'INVOICE_SINGLE');
    const singleUsd = single.filter((d) => ((d.header as any)?.currency ?? 'USD') === 'USD');
    const input: LotInput = {
      orderRef: `#${order.orderNo}`,
      customerName: order.customer?.name ?? null,
      supplierName: order.supplier?.name ?? null,
      pattern,
      deliveryMonth,
      usdRate: fx ? Number(fx.rate) : null,
      shipments,
      aimsDeposit: dep?.amount ?? null,
      directInvoiceTotal: singleUsd.length ? Math.round(singleUsd.reduce((t, d) => t + generatedInvoiceTotal(d), 0) * 100) / 100 : null,
      invoice1,
      done: {
        piPayment: done('PI_PAYMENT'),
        ciPayment: shipIds.length > 0 && shipIds.every((id) => done('CI_PAYMENT', id)),
        invoice1: done('INVOICE_1'),
        taxFunds: shipIds.length > 0 && shipIds.every((id) => done('TAX_FUNDS', id)),
      },
    };
    return {
      ...lotPreview(input),
      accounts: Object.fromEntries(chart.map((a) => [a.code, a.name])),
      customer: order.customer?.name ?? null,
      rateEnteredBy: fx ? `${fx.enteredByName ?? '—'} · ${fx.enteredAt.toISOString().slice(0, 10)}` : null,
      invoice1InAims: !!inv1Totals,
    };
  }
}
