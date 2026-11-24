/**
 * Imported orders that are not fully billed (WCT group, 2026-11-19): what is left to bill on the quotation.
 * Pure (no database); used by the order page, "Create invoice" and scripts/wct-imported-part-billed.ts.
 *
 * Each priced quotation line is matched to the priced lines of the order's billed invoices by description
 * (case, spacing and punctuation ignored; then the item code; then one description that starts with the
 * other, when only one quotation line fits). Remaining qty = quoted qty minus billed qty (never below 0).
 * The invoice lines to make = the remaining priced lines plus the quotation's $0 description lines (S- / G-).
 *
 * When the billed lines cannot be matched (a lump sum or % invoice such as a deposit: a billed priced line matches
 * no quotation line, or the remaining lines do not add up to what is left, within $1), the lines are (2026-11-23,
 * never one summary line again): every quotation line in full, then one "Less: <INV no.> (<date>)" line per
 * earlier invoice for what it billed (ex GST), so the total is what is left to bill. Only a quotation with no
 * priced line at all keeps the one "Balance of quotation" line.
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
  /** Line discount (2026-11-25, WCT QO / invoice): a % (default) or a $ amount for the whole line. */
  discount?: unknown;
  discountType?: string | null;
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
  /** A "Less: INV… (date)" line (negative): an earlier invoice taken off the full quotation. */
  less?: boolean;
  /** The quotation line's discount carried onto this line (2026-11-25): a %, or a $ amount prorated to its qty. */
  discount?: number;
  discountType?: 'percent' | 'amount';
}

/** An earlier invoice on the order, for its "Less:" line (gross = what it billed, GST included, credits off). */
export interface BilledInvoiceRef {
  name?: string | null;
  date?: string | null;
  gross: number;
}

/** "Less: INV202611-0012 (05/11/2026)". */
export function lessLineText(ref: BilledInvoiceRef): string {
  const d = String(ref.date ?? '').slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  const date = m ? `${m[3]}/${m[2]}/${m[1]}` : d;
  return `Less: ${ref.name || 'invoice'}${date ? ` (${date})` : ''}`;
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

/**
 * A quotation line's discount for `qty` of its units (2026-11-25): { amount after discount, the discount to carry }.
 * % stays a %; a $ line discount is prorated to the qty (whole line = the full $). No discount: qty x unit.
 */
export function discountedLine(q: QuoteLine, qty: number, unit: number): { amount: number; discount?: number; discountType?: 'percent' | 'amount' } {
  const gross = qty * unit;
  const d = num(q.discount);
  // Only a line priced by its unit price carries a discount (a line with only an amount is already net).
  if (!(d > 0) || !num(q.unitPrice)) return { amount: R2(gross) };
  if (q.discountType === 'amount') {
    const quoted = num(q.quantity) || qty || 1;
    const share = R2(Math.min(d, Math.abs(num(q.quantity) * unit) || d) * (qty / quoted));
    return { amount: R2(Math.max(0, gross - share)), discount: share, discountType: 'amount' };
  }
  return { amount: R2(gross * (1 - Math.min(d, 100) / 100)), discount: d, discountType: 'percent' };
}
const withDisc = (d: { discount?: number; discountType?: 'percent' | 'amount' }) => (d.discount ? { discount: d.discount, discountType: d.discountType } : {});

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
  /** The earlier invoices, in the same order as billedInvoiceItems (2026-11-23: their "Less:" lines). */
  billedInvoices?: BilledInvoiceRef[];
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
    const dl = discountedLine(q, left, unit);
    ordered.push({ description: String(q.description ?? ''), quantity: left, unitPrice: unit, amount: dl.amount, quotedQty: quoted, billedQty: R2(billedQty[i]), priced: true, ...withDisc(dl) });
  }
  const pricedLeft = ordered.filter((l) => l.priced);
  const net = R2(pricedLeft.reduce((t, l) => t + l.amount, 0));

  // Every quotation line in full, less each earlier invoice: total = what is left (a quotation discount, if any, its own line).
  const fullLess = (reason: string): RemainingPlan | null => {
    const refs = (args.billedInvoices ?? []).filter((r) => Math.abs(num(r.gross)) >= 0.005);
    if (!refs.length && args.billedInvoiceItems?.length) return null;
    const full: RemainingLine[] = quote.map((q) => {
      if (!isPriced(q)) return { description: String(q.description ?? ''), quantity: num(q.quantity) || 1, unitPrice: 0, amount: 0, quotedQty: null, billedQty: null, priced: false };
      const quoted = num(q.quantity) || 1;
      const unit = num(q.unitPrice) || (num(q.quantity) ? R2(num(q.amount) / num(q.quantity)) : num(q.amount));
      const dl = discountedLine(q, quoted, unit);
      return { description: String(q.description ?? ''), quantity: quoted, unitPrice: unit, amount: dl.amount, quotedQty: quoted, billedQty: 0, priced: true, ...withDisc(dl) };
    });
    const less: RemainingLine[] = refs.map((r) => {
      const unit = -R2(num(r.gross) / (1 + rate / 100));
      return { description: lessLineText(r), quantity: 1, unitPrice: unit, amount: unit, quotedQty: null, billedQty: null, priced: true, less: true };
    });
    const lines = [...full, ...less];
    const target = R2(remainingGross / (1 + rate / 100));
    const diff = R2(target - lines.reduce((t, l) => t + l.amount, 0));
    // Rounding cents (each Less line is rounded on its own) go into the last Less line; only a real gap (a quotation
    // discount, a different GST rate) gets its own line.
    if (Math.abs(diff) >= 0.01 && Math.abs(diff) <= 0.05 && less.length) {
      const last = less[less.length - 1];
      last.unitPrice = R2(last.unitPrice + diff);
      last.amount = last.unitPrice;
    } else if (Math.abs(diff) >= 0.01) lines.push({ description: diff < 0 ? 'Less: quotation discount' : 'Adjustment', quantity: 1, unitPrice: diff, amount: diff, quotedQty: null, billedQty: null, priced: true, less: true });
    return { matched: false, reason, lines: remainingGross > 0 ? lines : [], remainingNet: remainingGross > 0 ? target : 0, remainingGross, progress, partQtyLines };
  };

  const fallback = (reason: string): RemainingPlan => {
    if (priced.length) {
      const plan = fullLess(reason);
      if (plan) return plan;
    }
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
  invoiceDocs: Array<{ id: string; name?: string | null; status?: string; config: any }>;
  quotation: { name?: string | null; config: any } | null;
  quoteTotal: number | null;
  billed: number;
}): RemainingPlan {
  const credits = args.marker?.credits || {};
  const qc: any = args.quotation?.config || {};
  const billedDocs = args.invoiceDocs
    .filter((d) => isCountedInvoice(d))
    .map((d) => ({ d, m: importedInvoiceMoney(d, Number(credits[d.id]) || creditOfImportedInvoice(d.config)) }))
    .filter((x) => !['CREDITED', 'NO_CHARGE'].includes(x.m.state));
  const billedItems = billedDocs.map((x) => (Array.isArray(x.d.config?.items) ? x.d.config.items : []));
  return remainingToBill({
    quoteItems: Array.isArray(qc.items) ? qc.items : [],
    billedInvoiceItems: billedItems,
    quoteTotal: args.quoteTotal ?? 0,
    billed: args.billed,
    gstPercent: Number(qc.gstPercent) || 0,
    quotationNo: args.quotation?.name ?? null,
    subject: qc.subject ?? null,
    billedInvoices: billedDocs.map((x) => invoiceRefOf(x.d, x.m.net)),
  });
}

/** An invoice document as a "Less:" reference: its number and date, and what it billed (GST included). */
export function invoiceRefOf(d: { name?: string | null; config?: any }, gross: number): BilledInvoiceRef {
  const c: any = d.config || {};
  return { name: d.name ?? c.documentNumber ?? c.invoiceNumber ?? null, date: c.date ?? c.documentInfo?.date ?? null, gross };
}

/**
 * "1 of 2 Paid · 2 of 2 Draft" (2026-11-19): when the quotation has ONE priced line, each invoice on the order (in
 * date order, drafts last) as the running qty it brings that line to, with its state. Empty otherwise.
 */
export function billingSteps(quoteItems: QuoteLine[], invoices: Array<{ items: QuoteLine[]; state: string }>): Array<{ label: string; state: string }> {
  const priced = (quoteItems || []).filter(isRow).filter(isPriced);
  if (priced.length !== 1) return [];
  const key = norm(priced[0].description);
  const quoted = num(priced[0].quantity);
  if (!quoted) return [];
  let running = 0;
  const out: Array<{ label: string; state: string }> = [];
  for (const inv of invoices) {
    const qty = (inv.items || []).filter(isRow).filter(isPriced).filter((l) => norm(l.description) === key || (key && (norm(l.description).startsWith(key) || key.startsWith(norm(l.description))))).reduce((t, l) => t + (num(l.quantity) || 1), 0);
    if (!qty) continue;
    running = R2(running + qty);
    out.push({ label: `${running} of ${quoted}`, state: inv.state });
  }
  return out;
}

/**
 * Create invoice's prefilled lines on an imported order (round 19, any status): what is left to bill when something
 * is; on an order billed in full the quotations' own lines (as quoted: priced lines with their qty, $0 description
 * lines as they are); a quotation with no line: one empty line. The office edits them in the dialog.
 */
export function importedInvoicePrefill(remaining: Pick<RemainingPlan, 'lines'>, quoteItems: QuoteLine[]): RemainingLine[] {
  if ((remaining.lines || []).some((l) => l.priced && l.amount > 0)) return remaining.lines;
  const rows = (quoteItems || []).filter(isRow);
  if (rows.some(isPriced)) {
    return rows.map((q) => {
      const priced = isPriced(q);
      const qty = num(q.quantity) || 1;
      const unit = priced ? num(q.unitPrice) || (num(q.quantity) ? R2(num(q.amount) / num(q.quantity)) : num(q.amount)) : 0;
      const dl = priced ? discountedLine(q, qty, unit) : { amount: 0 };
      return { description: String(q.description ?? ''), quantity: qty, unitPrice: unit, amount: dl.amount, quotedQty: priced ? num(q.quantity) : null, billedQty: null, priced, ...withDisc(dl) };
    });
  }
  return [{ description: '', quantity: 1, unitPrice: 0, amount: 0, quotedQty: null, billedQty: null, priced: true }];
}
