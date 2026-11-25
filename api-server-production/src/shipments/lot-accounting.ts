/**
 * Round BW — ADH lot accounting PREVIEW (pure; no database). ADH Singapore's books per lot (= order #n), following
 * ADH's FRS (~/Desktop/ADH_Docs/accounting/ADH_SG_Xero_FRS.md):
 *
 *   Purchases (every customer)          Bill PI deposit (620) · Bill CI balance = CI TOTAL (620) ·
 *                                       Manual journal on the 1st of the delivery month: 620 → 310 COGS
 *   SUS  (2-phase, via ADH Japan)       Advance invoice (810) · Import GST advance bill (810) ·
 *                                       Manual journal at delivery: 810 → 200 · Settlement A / B / C
 *   Kato (1-phase, via ADH Japan)       Import GST advance bill · Settlement A (full product revenue) / B / C
 *   Hoei (direct)                       One sales invoice to HOEI → 200
 *
 * Every amount is USD (JPY via the customs rate where the FRS does so) and converts to SGD at the rate of the
 * 1st of the lot's delivery month ("1 SGD = x USD", Xero's convention). Nothing the FRS / ADH hasn't answered is
 * filled in: such a line has amount null and says "rule needed"; data AIMS doesn't have says "missing".
 */

export type BooksPattern = 'SUS' | 'KATO' | 'HOEI';
export type PostingStatus = 'ready' | 'waiting' | 'rule needed' | 'missing data' | 'rate needed';

/** Provisional chart (codes editable; ADH's Xero chart is imported later). */
export const LOT_ACCOUNTS = {
  prepayments: '620',
  advance: '810',
  sales: '200',
  cogs: '310',
  receivable: '610',
  payable: '800',
} as const;

export const CONTACTS = { supplier: 'VEDANTA LIMITED', adhJapan: 'ASIA DEAL HUB JAPAN LTD.', hoei: 'HOEI' } as const;

/** 他諸掛 fee per MT and ADH Japan's share (FRS + Elroy 18 Nov: every SUS and Kato lot, never Hoei). */
export const FEE_PER_MT = 40;
export const ADHJ_SHARE = 0.15;

export interface LotShipmentInput {
  ref: string;
  netMt: number | null;
  /** The CI read (Sub Total / Advance / boxed TOTAL) of the CI version AIMS stores. */
  ci: { ciNumber: string | null; subTotal: number; advance: number | null; total: number | null } | null;
  /** SG→JP invoice total (USD) = the permit's CIF. */
  sgjpTotal: number | null;
  /** Import tax in yen and the customs weekly rate (JPY per USD) it was computed at. */
  importTaxJpy: number | null;
  customsRate: number | null;
}

export interface LotInput {
  orderRef: string;
  customerName: string | null;
  /** Round BZ: the order's supplier — the FRS covers lots bought from Vedanta only. */
  supplierName?: string | null;
  pattern: BooksPattern | null;
  deliveryMonth: string | null;
  /** 1 SGD = rate USD for the 1st of the delivery month (null = not typed yet). */
  usdRate: number | null;
  shipments: LotShipmentInput[];
  /** The order's deposit as AIMS has it (PI × %), to compare with the CIs' advances. */
  aimsDeposit: number | null;
  /** Hoei: the USD total of ADH's invoice to Hoei (AIMS-made, FINAL). */
  directInvoiceTotal: number | null;
  /**
   * SUS: the advance invoice = SUS Invoice #1, USD (Elroy 18 Nov): principal (the product line, before tax) + its tax.
   * From AIMS's FINAL Invoice #1, else the amounts ADH Admin typed; null = "Invoice #1 not in AIMS".
   */
  invoice1: { principal: number; tax: number; number: string | null; source: 'aims' | 'typed'; by?: string | null } | null;
  /** Step state, for when each posting would happen. */
  done: { piPayment: boolean; ciPayment: boolean; invoice1: boolean; taxFunds: boolean };
  /**
   * Rules ADH hasn't answered yet (null = "rule needed"). Only tests / an answered rule fill these.
   *   gstActualUsd      the import GST actually paid, USD (FRS 121,430.25)
   *   logisticsUsd      the Japan logistics reimbursement (FRS 16,830.08)
   *   deliveryCompleted whether the "Delivery Completed" event has happened
   * Answered 18 Nov: product sales to ADH Japan = the SG→JP invoice total (sgjpTotal); advance invoice = Invoice #1.
   */
  rules?: { gstActualUsd?: number | null; logisticsUsd?: number | null; deliveryCompleted?: boolean | null };
}

export interface PreviewLine {
  account: string;
  side: 'Dr' | 'Cr';
  usd: number | null;
  sgd: number | null;
  label: string;
  /** Why the amount is empty / how it was worked out. */
  note?: string;
  problem?: 'rule needed' | 'missing';
}

export interface PreviewPosting {
  key: string;
  frs: string;
  title: string;
  kind: 'Bill' | 'Sales invoice' | 'Manual journal';
  contact: string | null;
  /** The AIMS event that will post it, and whether it has happened. */
  trigger: string;
  triggerState: 'done' | 'not yet' | 'rule needed';
  date: string | null;
  status: PostingStatus;
  lines: PreviewLine[];
  notes: string[];
}

export interface PreviewCheck {
  key: 'cogs' | 'prepayments' | 'advance' | 'pnl';
  label: string;
  ok: boolean | null;
  detail: string;
  /** What has to be answered / filled before the check can run. */
  waitingOn: string[];
}

export interface LotPreview {
  orderRef: string;
  pattern: BooksPattern | null;
  /** Round BZ: set when the lot isn't in the FRS at all (e.g. Sankyo Tateyama / PT Sri Indah) — no postings, rule needed. */
  notInFrs?: string | null;
  deliveryMonth: string | null;
  rateMonth: string | null;
  usdRate: number | null;
  postings: PreviewPosting[];
  checks: PreviewCheck[];
  missing: string[];
  rulesNeeded: string[];
  /** SUS: where the advance invoice's amounts come from (null = Invoice #1 not in AIMS). */
  invoice1: LotInput['invoice1'];
}

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const sum = (xs: Array<number | null>) => (xs.some((x) => x === null) ? null : r2(xs.reduce<number>((s, x) => s + (x as number), 0)));
const fmt = (n: number | null, dp = 2) => (n === null ? '—' : n.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp }));

/** USD → SGD at "1 SGD = rate USD". */
export const toSgd = (usd: number | null, rate: number | null) => (usd === null || !rate ? null : r2(usd / rate));

/** The posting's status: a missing figure beats a missing rule beats a missing rate beats the trigger. */
function statusOf(p: Omit<PreviewPosting, 'status'>, rate: number | null): PostingStatus {
  if (p.lines.some((l) => l.problem === 'missing')) return 'missing data';
  if (p.lines.some((l) => l.problem === 'rule needed') || p.triggerState === 'rule needed') return 'rule needed';
  if (!rate) return 'rate needed';
  return p.triggerState === 'done' ? 'ready' : 'waiting';
}

/**
 * Round BZ: why a lot is outside the FRS (null = inside). The FRS (ADH_SG_Xero_FRS.md) books SUS / Kato / Hoei lots
 * bought from Vedanta; another supplier (PT Sri Indah for Sankyo Tateyama's fixed all-in price) has no rule yet —
 * never borrow SUS / Kato's postings for it.
 */
export function notInFrs(input: Pick<LotInput, 'customerName' | 'supplierName'>): string | null {
  if (input.supplierName === undefined) return null;
  if (/VEDANTA/i.test(input.supplierName ?? '')) return null;
  return `${input.customerName ?? 'This customer'} / ${input.supplierName ?? 'no supplier'} isn't in the FRS (it covers SUS, Kato and Hoei lots bought from Vedanta): how ADH books this lot`;
}

export function lotPreview(input: LotInput): LotPreview {
  const outside = notInFrs(input);
  if (outside) {
    return {
      orderRef: input.orderRef,
      pattern: null,
      notInFrs: outside,
      deliveryMonth: input.deliveryMonth,
      rateMonth: input.deliveryMonth,
      usdRate: input.usdRate && input.usdRate > 0 ? input.usdRate : null,
      postings: [],
      checks: [],
      missing: [],
      rulesNeeded: [outside],
      invoice1: null,
    };
  }
  const rate = input.usdRate && input.usdRate > 0 ? input.usdRate : null;
  const rules = input.rules ?? {};
  const missing: string[] = [];
  const rulesNeeded: string[] = [];
  const postings: PreviewPosting[] = [];
  const firstOfMonth = input.deliveryMonth ? `${input.deliveryMonth}-01` : null;
  const line = (account: string, side: 'Dr' | 'Cr', usd: number | null, label: string, extra: Partial<PreviewLine> = {}): PreviewLine => ({
    account,
    side,
    usd,
    sgd: toSgd(usd, rate),
    label,
    ...extra,
  });
  const push = (p: Omit<PreviewPosting, 'status'>) => postings.push({ ...p, status: statusOf(p, rate) });
  const need = (what: string) => {
    if (!rulesNeeded.includes(what)) rulesNeeded.push(what);
  };
  const miss = (what: string) => {
    if (!missing.includes(what)) missing.push(what);
  };

  if (!input.deliveryMonth) miss(`${input.orderRef}: delivery month`);
  else if (!rate) miss(`FX rate for ${input.deliveryMonth} (1 SGD = ? USD)`);

  // ── Purchases: PI deposit + CI balance per shipment (COGS = deposit + CI TOTAL = CI Sub Total) ──
  const depositLines: Array<number | null> = [];
  const ciLines: Array<number | null> = [];
  for (const s of input.shipments) {
    if (!s.ci) miss(`${s.ref}: the CI read (Sub Total / Advance / TOTAL)`);
    const deposit = s.ci ? (s.ci.advance ?? null) : null;
    const balance = s.ci ? (s.ci.total ?? (s.ci.advance !== null ? r2(s.ci.subTotal - s.ci.advance) : null)) : null;
    if (s.ci && s.ci.advance === null) miss(`${s.ref}: the CI's Advance (deposit) was not read`);
    depositLines.push(deposit);
    ciLines.push(balance);
  }
  const depositTotal = sum(depositLines);
  const ciTotal = sum(ciLines);
  const refs = input.shipments.map((s) => s.ref).join(', ');
  const noShip = !input.shipments.length;
  if (noShip) miss(`${input.orderRef}: no shipment yet`);

  push({
    key: 'PI_DEPOSIT_BILL',
    frs: 'FRS 3 · Step 1',
    title: 'PI deposit (bill, paid)',
    kind: 'Bill',
    contact: CONTACTS.supplier,
    trigger: 'Step 1 PI payment done',
    triggerState: input.done.piPayment ? 'done' : 'not yet',
    date: null,
    lines: [
      line(LOT_ACCOUNTS.prepayments, 'Dr', noShip ? null : depositTotal, `PI deposit ${refs}`, depositTotal === null ? { problem: 'missing', note: 'The CI Advance of each shipment' } : { note: 'The CI Advance (the deposit the CI deducts)' }),
      line(LOT_ACCOUNTS.payable, 'Cr', noShip ? null : depositTotal, 'Vedanta', depositTotal === null ? { problem: 'missing' } : {}),
    ],
    notes: input.aimsDeposit !== null && depositTotal !== null && Math.abs(input.aimsDeposit - depositTotal) >= 0.01 ? [`AIMS deposit ${fmt(input.aimsDeposit)} ≠ CI advances ${fmt(depositTotal)}`] : [],
  });
  push({
    key: 'CI_BALANCE_BILL',
    frs: 'FRS 3 · Step 2',
    title: 'Final CI balance (bill)',
    kind: 'Bill',
    contact: CONTACTS.supplier,
    trigger: 'Step 6 CI payment done',
    triggerState: input.done.ciPayment ? 'done' : 'not yet',
    date: null,
    lines: [
      line(LOT_ACCOUNTS.prepayments, 'Dr', noShip ? null : ciTotal, `CI balance (TOTAL) ${refs}`, ciTotal === null ? { problem: 'missing' } : { note: 'The CI boxed TOTAL (Sub Total − Advance)' }),
      line(LOT_ACCOUNTS.payable, 'Cr', noShip ? null : ciTotal, 'Vedanta', ciTotal === null ? { problem: 'missing' } : {}),
    ],
    notes: [],
  });
  const deliveryTrigger = rules.deliveryCompleted === true ? 'done' : rules.deliveryCompleted === false ? 'not yet' : 'rule needed';
  if (deliveryTrigger === 'rule needed') need('What "Delivery Completed" is in AIMS (the event that posts the delivery journals)');
  push({
    key: 'COGS_RECLASS',
    frs: 'FRS 3 · Step 3 (MJ #18423)',
    title: 'COGS reclassification',
    kind: 'Manual journal',
    contact: null,
    trigger: 'Delivery Completed',
    triggerState: deliveryTrigger,
    date: firstOfMonth,
    lines: [
      line(LOT_ACCOUNTS.prepayments, 'Cr', noShip ? null : depositTotal, 'PI deposit', depositTotal === null ? { problem: 'missing' } : {}),
      line(LOT_ACCOUNTS.prepayments, 'Cr', noShip ? null : ciTotal, 'Final CI', ciTotal === null ? { problem: 'missing' } : {}),
      line(LOT_ACCOUNTS.cogs, 'Dr', noShip ? null : depositTotal, 'PI deposit', depositTotal === null ? { problem: 'missing' } : {}),
      line(LOT_ACCOUNTS.cogs, 'Dr', noShip ? null : ciTotal, 'Final CI', ciTotal === null ? { problem: 'missing' } : {}),
    ],
    notes: [],
  });

  // ── Sales ──
  const qtys = input.shipments.map((s) => s.netMt);
  const qty = qtys.some((x) => x === null) ? null : Math.round(qtys.reduce<number>((t, x) => t + (x as number), 0) * 1000) / 1000;
  const sgjp = sum(input.shipments.map((s) => s.sgjpTotal));
  const fee = qty === null ? null : r2(qty * FEE_PER_MT);
  const share15 = fee === null ? null : r2(fee * ADHJ_SHARE);
  const share85 = fee === null || share15 === null ? null : r2(fee - share15);
  const gstJpy = sum(input.shipments.map((s) => s.importTaxJpy));
  const gstEstimate = sum(input.shipments.map((s) => (s.importTaxJpy !== null && s.customsRate ? r2(s.importTaxJpy / s.customsRate) : null)));
  const gstActual = rules.gstActualUsd ?? null;
  const logistics = rules.logisticsUsd ?? null;
  const inv1 = input.invoice1;
  const advancePrincipal = inv1 ? inv1.principal : null;
  const advanceTax = inv1 ? inv1.tax : null;
  const noInv1 = { problem: 'missing' as const, note: 'Invoice #1 not in AIMS' };
  // Answered 18 Nov: ADH SG's product sales to ADH Japan for the lot = the SG→JP invoice total.
  const productSales = sgjp;

  if (input.pattern === 'SUS' || input.pattern === 'KATO') {
    if (qty === null) miss(`${input.orderRef}: net weight of every shipment (for the 40 USD/MT fee)`);
    if (gstEstimate === null) miss(`${input.orderRef}: import tax (¥) and customs rate of every shipment`);
    if (sgjp === null) miss(`${input.orderRef}: SG→JP invoice total (permit CIF) of every shipment`);
    if (gstActual === null) need('Import GST actually paid (USD) — FRS 121,430.25 ≈ ¥18,423,000 ÷ 151.72: which rate?');
    if (logistics === null) need('Japan logistics reimbursement (USD) — FRS 16,830.08: from which AIMS figures?');
  }

  if (input.pattern === 'SUS') {
    if (!inv1) miss(`${input.orderRef}: Invoice #1 not in AIMS`);
    const src = inv1 ? (inv1.source === 'aims' ? `Invoice #1${inv1.number ? ` ${inv1.number}` : ''} (AIMS)` : `Invoice #1 typed${inv1.by ? ` by ${inv1.by}` : ''}`) : undefined;
    push({
      key: 'SUS_ADVANCE_INVOICE',
      frs: 'FRS 4 · SUS 1 (INV-0586)',
      title: 'Advance invoice to ADH Japan',
      kind: 'Sales invoice',
      contact: CONTACTS.adhJapan,
      trigger: 'Step 2 Invoice #1 issued',
      triggerState: input.done.invoice1 ? 'done' : 'not yet',
      date: null,
      lines: [
        line(LOT_ACCOUNTS.receivable, 'Dr', sum([advancePrincipal, advanceTax]), 'ADH Japan', inv1 ? { note: src } : noInv1),
        line(LOT_ACCOUNTS.advance, 'Cr', advanceTax, 'Consumption tax', inv1 ? { note: src } : noInv1),
        line(LOT_ACCOUNTS.advance, 'Cr', advancePrincipal, 'Product principal', inv1 ? { note: src } : noInv1),
      ],
      notes: [],
    });
  }
  if (input.pattern === 'SUS' || input.pattern === 'KATO') {
    push({
      key: 'GST_ADVANCE_BILL',
      frs: 'FRS 4 · SUS 2 / Kato',
      title: 'Import GST advance (bill from ADH Japan, paid)',
      kind: 'Bill',
      contact: CONTACTS.adhJapan,
      trigger: 'Step 8 import-tax funds sent',
      triggerState: input.done.taxFunds ? 'done' : 'not yet',
      date: null,
      lines: [
        line(LOT_ACCOUNTS.advance, 'Dr', gstEstimate, 'Import GST advance', gstEstimate === null ? { problem: 'missing' } : { note: `¥${(gstJpy ?? 0).toLocaleString('en-US')} ÷ customs rate` }),
        line(LOT_ACCOUNTS.payable, 'Cr', gstEstimate, 'ADH Japan', gstEstimate === null ? { problem: 'missing' } : {}),
      ],
      notes: [],
    });
  }
  if (input.pattern === 'SUS') {
    push({
      key: 'SUS_REVENUE_RECOGNITION',
      frs: 'FRS 4 · SUS 3 (MJ #18424)',
      title: 'Revenue recognition at delivery',
      kind: 'Manual journal',
      contact: null,
      trigger: 'Delivery Completed',
      triggerState: deliveryTrigger,
      date: firstOfMonth,
      lines: [
        line(LOT_ACCOUNTS.advance, 'Dr', advancePrincipal, 'Advance principal', inv1 ? {} : noInv1),
        line(LOT_ACCOUNTS.sales, 'Cr', advancePrincipal, 'Product sales', inv1 ? {} : noInv1),
      ],
      notes: [],
    });
  }
  if (input.pattern === 'SUS' || input.pattern === 'KATO') {
    const sus = input.pattern === 'SUS';
    const salesLine = sus ? (productSales === null || advancePrincipal === null ? null : r2(productSales - advancePrincipal)) : productSales;
    const advTax = sus ? advanceTax : 0;
    const gapA = gstActual === null || advTax === null ? null : r2(gstActual - advTax);
    const gapB = gstActual === null || gstEstimate === null ? null : r2(gstActual - gstEstimate);
    const docA = [
      line(LOT_ACCOUNTS.sales, 'Cr', salesLine, sus ? 'Final variance (product sales − advance principal)' : 'Full product revenue', salesLine === null ? { problem: 'missing' } : { note: sus ? `SG→JP invoice total ${fmt(sgjp)} − Invoice #1 principal ${fmt(advancePrincipal)}` : 'The SG→JP invoice total' }),
      line(LOT_ACCOUNTS.advance, 'Cr', logistics, 'Japan logistics reimbursement', logistics === null ? { problem: 'rule needed' } : {}),
      line(LOT_ACCOUNTS.advance, 'Cr', gapA, sus ? 'GST gap (actual − advance invoice tax)' : 'Import GST (actual)', gapA === null ? { problem: gstActual === null ? 'rule needed' : 'missing' } : {}),
      line(LOT_ACCOUNTS.advance, 'Cr', share15, '15% transaction profit share', share15 === null ? { problem: 'missing' } : { note: `${fmt(qty, 3)} MT × ${FEE_PER_MT} USD × 15%` }),
    ];
    push({
      key: 'SETTLEMENT_A',
      frs: sus ? 'FRS 4 · SUS 4 Doc A (INV-0593)' : 'FRS 4 · Kato Doc A',
      title: 'Final settlement — sales invoice to ADH Japan',
      kind: 'Sales invoice',
      contact: CONTACTS.adhJapan,
      trigger: 'Delivery Completed',
      triggerState: deliveryTrigger,
      date: null,
      lines: [line(LOT_ACCOUNTS.receivable, 'Dr', sum(docA.map((l) => l.usd)), 'ADH Japan', docA.some((l) => l.usd === null) ? { problem: docA.some((l) => l.problem === 'missing') ? 'missing' : 'rule needed' } : {}), ...docA],
      notes: [],
    });
    const docB = [
      line(LOT_ACCOUNTS.advance, 'Dr', logistics, 'Japan logistics', logistics === null ? { problem: 'rule needed' } : {}),
      line(LOT_ACCOUNTS.advance, 'Dr', gapB, 'GST gap (actual − GST advance)', gapB === null ? { problem: gstEstimate === null ? 'missing' : 'rule needed' } : {}),
      line(LOT_ACCOUNTS.advance, 'Dr', share15, '15% profit share', share15 === null ? { problem: 'missing' } : {}),
    ];
    push({
      key: 'SETTLEMENT_B',
      frs: sus ? 'FRS 4 · SUS 4 Doc B' : 'FRS 4 · Kato Doc B',
      title: 'Final settlement — bill from ADH Japan',
      kind: 'Bill',
      contact: CONTACTS.adhJapan,
      trigger: 'Delivery Completed',
      triggerState: deliveryTrigger,
      date: null,
      lines: [...docB, line(LOT_ACCOUNTS.payable, 'Cr', sum(docB.map((l) => l.usd)), 'ADH Japan', docB.some((l) => l.usd === null) ? { problem: docB.some((l) => l.problem === 'missing') ? 'missing' : 'rule needed' } : {})],
      notes: [],
    });
    push({
      key: 'SETTLEMENT_C',
      frs: sus ? 'FRS 4 · SUS 4 Doc C (INV-0594)' : 'FRS 4 · Kato Doc C',
      title: '85% management fee — sales invoice to ADH Japan',
      kind: 'Sales invoice',
      contact: CONTACTS.adhJapan,
      trigger: 'Delivery Completed (timing to confirm with ADH)',
      triggerState: deliveryTrigger,
      date: null,
      lines: [
        line(LOT_ACCOUNTS.receivable, 'Dr', share85, 'ADH Japan', share85 === null ? { problem: 'missing' } : {}),
        line(LOT_ACCOUNTS.sales, 'Cr', share85, '85% management fee', share85 === null ? { problem: 'missing' } : { note: `${fmt(qty, 3)} MT × ${FEE_PER_MT} USD × 85%` }),
      ],
      notes: [],
    });
  }
  if (input.pattern === 'HOEI') {
    if (input.directInvoiceTotal === null) miss(`${input.orderRef}: ADH's invoice to Hoei (FINAL, USD)`);
    push({
      key: 'HOEI_INVOICE',
      frs: 'FRS 4 · Hoei',
      title: 'Sales invoice to HOEI',
      kind: 'Sales invoice',
      contact: CONTACTS.hoei,
      trigger: "ADH's invoice to Hoei finalized",
      triggerState: input.directInvoiceTotal !== null ? 'done' : 'not yet',
      date: null,
      lines: [
        line(LOT_ACCOUNTS.receivable, 'Dr', input.directInvoiceTotal, 'HOEI', input.directInvoiceTotal === null ? { problem: 'missing' } : {}),
        line(LOT_ACCOUNTS.sales, 'Cr', input.directInvoiceTotal, 'Product sales', input.directInvoiceTotal === null ? { problem: 'missing' } : {}),
      ],
      notes: [],
    });
  }
  if (!input.pattern) need(`Which FRS pattern ${input.customerName ?? 'this customer'} follows (SUS 2-phase / Kato 1-phase / Hoei direct)`);

  // ── Checks ──
  const all = postings.flatMap((p) => p.lines);
  const balanceOf = (acct: string, unit: 'usd' | 'sgd') => {
    const ls = all.filter((l) => l.account === acct);
    if (ls.some((l) => l[unit] === null)) return null;
    return r2(ls.reduce((s, l) => s + (l.side === 'Dr' ? (l[unit] as number) : -(l[unit] as number)), 0));
  };
  const waitingFor = (acct: string) => [...new Set(postings.filter((p) => p.lines.some((l) => l.account === acct && l.usd === null)).map((p) => p.title))];
  const checks: PreviewCheck[] = [];

  const cogsRows = input.shipments.map((s) => {
    if (!s.ci || s.ci.advance === null) return { ref: s.ref, ok: null as boolean | null, text: `${s.ref}: CI not fully read` };
    const bal = s.ci.total ?? r2(s.ci.subTotal - s.ci.advance);
    const ok = Math.abs(r2(s.ci.advance + bal) - s.ci.subTotal) < 0.01;
    return { ref: s.ref, ok, text: `${s.ref}: ${fmt(s.ci.advance)} + ${fmt(bal)} = ${fmt(r2(s.ci.advance + bal))} ${ok ? '=' : '≠'} CI Sub Total ${fmt(s.ci.subTotal)}` };
  });
  checks.push({
    key: 'cogs',
    label: 'COGS = PI deposit + CI TOTAL = CI Sub Total',
    ok: noShip || cogsRows.some((r) => r.ok === null) ? null : cogsRows.every((r) => r.ok),
    detail: noShip ? 'No shipment yet' : cogsRows.map((r) => r.text).join(' · '),
    waitingOn: cogsRows.filter((r) => r.ok === null).map((r) => r.text),
  });
  const p620 = balanceOf(LOT_ACCOUNTS.prepayments, 'usd');
  const p620s = rate ? balanceOf(LOT_ACCOUNTS.prepayments, 'sgd') : null;
  checks.push({
    key: 'prepayments',
    label: '620 Prepayments comes back to 0',
    // USD and SGD must both be 0 (FRS: 0.00 SGD) — without the rate the SGD side can't be checked yet.
    ok: p620 === null ? null : Math.abs(p620) >= 0.005 || (p620s !== null && Math.abs(p620s) >= 0.005) ? false : p620s === null ? null : true,
    detail: p620 === null ? 'Not all 620 amounts are known' : `USD ${fmt(p620)}${rate ? ` · SGD ${fmt(p620s)}` : ' · SGD needs the rate'}`,
    waitingOn: [...waitingFor(LOT_ACCOUNTS.prepayments), ...(p620 !== null && !rate ? [`the FX rate for ${input.deliveryMonth ?? 'the delivery month'}`] : [])],
  });
  if (input.pattern !== 'HOEI') {
    const a810 = balanceOf(LOT_ACCOUNTS.advance, 'usd');
    const a810s = rate ? balanceOf(LOT_ACCOUNTS.advance, 'sgd') : null;
    checks.push({
      key: 'advance',
      label: '810 Advance comes back to 0',
      ok: a810 === null ? null : Math.abs(a810) < 0.005,
      detail: a810 === null ? 'Not all 810 amounts are known' : `USD ${fmt(a810)}${a810s !== null ? ` · SGD ${fmt(a810s)}${Math.abs(a810s) >= 0.005 ? ' (rounding of the SGD lines)' : ''}` : ''}`,
      waitingOn: waitingFor(LOT_ACCOUNTS.advance),
    });
  }
  const pl = all.filter((l) => l.account === LOT_ACCOUNTS.sales || l.account === LOT_ACCOUNTS.cogs);
  const feeLines = postings.filter((p) => p.key === 'SETTLEMENT_C').flatMap((p) => p.lines.filter((l) => l.account === LOT_ACCOUNTS.sales));
  const productLines = postings.filter((p) => p.key !== 'SETTLEMENT_C').flatMap((p) => p.lines.filter((l) => l.account === LOT_ACCOUNTS.sales));
  const sales = sum(productLines.map((l) => l.usd));
  const cogs = sum(all.filter((l) => l.account === LOT_ACCOUNTS.cogs).map((l) => l.usd));
  const mgmt = feeLines.length ? sum(feeLines.map((l) => l.usd)) : 0;
  const plTotal = pl.some((l) => l.usd === null) ? null : r2(pl.reduce((s, l) => s + (l.side === 'Cr' ? (l.usd as number) : -(l.usd as number)), 0));
  const expected = sales === null || cogs === null || mgmt === null ? null : r2(sales - cogs + mgmt);
  checks.push({
    key: 'pnl',
    label: 'ADH SG P&L = (product sales − COGS) + 85% management fee',
    ok: plTotal === null || expected === null ? null : Math.abs(plTotal - expected) < 0.005,
    detail:
      plTotal === null || expected === null
        ? 'Not all sales / COGS amounts are known'
        : `(${fmt(sales)} − ${fmt(cogs)}) + ${fmt(mgmt)} = ${fmt(expected)} · P&L lines (200, 310) = ${fmt(plTotal)}`,
    waitingOn: [...new Set(postings.filter((p) => p.lines.some((l) => (l.account === LOT_ACCOUNTS.sales || l.account === LOT_ACCOUNTS.cogs) && l.usd === null)).map((p) => p.title))],
  });

  return {
    orderRef: input.orderRef,
    pattern: input.pattern,
    deliveryMonth: input.deliveryMonth,
    rateMonth: input.deliveryMonth,
    usdRate: rate,
    postings,
    checks,
    missing,
    rulesNeeded,
    invoice1: input.pattern === 'SUS' ? (inv1 ?? null) : null,
  };
}

/** Which FRS pattern a customer follows: SUS = 2-phase billing, Kato = single billing in Japan, Hoei = abroad, direct. */
export function patternFor(p: { billingMode?: string | null; country?: string | null } | null | undefined): BooksPattern | null {
  if (!p) return null;
  if (p.billingMode === 'TWO_STAGE') return 'SUS';
  const c = (p.country ?? '').trim().toUpperCase();
  if (p.billingMode === 'SINGLE' && (c === 'JP' || c === 'JAPAN')) return 'KATO';
  if (p.billingMode === 'SINGLE' && c && c !== 'JP' && c !== 'JAPAN') return 'HOEI';
  return null;
}
