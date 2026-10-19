/**
 * INVOICE_SINGLE — the one invoice a SINGLE-billing customer (Kato, Hoei) gets
 * after the B/L, laid out after ADH's
 *   請求書正式ビレット_加藤軽金属様6005_40.825t_202609.xlsx and
 *   請求書6005 8インチビレット(2026年9月納入(7月出荷)40t)_2026年7月平均LME3QMJP.pdf:
 * header 番号 / 発行日 / 件名 / 支払条件 / 有効期限 / 合計(税込); seven columns
 * 摘要 | 数量(MT) | 単価(USD) | 金額(USD) | 単価(円) | 金額(円) | 備考; a per-MT
 * row; 非課税合計 / 課税対象合計 / 消費税 / 今回請求合計額 in USD and JPY; 税率別内訳;
 * 条件; 支払い条件; 弊社指定口座.
 *
 * Lines (the sheet's three kinds):
 *   goods  billet: unit USD = LME (shipment-month average) + QMJP + premium (+ upcharge);
 *          amount USD = ROUND(qty × unit, 2); amount JPY = ROUND(qty × unit × FX, 0)
 *   jpy    通関、車輸送料 (taxable) / 通関 (non-taxable): typed / estimated in JPY;
 *          amount USD = ROUND(JPY / FX, 2); unit USD = ROUND(amount / qty, 2);
 *          単価(円) = ROUND(amount USD × FX / qty, 2) — the sheet's per-line rounding, so the
 *          per-MT yen row is 609,920.82 + 5,047.46 + 2,199.63 + 6,360 = 623,527.91 as printed
 *   usd    他諸掛 (taxable): 40 USD/MT; amount USD = ROUND(qty × 40, 2), JPY = ROUND(qty × 40 × FX, 0)
 * Tax = ROUND(taxable × 10%, 2) in USD and ROUND(... , 0) in JPY (the sheet's ROUND).
 * 番号 defaults to the 発行日 as yyyymmdd (the sample: 2026/8/18 → 20260818); editable.
 * Sample check: 40.825 t, LME 3,155.98 + 395 + 285 = 3,835.98 → 156,603.88; 通関、車輸送料
 * ¥206,062.5 → 1,295.99; 通関 ¥89,800 → 564.78; 他諸掛 1,633.00; FX 159.00 → US$176,050.94.
 */
import { docShell, esc, lines as br, money } from './trade-doc-shell';
import { helperRemarks, InvoiceLine, roundTo } from './trade-invoice';

/** The 番号 when none is typed: the 発行日 as yyyymmdd (2026-08-18 → "20260818"). */
export function singleInvoiceNoFor(issueDate: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(issueDate ?? '');
  return m ? `${m[1]}${m[2]}${m[3]}` : '';
}

export type SingleLineKind = 'goods' | 'jpy' | 'usd';

export interface SingleLine {
  kind: SingleLineKind;
  description: string;
  quantity: number | null;
  /** goods: price helper (USD/MT). */
  lme?: number | null;
  qmjp?: number | null;
  premium?: number | null;
  upcharge?: number | null;
  /** usd: unit price USD/MT (他諸掛 40). */
  unitPrice?: number | null;
  /** jpy: the yen amount (通関、車輸送料 = qty × 2,300 + trucks × 26,000 + qty × 200). */
  jpyAmount?: number | null;
  taxable: boolean;
  remarks: string;
  /** Remarks follow the helper until edited (goods line). */
  autoRemarks?: boolean;
  /** Provenance (the covered shipment / order). */
  shipmentId?: string | null;
  orderId?: string | null;
  grade?: string | null;
}

export interface SingleInvoiceHeader {
  layout: 'single';
  title: string;
  invoiceNo: string | null;
  issueDate: string;
  registrationNo: string;
  toName: string;
  toSuffix: string;
  subject: string;
  /** 支払条件 (header). */
  paymentTerms: string;
  /** 有効期限 (header). */
  validity: string;
  fromBlock: string;
  fxRate: number | null;
  fxNote: string;
  taxRate: number;
  lmeMonth: string;
  /** 条件 lines. */
  conditions: string;
  /** 支払い条件 section under 条件. */
  paymentBlock: string;
  bankBlock: string;
  bankId?: string | null;
  showSeal?: boolean;
  dueDate: string;
  currency: string;
}

const has = (v: unknown) => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v));
const n = (v: unknown) => (has(v) ? Number(v) : 0);

export interface SingleLineCalc {
  unitUsd: number | null;
  amountUsd: number;
  unitJpy: number | null;
  amountJpy: number | null;
}

/** One line's figures at the FX (null FX → JPY columns blank, JPY lines unpriced). */
export function singleLineCalc(l: SingleLine, fx: number | null): SingleLineCalc {
  const q = has(l.quantity) ? Number(l.quantity) : null;
  const rate = has(fx) && Number(fx) > 0 ? Number(fx) : null;
  if (l.kind === 'jpy') {
    const jpy = has(l.jpyAmount) ? Number(l.jpyAmount) : null;
    const amountUsd = jpy === null || rate === null ? 0 : roundTo(jpy / rate, 2);
    return {
      unitUsd: q ? roundTo(amountUsd / q, 2) : null,
      amountUsd,
      unitJpy: jpy === null || !q ? null : rate === null ? roundTo(jpy / q, 2) : roundTo((amountUsd * rate) / q, 2),
      amountJpy: jpy === null ? null : roundTo(jpy, 0),
    };
  }
  const unit = l.kind === 'goods' ? (has(l.lme) ? roundTo(n(l.lme) + n(l.qmjp) + n(l.premium) + n(l.upcharge), 4) : null) : has(l.unitPrice) ? Number(l.unitPrice) : null;
  const amountUsd = unit === null || q === null ? 0 : roundTo(q * unit, 2);
  return {
    unitUsd: unit,
    amountUsd,
    unitJpy: unit === null || rate === null ? null : roundTo(unit * rate, 2),
    amountJpy: unit === null || q === null || rate === null ? null : roundTo(q * unit * rate, 0),
  };
}

export interface SingleTotals {
  lines: SingleLineCalc[];
  /** The per-MT row: Σ unit USD / Σ unit JPY. */
  perMt: { usd: number; jpy: number | null };
  usd: { nonTaxable: number; taxable: number; tax: number; total: number };
  jpy: { nonTaxable: number; taxable: number; tax: number; total: number } | null;
}

export function singleTotals(rows: SingleLine[], taxRate: number, fx: number | null): SingleTotals {
  const calc = rows.map((l) => singleLineCalc(l, fx));
  const rate = n(taxRate) / 100;
  const sum = (pick: (c: SingleLineCalc, l: SingleLine) => number | null, taxable: boolean) => rows.reduce((a, l, i) => a + (l.taxable === taxable ? (pick(calc[i], l) ?? 0) : 0), 0);
  const usdTaxable = roundTo(
    sum((c) => c.amountUsd, true),
    2,
  );
  const usdNon = roundTo(
    sum((c) => c.amountUsd, false),
    2,
  );
  const usdTax = roundTo(usdTaxable * rate, 2);
  const haveFx = has(fx) && Number(fx) > 0;
  const jpyTaxable = roundTo(
    sum((c) => c.amountJpy, true),
    0,
  );
  const jpyNon = roundTo(
    sum((c) => c.amountJpy, false),
    0,
  );
  const jpyTax = roundTo(jpyTaxable * rate, 0);
  // Per-MT row: unit prices of the lines billed by quantity.
  const perUsd = roundTo(
    calc.reduce((a, c) => a + (c.unitUsd ?? 0), 0),
    2,
  );
  const perJpy = haveFx
    ? roundTo(
        calc.reduce((a, c) => a + (c.unitJpy ?? 0), 0),
        2,
      )
    : null;
  return {
    lines: calc,
    perMt: { usd: perUsd, jpy: perJpy },
    usd: { nonTaxable: usdNon, taxable: usdTaxable, tax: usdTax, total: roundTo(usdNon + usdTaxable + usdTax, 2) },
    jpy: haveFx ? { nonTaxable: jpyNon, taxable: jpyTaxable, tax: jpyTax, total: jpyNon + jpyTaxable + jpyTax } : null,
  };
}

/** The single invoice as plain invoice lines (USD amounts as overrides) — for the Sales Document and the totals shared with Invoice #1 / #2. */
export function singleAsInvoiceLines(rows: SingleLine[], fx: number | null, dueDate: string | null): InvoiceLine[] {
  return rows.map((l) => {
    const c = singleLineCalc(l, fx);
    return {
      description: l.description,
      quantity: has(l.quantity) ? Number(l.quantity) : null,
      unit: 'MT',
      unitPrice: c.unitUsd,
      amountOverride: c.amountUsd,
      remarks: l.remarks,
      dueDate,
      taxable: l.taxable,
      grade: l.grade ?? null,
    };
  });
}

/** Rows as stored (Json) → typed lines. */
export function toSingleLines(rows: unknown): SingleLine[] {
  return (Array.isArray(rows) ? rows : []).map((r: any) => ({
    kind: r?.kind === 'jpy' || r?.kind === 'usd' ? r.kind : 'goods',
    description: String(r?.description ?? ''),
    quantity: has(r?.quantity) ? Number(r.quantity) : null,
    lme: has(r?.lme) ? Number(r.lme) : null,
    qmjp: has(r?.qmjp) ? Number(r.qmjp) : null,
    premium: has(r?.premium) ? Number(r.premium) : null,
    upcharge: has(r?.upcharge) ? Number(r.upcharge) : null,
    unitPrice: has(r?.unitPrice) ? Number(r.unitPrice) : null,
    jpyAmount: has(r?.jpyAmount) ? Number(r.jpyAmount) : null,
    taxable: r?.taxable !== false,
    remarks: String(r?.remarks ?? ''),
    autoRemarks: !!r?.autoRemarks,
    shipmentId: r?.shipmentId ?? null,
    orderId: r?.orderId ?? null,
    grade: r?.grade ?? null,
  }));
}

/** Goods-line 備考: "LME Cash 2026/7月平均(3155.98USD) +395(3QMJP) + 285(Billet Premium)". */
export function singleGoodsRemarks(l: SingleLine, lmeMonth: string, template?: string): string {
  return helperRemarks(
    {
      description: '',
      quantity: null,
      unit: '',
      unitPrice: null,
      amountOverride: null,
      remarks: '',
      dueDate: null,
      lme: l.lme,
      qmjp: l.qmjp,
      premium: l.premium,
      upcharge: l.upcharge,
      grade: l.grade,
    },
    lmeMonth,
    template ?? 'LME Cash {month}月平均({LME}USD) +{QMJP}({q}QMJP) + {premium}(Billet Premium){upcharge}',
    ' +{upcharge}(Upcharge)',
  );
}

/** What stops a single invoice from finalizing. */
export function singleFinalizeProblems(rows: SingleLine[], fx: number | null): string[] {
  const p: string[] = [];
  if (!has(fx) || Number(fx) <= 0) p.push('enter the exchange rate (円/USD) — the 円 lines need it');
  rows.forEach((l, i) => {
    if (l.kind === 'goods' && !has(l.lme) && (l.description.trim() || has(l.quantity))) p.push(`line ${i + 1} needs the LME`);
    if (l.kind === 'jpy' && !has(l.jpyAmount) && l.description.trim()) p.push(`line ${i + 1} needs its yen amount`);
    if (l.kind === 'usd' && !has(l.unitPrice) && l.description.trim()) p.push(`line ${i + 1} needs a unit price`);
  });
  if (singleTotals(rows, 10, fx).usd.total === 0) p.push('the total is US$0.00');
  return p;
}

const slashDate = (d: string | null | undefined) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d ?? '');
  return m ? `${m[1]}/${Number(m[2])}/${Number(m[3])}` : esc(d ?? '');
};
const tons = (v: number | null) => (v === null || !Number.isFinite(v) ? '' : v.toLocaleString('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 3 }));

/** Bank block: "label<TAB>value" lines print as two columns. */
const bankRows = (text: string) =>
  (text ?? '')
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .map((l) => {
      const [k, ...v] = l.split('\t');
      return v.length ? `<tr><td class="bk">${esc(k.trim())}</td><td>${esc(v.join(' ').trim())}</td></tr>` : `<tr><td colspan="2">${esc(l.trim())}</td></tr>`;
    })
    .join('');

const COLS = '<colgroup><col style="width:24%"><col style="width:11%"><col style="width:10%"><col style="width:10.5%"><col style="width:9%"><col style="width:9.5%"><col style="width:12%"></colgroup>';

/**
 * A4 HTML after the Kato sample. The 備考 of consecutive lines with the same
 * remarks text is merged into one cell (the 通関、車輸送料 / 通関 block).
 */
export function renderSingleInvoiceHtml(h: SingleInvoiceHeader, rows: SingleLine[], opts: { draft?: boolean; seal?: string | null } = {}): string {
  const fx = has(h.fxRate) ? Number(h.fxRate) : null;
  const t = singleTotals(rows, h.taxRate, fx);
  const seal = h.showSeal !== false && opts.seal && /^data:image\/(png|jpe?g);base64,/.test(opts.seal) ? opts.seal : null;
  // Merge equal, consecutive non-empty remarks (rowspan).
  const span: number[] = rows.map(() => 1);
  for (let i = rows.length - 1; i > 0; i--) {
    if (rows[i].remarks && rows[i].remarks === rows[i - 1].remarks) {
      span[i - 1] = span[i] + 1;
      span[i] = 0;
    }
  }
  const tr = rows
    .map((l, i) => {
      const c = t.lines[i];
      const rem = span[i] === 0 ? '' : `<td class="rem pre"${span[i] > 1 ? ` rowspan="${span[i]}"` : ''}>${br(l.remarks)}</td>`;
      return `<tr><td class="desc pre">${br(l.description)}</td><td class="num">${tons(l.quantity)}</td><td class="num">${money(c.unitUsd)}</td><td class="num">${money(c.amountUsd)}</td><td class="num">${c.unitJpy === null ? '' : money(roundTo(c.unitJpy, 0), 0)}</td><td class="num">${c.amountJpy === null ? '' : money(c.amountJpy, 0)}</td>${rem}</tr>`;
    })
    .join('');
  const sumRow = (label: string, usd: number, jpy: number | null, cls = '') =>
    `<tr class="${cls}"><td class="blank"></td><td colspan="2" class="lb">${label}</td><td class="num v">${money(usd)}</td><td colspan="2" class="num v">${jpy === null ? '' : money(jpy, 0)}</td><td class="blank"></td></tr>`;
  const body = `
<div class="meta"><div><span class="k">番号：</span>${esc(h.invoiceNo?.trim() || singleInvoiceNoFor(h.issueDate) || '（確定時に採番）')}</div><div><span class="k">発行日：</span>${slashDate(h.issueDate)}</div>${h.registrationNo ? `<div><span class="k">登録番号：</span>${esc(h.registrationNo)}</div>` : ''}</div>
<div class="title">${esc((h.title || '請求書').replace(/[\s　]+/g, ''))}</div>
<div class="to">${esc(h.toName)}　${esc(h.toSuffix || '御中')}</div>
<div class="parties">
  <table class="hd">
    <tr><th>件名：</th><td class="pre">${br(h.subject)}</td></tr>
    <tr><th>支払条件：</th><td class="pre">${br(h.paymentTerms)}</td></tr>
    <tr class="small"><th>有効期限：</th><td class="pre">${br(h.validity)}</td></tr>
  </table>
  <div class="from pre">${br(h.fromBlock)}${seal ? `<img class="seal" src="${seal}" alt="">` : ''}</div>
</div>
<div class="grand"><span>合計(税込)</span><span class="num">US$${money(t.usd.total)}</span></div>
<table class="grid">${COLS}
  <thead><tr><th>摘要</th><th>数量(MT)</th><th>単価(USD)</th><th>金額(USD)</th><th>単価(円)</th><th>金額(円)</th><th>備考</th></tr></thead>
  <tbody>${tr}
  <tr class="per"><td></td><td></td><td class="num">${money(t.perMt.usd)}</td><td></td><td class="num">${t.perMt.jpy === null ? '' : money(t.perMt.jpy)}</td><td></td><td></td></tr>
  </tbody>
</table>
<table class="sums">${COLS}
  ${sumRow('非課税合計', t.usd.nonTaxable, t.jpy?.nonTaxable ?? null)}
  ${sumRow('課税対象合計', t.usd.taxable, t.jpy?.taxable ?? null)}
  ${sumRow('消費税', t.usd.tax, t.jpy?.tax ?? null)}
  ${sumRow('今回請求合計額', t.usd.total, t.jpy?.total ?? null, 'tot')}
</table>
<div class="bd">
  <div class="bdl">
    <div>税率別内訳</div>
    <table>
      <tr class="h"><td></td><td>税抜合計</td><td>消費税額</td><td>税込金額</td></tr>
      ${t.jpy ? `<tr><td>${n(h.taxRate)}%</td><td class="num">¥${money(t.jpy.taxable, 0)}</td><td class="num">¥${money(t.jpy.tax, 0)}</td><td class="num">¥${money(t.jpy.total, 0)}</td></tr>` : ''}
      <tr><td>${n(h.taxRate)}%</td><td class="num">USD ${money(t.usd.taxable)}</td><td class="num">USD ${money(t.usd.tax)}</td><td class="num">USD ${money(t.usd.total)}</td></tr>
    </table>
  </div>
  ${fx !== null ? `<div class="fx"><div>円貨※</div><div>${esc(fx.toFixed(2))} <u>${esc(h.fxNote)}</u></div></div>` : ''}
</div>
${h.conditions ? `<div class="sec">条件</div><div class="txt pre">${br(h.conditions)}</div>` : ''}
${h.paymentBlock ? `<div class="sec">支払い条件</div><div class="txt pre">${br(h.paymentBlock)}</div>` : ''}
${h.bankBlock ? `<div class="sec2">弊社指定口座</div><table class="bank">${bankRows(h.bankBlock)}</table>` : ''}
`;
  const css = `
@page { size: A4; margin: 14mm 13mm 14mm 13mm; }
body { font-size: 8pt; }
.meta { text-align: right; font-size: 6.6pt; line-height: 1.9; }
.meta .k { color: #333; }
.title { text-align: center; font-size: 13pt; font-weight: 700; letter-spacing: 1em; margin: 0 0 5mm 1em; }
.to { font-size: 9pt; font-weight: 700; margin-bottom: 4mm; }
.parties { display: flex; justify-content: space-between; align-items: flex-end; }
table.hd th { font-weight: 400; text-align: left; width: 26mm; padding: .6mm 0; vertical-align: top; font-size: 8pt; }
table.hd td { padding: .6mm 0; font-size: 8pt; }
table.hd tr.small td { font-size: 6.2pt; }
.from { position: relative; text-align: left; font-size: 8.3pt; line-height: 1.75; padding-right: 8mm; }
.from .seal { position: absolute; right: -2mm; bottom: -4mm; width: 17mm; height: auto; opacity: .92; }
.grand { display: inline-flex; gap: 12mm; margin: 2mm 0 4mm; padding: 0 8mm 1px 0; border-bottom: 1px solid #111; font-size: 9.3pt; }
table.grid, table.sums { width: 100%; table-layout: fixed; }
.grid th { background: #d9d9d9; border: 1px solid #555; padding: 4mm 2px; font-weight: 400; text-align: center; font-size: 7.8pt; }
.grid td { border: 1px solid #555; padding: 3mm 2px; vertical-align: middle; font-size: 8pt; }
.grid td.desc { font-size: 7.6pt; line-height: 1.6; }
.grid td.rem { font-size: 6pt; line-height: 1.4; vertical-align: top; padding: .8mm 2px; }
.grid tr.per td { padding: 1mm 2px; }
.sums td { padding: .5mm 2px; font-size: 8pt; }
.sums td.lb { text-align: right; border: 1px solid #555; }
.sums td.v { border: 1px solid #555; }
.sums tr.tot td.lb, .sums tr.tot td.v { border-top: 1px solid #111; }
.sums td.blank { border: 0; }
.bd { display: flex; align-items: flex-end; gap: 10mm; margin-top: 5mm; font-size: 6pt; color: #222; }
.bdl { width: 55%; }
.bdl table { width: 100%; border-top: 1px solid #777; }
.bdl td { padding: 0 4px; border-bottom: 1px solid #999; }
.bdl tr.h td { text-align: right; }
.fx { font-size: 6.2pt; line-height: 1.6; }
.sec { font-size: 8pt; margin-top: 3mm; }
.sec2 { font-size: 6.6pt; margin-top: 4mm; }
.txt { font-size: 7.6pt; line-height: 1.6; }
table.bank { font-size: 6.2pt; line-height: 1.45; }
table.bank td { padding: 0; vertical-align: top; }
table.bank td.bk { width: 30mm; }
`;
  return docShell({ title: `請求書 ${h.invoiceNo?.trim() || singleInvoiceNoFor(h.issueDate)}`.trim(), css, body, draft: opts.draft });
}
