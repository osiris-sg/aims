/**
 * Imported orders that are not fully billed (WCT group, 2026-11-19): what is left to bill on the quotation.
 * Pure (no database); used by the order page, "Create invoice" and scripts/wct-imported-part-billed.ts.
 *
 * Each priced quotation line is matched to the priced lines of the order's billed invoices by description
 * (case, spacing and punctuation ignored; then the item code; then one description that starts with the
 * other, when only one quotation line fits). Remaining qty = quoted qty minus billed qty (never below 0).
 * The invoice lines to make = the remaining priced lines plus the quotation's $0 description lines (S- / G-).
 *
 * Fallback (one line for the remaining amount, ex GST): a billed priced line matches no quotation line, the
 * quotation has no priced line, or the remaining lines do not add up to what is left (quotation total
 * minus billed, within $1).
 */

import { creditOfImportedInvoice, importedInvoiceMoney, isCountedInvoice } from './imported-orders';

export interface QuoteLine {
  description?: string | null;
  quantity?: unknown;
  unitPrice?: unknown;
  amount?: unknown;
  itemCode?: string | null;
  isGroupHeader?: boolean;
  isTagGroup?: boolean;
}

export interface RemainingLine {
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
  /** The quotation's own figures for a priced line (null on $0 description lines and the fallback line). */
  quotedQty: number | null;
  billedQty: number | null;
  priced: boolean;
}

export interface RemainingPlan {
  /** Lines matched: the remaining lines are per quotation line; false = the one-line fallback. */
  matched: boolean;
  reason: string | null;
  lines: RemainingLine[];
  /** Ex GST, the lines' sum. */
  remainingNet: number;
  /** What is left in money: quotation total minus billed (GST included), never below 0. */
  remainingGross: number;
  /** "1 of 2": only when the quotation has exactly one priced line. */
  progress: { billed: number; quoted: number } | null;
  /** Priced lines with qty > 1 billed less than quoted (B: flagged in the report). */
  partQtyLines: Array<{ description: string; quoted: number; billed: number }>;
}

const R2 = (n: number) => Math.round(n * 100) / 100;
const num = (v: unknown): number => {
  const n = Number(String(v ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
};
const norm = (s: unknown): string => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const isRow = (l: QuoteLine | null | undefined): l is QuoteLine => !!l && !l.isGroupHeader && !l.isTagGroup;
const isPriced = (l: QuoteLine) => Math.abs(num(l.amount)) >= 0.005 || Math.abs(num(l.unitPrice)) >= 0.005;

/** The first line of a description, for the fallback text and reports. */
export const firstLine = (s: unknown): string => String(s ?? '').split(/\r?\n/)[0].trim();

export function remainingToBill(args: {
  quoteItems: QuoteLine[];
  /** Line items of the order's billed invoices (live, not fully credited). */
  billedInvoiceItems: QuoteLine[][];
  quoteTotal: number;
  billed: number;
  gstPercent: number;
  quotationNo?: string | null;
  subject?: string | null;
}): RemainingPlan {
  const quote = (args.quoteItems || []).filter(isRow);
  const priced = quote.filter(isPriced);
  const remainingGross = R2(Math.max(0, num(args.quoteTotal) - num(args.billed)));
  const rate = Math.max(0, num(args.gstPercent));
  const billedQty = priced.map(() => 0);
  let unmatched: string | null = null;

  for (const inv of args.billedInvoiceItems || []) {
    for (const l of (inv || []).filter(isRow).filter(isPriced)) {
      const d = norm(l.description);
      let k = priced.findIndex((q) => norm(q.description) === d && d !== '');
      if (k < 0 && l.itemCode) k = priced.findIndex((q) => !!q.itemCode && q.itemCode === l.itemCode);
      if (k < 0 && d) {
        const near = priced.map((q, i) => ({ i, q: norm(q.description) })).filter((x) => x.q && (x.q.startsWith(d) || d.startsWith(x.q)));
        if (near.length === 1) k = near[0].i;
      }
      if (k < 0) {
        unmatched = unmatched ?? firstLine(l.description);
        continue;
      }
      billedQty[k] += num(l.quantity) || 1;
    }
  }

  const partQtyLines = priced
    .map((q, i) => ({ description: firstLine(q.description), quoted: num(q.quantity), billed: R2(billedQty[i]) }))
    .filter((x) => x.quoted > 1 && x.billed < x.quoted - 0.0001);
  const progress = priced.length === 1 ? { billed: R2(billedQty[0]), quoted: num(priced[0].quantity) } : null;

  // In the quotation's own order: $0 description lines as quoted, priced lines with what is left.
  const ordered: RemainingLine[] = [];
  for (const q of quote) {
    const i = priced.indexOf(q);
    if (i < 0) {
      ordered.push({ description: String(q.description ?? ''), quantity: num(q.quantity) || 1, unitPrice: 0, amount: 0, quotedQty: null, billedQty: null, priced: false });
      continue;
    }
    const quoted = num(q.quantity);
    const left = R2(Math.max(0, quoted - billedQty[i]));
    if (left <= 0) continue;
    const unit = num(q.unitPrice) || (quoted ? R2(num(q.amount) / quoted) : num(q.amount));
    ordered.push({ description: String(q.description ?? ''), quantity: left, unitPrice: unit, amount: R2(left * unit), quotedQty: quoted, billedQty: R2(billedQty[i]), priced: true });
  }
  const pricedLeft = ordered.filter((l) => l.priced);
  const net = R2(pricedLeft.reduce((t, l) => t + l.amount, 0));

  const fallback = (reason: string): RemainingPlan => {
    const unit = R2(remainingGross / (1 + rate / 100));
    const subject = firstLine(args.subject);
    const description = `Balance of quotation ${args.quotationNo ?? ''}${subject ? `: ${subject}` : ''}`.replace(/\s+:/, ':').trim();
    return {
      matched: false,
      reason,
      lines: remainingGross > 0 ? [{ description, quantity: 1, unitPrice: unit, amount: unit, quotedQty: null, billedQty: null, priced: true }] : [],
      remainingNet: remainingGross > 0 ? unit : 0,
      remainingGross,
      progress,
      partQtyLines,
    };
  };

  if (!priced.length) return fallback('the quotation has no priced line');
  if (unmatched) return fallback(`a billed line matches no quotation line ("${unmatched.slice(0, 60)}")`);
  if (Math.abs(R2(net * (1 + rate / 100)) - remainingGross) > 1) {
    return fallback(`the remaining lines (${net.toFixed(2)} + GST) do not add up to what is left (${remainingGross.toFixed(2)})`);
  }
  return { matched: true, reason: null, lines: pricedLeft.length ? ordered : [], remainingNet: net, remainingGross, progress, partQtyLines };
}

/**
 * What is left on an imported order (the order page and "Create invoice" use the same reading): its counted invoices
 * that billed something (not $0, not fully credited) against its quotation's lines.
 */
export function remainingForOrder(args: {
  marker: { credits?: Record<string, number> } | null;
  invoiceDocs: Array<{ id: string; status?: string; config: any }>;
  quotation: { name?: string | null; config: any } | null;
  quoteTotal: number | null;
  billed: number;
}): RemainingPlan {
  const credits = args.marker?.credits || {};
  const qc: any = args.quotation?.config || {};
  const billedItems = args.invoiceDocs
    .filter((d) => isCountedInvoice(d))
    .filter((d) => !['CREDITED', 'NO_CHARGE'].includes(importedInvoiceMoney(d, Number(credits[d.id]) || creditOfImportedInvoice(d.config)).state))
    .map((d) => (Array.isArray(d.config?.items) ? d.config.items : []));
  return remainingToBill({
    quoteItems: Array.isArray(qc.items) ? qc.items : [],
    billedInvoiceItems: billedItems,
    quoteTotal: args.quoteTotal ?? 0,
    billed: args.billed,
    gstPercent: Number(qc.gstPercent) || 0,
    quotationNo: args.quotation?.name ?? null,
    subject: qc.subject ?? null,
  });
}
