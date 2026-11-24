/**
 * SPLIT INVOICE (features.enableInvoiceSplit, 2026-11-17; WCT group, default OFF).
 *
 * A draft invoice is split into payment parts, BC Air I003278 style: the
 * original keeps its row and becomes <number>-1, the other parts are new draft
 * invoices <number>-2, -3 ... (the numbering counter is never touched). Each
 * part carries ONE line, e.g. "First payment (30%) of contract value
 * $10,000.00, ref QO202611-0030", its own GST, and posts to the GL on
 * confirm / send like any draft invoice (postInvoicesOnConfirm). "Undo split"
 * merges the parts back while every part is still a draft with no payment.
 *
 * Two ways to split:
 *   rate     parts by % of the contract value, totalling 100%
 *   deposit  part 1 a deposit (% or a fixed amount), the remainder by %, the
 *            remainder rows totalling 100% of the remainder
 * Since 2026-11-24 every row may instead be a fixed $ amount, chosen per row
 * ({ amount }); then the rows must add up to the contract value (or the
 * remainder) to the cent, and the last % row takes the rounding cents.
 * The last part takes the rounding cents, so the parts add up to the contract
 * value exactly. The contract value is what the invoice's lines carry after
 * its document discount (excl. GST, or incl. GST on a tax-inclusive invoice).
 *
 * Pure helpers (no Prisma) shared by the service and the specs; the portal
 * mirrors the math in helpers/invoiceSplit.ts (same fixtures in both tests).
 *
 * Stored on Document.config.invoiceSplit (no schema change):
 *   every part:  { groupId (the original's id), part, of, baseNumber, mode }
 *   part 1 also: partIds (all parts, in order), plan, contractValue, restore
 *                (the original's items / totals / number, for Undo split), at, by
 */
import { computeDocumentTotals, roundCents } from '../common/document-money';
import { moneySignature } from '../common/erp-import';

export const INVOICE_SPLIT_FLAG = 'enableInvoiceSplit';
export const MAX_SPLIT_PARTS = 20;

export type SplitMode = 'rate' | 'deposit';
/**
 * One row of a split (2026-11-24): a % (a plain number, as stored before) or, chosen per row, a fixed amount
 * ({ amount }). Rate mode: of the contract value; deposit mode: of the remainder.
 */
export type SplitRow = number | { percent?: number | string | null; amount?: number | string | null };
export interface SplitPlan {
  mode: SplitMode;
  /** rate: every part's % or $ amount; deposit: the remainder rows' % (of the remainder) or $ amount. */
  parts: SplitRow[];
  /** deposit mode only: a % of the contract value OR a fixed amount. */
  deposit?: { percent?: number | null; amount?: number | null } | null;
}

export class SplitPlanError extends Error {}

const R2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const num = (v: any): number | null => {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** "$10,000.00" (fixed, locale-free, so server and portal print the same). */
export function fmtMoney(n: number): string {
  const neg = n < 0;
  const [i, d] = Math.abs(R2(n)).toFixed(2).split('.');
  return `${neg ? '-' : ''}$${i.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${d}`;
}

/** 30 -> "30", 33.333 -> "33.33", 12.5 -> "12.5". */
export function fmtPct(p: number): string {
  return String(Number(R2(p).toFixed(2)));
}

const ORDINALS = ['First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh', 'Eighth', 'Ninth', 'Tenth'];
const paymentLabel = (k: number) => (k <= ORDINALS.length ? `${ORDINALS[k - 1]} payment` : `Payment ${k}`);

/** The number a part carries: INV202611-0014 -> INV202611-0014-2. */
export const splitPartNumber = (baseNumber: string, part: number) => `${baseNumber}-${part}`;

const isDisplayRow = (l: any): boolean => !l || !!l.isGroupHeader || !!l.isTagGroup;

/** The invoice's tax settings, flat key first then documentInfo (as the editor stores them). */
export function taxOf(config: any): { gstPercent: any; taxApplicable: any; absorbTax: any } {
  const c = config || {};
  const di = c.documentInfo || {};
  return { gstPercent: c.gstPercent ?? di.gstPercent, taxApplicable: c.taxApplicable ?? di.taxApplicable, absorbTax: c.absorbTax ?? di.absorbTax };
}

/**
 * What a split divides: the contract value (the lines after the document
 * discount, in the lines' own tax basis), the invoice's totals from its lines
 * and the quotation it bills (for the ", ref QO…" on each line).
 */
export function splitBaseOf(config: any, opts: { lineDiscounts?: boolean } = {}): { contractValue: number; nettTotal: number; tax: ReturnType<typeof taxOf>; quotationNo: string | null } {
  const c = config || {};
  const di = c.documentInfo || {};
  const items = (Array.isArray(c.items) ? c.items : []).filter((l: any) => !isDisplayRow(l));
  const tax = taxOf(c);
  const discount = num(c.discountAmount) ?? num(di.discountAmount) ?? 0;
  const t = computeDocumentTotals(items, tax, { discountAmount: discount, lineDiscounts: opts.lineDiscounts });
  const contractValue = R2(t.grossTotal - (t.discountAmount ?? 0));
  const srcType = String(c.sourceDocumentType ?? '').toUpperCase();
  const quotationNo =
    String((!srcType || srcType.startsWith('QUOTATION') || srcType.startsWith('QO') ? c.sourceDocumentNumber : '') ?? '').trim() ||
    String(c.quotationNo ?? di.quotationNo ?? '').trim() ||
    null;
  return { contractValue, nettTotal: t.nettTotal, tax, quotationNo };
}

/** A row as { kind, value }: a plain number (or { percent }) is a %, { amount } a fixed $ amount. NaN = not filled in. */
export function splitRowOf(r: SplitRow): { kind: 'percent' | 'amount'; value: number } {
  if (r !== null && typeof r === 'object') {
    const a = num((r as any).amount);
    if (a !== null || ((r as any).percent === undefined && 'amount' in (r as any))) return { kind: 'amount', value: a ?? NaN };
    const p = num((r as any).percent);
    return { kind: 'percent', value: p ?? NaN };
  }
  const p = num(r);
  return { kind: 'percent', value: p ?? NaN };
}

/** The plan's rows normalised for storage: a % stays a plain number (as before), an amount is { amount }. */
export function storedSplitRows(rows: SplitRow[]): Array<number | { amount: number }> {
  return (Array.isArray(rows) ? rows : []).map((r) => {
    const x = splitRowOf(r);
    return x.kind === 'amount' ? { amount: R2(x.value) } : x.value;
  });
}

/**
 * The rows' amounts out of `of` (the contract value, or the remainder after a deposit). Every row % or $; all %:
 * they total 100% (as before); any $: they add up to `of` to the cent. The last % row takes the rounding cents (a
 * typed $ amount is never changed). Throws SplitPlanError.
 */
function rowAmounts(of: number, rawRows: SplitRow[], what: { remainder: boolean }): number[] {
  const rows = rawRows.map(splitRowOf);
  const allPct = rows.every((r) => r.kind === 'percent');
  if (rows.some((r) => !Number.isFinite(r.value) || r.value <= 0)) {
    throw new SplitPlanError(allPct ? 'Every part needs a rate above 0%.' : 'Every part needs a rate or an amount above 0.');
  }
  if (allPct) {
    const sum = rows.reduce((s, r) => s + r.value, 0);
    if (Math.abs(sum - 100) > 0.001) throw new SplitPlanError(`The ${what.remainder ? 'remainder rates' : 'rates'} must total 100% (now ${fmtPct(sum)}%).`);
  } else {
    const exact = rows.reduce((s, r) => s + (r.kind === 'amount' ? R2(r.value) : (of * r.value) / 100), 0);
    const left = R2(of - exact);
    if (Math.abs(of - exact) > 0.005) {
      const target = what.remainder ? `the remainder ${fmtMoney(of)}` : `the contract value ${fmtMoney(of)}`;
      throw new SplitPlanError(`The invoices must add up to ${target} (${left > 0 ? `${fmtMoney(left)} left` : `${fmtMoney(-left)} over`}).`);
    }
  }
  const out = rows.map((r) => (r.kind === 'amount' ? R2(r.value) : R2((of * r.value) / 100)));
  let k = -1;
  rows.forEach((r, i) => {
    if (r.kind === 'percent') k = i;
  });
  if (k >= 0) out[k] = R2(of - out.reduce((s, a, i) => (i === k ? s : s + a), 0));
  return out;
}

/**
 * What is still to place: the contract value minus the deposit and every filled-in row (a % row at its share).
 * Negative = over. For the dialog's "Left" figure; blank rows count as 0.
 */
export function splitLeft(contractValue: number, plan: SplitPlan): number {
  const base = R2(Number(contractValue) || 0);
  let of = base;
  let used = 0;
  if (plan?.mode === 'deposit') {
    const pct = num(plan.deposit?.percent);
    const amt = num(plan.deposit?.amount);
    const dep = pct !== null ? R2((base * pct) / 100) : amt !== null ? R2(amt) : 0;
    used += dep;
    of = R2(base - dep);
  }
  for (const r of Array.isArray(plan?.parts) ? plan.parts : []) {
    const x = splitRowOf(r);
    if (!Number.isFinite(x.value)) continue;
    used += x.kind === 'amount' ? R2(x.value) : (of * x.value) / 100;
  }
  return R2(base - used);
}

/**
 * The amount of each part (in the lines' tax basis), validated. The last part
 * (and, in deposit mode, the last remainder row) takes the rounding cents.
 */
export function splitAmounts(contractValue: number, plan: SplitPlan): { amounts: number[]; deposit: number | null; remainder: number | null } {
  const base = R2(Number(contractValue));
  if (!(base > 0)) throw new SplitPlanError('This invoice has no amount to split.');
  if (plan?.mode !== 'rate' && plan?.mode !== 'deposit') throw new SplitPlanError('Pick By rate or Deposit + rate.');
  const rows: SplitRow[] = Array.isArray(plan.parts) ? plan.parts : [];
  let amounts: number[];
  let deposit: number | null = null;
  let remainder: number | null = null;
  if (plan.mode === 'rate') {
    if (rows.length < 2) throw new SplitPlanError('Add at least one more invoice to split.');
    amounts = rowAmounts(base, rows, { remainder: false });
  } else {
    if (rows.length < 1) throw new SplitPlanError('Add at least one invoice for the remainder.');
    const pct = num(plan.deposit?.percent);
    const amt = num(plan.deposit?.amount);
    if (pct !== null && amt !== null) throw new SplitPlanError('Give the deposit as a % or as an amount, not both.');
    if (pct !== null) {
      if (!(pct > 0 && pct < 100)) throw new SplitPlanError('The deposit % must be above 0 and below 100.');
      deposit = R2((base * pct) / 100);
    } else if (amt !== null) {
      if (!(amt > 0 && R2(amt) < base)) throw new SplitPlanError(`The deposit must be above $0.00 and below the contract value ${fmtMoney(base)}.`);
      deposit = R2(amt);
    } else throw new SplitPlanError('Enter the deposit.');
    remainder = R2(base - deposit);
    amounts = [deposit, ...rowAmounts(remainder, rows, { remainder: true })];
  }
  if (amounts.length > MAX_SPLIT_PARTS) throw new SplitPlanError(`At most ${MAX_SPLIT_PARTS} invoices.`);
  const zero = amounts.findIndex((a) => !(a > 0));
  if (zero >= 0) throw new SplitPlanError(`Invoice -${zero + 1} comes to ${fmtMoney(amounts[zero])}. Use a larger rate.`);
  return { amounts, deposit, remainder };
}

/** Each part's one line text (BC Air I003278 style). A $ row reads "($3,000.00)" where a % row reads "(30%)". */
export function splitLineTexts(plan: SplitPlan, contractValue: number, quotationNo: string | null): string[] {
  const { remainder } = splitAmounts(contractValue, plan);
  const ref = quotationNo ? `, ref ${quotationNo}` : '';
  const of = `of contract value ${fmtMoney(contractValue)}${ref}`;
  const rows = plan.parts.map(splitRowOf);
  if (plan.mode === 'rate') {
    return rows.map((r, i) => `${i === rows.length - 1 ? 'Final payment' : paymentLabel(i + 1)} (${r.kind === 'amount' ? fmtMoney(r.value) : `${fmtPct(r.value)}%`}) ${of}`);
  }
  const pct = num(plan.deposit?.percent);
  const dep = pct !== null ? `Deposit (${fmtPct(pct)}%) ${of}` : `Deposit (${fmtMoney(R2(Number(plan.deposit?.amount)))}) ${of}`;
  const bal = fmtMoney(remainder as number);
  return [
    dep,
    ...rows.map((q, j) => {
      const last = j === rows.length - 1;
      const share =
        q.kind === 'amount'
          ? `${fmtMoney(q.value)} of balance ${bal}`
          : rows.length === 1 && Math.abs(q.value - 100) < 0.001
          ? `balance ${bal}`
          : `${fmtPct(q.value)}% of balance ${bal}`;
      return `${last ? 'Final payment' : paymentLabel(j + 2)} (${share}) ${of}`;
    }),
  ];
}

export interface SplitPart {
  part: number;
  amount: number;
  description: string;
  /**
   * The part's totals: the editor's formula for every part but the last; the
   * last part takes what is left of the original's subtotal, GST and total, so
   * the parts always add up to the original exactly (to the cent, GST too).
   */
  totals: ReturnType<typeof computeDocumentTotals>;
  /**
   * GL: the part's net (excl. GST) spread over the ORIGINAL lines' revenue
   * accounts by each account's share of the original net; the last part takes
   * the leftover cents per account. Null when the original carries no line
   * accounts (the part posts like any invoice then). accountCode null = the
   * original's lines with no account (they post to Sales, as before).
   */
  glAllocation: Array<{ accountCode: string | null; amount: number }> | null;
}

/** Each revenue account's share of the original invoice's net, in the order the lines first name them; the last account takes the cents. */
export function originalAccountNets(items: any[], net: number): Array<{ accountCode: string | null; amount: number }> | null {
  const lines = (Array.isArray(items) ? items : []).filter((l) => !isDisplayRow(l));
  const amountOf = (l: any) => {
    const a = Number(l?.amount);
    if (Number.isFinite(a) && a !== 0) return a;
    const q = Number(l?.quantity), u = Number(l?.unitPrice);
    return Number.isFinite(q) && Number.isFinite(u) ? q * u : 0;
  };
  if (!lines.some((l) => l.accountCode || l.revenueAccountCode)) return null;
  const weights = new Map<string | null, number>();
  for (const l of lines) {
    const code = (l.accountCode || l.revenueAccountCode || null) as string | null;
    weights.set(code, (weights.get(code) || 0) + amountOf(l));
  }
  const total = [...weights.values()].reduce((s, w) => s + w, 0);
  if (!(total > 0)) return null;
  const entries = [...weights.entries()];
  const out = entries.map(([accountCode, w]) => ({ accountCode, amount: R2((net * w) / total) }));
  out[out.length - 1].amount = R2(net - out.slice(0, -1).reduce((s, a) => s + a.amount, 0));
  return out;
}

/** Every part of a split: amount, line text, totals and GL allocation. Throws SplitPlanError on a bad plan. */
export function planInvoiceSplit(config: any, plan: SplitPlan, opts: { lineDiscounts?: boolean } = {}): { parts: SplitPart[]; contractValue: number; quotationNo: string | null } {
  const { contractValue, tax, quotationNo } = splitBaseOf(config, opts);
  const { amounts } = splitAmounts(contractValue, plan);
  const texts = splitLineTexts(plan, contractValue, quotationNo);
  const c = config || {};
  const di = c.documentInfo || {};
  const original = computeDocumentTotals(
    (Array.isArray(c.items) ? c.items : []).filter((l: any) => !isDisplayRow(l)),
    tax,
    { discountAmount: num(c.discountAmount) ?? num(di.discountAmount) ?? 0, lineDiscounts: opts.lineDiscounts },
  );
  // WCT group (lineDiscounts): every part rounds the WCT way too (document-money.ts wctTotalsFromNet, 2026-11-25 UAT).
  const totals = amounts.map((amount) => computeDocumentTotals([{ amount }], tax, { lineDiscounts: opts.lineDiscounts }));
  // The last part takes the leftover subtotal / GST / total cents.
  const last = totals[totals.length - 1];
  const before = totals.slice(0, -1);
  const R = opts.lineDiscounts ? roundCents : R2;
  const left = (k: 'subTotal' | 'gstAmount' | 'nettTotal') => R(original[k] - before.reduce((s, t) => s + t[k], 0));
  totals[totals.length - 1] = { ...last, subTotal: left('subTotal'), gstAmount: left('gstAmount'), nettTotal: left('nettTotal') };
  const lt = totals[totals.length - 1];
  if (lt.gstAmount < 0 || lt.subTotal <= 0 || lt.nettTotal <= 0) throw new SplitPlanError(`Invoice -${totals.length} comes to too little after rounding. Use a larger rate for it.`);
  // GL: each part's net over the original's revenue accounts; the last part takes each account's leftover.
  const accounts = originalAccountNets(c.items, original.subTotal);
  const alloc: Array<SplitPart['glAllocation']> = totals.map(() => null);
  if (accounts) {
    const used = accounts.map(() => 0);
    totals.forEach((t, i) => {
      let lines: Array<{ accountCode: string | null; amount: number }>;
      if (i === totals.length - 1) lines = accounts.map((a, k) => ({ accountCode: a.accountCode, amount: R2(a.amount - used[k]) }));
      else {
        lines = accounts.map((a) => ({ accountCode: a.accountCode, amount: original.subTotal ? R2((t.subTotal * a.amount) / original.subTotal) : 0 }));
        lines[lines.length - 1].amount = R2(t.subTotal - lines.slice(0, -1).reduce((s, l) => s + l.amount, 0));
      }
      lines.forEach((l, k) => (used[k] = R2(used[k] + l.amount)));
      alloc[i] = lines;
    });
  }
  return {
    contractValue,
    quotationNo,
    parts: amounts.map((amount, i) => ({ part: i + 1, amount, description: texts[i], totals: totals[i], glAllocation: alloc[i] })),
  };
}

/**
 * A split group's parts re-taxed TOGETHER (WCT group, 2026-11-25 UAT), e.g. by a GST switch: each part's GST is
 * worked out from its own net, and the last part takes what is left of the GST on the parts' combined net, so the
 * parts' GST still adds up to the unsplit invoice's GST to the cent (re-taxing each part on its own can lose the
 * last part's leftover cent). `configs` in part order; WCT rounding (document-money.ts wctTotalsFromNet).
 */
export function retaxedSplitTotals(
  configs: any[],
  tax: { gstPercent?: any; taxApplicable?: any; absorbTax?: any },
): Array<ReturnType<typeof computeDocumentTotals>> {
  const list = Array.isArray(configs) ? configs : [];
  const each = list.map((c) => {
    const di = c?.documentInfo || {};
    const items = (Array.isArray(c?.items) ? c.items : []).filter((l: any) => !isDisplayRow(l));
    return computeDocumentTotals(items, tax, { discountAmount: num(c?.discountAmount) ?? num(di.discountAmount) ?? 0, lineDiscounts: true });
  });
  if (each.length < 2) return each;
  const netOf = (t: ReturnType<typeof computeDocumentTotals>) => roundCents(t.grossTotal - (t.discountAmount ?? 0));
  const whole = computeDocumentTotals([{ amount: roundCents(each.reduce((s, t) => s + netOf(t), 0)) }], tax, { lineDiscounts: true });
  const before = each.slice(0, -1);
  const left = (k: 'subTotal' | 'gstAmount' | 'nettTotal') => roundCents(whole[k] - before.reduce((s, t) => s + t[k], 0));
  const last = each[each.length - 1];
  return [...before, { ...last, subTotal: left('subTotal'), gstAmount: left('gstAmount'), nettTotal: left('nettTotal') }];
}

/**
 * The revenue lines a split part posts (postFromInvoice's revenueLines), or
 * null for any other invoice, or for a part whose net no longer matches its
 * allocation (its line was edited after the split: it posts from its line).
 */
export function splitGlRevenueLines(config: any, netAmount: number): Array<{ accountCode: string | null; amount: number }> | null {
  const alloc = invoiceSplitOf(config) ? (config.invoiceSplit as any).glAllocation : null;
  if (!Array.isArray(alloc) || !alloc.length) return null;
  const sum = R2(alloc.reduce((s: number, l: any) => s + (Number(l?.amount) || 0), 0));
  if (Math.abs(sum - R2(netAmount)) > 0.005) return null;
  return alloc.map((l: any) => ({ accountCode: l?.accountCode ?? null, amount: R2(Number(l.amount) || 0) }));
}

/** The revenue account a part's one line posts to: the account of the invoice's largest line. */
export function dominantLineAccount(items: any[]): { accountCode?: string; revenueAccountCode?: string; glAccountName?: string } {
  const lines = (Array.isArray(items) ? items : []).filter((l) => !isDisplayRow(l) && (l.accountCode || l.revenueAccountCode));
  if (!lines.length) return {};
  const amt = (l: any) => Math.abs(Number(l.amount) || Number(l.quantity) * Number(l.unitPrice) || 0);
  const top = lines.reduce((a, b) => (amt(b) > amt(a) ? b : a));
  return {
    ...(top.accountCode ? { accountCode: top.accountCode } : {}),
    ...(top.revenueAccountCode ? { revenueAccountCode: top.revenueAccountCode } : {}),
    ...(top.glAccountName ? { glAccountName: top.glAccountName } : {}),
  };
}

/** Config keys a part's totals live under (flat and in documentInfo). */
export const SPLIT_TOTAL_KEYS = ['grossTotal', 'subTotal', 'gstAmount', 'nettTotal', 'gstPercent', 'taxApplicable', 'absorbTax', 'discountAmount', 'discountPercent'] as const;
/** Money stamps (document-money.ts writes them; Undo split restores them as they were). */
export const SPLIT_MONEY_KEYS = ['outstandingBalance', 'xeroBalance', 'paidToDate', 'xeroAmountPaid', 'totalWithTax', 'xeroGross'] as const;
/** Copied from the original onto a new part: never (identity, payment link, edit stamps, jobs billed). */
export const SPLIT_NOT_COPIED = ['payToken', 'savedAt', 'savedBy', 'lastUsedAt', 'lastUsedBy', 'confirmedAt', 'orderJobIds', 'xeroInvoiceId', 'xeroSyncedAt', 'invoiceSplit', 'sentAt', 'emailedAt'] as const;

/** The part's config: the original's header with the part's one line and totals. */
export function partConfig(
  original: any,
  p: SplitPart,
  ctx: { number: string; groupId: string; of: number; baseNumber: string; mode: SplitMode; account: Record<string, string> },
): any {
  const src: any = { ...(original || {}) };
  for (const k of SPLIT_NOT_COPIED) delete src[k];
  for (const k of [...SPLIT_TOTAL_KEYS, ...SPLIT_MONEY_KEYS]) delete src[k];
  const di: any = { ...(src.documentInfo || {}) };
  for (const k of SPLIT_TOTAL_KEYS) delete di[k];
  const t = p.totals;
  const totals = { grossTotal: t.grossTotal, subTotal: t.subTotal, gstAmount: t.gstAmount, nettTotal: t.nettTotal, gstPercent: t.gstPercent, taxApplicable: t.taxApplicable, absorbTax: t.absorbTax };
  return {
    ...src,
    documentNumber: ctx.number,
    items: [{ description: p.description, quantity: 1, unitPrice: p.amount, amount: p.amount, splitPart: p.part, ...ctx.account }],
    ...totals,
    documentInfo: { ...di, ...totals, ...(di.documentNumber !== undefined ? { documentNumber: ctx.number } : {}) },
    // Money (document-money.ts): a new unpaid part is owed in full.
    totalWithTax: t.nettTotal,
    xeroGross: t.nettTotal,
    outstandingBalance: t.nettTotal,
    xeroBalance: t.nettTotal,
    paidToDate: 0,
    xeroAmountPaid: 0,
    invoiceSplit: { groupId: ctx.groupId, part: p.part, of: ctx.of, baseNumber: ctx.baseNumber, mode: ctx.mode, ...(p.glAllocation ? { glAllocation: p.glAllocation } : {}) },
  };
}

/** Server-owned invoice keys a later step may have changed on part 1 (kept on Undo split). */
const KEEP_ON_UNDO = ['orderId', 'orderNo', 'orderJobIds', 'orderBillsQuote', 'deliveryOrderNos'] as const;

/** What Undo split puts back: a full copy of the original invoice's config (lines, money, tax, discount, number). */
export function restoreSnapshotOf(original: any): { config: any } {
  const c = { ...(original || {}) };
  delete c.invoiceSplit;
  return { config: JSON.parse(JSON.stringify(c)) };
}

/**
 * Part 1's config after Undo split: the original invoice exactly as it was
 * before the split, with only the order keys a later step may have moved
 * (KEEP_ON_UNDO) taken from part 1. A snapshot from the first release
 * ({ items, flat, documentInfo }) is still read.
 */
export function mergedBackConfig(current: any, restore: any): any {
  if (restore?.config && typeof restore.config === 'object') {
    const out: any = JSON.parse(JSON.stringify(restore.config));
    for (const k of KEEP_ON_UNDO) if (current?.[k] !== undefined) out[k] = current[k];
    return out;
  }
  const out: any = { ...(current || {}) };
  delete out.invoiceSplit;
  for (const k of [...SPLIT_TOTAL_KEYS, ...SPLIT_MONEY_KEYS, 'documentNumber']) delete out[k];
  const di: any = { ...(out.documentInfo || {}) };
  for (const k of [...SPLIT_TOTAL_KEYS, 'documentNumber']) delete di[k];
  return { ...out, items: restore.items, ...restore.flat, documentInfo: { ...di, ...restore.documentInfo } };
}

/** The split marker on an invoice's config, or null. */
export function invoiceSplitOf(config: any): { groupId: string; part: number; of: number; baseNumber: string; mode?: SplitMode; partIds?: string[] } | null {
  const s = config?.invoiceSplit;
  return s && typeof s === 'object' && typeof s.groupId === 'string' && Number.isFinite(Number(s.part)) ? s : null;
}

/**
 * Every invoice id of the given ones plus the other parts of any split among
 * them (part 1 lists them in partIds), first seen order. `docs` are the rows
 * already read for `ids` (with config); none split = `ids` unchanged.
 */
export function withSplitPartIds(ids: string[], docs: Array<{ id: string; config?: any }>): string[] {
  const out = [...ids];
  const seen = new Set(out);
  for (const d of docs) {
    const s = invoiceSplitOf(d.config);
    for (const pid of [...(s?.partIds ?? []), ...(s && s.groupId !== d.id ? [s.groupId] : [])]) {
      if (typeof pid === 'string' && !seen.has(pid)) {
        seen.add(pid);
        out.push(pid);
      }
    }
  }
  return out;
}

/** "2 of 3 sent" for an order's invoices when some are split parts; null when none is. */
export function splitSentSummary(invoices: Array<{ status?: string | null; config?: any; split?: any }>): string | null {
  const parts = invoices.filter((i) => i.split || invoiceSplitOf(i.config));
  if (!parts.length) return null;
  const sent = invoices.filter((i) => !['draft', 'unconfirmed'].includes(String(i.status ?? '').toLowerCase())).length;
  return `${sent} of ${invoices.length} sent`;
}

/**
 * On an editor save of a split part: keep its stored subtotal / GST / total and
 * money stamps while its line's money is unchanged (the editor's formula would
 * re-round the last part's leftover GST cent). Any other invoice, or a part
 * whose line money changed: untouched. Mutates and returns `next`.
 */
export function keepSplitPartTotals(prev: any, next: any): any {
  if (!next || typeof next !== 'object' || !invoiceSplitOf(prev)) return next;
  if (Array.isArray(next.items) && moneySignature(next.items) !== moneySignature(prev?.items)) return next;
  const T = ['grossTotal', 'subTotal', 'gstAmount', 'nettTotal'];
  for (const k of [...T, ...SPLIT_MONEY_KEYS]) if (prev[k] !== undefined) next[k] = prev[k];
  if (next.documentInfo && typeof next.documentInfo === 'object' && prev.documentInfo) {
    for (const k of T) if (prev.documentInfo[k] !== undefined) next.documentInfo[k] = prev.documentInfo[k];
  }
  return next;
}
