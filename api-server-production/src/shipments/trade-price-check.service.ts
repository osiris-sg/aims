import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { TradeConfigService } from './trade-config.service';
import { MarketPrices, priceCheck, PriceCheck } from './trade-contract';
import { addMonths } from './orders.service';
import { cleanLmeAuto, provisionalMonths } from './lme-feed';

const n = (v: unknown): number | null => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const round2 = (v: number) => Math.round(v * 100) / 100;

/**
 * Price check (2026-10, contract master): for a PI (supplier order), a CI
 * (shipment) or an invoice (in-app 請求書), the expected unit price from the
 * contract — LME of the basis month + premium (+ QMJP on the client side) —
 * against what the document says. Read-only: nothing is ever changed.
 *
 * Basis month: PI and Invoice #1 are provisional on the month BEFORE the
 * shipment month (the LME known when they are issued); the CI, Invoice #2 and
 * the single invoice use the shipment month itself.
 */
@Injectable()
export class TradePriceCheckService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: TradeConfigService,
  ) {}

  private async prices(organizationId: string): Promise<MarketPrices> {
    const s = await this.config.getSettings(organizationId);
    const d = s.docDefaults as Record<string, unknown>;
    const lmeByMonth = (d.lmeByMonth as Record<string, number> | undefined) ?? {};
    return {
      lmeByMonth,
      qmjpByQuarter: (d.qmjpByQuarter as Record<string, number> | undefined) ?? {},
      provisionalMonths: provisionalMonths(lmeByMonth, cleanLmeAuto(d.lmeAuto)),
    };
  }

  /** PI (round H — the PI is on the order): the order's PI (read by AI if it was) against the contract's supplier premium. */
  async forOrder(organizationId: string, id: string): Promise<PriceCheck & { source: string }> {
    const o = await this.prisma.tradeOrder.findFirst({
      where: { id, organizationId },
      select: {
        grade: true,
        shipMonth: true,
        supplierPremium: true,
        contract: { select: { premiumSchedule: true, qmjpRule: true, lines: true } },
        fileLinks: { select: { fileId: true, file: { select: { docType: true } } } },
      },
    });
    if (!o) throw new NotFoundException('Order not found');
    const piFileIds = o.fileLinks.filter((l: { file: { docType: string } }) => l.file.docType === 'PI').map((l: { fileId: string }) => l.fileId);
    const ex = piFileIds.length
      ? await this.prisma.tradeExtraction.findFirst({ where: { organizationId, fileId: { in: piFileIds }, kind: 'PI', status: 'DONE' }, orderBy: { createdAt: 'desc' }, select: { result: true } })
      : null;
    const lines = (((ex?.result as { raw?: { lines?: Array<Record<string, unknown>> } } | null)?.raw?.lines ?? []) as Array<Record<string, unknown>>).filter(Boolean);
    const line = lines.find((l) => o.grade && String(l.grade ?? '').includes(o.grade)) ?? lines[0] ?? null;
    const basis = o.shipMonth ? addMonths(o.shipMonth, -1) : null;
    const line0 = (o.contract?.lines ?? []).find((l: { grade: string | null }) => l.grade === o.grade) ?? (o.contract?.lines ?? [])[0];
    const check = priceCheck({
      // A PI's prices are provisional (round N).
      provisional: true,
      side: 'supplier',
      basisMonth: basis,
      grade: o.grade ?? null,
      schedule: o.contract?.premiumSchedule,
      mjpBased: true,
      fallback: { supplierPremium: n(o.supplierPremium) ?? n(line0?.supplierPremium) },
      prices: await this.prices(organizationId),
      found: { premium: n(line?.premium), lme: n(line?.lme), unit: n(line?.rate) },
    });
    return { ...check, notes: [`Provisional: the PI prices on the month before shipment (${basis ?? '—'})`, ...check.notes], source: line ? 'PI (AI read)' : 'order fields' };
  }

  /** PI on a retired supplier order (read-only, kept for old links). */
  async forSupplierOrder(organizationId: string, id: string): Promise<PriceCheck & { source: string }> {
    const so = await this.prisma.supplierOrder.findFirst({
      where: { id, organizationId },
      select: {
        grade: true,
        declarationMonth: true,
        supplierPremium: true,
        provisionalPricePerMt: true,
        contract: { select: { premiumSchedule: true, qmjpRule: true, lines: true } },
        fileLinks: { select: { fileId: true, file: { select: { docType: true } } } },
      },
    });
    if (!so) throw new NotFoundException('Supplier order not found');
    const piFileIds = so.fileLinks.filter((l: { file: { docType: string } }) => l.file.docType === 'PI').map((l: { fileId: string }) => l.fileId);
    const ex = piFileIds.length
      ? await this.prisma.tradeExtraction.findFirst({ where: { organizationId, fileId: { in: piFileIds }, kind: 'PI', status: 'DONE' }, orderBy: { createdAt: 'desc' }, select: { result: true } })
      : null;
    const lines = (((ex?.result as { raw?: { lines?: Array<Record<string, unknown>> } } | null)?.raw?.lines ?? []) as Array<Record<string, unknown>>).filter(Boolean);
    const line = lines.find((l) => so.grade && String(l.grade ?? '').includes(so.grade)) ?? lines[0] ?? null;
    const basis = so.declarationMonth ? addMonths(so.declarationMonth, -1) : null;
    const line0 = (so.contract?.lines ?? []).find((l: { grade: string | null }) => l.grade === so.grade) ?? (so.contract?.lines ?? [])[0];
    const check = priceCheck({
      // A PI's prices are provisional (round N).
      provisional: true,
      side: 'supplier',
      basisMonth: basis,
      grade: so.grade ?? null,
      schedule: so.contract?.premiumSchedule,
      // Both sides price as fixed premium + QMJP by quarter; the stored premiums are the fixed part.
      mjpBased: true,
      fallback: { supplierPremium: n(so.supplierPremium) ?? n(line0?.supplierPremium) },
      prices: await this.prices(organizationId),
      // The PI's printed premium (QMJP + fixed); without a PI read there is nothing to compare.
      found: { premium: n(line?.premium), lme: n(line?.lme), unit: n(line?.rate) ?? n(so.provisionalPricePerMt) },
    });
    return { ...check, notes: [`Provisional: the PI prices on the month before the declaration (${basis ?? '—'})`, ...check.notes], source: line ? 'PI (AI read)' : 'supplier order fields' };
  }

  /** CI: Vedanta's CI unit (CI amount ÷ net weight) against LME of the shipment month + supplier premium. */
  async forShipment(organizationId: string, id: string): Promise<PriceCheck & { source: string }> {
    const s = await this.prisma.shipment.findFirst({
      where: { id, organizationId },
      select: {
        ciAmount: true,
        netWeightMt: true,
        order: { select: { shipMonth: true, grade: true, supplierPremium: true } },
        contract: { select: { premiumSchedule: true, qmjpRule: true, lines: true } },
      },
    });
    if (!s) throw new NotFoundException('Shipment not found');
    // The CI read on upload (step 3b): its printed unit / LME / premium; else CI amount ÷ net weight.
    const ex = await this.prisma.tradeExtraction.findFirst({ where: { organizationId, shipmentId: id, kind: 'CI', status: 'DONE' }, orderBy: { createdAt: 'desc' }, select: { result: true } });
    const ci = ((ex?.result as { raw?: Record<string, unknown> } | null)?.raw ?? null) as Record<string, unknown> | null;
    const unit = n(ci?.unitPrice) ?? (n(s.ciAmount) !== null && n(s.netWeightMt) ? round2((n(s.ciAmount) as number) / (n(s.netWeightMt) as number)) : null);
    const line0 = (s.contract?.lines ?? []).find((l: { grade: string | null }) => l.grade === s.order?.grade) ?? (s.contract?.lines ?? [])[0];
    const check = priceCheck({
      side: 'supplier',
      basisMonth: s.order?.shipMonth ?? null,
      grade: s.order?.grade ?? null,
      schedule: s.contract?.premiumSchedule,
      mjpBased: true,
      fallback: { supplierPremium: n(s.order?.supplierPremium) ?? n(line0?.supplierPremium) },
      prices: await this.prices(organizationId),
      found: { unit, lme: n(ci?.lme), premium: n(ci?.premium) },
    });
    return { ...check, source: ci ? 'CI (read on upload)' : unit === null ? 'no CI read yet' : 'CI amount ÷ net weight' };
  }

  /** Invoice (in-app 請求書): the goods line's LME / QMJP / premium / unit against the contract's client side. */
  async forGeneratedDoc(organizationId: string, id: string): Promise<PriceCheck & { source: string }> {
    const g = await this.prisma.tradeGeneratedDoc.findFirst({
      where: { id, organizationId },
      select: {
        docType: true,
        rows: true,
        order: { select: { shipMonth: true, grade: true, clientPremium: true, upcharge: true, contract: { select: { premiumSchedule: true } } } },
        shipment: { select: { order: { select: { shipMonth: true, grade: true, clientPremium: true, upcharge: true, contract: { select: { premiumSchedule: true } } } } } },
      },
    });
    if (!g) throw new NotFoundException('Document not found');
    const o = g.order ?? g.shipment?.order ?? null;
    const rows = (Array.isArray(g.rows) ? g.rows : []) as Array<Record<string, unknown>>;
    // The goods line: the one priced with the helper (LME filled), else the first priced line.
    const line = rows.find((r) => n(r.lme) !== null) ?? rows.find((r) => n(r.unitPrice) !== null) ?? null;
    const unit = line ? (n(line.lme) !== null ? round2((n(line.lme) ?? 0) + (n(line.qmjp) ?? 0) + (n(line.premium) ?? 0) + (n(line.upcharge) ?? 0)) : n(line.unitPrice)) : null;
    const provisional = g.docType === 'INVOICE_1';
    const basis = o?.shipMonth ? (provisional ? addMonths(o.shipMonth, -1) : o.shipMonth) : null;
    const check = priceCheck({
      side: 'client',
      basisMonth: basis,
      grade: o?.grade ?? null,
      schedule: o?.contract?.premiumSchedule,
      fallback: { clientPremium: n(o?.clientPremium), upcharge: n(o?.upcharge) },
      prices: await this.prices(organizationId),
      found: { premium: n(line?.premium), lme: n(line?.lme), qmjp: n(line?.qmjp), unit },
    });
    return { ...check, notes: [...(provisional ? [`Provisional: Invoice #1 prices on the month before shipment (${basis ?? '—'})`] : []), ...check.notes], source: line ? 'the invoice’s goods line' : 'no priced line yet' };
  }
}
