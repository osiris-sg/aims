/**
 * Round BO — Kato's 請求書 as ADH issued it in Nov 2026 (single invoice "style 2"), laid out after
 *   請求書正式ビレット_加藤軽金属様202612納入_6063 8 インチ 40T.pdf  (202611_01, US$162,205.08)
 *   請求書正式ビレット_加藤軽金属様202612納入_6005 8インチ 40T.pdf   (202611_02, US$165,661.77)
 *   (正誤差額)_請求書_加藤軽金属様_11月納入6063材40.271Tビレットプレミアム差.pdf (202610_004, US$1,107.44):
 * 番号 / 発行日 / 登録番号 top right; 件名 + 支払条件 left, the From block (with 担当) + seal right; 合計(税込) $…;
 * seven columns 摘要 | 数量(MT) | 単価(USD) | 金額(USD) | 単価(円) | 金額(円) | 備考(単価明細等); 非課税合計 /
 * 課税対象合計 / 消費税 / 合計 in USD and yen; 課税対象分 税率別内訳 (yen row, then USD); 円貨※ rate + its source
 * ("11/8-11/14 関税外国為替相場" = the customs weekly rate of the issue week); 条件; お支払い期限; 弊社指定口座.
 * Rounding: trade-invoice-single.ts singleLineCalc / singleTotals with style 2.
 *
 * Also here: the 番号 series (YYYYMM_NN per issue month) and the two follow-up invoices — 正誤差額 (a corrected
 * price field × quantity) and 実費差分 (actual customs / trucking costs − what the invoice billed).
 */
import { docShell, esc, lines as br, money } from './trade-doc-shell';
import { roundTo } from './trade-invoice';
import { invoiceLayoutCss } from './trade-invoice-layout';
import { SingleInvoiceHeader, SingleLine, singleTotals } from './trade-invoice-single';

const has = (v: unknown) => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v));
const n = (v: unknown) => (has(v) ? Number(v) : 0);
const slashDate = (d: string | null | undefined) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d ?? '');
  return m ? `${m[1]}/${Number(m[2])}/${Number(m[3])}` : esc(d ?? '');
};
const tons = (v: number | null) => (v === null || v === undefined || !Number.isFinite(v) ? '' : v.toLocaleString('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 3 }));

/** The billet line's 備考 on Kato's Nov 2026 invoices: "LME Cash / 10月平均 3061.11 / + Q4 MJP 255.0 / + Billet Premium 260". */
export const KATO_REMARKS_TEMPLATE = 'LME Cash\n{monthNo}月平均 {LME}\n+ Q{q} MJP {QMJP:1}\n+ Billet Premium {premium}{upcharge}';
export const KATO_UPCHARGE_TEMPLATE = '\n+ Upcharge {upcharge}';

// ── 番号 ──────────────────────────────────────────────────────────────────────
/**
 * The next 番号 of an issue month: "YYYYMM_NN" after the highest NN already used that month (AIMS's finals and the
 * numbers ADH issued outside AIMS, e.g. "202611_02" → "202611_03"). Two digits, or as wide as the widest seen
 * (Oct 2026 ran "202610_003", "202610_004").
 */
export function nextKatoInvoiceNo(issueDate: string, seen: Array<string | null | undefined>): string {
  const m = /^(\d{4})-(\d{2})/.exec(issueDate ?? '');
  if (!m) return '';
  const prefix = `${m[1]}${m[2]}_`;
  let max = 0;
  let width = 2;
  for (const s of seen) {
    const hit = new RegExp(`(?:^|\\D)${prefix}(\\d{1,4})(?!\\d)`).exec(String(s ?? ''));
    if (!hit) continue;
    max = Math.max(max, Number(hit[1]));
    width = Math.max(width, hit[1].length);
  }
  return `${prefix}${String(max + 1).padStart(width, '0')}`;
}

/** "11/8-11/14" for the customs week (Sunday–Saturday) — how the Kato invoice names its rate. */
export function customsWeekLabel(start: string, end: string): string {
  const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
  return `${md(start)}-${md(end)}`;
}

// ── follow-up invoices ───────────────────────────────────────────────────────
/** The price fields a correction may change on the billet line. */
export const CORRECTION_FIELDS = {
  premium: { label: 'Billet Premium', ja: 'ビレットプレミアム' },
  lme: { label: 'LME Cash', ja: 'LME' },
  qmjp: { label: 'MJP', ja: 'MJP' },
  upcharge: { label: 'Upcharge', ja: 'アップチャージ' },
} as const;
export type CorrectionField = keyof typeof CORRECTION_FIELDS;

export interface OriginalInvoice {
  id: string;
  number: string | null;
  header: SingleInvoiceHeader;
  rows: SingleLine[];
}

const jaMonth = (month: string | null | undefined) => {
  const m = /^\d{4}-(\d{2})$/.exec(month ?? '');
  return m ? `${Number(m[1])}月` : '';
};

/**
 * 正誤差額: the original's billet line with one price field corrected (premium 235 → 260), billed as the difference
 * per MT × the quantity at the ORIGINAL's rate. The ご参考 box shows the original total recomputed with the correct
 * value (正) and as issued (誤). Paid together with the next invoice.
 */
export function correctionDraft(opts: {
  original: OriginalInvoice;
  field: CorrectionField;
  to: number;
  quantity?: number | null;
  today: string;
  /** "11月" — the delivery month of the corrected invoice; "12月" — the next invoice it is paid with. */
  deliveryMonth?: string | null;
  nextDeliveryMonth?: string | null;
}): { header: SingleInvoiceHeader; rows: SingleLine[] } {
  const { original: o, field } = opts;
  const goods = o.rows.find((r) => r.kind === 'goods');
  if (!goods) throw new Error('The original invoice has no billet line to correct');
  const from = n(goods[field]);
  const diff = roundTo(opts.to - from, 4);
  if (diff === 0) throw new Error(`${CORRECTION_FIELDS[field].label} is already ${opts.to} on ${o.number ?? 'the original'}`);
  const qty = has(opts.quantity) ? Number(opts.quantity) : goods.quantity;
  const fx = o.header.fxRate;
  const totalAs = (rows: SingleLine[]) => singleTotals(rows, o.header.taxRate, fx, o.header.style).usd.total;
  const fixed = o.rows.map((r) => (r === goods ? { ...r, [field]: opts.to } : r));
  const right = totalAs(fixed);
  const wrong = totalAs(o.rows);
  const d = jaMonth(opts.deliveryMonth);
  const next = jaMonth(opts.nextDeliveryMonth);
  const firstLine = (goods.description ?? '').split('\n')[0];
  const noDash = (o.number ?? '').replace('_', '-');
  const label = `${CORRECTION_FIELDS[field].label} 差額`;
  const fmtDiff = Math.abs(diff) < 100 ? diff.toFixed(1) : String(diff);
  const header: SingleInvoiceHeader = {
    ...o.header,
    style: 2,
    variant: 'correction',
    invoiceNo: null,
    issueDate: opts.today,
    subject: `${(o.header.subject ?? '').split('\n')[0]}\n${CORRECTION_FIELDS[field].ja}差額`,
    paymentTerms: `${next ? `${next}納入分` : '次回'}請求書と合算の上お支払い 弊社指定口座振込`,
    dueLine: '次回ご請求書お支払い期限 までにお支払いをお願い致します。',
    // The original's rate and its source ("202610-003発行時使用 10/2 関税外国為替相場").
    fxRate: fx,
    fxNote: `${noDash}発行時使用 ${slashDate(o.header.issueDate).replace(/^\d{4}\//, '')} ${(o.header.fxNote ?? '').replace(/^[\d/-]+\s*/, '') || '関税外国為替相場'}`,
    reference: {
      title: `ご参考 ${d ? `${d}納入分` : ''}${(o.header.subject ?? '').split('\n')[0].replace(/^アルミニウムビレット[\s　]*/, '')} ${qty ?? ''}MT ご請求`.replace(/\s+/g, ' ').trim(),
      lines: [`(正) US$ ${money(right)}`, `(誤) US$ ${money(wrong)}`],
    },
    original: { id: o.id, number: o.number, issueDate: o.header.issueDate, total: wrong },
  };
  const rows: SingleLine[] = [
    {
      kind: 'usd',
      description: `${firstLine}\n${(goods.description ?? '').split('\n')[1] ?? ''}${d ? ` ${d}納入分` : ''}\n${slashDate(o.header.issueDate)}発行 請求書 ${o.number ?? ''} との差額`.replace(/\n\s*\n/g, '\n'),
      quantity: qty,
      unitPrice: diff,
      taxable: true,
      remarks: `${label}\n(USD/MT) ${fmtDiff}`,
      shipmentId: goods.shipmentId ?? null,
      orderId: goods.orderId ?? null,
      grade: goods.grade ?? null,
    },
  ];
  return { header, rows };
}

/**
 * 実費差分: actual customs / trucking (課税) and customs (非課税) costs − what the original billed for them, in yen,
 * at the original's rate (editable). A negative difference is a credit.
 */
export function actualsDraft(opts: { original: OriginalInvoice; actualTaxableJpy: number | null; actualNonTaxableJpy: number | null; today: string; source?: string | null }): { header: SingleInvoiceHeader; rows: SingleLine[] } {
  const o = opts.original;
  const billed = (taxable: boolean) => o.rows.filter((r) => r.kind === 'jpy' && r.taxable === taxable).reduce((a, r) => a + n(r.jpyAmount), 0);
  const rows: SingleLine[] = [];
  const add = (actual: number | null, taxable: boolean, label: string) => {
    if (actual === null) return;
    const diff = roundTo(actual - billed(taxable), 2);
    if (diff === 0) return;
    rows.push({ kind: 'jpy', description: label, quantity: null, jpyAmount: diff, taxable, remarks: `実費 ¥${money(actual, 0)} − ご請求済 ¥${money(billed(taxable), 0)}` });
  };
  add(opts.actualTaxableJpy, true, '通関、車輸送料 実費差分\n　課税対象　消費税率10％');
  add(opts.actualNonTaxableJpy, false, '通関 実費差分\n　課税対象外');
  if (!rows.length) throw new Error('The actual costs equal what the invoice billed — nothing to invoice');
  const header: SingleInvoiceHeader = {
    ...o.header,
    style: 2,
    variant: 'actuals',
    invoiceNo: null,
    issueDate: opts.today,
    subject: `${(o.header.subject ?? '').split('\n')[0]}\n実費差分`,
    paymentTerms: '次回請求書と合算の上お支払い 弊社指定口座振込',
    dueLine: '次回ご請求書お支払い期限 までにお支払いをお願い致します。',
    reference: { title: `ご参考 請求書 ${o.number ?? ''} の実費精算${opts.source ? `（${opts.source}）` : ''}`, lines: [] },
    original: { id: o.id, number: o.number, issueDate: o.header.issueDate, total: singleTotals(o.rows, o.header.taxRate, o.header.fxRate, o.header.style).usd.total },
  };
  return { header, rows };
}

// ── HTML ─────────────────────────────────────────────────────────────────────
const COLS = '<colgroup><col style="width:26%"><col style="width:9.5%"><col style="width:9.5%"><col style="width:10.5%"><col style="width:8.5%"><col style="width:10%"><col style="width:16%"></colgroup>';

export function renderKatoInvoiceHtml(h: SingleInvoiceHeader, rows: SingleLine[], opts: { draft?: boolean; seal?: string | null } = {}): string {
  const fx = has(h.fxRate) ? Number(h.fxRate) : null;
  const t = singleTotals(rows, h.taxRate, fx, 2);
  const seal = h.showSeal !== false && opts.seal && /^data:image\/(png|jpe?g);base64,/.test(opts.seal) ? opts.seal : null;
  // Equal, consecutive remarks print once (the 通関、車輸送料 / 通関 block).
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
      const ichi = l.kind === 'jpy' && !has(l.quantity);
      // The PDF bolds what the line is priced on: quantity / unit / USD amount (billet, 他諸掛), the yen amount (yen lines).
      const b = (v: string, on: boolean) => (on ? `<b>${v}</b>` : v);
      const rem = span[i] === 0 ? '' : `<td class="rem pre"${span[i] > 1 ? ` rowspan="${span[i]}"` : ''}>${br(l.remarks)}</td>`;
      return `<tr><td class="desc pre">${br(l.description)}</td><td class="num">${ichi ? '一式' : b(tons(l.quantity), true)}</td><td class="num">${b(money(c.unitUsd), !ichi)}</td><td class="num">${b(money(c.amountUsd), !ichi)}</td><td class="num">${c.unitJpy === null ? '' : money(c.unitJpy, 0)}</td><td class="num">${c.amountJpy === null ? '' : b(money(c.amountJpy, 0), ichi)}</td>${rem}</tr>`;
    })
    .join('');
  const sumRow = (label: string, usd: number, jpy: number | null, cls = '') =>
    `<tr class="${cls}"><td class="blank"></td><td class="lb">${label}</td><td colspan="2" class="num v${cls ? ' b' : ''}">${money(usd)}</td><td colspan="2" class="num v">${jpy === null ? '' : money(jpy, 0)}</td><td class="blank"></td></tr>`;
  const due = (h.dueLine ?? '{date} までにお支払いをお願い致します。').replace('{date}', `<span class="dd">${slashDate(h.dueDate)}</span>`);
  const ref = h.reference && (h.reference.title || h.reference.lines.length) ? `<div class="ref"><div class="rt">${esc(h.reference.title)}</div>${h.reference.lines.map((l) => `<div>${esc(l)}</div>`).join('')}</div>` : '';
  const body = `
<div class="meta"><div><span class="k">番号：</span>${esc(h.invoiceNo?.trim() || '（確定時に採番）')}</div><div><span class="k">発行日：</span>${slashDate(h.issueDate)}</div>${h.registrationNo ? `<div><span class="k">登録番号：</span>${esc(h.registrationNo)}</div>` : ''}</div>
<div class="title">${esc((h.title || '請求書').replace(/[\s　]+/g, ''))}</div>
<div class="to">${esc(h.toName)}　${esc(h.toSuffix || '御中')}</div>
<div class="parties">
  <table class="hd">
    <tr><th>件名：</th><td class="pre">${br(h.subject)}</td></tr>
    <tr><th>支払条件：</th><td class="pre">${br(h.paymentTerms)}</td></tr>
  </table>
  <div class="from pre">${br(h.fromBlock)}${seal ? `<img class="seal" src="${seal}" alt="">` : ''}</div>
</div>
<div class="grand"><span>合計(税込)</span><span class="num">$${money(t.usd.total)}</span></div>
<table class="grid">${COLS}
  <thead><tr><th>摘要</th><th>数量(MT)</th><th>単価(USD)</th><th>金額(USD)</th><th>単価(円)</th><th>金額(円)</th><th>備考(単価明細等)</th></tr></thead>
  <tbody>${tr}</tbody>
</table>
<table class="sums">${COLS}
  ${sumRow('非課税合計', t.usd.nonTaxable, t.jpy?.nonTaxable ?? null)}
  ${sumRow('課税対象合計', t.usd.taxable, t.jpy?.taxable ?? null)}
  ${sumRow('消費税', t.usd.tax, t.jpy?.tax ?? null)}
  ${sumRow('合計', t.usd.total, t.jpy?.total ?? null, 'tot')}
</table>
<div class="bd">
  <div class="bdl">
    <div>課税対象分 税率別内訳</div>
    <table>
      <tr class="h"><td></td><td>税抜金額</td><td>消費税額</td><td>税込金額</td></tr>
      ${t.jpy ? `<tr><td>${n(h.taxRate)}%</td><td class="num">¥${money(t.jpy.taxable, 0)}</td><td class="num">¥${money(t.jpy.tax, 0)}</td><td class="num">¥${money(t.jpy.taxable + t.jpy.tax, 0)}</td></tr>` : ''}
      <tr><td>${n(h.taxRate)}%</td><td class="num">USD ${money(t.usd.taxable)}</td><td class="num">USD ${money(t.usd.tax)}</td><td class="num">USD ${money(roundTo(t.usd.taxable + t.usd.tax, 2))}</td></tr>
    </table>
  </div>
  ${fx !== null ? `<div class="fx"><div>円貨※</div><div>${esc(fx.toFixed(2))} <u>${esc(h.fxNote)}</u></div></div>` : opts.draft ? `<div class="fx missing"><div>円貨※</div><div>（為替レート未入力 / FX rate missing）</div></div>` : ''}
</div>
<div class="cond">
  <div>${h.conditions ? `<div class="sec">条件</div><div class="txt pre">${br(h.conditions)}</div>` : ''}</div>
  ${ref}
</div>
<div class="sec">お支払い期限</div><div class="due">${due}</div>
${h.bankBlock ? `<div class="sec">弊社指定口座</div><table class="bank">${bankRowsOf(h.bankBlock)}</table>` : ''}
`;
  const css = `
@page { size: A4; margin: 14mm 13mm 14mm 13mm; }
body { font-size: 8pt; }
.meta { text-align: right; font-size: 6.6pt; line-height: 1.9; margin-right: 12mm; }
.meta .k { color: #333; }
.title { text-align: center; font-size: 13pt; font-weight: 700; margin: 1mm 0 5mm; }
.to { font-size: 9pt; font-weight: 700; margin-bottom: 5mm; }
.parties { display: flex; justify-content: space-between; align-items: flex-start; }
table.hd th { font-weight: 400; text-align: left; width: 26mm; padding: 1.2mm 0; vertical-align: top; font-size: 8pt; }
table.hd td { padding: 1.2mm 0; font-size: 8pt; }
.from { position: relative; text-align: left; font-size: 8.3pt; line-height: 1.75; padding-right: 8mm; margin-right: 12mm; }
.from .seal { position: absolute; right: -14mm; bottom: -2mm; width: 17mm; height: auto; opacity: .92; }
.grand { display: inline-flex; gap: 22mm; margin: 4mm 0 4mm; padding: 0 2mm 1px 0; border-bottom: 1px solid #111; font-size: 9.3pt; }
table.grid, table.sums { width: 100%; table-layout: fixed; }
.grid th { border: 1px solid #555; padding: 4mm 2px; font-weight: 400; text-align: center; font-size: 7.8pt; }
.grid td { border: 1px solid #555; padding: 3mm 2px; vertical-align: middle; font-size: 8pt; }
.grid td.desc { font-size: 7.6pt; line-height: 1.6; }
.grid td.rem { font-size: 6pt; line-height: 1.5; vertical-align: top; padding: .8mm 2px; }
.sums td { padding: .4mm 2px; font-size: 8pt; }
.sums td.lb { text-align: right; border: 1px solid #555; }
.sums td.v { border: 1px solid #555; }
.sums td.b { font-weight: 700; }
.sums td.blank { border: 0; }
.bd { display: flex; align-items: flex-end; gap: 10mm; margin-top: 7mm; font-size: 6pt; color: #222; }
.bdl { width: 48%; }
.bdl table { width: 100%; border-top: 1px solid #777; }
.bdl td { padding: 0 4px; border-bottom: 1px solid #999; }
.bdl tr.h td { text-align: right; }
.fx { font-size: 6.2pt; line-height: 1.6; text-align: center; }
.fx.missing { color: #c00000; }
.cond { display: flex; gap: 8mm; align-items: flex-start; margin-top: 3mm; }
.ref { border: 1px solid #4a6fa5; border-radius: 3mm; padding: 1.5mm 3mm; font-size: 7.4pt; line-height: 1.7; margin-top: 2mm; }
.ref .rt { font-size: 6.2pt; }
.sec { font-size: 8pt; margin-top: 4mm; }
.txt { font-size: 8pt; line-height: 1.6; }
.due { font-size: 8pt; margin: 1mm 0 0 6mm; }
.due .dd { font-size: 10pt; }
table.bank { font-size: 6.4pt; line-height: 1.45; }
table.bank td { padding: 0; vertical-align: top; }
table.bank td.bk { width: 30mm; }
${h.printLayout ? invoiceLayoutCss(h.printLayout, { firstLineMm: 5.1 }) : ''}`;
  return docShell({ title: `請求書 ${h.invoiceNo?.trim() ?? ''}`.trim(), css, body, draft: opts.draft });
}

/** Bank block: "label<TAB>value" lines print as two columns. */
function bankRowsOf(text: string): string {
  return (text ?? '')
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .map((l) => {
      const [k, ...v] = l.split('\t');
      return v.length ? `<tr><td class="bk">${esc(k.trim())}</td><td>${esc(v.join(' ').trim())}</td></tr>` : `<tr><td colspan="2">${esc(l.trim())}</td></tr>`;
    })
    .join('');
}
