/**
 * ADH 請求書 (Invoice #1 / Invoice #2) as an in-app trade document: the pure
 * parts — line pricing helper, totals / tax / JPY conversion, business-day due
 * date, prefills from contracts / shipments, and the A4 HTML. Org-specific
 * texts (From block, bank, conditions …) come from TradeSetting.docDefaults,
 * never from code.
 */
import * as holidayJp from '@holiday-jp/holiday_jp';
import { docShell, esc, jpDate, lines as br, money } from './trade-doc-shell';

export interface InvoiceLine {
  description: string;
  quantity: number | null;
  /** Unit label, e.g. "トン". */
  unit: string;
  unitPrice: number | null;
  /** Typed amount that wins over qty × price (e.g. "Less: Invoice #1"). */
  amountOverride: number | null;
  remarks: string;
  /** 取引年月日(支払い期日) column. */
  dueDate: string | null;
  /** Pricing helper (USD/MT): when any is filled, unit price = their sum. */
  lme?: number | null;
  qmjp?: number | null;
  premium?: number | null;
  upcharge?: number | null;
  /** Remarks follow the helper ("LME Cash 2026/6月平均(…)") until edited. */
  autoRemarks?: boolean;
  /** Consumption tax applies (default). Invoice #2's 通関 line is 課税対象外. */
  taxable?: boolean;
  /** Provenance: the contract / product line this line bills (Invoice #1 may span contracts). */
  contractId?: string | null;
  contractNo?: string | null;
  contractLineId?: string | null;
  grade?: string | null;
}

export interface InvoiceHeader {
  title: string;
  /** Assigned on Finalize from the org's INVOICE numbering (read-only in the form). */
  invoiceNo: string | null;
  issueDate: string;
  registrationNo: string;
  toName: string;
  toSuffix: string;
  subject: string;
  fromBlock: string;
  dueDate: string;
  /** "{date} までにお支払いをお願い致します。" — {date} = the due date. */
  dueLine: string;
  taxRate: number;
  fxRate: number | null;
  fxNote: string;
  /** YYYY-MM of the LME average quoted in helper remarks. */
  lmeMonth: string;
  conditions: string;
  paymentTerms: string;
  bankBlock: string;
  /** Which of the org's bank accounts bankBlock came from (docDefaults.banks[].id). */
  bankId?: string | null;
  /** Print the org's seal (docDefaults.sealImage) beside the From block. */
  showSeal?: boolean;
  currency: string;
  /**
   * Invoice #2 "final price" layout: 課税対象金額 / 消費税 / 課税以外金額 / 合計,
   * then １回目の金額 and ２回目の金額(差額) = 合計 − Invoice #1 (can be negative).
   */
  variant?: 'final';
  /** Invoice #2: the tax-inclusive amount Invoice #1 billed for this product. */
  invoice1Amount?: number | null;
  invoice1No?: string | null;
}

/** One of the org's bank accounts for the 弊社指定口座 block ("label<TAB>value" lines). */
export interface BankAccount {
  id: string;
  label: string;
  block: string;
}

/** A customer delivery site for shipping instructions (納入先 + 備考 lines). */
export interface DeliveryProfile {
  id: string;
  /** Matches the shipment's customer (name contains this, case-insensitive). */
  customerName: string;
  siteName: string;
  address: string;
  notes: string;
}

/** Org defaults for in-app documents (TradeSetting.docDefaults). All optional. */
export interface DocDefaults {
  invoiceFromBlock?: string;
  invoiceSubjectTemplate?: string;
  invoiceLineTemplate?: string;
  invoiceRemarksTemplate?: string;
  invoiceDueLine?: string;
  invoiceFxNote?: string;
  invoiceConditions?: string;
  invoicePaymentTerms?: string;
  /** Invoice #2 (2回目): its own 諸条件 / 支払い条件 / 件名 (ADH's sheet: "6営業日以内", only the 納入条件 line, "6005 アルミニウムビレット品"). */
  invoice2Conditions?: string;
  invoice2PaymentTerms?: string;
  invoice2SubjectTemplate?: string;
  invoiceBankBlock?: string;
  /** Bank accounts an invoice can print (the first, or defaultBankId, is preselected). */
  banks?: BankAccount[];
  defaultBankId?: string;
  /** Company seal (data: URL, PNG/JPEG) printed beside the 請求書 From block. */
  sealImage?: string;
  /** " +{upcharge}(upcharge for {grade})" — the {upcharge} part of the remarks template. */
  invoiceUpchargeTemplate?: string;
  /** Invoice #2 texts: final-price line, its remarks, and the three cost lines. */
  invoice2LineTemplate?: string;
  invoice2RemarksTemplate?: string;
  invoice2CustomsTaxableLabel?: string;
  invoice2CustomsTaxableRemarks?: string;
  invoice2CustomsLabel?: string;
  invoice2OtherLabel?: string;
  invoice2OtherRemarks?: string;
  /** 他諸掛 default rate, USD per MT. */
  invoice2OtherPerMt?: number;
  invoiceTaxRate?: number;
  invoiceUnit?: string;
  invoiceDueBusinessDays?: number;
  /** Invoice #2 (2回目) due: ADH's "6営業日以内" — default 6. */
  invoice2DueBusinessDays?: number;
  productJa?: Record<string, string>;
  sgSellerBlock?: string;
  siTo?: string;
  siFromBlock?: string;
  /** SG→JP INVOICE & PACKING LIST blocks (Shipper falls back to the supplier's master record). */
  sgjpShipperBlock?: string;
  sgjpConsigneeBlock?: string;
  sgjpSellerBlock?: string;
  sgjpBuyerBlock?: string;
  sgjpSignBlock?: string;
  sgjpDimension?: string;
  /** "inch" label per size, e.g. { "203": "8 inch" } for "Aluminium Billet Alloy 6063-8 inch". */
  sizeInch?: Record<string, string>;
  /** Customer documents (計量検収票 / 納品書兼分析試験成績報告書) issuer. */
  customerDocIssuerName?: string;
  customerDocIssuerAddress?: string;
  customerDocContact?: string;
  customerPlFormLabel?: string;
  customerPlApplicant?: string;
  customerCoaFormLabel?: string;
  customerCoaVendor?: string;
  customerCoaPiecesPerBundle?: number;
  customerCoaWeightUnit?: string;
  /** 出庫・納入依頼書. */
  siWarehouseTo?: string;
  siIssuerName?: string;
  siWarehouseName?: string;
  /** 出庫・納入依頼書 宛先 line incl. 御中 (default "三井倉庫 株式会社 御中"). */
  siAddressee?: string;
  siCarrier?: string;
  siBilletLabel?: string;
  deliveryProfiles?: DeliveryProfile[];
}

// ── numbers ─────────────────────────────────────────────────────────────────
/** Half-up rounding that is symmetric for negatives (−0.005 → −0.01). */
export const roundTo = (n: number, dp: number) => {
  const f = 10 ** dp;
  return (Math.sign(n) * Math.round(Math.abs(n) * f + 1e-9)) / f;
};
/** Excel ROUNDDOWN: truncate toward zero (ADH's invoices truncate line amounts and tax). */
export const roundDown = (n: number, dp: number) => {
  const f = 10 ** dp;
  return (Math.sign(n) * Math.floor(Math.abs(n) * f + 1e-7)) / f;
};
const has = (v: unknown) => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v));
const n = (v: unknown) => (has(v) ? Number(v) : 0);

/** Unit price: the helper sum (LME + QMJP + premium + upcharge) when any helper field is filled, else as typed. */
/**
 * Unit price: LME + QMJP + premium + upcharge when the helper is used — but
 * null until the LME is typed (QMJP + premium alone is not a price) — else the
 * typed unit price.
 */
export function unitPriceOf(l: InvoiceLine): number | null {
  if ([l.lme, l.qmjp, l.premium, l.upcharge].some(has)) return has(l.lme) ? roundTo(n(l.lme) + n(l.qmjp) + n(l.premium) + n(l.upcharge), 4) : null;
  return has(l.unitPrice) ? Number(l.unitPrice) : null;
}

/** Amount: the typed override, else qty × unit price truncated to 2 dp (ADH's ROUNDDOWN); negative lines allowed. */
export function amountOf(l: InvoiceLine): number {
  if (has(l.amountOverride)) return roundTo(Number(l.amountOverride), 2);
  const p = unitPriceOf(l);
  return has(l.quantity) && p !== null ? roundDown(Number(l.quantity) * p, 2) : 0;
}

/** Calendar quarter (1–4) of "YYYY-MM": QMJP is quoted per quarter ("2QMJP" for June). */
export const quarterOf = (month: string) => {
  const m = /^\d{4}-(\d{2})$/.exec(month ?? '');
  return m ? String(Math.ceil(Number(m[1]) / 3)) : '';
};

/**
 * Price build-up for 備考, e.g. ADH's "LME Cash 2026/6月平均(3458.64USD) +351.5(2QMJP)
 * +190(Billet Premium) +10(upcharge for 6005)\n\nTotal Premium is 351.5(2QMJP) + 200".
 * Tokens: {month} (2026/6), {LME}, {QMJP}, {q} (quarter of the LME month),
 * {premium}, {upcharge} (the upcharge template, only when non-zero), {grade},
 * {totalPremium} (premium + upcharge). A template without {upcharge} gets the
 * legacy " +10(Upcharge)" appended.
 */
export function helperRemarks(
  l: InvoiceLine,
  lmeMonth: string,
  template = 'LME Cash {month}月平均({LME}USD) +{QMJP}(QMJP) +{premium}(Billet Premium)',
  upchargeTemplate = ' +{upcharge}(upcharge for {grade})',
): string {
  if (![l.lme, l.qmjp, l.premium, l.upcharge].some(has)) return '';
  const m = /^(\d{4})-(\d{2})$/.exec(lmeMonth ?? '');
  const month = m ? `${m[1]}/${Number(m[2])}` : lmeMonth;
  const fmt = (v: unknown) => (has(v) ? String(Number(v)) : '0');
  const up = has(l.upcharge) && Number(l.upcharge) !== 0;
  const vars: Record<string, string> = {
    month,
    LME: fmt(l.lme),
    QMJP: fmt(l.qmjp),
    q: quarterOf(lmeMonth),
    premium: fmt(l.premium),
    grade: l.grade ?? '',
    totalPremium: String(roundTo(n(l.premium) + n(l.upcharge), 4)),
  };
  vars.upcharge = up ? upchargeTemplate.replace(/\{(\w+)\}/g, (_, k) => (k === 'upcharge' ? fmt(l.upcharge) : (vars[k] ?? ''))) : '';
  // LME not typed yet: leave out its "(…USD)" figure instead of printing "(0USD)".
  if (!has(l.lme)) template = template.replace(/\(\{LME\}[^)]*\)/g, '');
  const s = template.replace(/\{(\w+)\}/g, (all, k) => (k in vars ? vars[k] : all));
  return !template.includes('{upcharge}') && up ? `${s} +${fmt(l.upcharge)}(Upcharge)` : s;
}

export interface InvoiceTotals {
  /** 税率別内訳 税込金額 (US$): taxable + tax (Invoice #1); 合計 incl. the non-taxable amount (Invoice #2, as ADH's 2回目 sheet). */
  breakdownGross: number;
  /** Every line (小計). */
  subtotal: number;
  /** 課税対象金額 / 課税以外金額 (equal to subtotal / 0 when every line is taxable). */
  taxable: number;
  nonTaxable: number;
  tax: number;
  total: number;
  /** 税込み小計 per product (grade) — only when the invoice bills more than one. */
  perProduct: Array<{ label: string; net: number; tax: number; gross: number }>;
  jpy: { subtotal: number; tax: number; total: number } | null;
}

/**
 * Invoice totals. `variant: 'final'` (Invoice #2) follows ADH's 2回目 sheet
 * (請求書正式ビレット…2回目.xlsx, 編集用): 税込金額 = 合計 (=F23, incl. the
 * non-taxable 通関), ¥税抜 = ROUND(FX × 課税対象, 0), ¥消費税 = ROUND(FX × US$消費税, 0),
 * ¥税込 = their sum. Invoice #1 keeps its own rule (tax truncated from the yen figure).
 */
export function invoiceTotals(rows: InvoiceLine[], taxRate: number, fxRate: number | null, variant?: 'final'): InvoiceTotals {
  const rate = n(taxRate) / 100;
  const amounts = rows.map(amountOf);
  const sum = (pick: (l: InvoiceLine) => boolean) =>
    roundTo(
      rows.reduce((a, l, i) => a + (pick(l) ? amounts[i] : 0), 0),
      2,
    );
  const taxable = sum((l) => l.taxable !== false);
  const nonTaxable = sum((l) => l.taxable === false);
  const subtotal = roundTo(taxable + nonTaxable, 2);
  // ADH truncates the tax (ROUNDDOWN(課税対象金額 × 10%, 2)).
  const tax = roundDown(taxable * rate, 2);
  const total = roundTo(subtotal + tax, 2);
  const groups = new Map<string, number>();
  rows.forEach((l, i) => {
    if (!l.grade) return;
    groups.set(l.grade, (groups.get(l.grade) ?? 0) + amounts[i]);
  });
  const perProduct =
    groups.size > 1
      ? [...groups].map(([label, net]) => {
          const t = roundTo(net * rate, 2);
          return { label, net: roundTo(net, 2), tax: t, gross: roundTo(net * (1 + rate), 2) };
        })
      : [];
  // JPY (税率別内訳): the taxable amount converted and rounded to the yen, its tax
  // truncated from that yen figure, the total their sum so the table adds up.
  const jpy =
    has(fxRate) && Number(fxRate) > 0
      ? (() => {
          const fx = Number(fxRate);
          const s = roundTo(taxable * fx, 0);
          const t = variant === 'final' ? roundTo(tax * fx, 0) : roundDown(s * rate, 0);
          return { subtotal: s, tax: t, total: s + t };
        })()
      : null;
  const breakdownGross = variant === 'final' ? total : roundTo(taxable + tax, 2);
  return { breakdownGross, subtotal, taxable, nonTaxable, tax, total, perProduct, jpy };
}

// ── dates ───────────────────────────────────────────────────────────────────
const parse = (d: string) => {
  const [y, m, dd] = d.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, dd));
};
const iso = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Japanese bank business day: not a weekend, not a public holiday
 * (@holiday-jp/holiday_jp — bundled data, no network), and not the banks'
 * year-end closure (12/31, 1/2, 1/3 — not public holidays, but no transfers).
 */
export function isJapanBusinessDay(date: string): boolean {
  const [y, m, d] = date.split('-').map(Number);
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  if (wd === 0 || wd === 6) return false;
  if ((m === 12 && d === 31) || (m === 1 && (d === 2 || d === 3))) return false;
  // The library reads the LOCAL calendar date, so build it in local time.
  return !holidayJp.isHoliday(new Date(y, m - 1, d));
}

/** `days` Japanese bank business days after an ISO calendar date (Asia/Tokyo day). */
export function addBusinessDays(date: string, days: number): string {
  const d = parse(date);
  let left = days;
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    if (isJapanBusinessDay(iso(d))) left--;
  }
  return iso(d);
}

/** The customs weekly FX period (Sunday–Saturday) containing `date`: "7/5～7/11". */
export function customsWeek(date: string): string {
  const d = parse(date);
  const start = new Date(d);
  start.setUTCDate(d.getUTCDate() - d.getUTCDay());
  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + 6);
  return `${start.getUTCMonth() + 1}/${start.getUTCDate()}～${end.getUTCMonth() + 1}/${end.getUTCDate()}`;
}

/** The month before a "YYYY-MM" month ("2026-01" → "2025-12"); '' when it isn't one. */
export function monthBefore(month: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})$/.exec(month ?? '');
  if (!m) return '';
  const y = Number(m[1]);
  const mo = Number(m[2]);
  return mo === 1 ? `${y - 1}-12` : `${y}-${String(mo - 1).padStart(2, '0')}`;
}

/**
 * Default LME average month, from the contract's shipment month — never from
 * today: Invoice #1 (advance) is priced on the month BEFORE the shipment
 * month; Invoice #2 and the SG→JP invoice on the shipment month itself.
 * '' when the contract has no shipment month (the user types it).
 */
export function defaultLmeMonth(docType: 'INVOICE_1' | 'INVOICE_2' | 'SGJP_IV_PL', shipmentMonth: string | null | undefined): string {
  const sm = /^\d{4}-\d{2}$/.test(shipmentMonth ?? '') ? (shipmentMonth as string) : '';
  return docType === 'INVOICE_1' ? monthBefore(sm) : sm;
}

// ── prefills ────────────────────────────────────────────────────────────────
export interface PrefillContractLine {
  id: string;
  grade: string | null;
  product: string | null;
  sizeSpec: string | null;
  quantityMt: unknown;
  tolerancePct: unknown;
  clientPremium?: unknown;
  /** Price parts (USD/MT) the helper starts from. */
  qmjp?: unknown;
  billetPremium?: unknown;
  upcharge?: unknown;
}

/** "8 Inch" for a size whose mm figure is in docDefaults.sizeInch ({ "203": "8 inch" }); the size itself otherwise. */
export function inchLabel(size: string | null | undefined, d: DocDefaults): string {
  const mm = /(\d{2,4})\s*MM/i.exec(size ?? '')?.[1];
  const v = mm ? d.sizeInch?.[mm] : undefined;
  return v ? v.replace(/\binch\b/i, 'Inch') : (size ?? '');
}

const fill = (tpl: string, vars: Record<string, unknown>) => tpl.replace(/\{(\w+)\}/g, (_, k) => (vars[k] === null || vars[k] === undefined ? '' : String(vars[k])));
const num = (v: unknown) => (has(v) ? Number(v) : null);

/**
 * 件名: with "{grade}" the template repeats per grade, one per line
 * ("6005アルミニウムビレット品\n6063アルミニウムビレット品", as on ADH's
 * invoices); with "{grades}" the grades are joined with "・".
 */
export function invoiceSubject(template: string | undefined, grades: string[], product: string): string {
  const uniq = [...new Set(grades.filter(Boolean))];
  const tpl = template ?? '{grade}{product}';
  if (tpl.includes('{grade}')) return (uniq.length ? uniq : ['']).map((g) => fill(tpl, { grade: g, product })).join('\n');
  return fill(tpl, { grades: uniq.join('・'), product });
}

/** The org's bank accounts: docDefaults.banks, else the single legacy invoiceBankBlock. */
export function banksOf(d: DocDefaults): BankAccount[] {
  const list = Array.isArray(d.banks) ? d.banks.filter((b) => b && typeof b.block === 'string') : [];
  if (list.length) return list;
  return d.invoiceBankBlock ? [{ id: 'default', label: d.invoiceBankBlock.split('\n')[0] ?? 'Bank', block: d.invoiceBankBlock }] : [];
}
export function defaultBank(d: DocDefaults): BankAccount | null {
  const list = banksOf(d);
  return list.find((b) => b.id === d.defaultBankId) ?? list[0] ?? null;
}

/** Business days to the 請求書 due date: Invoice #1 7 (invoiceDueBusinessDays), Invoice #2 6 (invoice2DueBusinessDays). */
export function dueBusinessDays(d: DocDefaults, docType?: string | null): number {
  return Number(docType === 'INVOICE_2' ? (d.invoice2DueBusinessDays ?? 6) : (d.invoiceDueBusinessDays ?? 7));
}

export function invoiceHeaderDefaults(opts: {
  today: string;
  /** INVOICE_1 (default) or INVOICE_2 — sets the due-date default. */
  docType?: string;
  org: { name: string; address?: string | null; registrationNumber?: string | null };
  customerName: string;
  grades: string[];
  products: string[];
  defaults: DocDefaults;
  /** The LME average month (see defaultLmeMonth); '' when unknown. */
  lmeMonth?: string;
}): InvoiceHeader {
  const d = opts.defaults;
  const bank = defaultBank(d);
  const due = addBusinessDays(opts.today, dueBusinessDays(d, opts.docType));
  const productJa = (opts.products.map((p) => d.productJa?.[p] ?? p)[0] ?? '') || '';
  return {
    title: '請　求　書',
    invoiceNo: null,
    issueDate: opts.today,
    registrationNo: opts.org.registrationNumber ?? '',
    toName: opts.customerName,
    toSuffix: '御中',
    subject: invoiceSubject(opts.docType === 'INVOICE_2' ? (d.invoice2SubjectTemplate ?? '{grade} {product}品') : d.invoiceSubjectTemplate, opts.grades, productJa),
    fromBlock: d.invoiceFromBlock ?? [opts.org.name, opts.org.address].filter(Boolean).join('\n'),
    dueDate: due,
    dueLine: d.invoiceDueLine ?? '{date} までにお支払いをお願い致します。',
    taxRate: d.invoiceTaxRate ?? 10,
    fxRate: null,
    fxNote: fill(d.invoiceFxNote ?? '円/USD 税関{range} 外国為替相場参照', { range: customsWeek(opts.today) }),
    lmeMonth: opts.lmeMonth ?? '',
    conditions: opts.docType === 'INVOICE_2' ? (d.invoice2Conditions ?? '・納入条件ートラック積替え貴社指定先に納入（車上渡し）') : (d.invoiceConditions ?? ''),
    paymentTerms: opts.docType === 'INVOICE_2' ? (d.invoice2PaymentTerms ?? '・請求書発行　6営業日以内　弊社指定口座振込') : (d.invoicePaymentTerms ?? ''),
    bankBlock: bank?.block ?? '',
    bankId: bank?.id ?? null,
    showSeal: true,
    currency: 'USD',
  };
}

/** Invoice #1: one line per contract product line (description from the org's template). */
export function invoice1Line(contract: { id: string; contractNo: string }, l: PrefillContractLine, defaults: DocDefaults, dueDate: string): InvoiceLine {
  const tpl = defaults.invoiceLineTemplate ?? 'Aluminium Billet - {grade} as per Specification of {size}\n{qty}MT +- {tol}% Tolerance';
  return {
    description: fill(tpl, { grade: l.grade ?? '', size: l.sizeSpec ?? '', inch: inchLabel(l.sizeSpec, defaults), qty: num(l.quantityMt) ?? '', tol: num(l.tolerancePct) ?? '' }),
    quantity: num(l.quantityMt),
    unit: defaults.invoiceUnit ?? 'トン',
    unitPrice: null,
    amountOverride: null,
    remarks: '',
    dueDate,
    lme: null,
    // The contract line's price parts start the helper (the LME is typed).
    qmjp: num(l.qmjp),
    premium: num(l.billetPremium),
    upcharge: num(l.upcharge),
    autoRemarks: true,
    contractId: contract.id,
    contractNo: contract.contractNo,
    contractLineId: l.id,
    grade: l.grade,
  };
}

/**
 * Invoice #2: "Final price" on the shipment's net weight, "Less: Invoice #1"
 * (minus what Invoice #1 billed for this product line), and an empty cost line.
 */
export function invoice2Lines(opts: {
  netWeightMt: unknown;
  line: PrefillContractLine | null;
  contract: { id: string; contractNo: string };
  invoice1: { number: string | null; quantity: number | null; unitPrice: number | null; amount: number } | null;
  defaults: DocDefaults;
  dueDate: string;
}): InvoiceLine[] {
  const unit = opts.defaults.invoiceUnit ?? 'トン';
  const base = { contractId: opts.contract.id, contractNo: opts.contract.contractNo, contractLineId: opts.line?.id ?? null, grade: opts.line?.grade ?? null };
  const blank = { lme: null, qmjp: null, premium: null, upcharge: null, dueDate: opts.dueDate, remarks: '' };
  return [
    {
      ...blank,
      ...base,
      description: `Final price${opts.line?.grade ? ` - ${opts.line.grade}` : ''}${opts.line?.sizeSpec ? ` ${opts.line.sizeSpec}` : ''}`,
      quantity: num(opts.netWeightMt),
      unit,
      unitPrice: null,
      amountOverride: null,
      autoRemarks: true,
    },
    {
      ...blank,
      ...base,
      description: `Less: Invoice #1${opts.invoice1?.number ? ` (${opts.invoice1.number})` : ''}`,
      quantity: opts.invoice1?.quantity !== null && opts.invoice1?.quantity !== undefined ? -opts.invoice1.quantity : null,
      unit,
      unitPrice: opts.invoice1?.unitPrice ?? null,
      amountOverride: opts.invoice1 ? -opts.invoice1.amount : null,
      autoRemarks: false,
    },
    { ...blank, ...base, description: '', quantity: null, unit, unitPrice: null, amountOverride: null, autoRemarks: false },
  ];
}

/**
 * Invoice #2 as ADH issues it (請求書正式ビレット 2回目): the final price on the
 * shipment's actual net weight (LME of the shipment month + QMJP + premium +
 * upcharge), 通関、車輸送料 (taxable), 通関 (not taxable) and 他諸掛 (taxable,
 * default 40 USD/MT × net) — each with its own 備考. The header carries what
 * Invoice #1 billed for this product (tax incl.) so the PDF can show the 差額.
 */
export function invoice2FinalLines(opts: {
  netWeightMt: unknown;
  line: PrefillContractLine | null;
  contract: { id: string; contractNo: string };
  /** The Invoice #1 line for this product (its premium / upcharge / QMJP start the helper). */
  invoice1Line: Pick<InvoiceLine, 'qmjp' | 'premium' | 'upcharge'> | null;
  defaults: DocDefaults;
  dueDate: string;
  lmeMonth: string;
}): InvoiceLine[] {
  const d = opts.defaults;
  const unit = d.invoiceUnit ?? 'トン';
  const net = num(opts.netWeightMt);
  const base = { contractId: opts.contract.id, contractNo: opts.contract.contractNo, contractLineId: opts.line?.id ?? null, grade: opts.line?.grade ?? null, dueDate: opts.dueDate };
  const noHelper = { lme: null, qmjp: null, premium: null, upcharge: null, unitPrice: null, amountOverride: null, autoRemarks: false };
  const tpl = d.invoice2LineTemplate ?? 'Aluminium Billet - {grade} as per Specification of {size}\n{qty}MT +- {tol}% Tolerance';
  const qtyText = (v: number | null) => (v === null ? '' : String(roundTo(v, 3)));
  const finalLine: InvoiceLine = {
    ...base,
    description: fill(tpl, {
      grade: opts.line?.grade ?? '',
      size: opts.line?.sizeSpec ?? '',
      inch: inchLabel(opts.line?.sizeSpec, d),
      qty: num(opts.line?.quantityMt) ?? '',
      tol: num(opts.line?.tolerancePct) ?? '',
    }),
    quantity: net,
    unit,
    unitPrice: null,
    amountOverride: null,
    remarks: '',
    lme: null,
    qmjp: opts.invoice1Line?.qmjp ?? null,
    premium: opts.invoice1Line?.premium ?? null,
    upcharge: opts.invoice1Line?.upcharge ?? null,
    autoRemarks: true,
    taxable: true,
  };
  finalLine.remarks = helperRemarks(finalLine, opts.lmeMonth, d.invoice2RemarksTemplate, d.invoiceUpchargeTemplate);
  const perMt = d.invoice2OtherPerMt ?? 40;
  return [
    finalLine,
    {
      ...base,
      ...noHelper,
      description: d.invoice2CustomsTaxableLabel ?? '通関、車輸送料\n　課税対象　消費税率10％',
      quantity: 1,
      unit: '式',
      remarks: fill(d.invoice2CustomsTaxableRemarks ?? '', { qty: qtyText(net) }),
      taxable: true,
    },
    { ...base, ...noHelper, description: d.invoice2CustomsLabel ?? '通関\n　課税対象外', quantity: 1, unit: '式', remarks: '', taxable: false },
    {
      ...base,
      ...noHelper,
      description: d.invoice2OtherLabel ?? '他諸掛\n　課税対象　消費税率10％',
      // As ADH's 6005 2回目 sheet: 1 式 at ROUNDDOWN(net × 40, 2) (the rate and tonnage are in 備考).
      quantity: 1,
      unit: '式',
      unitPrice: net === null ? null : roundDown(net * perMt, 2),
      remarks: fill(d.invoice2OtherRemarks ?? '{rate}USD/ton\n（{qty}トン/月)', { rate: perMt, qty: qtyText(net) }),
      taxable: true,
    },
  ];
}

// ── HTML ────────────────────────────────────────────────────────────────────
/** "2026-07-21" → "2026/7/21" (the format ADH's invoices use in the header and due line). */
const slashDate = (d: string | null | undefined) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d ?? '');
  return m ? `${m[1]}/${Number(m[2])}/${Number(m[3])}` : esc(d ?? '');
};
/** "2026-10-12" → "10/12/26" (m/d/yy — how ADH's 2回目 sheet prints its dates). */
export const shortDate = (d: string | null | undefined) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d ?? '');
  return m ? `${Number(m[2])}/${Number(m[3])}/${m[1].slice(2)}` : esc(d ?? '');
};
/** "US$1,862,584.68" — no space, as on ADH's invoices. */
const usd = (v: number) => `US$${money(v)}`;
/** 数量: 2–3 decimals (120.00, 305.804), as ADH's sheets. */
const tons = (v: number | null) =>
  v === null || v === undefined || !Number.isFinite(v) ? '' : `${v < 0 ? '-' : ''}${Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 3 })}`;

/** Bank block: a line "label<TAB>value" prints as two columns, any other line spans both. */
const bankRows = (text: string) =>
  (text ?? '')
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .map((l) => {
      const [k, ...v] = l.split('\t');
      return v.length ? `<tr><td class="bk">${esc(k.trim())}</td><td>${esc(v.join(' ').trim())}</td></tr>` : `<tr><td colspan="2">${esc(l.trim())}</td></tr>`;
    })
    .join('');

/** Column widths of ADH's invoice (摘要 | 数量 | 単価 | 金額 | 備考 | 取引年月日). */
const COLS = '<colgroup><col style="width:33%"><col style="width:12.8%"><col style="width:12.9%"><col style="width:12.8%"><col style="width:15.2%"><col style="width:13.3%"></colgroup>';

/**
 * ADH 請求書, laid out after ADH's own Excel invoice: meta top-right, centred
 * title, customer 御中, 件名 + ADH block, 合計(税込) line, the six-column
 * table (one merged 取引年月日 cell when every line shares the date), per-
 * product 税込み小計 + the 小計 / 消費税 / 合計 box under 単価–金額, the small
 * 税率別内訳 with the FX note, the due line, 条件, 支払い条件 and the bank.
 */
export function renderInvoiceHtml(h: InvoiceHeader, rows: InvoiceLine[], opts: { draft?: boolean; seal?: string | null } = {}): string {
  const final = h.variant === 'final';
  const t = invoiceTotals(rows, h.taxRate, h.fxRate, final ? 'final' : undefined);
  // Invoice #2 prints like ADH's 2回目 sheet: dates m/d/yy, negative 合計(税込) in brackets "(US$11,380.29)".
  const day = final ? shortDate : slashDate;
  // Invoice #2: what is still owed after Invoice #1 (negative = refund).
  const first = has(h.invoice1Amount) ? Number(h.invoice1Amount) : null;
  const diff = final ? roundTo(t.total - (first ?? 0), 2) : t.total;
  const seal = h.showSeal !== false && opts.seal && /^data:image\/(png|jpe?g);base64,/.test(opts.seal) ? opts.seal : null;
  const rate = `${n(h.taxRate)}%`;
  const dueLine = (h.dueLine ?? '').replace('{date}', (h.variant === 'final' ? shortDate : slashDate)(h.dueDate));
  const dates = [...new Set(rows.map((l) => l.dueDate ?? ''))];
  const oneDate = rows.length > 0 && dates.length === 1;
  const body = `
<div class="meta">番号：&nbsp;${esc(h.invoiceNo ?? '（確定時に採番）')}<br>発行日：&nbsp;${day(h.issueDate)}${h.registrationNo ? `<br>登録番号：${esc(h.registrationNo)}` : ''}</div>
<div class="title">${esc((h.title || '請求書').replace(/[\s　]+/g, ''))}</div>
<div class="to">${esc(h.toName)}　${esc(h.toSuffix || '御中')}</div>
<div class="parties">
  <div class="subject"><span class="lbl">件名：</span><div class="pre">${br(h.subject)}</div></div>
  <div class="from pre">${br(h.fromBlock)}${seal ? `<img class="seal" src="${seal}" alt="">` : ''}</div>
</div>
<div class="grand"><span>合計(税込)</span><span class="num${final && diff < 0 ? ' neg' : ''}">${final && diff < 0 ? `(${usd(-diff)})` : usd(diff)}</span></div>
<table class="grid">${COLS}
  <thead><tr><th>摘要</th>${final ? '<th>数量</th><th>単価（USD）</th><th>金額（USD）</th>' : '<th>数量<br>（トン）</th><th>単価(US$/MT)</th><th>金額(US$)</th>'}<th>備考</th><th class="dh">取引年月日<br>(支払い期日)</th></tr></thead>
  <tbody>
  ${rows
    .map((l, i) => {
      const lineDate = (d: string | null | undefined) => (final ? shortDate(d) : jpDate(d));
      const date = oneDate ? (i === 0 ? `<td class="date" rowspan="${rows.length}">${lineDate(l.dueDate)}</td>` : '') : `<td class="date">${l.dueDate ? lineDate(l.dueDate) : ''}</td>`;
      // Invoice #2's 式 lines show a whole quantity ("1"), as ADH's sheet.
      const q = final && l.unit !== (rows[0]?.unit ?? 'トン') && Number.isInteger(Number(l.quantity)) ? String(Number(l.quantity)) : tons(l.quantity);
      return `<tr><td class="desc pre">${br(l.description)}</td><td class="num">${q}</td><td class="num">${money(unitPriceOf(l))}</td><td class="num">${money(amountOf(l))}</td><td class="rem pre">${br(l.remarks)}</td>${date}</tr>`;
    })
    .join('')}
  </tbody>
</table>
${
  final
    ? `<table class="sums">${COLS}
  ${(
    [
      ['課税対象金額', t.taxable],
      [`消費税(${rate})`, t.tax],
      ['課税以外金額', t.nonTaxable],
      ['合計', t.total],
      ['１回目の金額', first],
      ['２回目の金額(差額)', diff],
    ] as Array<[string, number | null]>
  )
    .map(
      ([k, v], i) =>
        `<tr><td></td><td colspan="2" class="lb${i === 3 || i === 5 ? ' tot' : ''}">${k}</td><td class="num v${i === 3 || i === 5 ? ' tot' : ''}${v !== null && v < 0 ? ' neg' : ''}">${money(v)}</td><td colspan="2"></td></tr>`,
    )
    .join('')}
</table>`
    : `<table class="sums">${COLS}
  <tr><td colspan="2" class="pp">${t.perProduct[0] ? `(${esc(t.perProduct[0].label)} 税込み小計<span>${usd(t.perProduct[0].gross)} )</span>` : ''}</td><td class="lb">小計</td><td class="num v">${money(t.subtotal)}</td><td colspan="2"></td></tr>
  <tr><td colspan="2" class="pp">${t.perProduct[1] ? `(${esc(t.perProduct[1].label)} 税込み小計<span>${usd(t.perProduct[1].gross)} )</span>` : ''}</td><td class="lb">消費税(${rate})</td><td class="num v">${money(t.tax)}</td><td colspan="2"></td></tr>
  <tr><td colspan="2" class="pp">${t.perProduct[2] ? `(${esc(t.perProduct[2].label)} 税込み小計<span>${usd(t.perProduct[2].gross)} )</span>` : ''}</td><td class="lb tot">合計</td><td class="num v tot">${money(t.total)}</td><td colspan="2"></td></tr>
  ${t.perProduct
    .slice(3)
    .map((p) => `<tr><td colspan="2" class="pp">(${esc(p.label)} 税込み小計<span>${usd(p.gross)} )</span></td><td colspan="4"></td></tr>`)
    .join('')}
</table>`
}
<div class="bd">
  <div class="bdl">
    <div>税率別内訳</div>
    <table>
      <tr class="hd"><td></td><td>税抜金額</td><td>消費税額</td><td>税込金額</td></tr>
      <tr><td>${rate}</td><td class="num">${usd(t.taxable)}</td><td class="num">${usd(t.tax)}</td><td class="num">${usd(t.breakdownGross)}</td></tr>
      ${t.jpy ? `<tr><td>${rate}</td><td class="num">¥${money(t.jpy.subtotal, 0)}</td><td class="num">¥${money(t.jpy.tax, 0)}</td><td class="num">¥${money(t.jpy.total, 0)}</td></tr>` : ''}
    </table>
  </div>
  ${t.jpy ? `<div class="fx"><div>※円貨</div><div>${esc(Number(h.fxRate).toLocaleString('en-US', { maximumFractionDigits: 4 }))} ${esc(h.fxNote)}</div></div>` : ''}
</div>
${dueLine ? `<p class="due">${dueLine}</p>` : ''}
${
  final
    ? h.conditions || h.paymentTerms
      ? `<div class="sec">諸条件</div><div class="txt pre">${br([h.conditions, h.paymentTerms].filter(Boolean).join('\n'))}</div>`
      : ''
    : `${h.conditions ? `<div class="sec">条件</div><div class="txt pre">${br(h.conditions)}</div>` : ''}
${h.paymentTerms ? `<div class="sec2">支払い条件</div><div class="txt pre">${br(h.paymentTerms)}</div>` : ''}`
}
${h.bankBlock ? `<div class="sec2 bank-t">弊社指定口座</div><table class="bank">${bankRows(h.bankBlock)}</table>` : ''}
`;
  const css = `
@page { size: A4; margin: 18mm 17mm 14mm 20mm; } /* ADH's invoice page margins (wins over the shell's) */
body { font-size: 8pt; }
.meta { text-align: right; font-size: 7pt; line-height: 1.7; }
.title { text-align: center; font-size: 12.5pt; font-weight: 700; letter-spacing: 1em; margin: 1.5mm 0 5mm 1em; }
.to { font-size: 9.5pt; font-weight: 700; margin-bottom: 3mm; }
.parties { display: flex; justify-content: space-between; align-items: flex-start; }
.subject { display: flex; gap: 0; font-size: 8pt; margin-top: 5mm; }
.subject .lbl { width: 24mm; flex-shrink: 0; font-weight: 400; }
.from { position: relative; text-align: right; font-size: 8.3pt; line-height: 1.55; padding-right: 9mm; }
/* The seal overlaps the end of the address, inside the printable area (as stamped on ADH's invoice). */
.from .seal { position: absolute; right: -2mm; bottom: -5mm; width: 17mm; height: auto; opacity: .92; }
.grand { display: inline-flex; gap: 14mm; margin: 3mm 0 3mm; padding: 0 2mm 1px 0; border-bottom: 1px solid #111; font-size: 9.3pt; }
table.grid, table.sums { width: 100%; table-layout: fixed; }
.grid th { background: #d9d9d9; border: 1px solid #555; padding: 3px 4px; font-weight: 400; text-align: center; font-size: 7.8pt; }
.grid th.dh { font-size: 6.5pt; text-align: left; vertical-align: top; }
.grid td { border: 1px solid #555; padding: 5px 3px; vertical-align: middle; font-size: 7.7pt; }
.grid td.desc { font-size: 7.25pt; line-height: 1.5; letter-spacing: -0.01em; }
.grid td.rem { font-size: 6.8pt; line-height: 1.4; vertical-align: top; padding-top: 6px; }
.grid td.date { text-align: center; }
.sums td { padding: 2px 3px; font-size: 7.8pt; }
.sums td.pp { font-size: 7pt; padding-left: 4mm; }
.sums td.pp span { display: inline-block; min-width: 30mm; text-align: right; margin-left: 10mm; font-size: 7.8pt; }
.sums td.lb { text-align: right; border: 1px solid #555; border-right: 0; }
.sums td.v { border: 1px solid #555; }
.sums td.tot { border-top: 1px solid #111; }
.neg { color: #c00000; } /* ADH's sheet prints negatives in red */
.bd { display: flex; align-items: flex-end; gap: 12mm; margin-top: 4mm; font-size: 6pt; color: #222; }
.bdl { width: 55%; }
.bdl table { width: 100%; border-top: 1px solid #777; margin-top: 1px; }
.bdl td { padding: 0 4px; border-bottom: 1px solid #999; }
.bdl tr.hd td { text-align: right; }
.fx { font-size: 6pt; line-height: 1.5; }
.due { font-weight: 700; font-size: 7pt; margin: 2.5mm 0 0 14mm; }
.sec { font-size: 8.5pt; margin-top: 1mm; }
.sec2 { font-size: 6.6pt; margin-top: 1mm; }
.txt { font-size: 6.2pt; line-height: 1.55; }
.bank-t { margin-top: 4mm; }
table.bank { font-size: 6.2pt; line-height: 1.45; }
table.bank td { padding: 0; vertical-align: top; }
table.bank td.bk { width: 32mm; }
`;
  return docShell({ title: `請求書 ${h.invoiceNo ?? ''}`.trim(), css, body, draft: opts.draft });
}

/** Rows as stored (Json) → typed lines with sane defaults. */
export function toInvoiceLines(rows: unknown): InvoiceLine[] {
  return (Array.isArray(rows) ? rows : []).map((r: any) => ({
    description: String(r?.description ?? ''),
    quantity: num(r?.quantity),
    unit: String(r?.unit ?? 'トン'),
    unitPrice: num(r?.unitPrice),
    amountOverride: num(r?.amountOverride),
    remarks: String(r?.remarks ?? ''),
    dueDate: r?.dueDate ?? null,
    lme: num(r?.lme),
    qmjp: num(r?.qmjp),
    premium: num(r?.premium),
    upcharge: num(r?.upcharge),
    autoRemarks: r?.autoRemarks ?? false,
    contractId: r?.contractId ?? null,
    contractNo: r?.contractNo ?? null,
    contractLineId: r?.contractLineId ?? null,
    grade: r?.grade ?? null,
    taxable: r?.taxable !== false,
  }));
}

// ── finalize guard ──────────────────────────────────────────────────────────
const lineNo = (i: number) => `line ${i + 1}`;
/**
 * What stops an invoice (Invoice #1 / #2) from being finalized: a billed line
 * without a unit price — "needs the LME" when the pricing helper is in use —
 * and a total of US$0.00. Lines with nothing on them are ignored.
 */
export function invoiceFinalizeProblems(rows: InvoiceLine[], taxRate: number): string[] {
  const problems: string[] = [];
  rows.forEach((l, i) => {
    const used = (l.description ?? '').trim() !== '' || has(l.quantity) || has(l.amountOverride);
    if (!used || has(l.amountOverride)) return;
    if (unitPriceOf(l) !== null) return;
    const helper = [l.lme, l.qmjp, l.premium, l.upcharge].some(has);
    problems.push(helper ? `${lineNo(i)} needs the LME` : `${lineNo(i)} needs a unit price`);
  });
  if (invoiceTotals(rows, taxRate, null).total === 0) problems.push('the total is US$0.00');
  return problems;
}

/** "Can't finalize: line 1 needs the LME; the total is US$0.00." */
export const finalizeMessage = (problems: string[]) => `Can't finalize: ${problems.join('; ')}.`;
