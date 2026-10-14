/**
 * A4 HTML for in-app trade documents (Customer PL / Customer COA). One template
 * for both the editor's live preview and the finalized PDF (Puppeteer via
 * PdfGeneratorService). ADH letterhead only — no supplier prices or branding.
 */
import { COA_JP_SUMMARY_KEYS } from './trade-coa';
import { docShell, jpDate, lines as br, money, qty } from './trade-doc-shell';
import { GenColumn, GenRow, plTotals, round3 } from './trade-sheet.parser';

export interface GenRef {
  key: string;
  label: string;
  value: string;
  visible: boolean;
}

export interface GenHeader {
  title: string;
  number?: string | null;
  letterhead: { name: string; address?: string | null; phone?: string | null; registrationNo?: string | null };
  to: { name: string; address?: string | null; contact?: string | null };
  date: string; // YYYY-MM-DD
  refs: GenRef[];
  /** COA spec line, e.g. "Grade 6063 · Size 8\"" */
  spec?: string | null;
  /** Pieces for the totals line (from the shipment; rows don't carry it). */
  pieces?: number | null;
  remarks?: string | null;
  /**
   * 'jp' = ADH's Japanese customer documents: 計量検収票 (Customer PL) and
   * 納品書兼分析試験成績報告書 (Customer COA). The fields below belong to it.
   */
  layout?: 'jp';
  /** "様式2" / "様式 1" (top-left). */
  formLabel?: string;
  toSuffix?: string;
  issuer?: { name: string; address: string; contact: string };
  // 計量検収票 header (from Vedanta's PL)
  invoiceNo?: string;
  /** Vedanta's PL date, printed as dd/mm/yyyy. */
  plDate?: string;
  portOfDischarge?: string;
  goodsDescription?: string;
  origin?: string;
  hsCode?: string;
  applicant?: string;
  // 納品書兼分析試験成績報告書
  productLine?: string;
  sizeLine?: string;
  /** Typed bundle count (blank = the rows' total). */
  bundles?: number | null;
  piecesPerBundle?: number | null;
  weightUnit?: string;
  analysisDate?: string;
  vendor?: string;
}

const esc = (v: unknown) =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmtDay = (d: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d || '');
  return m ? `${m[3]} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : esc(d);
};
const mt = (v: unknown) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? '' : Number(v).toLocaleString('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 3 }));

export function renderGeneratedHtml(docType: string, header: GenHeader, columns: GenColumn[], rows: GenRow[], opts: { draft?: boolean } = {}): string {
  if (header.layout === 'jp') return docType === 'CUSTOMER_COA' ? renderCustomerCoaJp(header, columns, rows, opts) : renderCustomerPlJp(header, rows, opts);
  const cols = columns.filter((c) => c.visible);
  const refs = header.refs.filter((r) => r.visible && r.value);
  const t = plTotals(rows.map((r) => ({ netMt: r.netMt ?? r.netwt ?? null, grossMt: r.grossMt ?? r.grosswt ?? null })));
  const hasWeights = cols.some((c) => c.kind === 'mt');
  const cell = (c: GenColumn, r: GenRow) => (c.kind === 'mt' ? mt(r[c.key]) : esc(r[c.key] ?? ''));
  const align = (c: GenColumn) => (c.kind === 'mt' || c.kind === 'number' ? 'num' : '');
  // Totals row: label in the first column, MT sums under their columns.
  const totalsRow = hasWeights
    ? `<tr class="tot">${cols
        .map((c, i) => {
          if (c.kind === 'mt') return `<td class="num">${mt(round3(rows.reduce((s, r) => s + (Number(r[c.key]) || 0), 0)))}</td>`;
          return `<td>${i === 0 ? 'Total' : ''}</td>`;
        })
        .join('')}</tr>`
    : '';
  // Wide tables (a COA with every chemistry column) must still fit portrait A4
  // (≈186 mm between margins): shrink the type, then the cell padding.
  const size = cols.length > 16 ? 'tiny' : cols.length > 12 ? 'small' : 'normal';

  const css = `
  @page { size: A4; margin: 14mm 12mm 16mm 12mm; }
  body { font-size: 9.5pt; }
  .lh { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #111; padding-bottom: 6px; }
  .lh .name { font-size: 15pt; font-weight: 800; letter-spacing: .01em; }
  .lh .sub { font-size: 8.5pt; color: #333; margin-top: 2px; white-space: pre-line; }
  .title { text-align: right; }
  .title h1 { font-size: 16pt; margin: 0; letter-spacing: .06em; }
  .title .no { font-size: 9pt; color: #333; margin-top: 3px; }
  .meta { display: flex; gap: 16px; margin: 10px 0 8px; }
  .to { flex: 1; }
  .label { font-size: 7.5pt; text-transform: uppercase; color: #555; letter-spacing: .05em; }
  .to .v { font-weight: 700; margin-top: 2px; } .to .a { white-space: pre-line; color: #333; font-size: 8.5pt; }
  .date { width: 30%; text-align: right; }
  table.refs { width: 100%; border-collapse: collapse; margin: 4px 0 8px; font-size: 8.5pt; }
  table.refs td { padding: 2px 6px 2px 0; vertical-align: top; }
  table.refs td.k { color: #555; width: 22%; white-space: nowrap; }
  .spec { margin: 0 0 8px; font-weight: 600; }
  table.grid { width: 100%; border-collapse: collapse; font-size: ${size === 'tiny' ? '6.2pt' : size === 'small' ? '7.2pt' : '8.6pt'}; }
  table.grid th { background: #f1f1f1; border: 1px solid #999; padding: 3px 4px; text-align: left; font-weight: 700; }
  table.grid td { border: 1px solid #bbb; padding: 2px 4px; }
  ${size === 'tiny' ? 'table.grid th, table.grid td { padding: 2px 2px; letter-spacing: -0.01em; }' : ''}
  table.grid td.num, table.grid th.num { text-align: right; font-variant-numeric: tabular-nums; }
  table.grid tr.tot td { font-weight: 700; background: #f7f7f7; border-top: 1.5px solid #111; }
  thead { display: table-header-group; } tr { page-break-inside: avoid; }
  .sum { display: flex; gap: 24px; margin-top: 10px; font-size: 9pt; }
  .sum b { font-variant-numeric: tabular-nums; }
  .remarks { margin-top: 10px; white-space: pre-line; font-size: 8.5pt; }
  .foot { margin-top: 26px; display: flex; justify-content: flex-end; }
  .sign { width: 45%; border-top: 1px solid #111; padding-top: 4px; text-align: center; font-size: 8.5pt; }
  `;
  const body = `
  <div class="lh">
    <div>
      <div class="name">${esc(header.letterhead.name)}</div>
      <div class="sub">${esc([header.letterhead.address, header.letterhead.phone ? `Tel ${header.letterhead.phone}` : '', header.letterhead.registrationNo ? `Reg. No. ${header.letterhead.registrationNo}` : ''].filter(Boolean).join('\n'))}</div>
    </div>
    <div class="title"><h1>${esc(header.title)}</h1>${header.number ? `<div class="no">No. ${esc(header.number)}</div>` : ''}</div>
  </div>
  <div class="meta">
    <div class="to"><div class="label">To</div><div class="v">${esc(header.to.name)}</div>${header.to.address ? `<div class="a">${esc(header.to.address)}</div>` : ''}</div>
    <div class="date"><div class="label">Date</div><div class="v">${fmtDay(header.date)}</div></div>
  </div>
  ${refs.length ? `<table class="refs">${refs.map((r) => `<tr><td class="k">${esc(r.label)}</td><td>${esc(r.value)}</td></tr>`).join('')}</table>` : ''}
  ${header.spec ? `<div class="spec">${esc(header.spec)}</div>` : ''}
  <table class="grid"><thead><tr>${cols.map((c) => `<th class="${align(c)}">${esc(c.label)}</th>`).join('')}</tr></thead>
  <tbody>${rows.map((r) => `<tr>${cols.map((c) => `<td class="${align(c)}">${cell(c, r)}</td>`).join('')}</tr>`).join('')}${totalsRow}</tbody></table>
  <div class="sum">
    <div>Bundles: <b>${t.bundles}</b></div>
    ${header.pieces ? `<div>Pieces: <b>${Number(header.pieces).toLocaleString('en-US')}</b></div>` : ''}
    ${hasWeights || docType === 'CUSTOMER_PL' ? `<div>Net weight: <b>${mt(t.netMt)} MT</b></div><div>Gross weight: <b>${mt(t.grossMt)} MT</b></div>` : ''}
  </div>
  ${header.remarks ? `<div class="remarks">${esc(header.remarks)}</div>` : ''}
  <div class="foot"><div class="sign">For and on behalf of ${esc(header.letterhead.name)}</div></div>
  `;
  return docShell({ title: header.title, css, body, draft: opts.draft });
}

// ── ADH's Japanese customer documents (header.layout = 'jp') ────────────────
const slashDate = (d: string | null | undefined) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d ?? '');
  return m ? `${m[1]}/${Number(m[2])}/${Number(m[3])}` : esc(d ?? '');
};
const dmy = (d: string | null | undefined) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d ?? '');
  return m ? `${m[3]}/${m[2]}/${m[1]}` : esc(d ?? '');
};

/** Address (left) and issuer block (right) under the 御中 line. */
const partiesJp = (h: GenHeader) => `
<div class="toj">${esc(h.to.name)}　${esc(h.toSuffix ?? '御中')}</div>
<div class="pj">
  <div class="addr pre">${br(
    [h.to.address, h.to.contact]
      .map((v) => (v ?? '').trim())
      .filter(Boolean)
      .join('\n'),
  )}</div>
  <div class="iss pre">${br([h.issuer?.name, h.issuer?.address, h.issuer?.contact ? `担当：${h.issuer.contact}` : ''].filter(Boolean).join('\n'))}</div>
</div>`;

const JP_CSS = `
body { font-size: 9pt; }
.top { display: flex; justify-content: space-between; font-size: 8.5pt; }
.ttl { text-align: center; font-size: 13pt; margin: 1mm 0 8mm; }
.toj { font-size: 11pt; margin-left: 4mm; }
.pj { display: flex; justify-content: space-between; align-items: flex-start; margin: 4mm 0 8mm 6mm; }
.pj .addr { font-size: 8.5pt; }
.pj .iss { text-align: center; font-size: 9pt; line-height: 1.6; }
`;

/**
 * 計量検収票: Vedanta's packing list re-issued to the customer — the PL header
 * (INVOICE NO, DATE, Net Wt., No. of Bundles, Port of Discharge, Goods
 * Description, Country of Origin + HS CODE, Applicant) and its table per
 * container (Sr. No. restarts per container, Sub Total per container, TOTAL).
 */
function renderCustomerPlJp(h: GenHeader, rows: GenRow[], opts: { draft?: boolean }): string {
  const groups: Array<{ container: string; rows: GenRow[] }> = [];
  for (const r of rows) {
    const c = String(r.container ?? '').trim();
    const last = groups[groups.length - 1];
    if (last && (!c || c === last.container)) last.rows.push(r);
    else groups.push({ container: c, rows: [r] });
  }
  const sum = (rs: GenRow[], k: string) => round3(rs.reduce((a, r) => a + (Number(r[k]) || 0), 0));
  const t = { net: sum(rows, 'netMt'), gross: sum(rows, 'grossMt') };
  const kv = (k: string, v: string) => `<tr><th>${k}</th><td>${v}</td></tr>`;
  const body = `
<div class="top"><span>${esc(h.formLabel ?? '')}</span><span>${jpDate(h.date)}</span></div>
<div class="ttl">${esc(h.title || '計量検収票')}</div>
${partiesJp(h)}
<div class="box">
  <div class="hd">
    <table class="kv">
      ${kv('INVOICE NO :', `${esc(h.invoiceNo ?? '')}<span class="dt"><b>DATE:</b> ${dmy(h.plDate)}</span>`)}
      ${kv('Net Wt. :', money(t.net, 3))}
      ${kv('No. of Bundles :', String(rows.length))}
      ${kv('Port of Discharge :', esc(h.portOfDischarge ?? ''))}
      ${kv('Goods Description:', `${esc(h.goodsDescription ?? '')}<br>COUNTRY OF ORIGIN : ${esc(h.origin ?? '')}${h.hsCode ? ` HS CODE : ${esc(h.hsCode)}` : ''}`)}
      ${kv('Applicant :', br(h.applicant ?? ''))}
    </table>
  </div>
  <table class="grid">
    <thead><tr><th>Container ID</th><th>Sr. No.</th><th>Batch No</th><th>Net Weight(MT)</th><th>Gross weight(MT)</th></tr></thead>
    <tbody>${groups
      .map(
        (g) =>
          g.rows
            .map(
              (r, i) =>
                `<tr><td>${i === 0 ? esc(g.container) : ''}</td><td>${i + 1}</td><td>${esc(r.batch ?? '')}</td><td>${money(Number(r.netMt), 3)}</td><td>${money(Number(r.grossMt), 3)}</td></tr>`,
            )
            .join('') + `<tr><td>Sub Total</td><td></td><td></td><td>${money(sum(g.rows, 'netMt'), 3)}</td><td>${money(sum(g.rows, 'grossMt'), 3)}</td></tr>`,
      )
      .join('')}</tbody>
    <tfoot><tr><td colspan="3">TOTAL</td><td>${money(t.net, 3)}</td><td>${money(t.gross, 3)}</td></tr></tfoot>
  </table>
</div>`;
  const css = `${JP_CSS}
.ttl { color: #9a2a2a; }
.box { border: 1.5px solid #111; padding: 3mm 4mm 5mm; }
table.kv { font-family: "Times New Roman", serif; font-size: 7.6pt; }
.kv th { text-align: left; font-weight: 700; padding: 0 3mm 0 0; vertical-align: top; white-space: nowrap; }
.kv td { padding: 0; } .kv .dt { margin-left: 30mm; }
table.grid { width: 100%; margin-top: 3mm; font-family: "Times New Roman", serif; font-size: 7.6pt; }
.grid th { background: #d9d9d9; border: 1px solid #555; padding: 1.5mm; }
.grid td { border: 1px solid #555; padding: .8mm 1.5mm; text-align: center; }
.grid tfoot td { background: #bfbfbf; font-weight: 700; border-width: 1.5px; }
thead { display: table-header-group; } tr { page-break-inside: avoid; }
`;
  return docShell({ title: h.title || '計量検収票', css, body, draft: opts.draft });
}

/**
 * 納品書兼分析試験成績報告書: 品種 (product, size, bundles / 1BD本数 / total
 * pieces, 合計 weight) and 分析試験成績 (date, vendor, one row per cast:
 * Batch · FE · SI · TI · MN · MG · ZN · PB · CU · CR · AL · OTTOT · ZR).
 */
function renderCustomerCoaJp(h: GenHeader, columns: GenColumn[], rows: GenRow[], opts: { draft?: boolean }): string {
  const bundles = h.bundles !== null && h.bundles !== undefined && Number.isFinite(Number(h.bundles)) ? Number(h.bundles) : rows.reduce((a, r) => a + (Number(r.bundles) || 0), 0);
  const ppb = h.piecesPerBundle !== null && h.piecesPerBundle !== undefined && Number.isFinite(Number(h.piecesPerBundle)) ? Number(h.piecesPerBundle) : null;
  const weight = round3(rows.reduce((a, r) => a + (Number(r.netwt) || 0), 0));
  const cols = columns.filter((c) => c.visible && !COA_JP_SUMMARY_KEYS.includes(c.key));
  const body = `
<div class="top"><b>${esc(h.formLabel ?? '')}</b><span>${slashDate(h.date)}</span></div>
<div class="ttl">${esc(h.title || '納品書兼分析試験成績報告書')}</div>
${partiesJp(h)}
<div class="sec"><div class="st">品種</div>
  <div class="prod">${esc(h.productLine ?? '')}</div>
  <div class="prod">${esc(h.sizeLine ?? '')}</div>
  <table class="cnt">
    <tr><th></th><th>バンドル数</th><th>1BD本数</th><th>トータル本数</th></tr>
    <tr><td></td><td>${qty(bundles)} BD</td><td>${ppb === null ? '' : qty(ppb)}</td><td>${ppb === null ? '' : `${qty(bundles * ppb)} PCS`}</td></tr>
    <tr><td class="sum">合計</td><td>${qty(bundles)} BD</td><td colspan="2">${money(weight, 3)} ${esc(h.weightUnit ?? 'MT')}</td></tr>
  </table>
</div>
<div class="sec an"><div class="st">分析試験成績</div>
  <div class="meta"><span>日付：&nbsp;${slashDate(h.analysisDate)}</span><span class="vd">ベンダー：${esc(h.vendor ?? '')}</span></div>
  <table class="grid"><thead><tr>${cols.map((c) => `<th>${esc(c.label)}</th>`).join('')}</tr></thead>
  <tbody>${rows.map((r) => `<tr>${cols.map((c, i) => `<td class="${i === 0 ? '' : 'num'}">${esc(r[c.key] ?? '')}</td>`).join('')}</tr>`).join('')}</tbody></table>
</div>`;
  const css = `${JP_CSS}
.toj { margin-left: 0; }
.sec { border: 1px solid #111; margin: 3mm 3mm 0; padding-bottom: 4mm; }
.st { border-bottom: 1px solid #111; font-weight: 700; font-size: 8pt; padding: .5mm 1mm; }
.prod { margin: 5mm 0 0 45%; font-size: 8.5pt; }
table.cnt { width: 70%; margin: 6mm 0 0 12%; font-size: 8.5pt; }
.cnt th { font-weight: 700; padding: .5mm 2mm; } .cnt td { text-align: center; padding: .5mm 2mm; } .cnt td.sum { font-weight: 700; }
.an { min-height: 70mm; }
.meta { font-size: 8.5pt; margin: 1mm 2mm 4mm; } .meta .vd { margin-left: 25mm; color: #445; }
table.grid { margin: 0 auto; font-size: 7.3pt; }
.grid th { border: 1px solid #111; padding: .5mm 1.5mm; text-align: left; font-weight: 400; min-width: 11mm; }
.grid td { border: 1px solid #111; padding: .5mm 1.5mm; }
`;
  return docShell({ title: h.title || '納品書兼分析試験成績報告書', css, body, draft: opts.draft });
}
