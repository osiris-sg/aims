// Split payment (features.enableInvoiceSplit, 2026-11-17; WCT (S), Racking, BC Air).
// The dialog's live amounts and line texts. Mirrors the API's
// src/documents/invoice-split.ts (the server re-checks and is the one that
// writes); helpers/invoiceSplit.test.mjs runs the same fixtures as the API spec.

export type SplitMode = "rate" | "deposit";
export interface SplitPlan {
  mode: SplitMode;
  /** rate: each part's %; deposit: the remainder rows' % of the remainder. */
  parts: number[];
  deposit?: { percent?: number | null; amount?: number | null } | null;
}

const R2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const num = (v: unknown): number | null => {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export function fmtMoney(n: number): string {
  const neg = n < 0;
  const [i, d] = Math.abs(R2(n)).toFixed(2).split(".");
  return `${neg ? "-" : ""}$${i.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${d}`;
}
export const fmtPct = (p: number) => String(Number(R2(p).toFixed(2)));

const ORDINALS = ["First", "Second", "Third", "Fourth", "Fifth", "Sixth", "Seventh", "Eighth", "Ninth", "Tenth"];
const paymentLabel = (k: number) => (k <= ORDINALS.length ? `${ORDINALS[k - 1]} payment` : `Payment ${k}`);
const isDisplayRow = (l: any) => !l || !!l.isGroupHeader || !!l.isTagGroup;

type Tax = { gstPercent?: unknown; taxApplicable?: unknown; absorbTax?: unknown };

/** document-money.ts computeDocumentTotals, same formula. */
export function totalsOf(lines: Array<{ amount?: unknown; quantity?: unknown; unitPrice?: unknown }>, tax: Tax, discountAmount = 0) {
  const amountOf = (l: any) => {
    const a = Number(l?.amount);
    if (Number.isFinite(a) && a !== 0) return a;
    const q = Number(l?.quantity), u = Number(l?.unitPrice);
    return Number.isFinite(q) && Number.isFinite(u) ? q * u : 0;
  };
  const grossTotal = R2(lines.reduce((s, l) => s + amountOf(l), 0));
  const applicable = !(tax?.taxApplicable === "N" || tax?.taxApplicable === false);
  const absorb = tax?.absorbTax === "Y" || tax?.absorbTax === true;
  const raw = Number(tax?.gstPercent);
  const g = !applicable ? 0 : Number.isFinite(raw) && raw >= 0 ? raw : 9;
  const d = R2(discountAmount > 0 ? Math.min(discountAmount, Math.max(0, grossTotal)) : 0);
  const net = grossTotal - d;
  const gst = absorb && g > 0 ? (net * g) / (100 + g) : (net * g) / 100;
  const nett = absorb && g > 0 ? net : net + gst;
  const sub = absorb && g > 0 ? net - gst : net;
  return { grossTotal, discountAmount: d, subTotal: R2(sub), gstAmount: R2(gst), nettTotal: R2(nett) };
}

/** What a split divides (the invoice's lines after its discount) and the quotation it bills. */
export function splitBaseOf(config: any): { contractValue: number; tax: Tax; quotationNo: string | null; original: ReturnType<typeof totalsOf> } {
  const c = config || {};
  const di = c.documentInfo || {};
  const items = (Array.isArray(c.items) ? c.items : []).filter((l: any) => !isDisplayRow(l));
  const tax = { gstPercent: c.gstPercent ?? di.gstPercent, taxApplicable: c.taxApplicable ?? di.taxApplicable, absorbTax: c.absorbTax ?? di.absorbTax };
  const t = totalsOf(items, tax, num(c.discountAmount) ?? num(di.discountAmount) ?? 0);
  const srcType = String(c.sourceDocumentType ?? "").toUpperCase();
  const quotationNo =
    String((!srcType || srcType.startsWith("QUOTATION") || srcType.startsWith("QO") ? c.sourceDocumentNumber : "") ?? "").trim() ||
    String(c.quotationNo ?? di.quotationNo ?? "").trim() ||
    null;
  return { contractValue: R2(t.grossTotal - t.discountAmount), tax, quotationNo, original: t };
}

export interface SplitPreviewPart {
  label: string;
  description: string;
  amount: number;
  subTotal: number;
  gstAmount: number;
  total: number;
}

/** Live preview: every part, or the reason the plan can't be saved yet. */
export function previewSplit(config: any, plan: SplitPlan, baseNumber: string): { parts: SplitPreviewPart[]; error: string | null; contractValue: number } {
  const { contractValue, tax, quotationNo, original } = splitBaseOf(config);
  const base = contractValue;
  const rows = plan.parts.map(Number);
  const fail = (error: string) => ({ parts: [], error, contractValue });
  if (!(base > 0)) return fail("This invoice has no amount to split.");
  if (rows.some((p) => !Number.isFinite(p) || p <= 0)) return fail("Every part needs a rate above 0%.");
  const sum = rows.reduce((s, p) => s + p, 0);
  const share = (of: number) => {
    const out = rows.map((p) => R2((of * p) / 100));
    out[out.length - 1] = R2(of - out.slice(0, -1).reduce((s, a) => s + a, 0));
    return out;
  };
  const ref = quotationNo ? `, ref ${quotationNo}` : "";
  const of = `of contract value ${fmtMoney(base)}${ref}`;
  let amounts: number[];
  let texts: string[];
  if (plan.mode === "rate") {
    if (rows.length < 2) return fail("Add at least one more invoice to split.");
    if (Math.abs(sum - 100) > 0.001) return fail(`The rates must total 100% (now ${fmtPct(sum)}%).`);
    amounts = share(base);
    texts = rows.map((p, i) => `${i === rows.length - 1 ? "Final payment" : paymentLabel(i + 1)} (${fmtPct(p)}%) ${of}`);
  } else {
    if (rows.length < 1) return fail("Add at least one invoice for the remainder.");
    if (Math.abs(sum - 100) > 0.001) return fail(`The remainder rates must total 100% (now ${fmtPct(sum)}%).`);
    const pct = num(plan.deposit?.percent);
    const amt = num(plan.deposit?.amount);
    let dep: number;
    if (pct !== null) {
      if (!(pct > 0 && pct < 100)) return fail("The deposit % must be above 0 and below 100.");
      dep = R2((base * pct) / 100);
    } else if (amt !== null) {
      if (!(amt > 0 && R2(amt) < base)) return fail(`The deposit must be above $0.00 and below the contract value ${fmtMoney(base)}.`);
      dep = R2(amt);
    } else return fail("Enter the deposit.");
    const rem = R2(base - dep);
    amounts = [dep, ...share(rem)];
    const bal = fmtMoney(rem);
    texts = [
      pct !== null ? `Deposit (${fmtPct(pct)}%) ${of}` : `Deposit (${fmtMoney(dep)}) ${of}`,
      ...rows.map((q, j) => {
        const s = rows.length === 1 && Math.abs(q - 100) < 0.001 ? `balance ${bal}` : `${fmtPct(q)}% of balance ${bal}`;
        return `${j === rows.length - 1 ? "Final payment" : paymentLabel(j + 2)} (${s}) ${of}`;
      }),
    ];
  }
  if (amounts.length > 20) return fail("At most 20 invoices.");
  const zero = amounts.findIndex((a) => !(a > 0));
  if (zero >= 0) return fail(`Invoice -${zero + 1} comes to ${fmtMoney(amounts[zero])}. Use a larger rate.`);
  const parts = amounts.map((amount, i) => {
    const t = totalsOf([{ amount }], tax);
    return { label: `${baseNumber}-${i + 1}`, description: texts[i], amount, subTotal: t.subTotal, gstAmount: t.gstAmount, total: t.nettTotal };
  });
  // The last part takes the leftover subtotal / GST / total cents: the parts add up to the invoice exactly.
  const last = parts[parts.length - 1];
  const before = parts.slice(0, -1);
  const left = (o: number, k: "subTotal" | "gstAmount" | "total") => R2(o - before.reduce((s, p) => s + p[k], 0));
  last.subTotal = left(original.subTotal, "subTotal");
  last.gstAmount = left(original.gstAmount, "gstAmount");
  last.total = left(original.nettTotal, "total");
  if (last.gstAmount < 0 || last.subTotal <= 0 || last.total <= 0) return fail(`Invoice -${parts.length} comes to too little after rounding. Use a larger rate for it.`);
  return { contractValue, error: null, parts };
}

/** The split marker on an invoice's config, or null. */
export function invoiceSplitOf(config: any): { groupId: string; part: number; of: number; baseNumber: string } | null {
  const s = config?.invoiceSplit;
  return s && typeof s === "object" && typeof s.groupId === "string" ? s : null;
}

/**
 * Toolbar: "Split payment" on a saved draft invoice with no payment, not
 * imported and not already split; "Undo split" on a split part while it is a
 * draft (the server checks every part). Both need the setting.
 */
export function splitButtons(o: { enabled: boolean; isInvoice: boolean; saved: boolean; status?: string | null; config?: any; paid?: number; settledCount?: number }): { split: boolean; undo: boolean } {
  const draft = ["draft", "unconfirmed"].includes(String(o.status ?? "").toLowerCase());
  if (!o.enabled || !o.isInvoice || !o.saved || !draft) return { split: false, undo: false };
  const c = o.config || {};
  const split = !!invoiceSplitOf(c);
  const clean = !c.erpImport && !c.xeroInvoiceId && !(Number(o.paid) > 0) && !(Number(o.settledCount) > 0);
  return { split: !split && clean, undo: split && clean };
}
