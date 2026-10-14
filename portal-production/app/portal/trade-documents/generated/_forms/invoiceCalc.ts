// Client mirror of the API's ADH 請求書 maths (api: src/shipments/trade-invoice.ts)
// so the form shows unit prices, amounts and totals as you type. The PDF and the
// Sales invoice are always computed on the server.

export type InvoiceLine = {
  description: string;
  quantity: number | null;
  unit: string;
  unitPrice: number | null;
  amountOverride: number | null;
  remarks: string;
  dueDate: string | null;
  /** 取引年月日 typed by hand: no longer follows the payment due date. */
  dueDateManual?: boolean;
  lme?: number | null;
  qmjp?: number | null;
  premium?: number | null;
  upcharge?: number | null;
  autoRemarks?: boolean;
  /** Consumption tax applies (default); Invoice #2's 通関 line is 課税対象外. */
  taxable?: boolean;
  contractId?: string | null;
  contractNo?: string | null;
  contractLineId?: string | null;
  grade?: string | null;
};

export const roundTo = (n: number, dp: number) => {
  const f = 10 ** dp;
  return (Math.sign(n) * Math.round(Math.abs(n) * f + 1e-9)) / f;
};
/** Excel ROUNDDOWN (truncate toward zero) — ADH's line amounts and tax. */
export const roundDown = (n: number, dp: number) => {
  const f = 10 ** dp;
  return (Math.sign(n) * Math.floor(Math.abs(n) * f + 1e-7)) / f;
};
const has = (v: unknown) => v !== null && v !== undefined && v !== "" && Number.isFinite(Number(v));
const n = (v: unknown) => (has(v) ? Number(v) : 0);
export const toNum = (v: unknown) => (has(v) ? Number(v) : null);

export const helperUsed = (l: InvoiceLine) => [l.lme, l.qmjp, l.premium, l.upcharge].some(has);
/** A helper-priced line (QMJP / premium …) whose LME isn't typed yet: no price until it is (not "QMJP + premium" alone). */
export const awaitingLme = (l: InvoiceLine) => helperUsed(l) && !has(l.lme);
export const unitPriceOf = (l: InvoiceLine) => (helperUsed(l) ? (awaitingLme(l) ? null : roundTo(n(l.lme) + n(l.qmjp) + n(l.premium) + n(l.upcharge), 4)) : has(l.unitPrice) ? Number(l.unitPrice) : null);
export const amountOf = (l: InvoiceLine) => {
  if (has(l.amountOverride)) return roundTo(Number(l.amountOverride), 2);
  const p = unitPriceOf(l);
  return has(l.quantity) && p !== null ? roundDown(Number(l.quantity) * p, 2) : 0;
};

const quarterOf = (month: string) => {
  const m = /^\d{4}-(\d{2})$/.exec(month ?? "");
  return m ? String(Math.ceil(Number(m[1]) / 3)) : "";
};

/** Price build-up for 備考 — tokens {month} {LME} {QMJP} {q} {premium} {upcharge} {grade} {totalPremium} (mirrors the API). */
export function helperRemarks(l: InvoiceLine, lmeMonth: string, template = "LME Cash {month}月平均({LME}USD) +{QMJP}(QMJP) +{premium}(Billet Premium)", upchargeTemplate = " +{upcharge}(upcharge for {grade})") {
  if (!helperUsed(l)) return "";
  const m = /^(\d{4})-(\d{2})$/.exec(lmeMonth ?? "");
  const month = m ? `${m[1]}/${Number(m[2])}` : lmeMonth;
  const fmt = (v: unknown) => (has(v) ? String(Number(v)) : "0");
  const up = has(l.upcharge) && Number(l.upcharge) !== 0;
  const vars: Record<string, string> = { month, LME: fmt(l.lme), QMJP: fmt(l.qmjp), q: quarterOf(lmeMonth), premium: fmt(l.premium), grade: l.grade ?? "", totalPremium: String(roundTo(n(l.premium) + n(l.upcharge), 4)) };
  vars.upcharge = up ? upchargeTemplate.replace(/\{(\w+)\}/g, (_, k) => (k === "upcharge" ? fmt(l.upcharge) : (vars[k] ?? ""))) : "";
  // LME not typed yet: leave out its "(…USD)" figure instead of printing "(0USD)".
  if (!has(l.lme)) template = template.replace(/\(\{LME\}[^)]*\)/g, "");
  const s = template.replace(/\{(\w+)\}/g, (all, k) => (k in vars ? vars[k] : all));
  return !template.includes("{upcharge}") && up ? `${s} +${fmt(l.upcharge)}(Upcharge)` : s;
}

/** Mirrors the backend (trade-invoice.ts); `final` = Invoice #2: ¥ tax = ROUND(US$ tax × FX, 0), as ADH's 2回目 sheet. */
export function invoiceTotals(rows: InvoiceLine[], taxRate: unknown, fxRate: unknown, variant?: "final") {
  const rate = n(taxRate) / 100;
  const sum = (pick: (l: InvoiceLine) => boolean) => roundTo(rows.reduce((a, l) => a + (pick(l) ? amountOf(l) : 0), 0), 2);
  const taxable = sum((l) => l.taxable !== false);
  const nonTaxable = sum((l) => l.taxable === false);
  const subtotal = roundTo(taxable + nonTaxable, 2);
  const tax = roundDown(taxable * rate, 2);
  const total = roundTo(subtotal + tax, 2);
  const jpy = has(fxRate) && Number(fxRate) > 0 ? (() => { const s = roundTo(taxable * Number(fxRate), 0); const t = variant === "final" ? roundTo(tax * Number(fxRate), 0) : roundDown(s * rate, 0); return { subtotal: s, tax: t, total: s + t }; })() : null;
  return { subtotal, taxable, nonTaxable, tax, total, jpy };
}

const fill = (tpl: string, vars: Record<string, unknown>) => tpl.replace(/\{(\w+)\}/g, (_, k) => (vars[k] === null || vars[k] === undefined ? "" : String(vars[k])));

/** An Invoice #1 line for a contract product line (same template as the API prefill). */
export function lineFromContractLine(
  contract: { id: string; contractNo: string },
  l: { id: string; grade: string | null; sizeSpec: string | null; quantityMt: unknown; tolerancePct: unknown },
  opts: { template?: string; unit?: string; dueDate: string | null; sizeInch?: Record<string, string> },
): InvoiceLine {
  const tpl = opts.template ?? "Aluminium Billet - {grade} as per Specification of {size}\n{qty}MT +- {tol}% Tolerance";
  // "8 Inch" for 203 MM (docDefaults.sizeInch), as the API's inchLabel.
  const mm = /(\d{2,4})\s*MM/i.exec(l.sizeSpec ?? "")?.[1];
  const inch = mm && opts.sizeInch?.[mm] ? opts.sizeInch[mm].replace(/\binch\b/i, "Inch") : (l.sizeSpec ?? "");
  return {
    description: fill(tpl, { grade: l.grade ?? "", size: l.sizeSpec ?? "", inch, qty: toNum(l.quantityMt) ?? "", tol: toNum(l.tolerancePct) ?? "" }),
    quantity: toNum(l.quantityMt),
    unit: opts.unit ?? "トン",
    unitPrice: null,
    amountOverride: null,
    remarks: "",
    dueDate: opts.dueDate,
    lme: null,
    qmjp: null,
    premium: null,
    upcharge: null,
    autoRemarks: true,
    contractId: contract.id,
    contractNo: contract.contractNo,
    contractLineId: l.id,
    grade: l.grade,
  };
}

export const usd = (v: number | null | undefined, dp = 2) =>
  v === null || v === undefined || !Number.isFinite(v) ? "—" : `${v < 0 ? "-" : ""}${Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp })}`;
