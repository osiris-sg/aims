/**
 * Round AM (2026-10-26) — SUS's own customer documents (step 4), as ADH makes them by hand from Vedanta's files
 * (samples: "COA_集計ファイル_….pdf" + "PACKING LIST….xls", Sayaka's mails of 24–25 Oct):
 *
 *   COA_集計ファイル  CUSTOMER_COA_SUS_SUMMARY: Vedanta's per-bundle COA.xls (or a COA PDF) summed per cast —
 *                    Cast No · Material · Net WT · Gross WT · Bundle · PIECES · Length · Size · FE … ZR, a total row
 *                    (net, gross, bundles, pieces), under Vedanta's producer block (Date, Invoice Number, Description of
 *                    Goods, Brand, Country of Origin, Applicant). Printed as a PDF.
 *   PACKING LIST     CUSTOMER_PL_SUS_XLS: Vedanta's PL.xls / PL.csv per bundle with two columns added — the cast
 *                    (the batch's first 8 characters) and the bundle no. (the rest) — and the "Sub Total" row.
 *                    Finalized as an .xlsx (SUS takes a spreadsheet).
 * Pure: no Prisma, no Nest. The sheet readers are trade-sheet.parser (spreadsheets) and trade-coa (PDF text).
 */
import { Workbook } from 'exceljs';
import { COA_ELEMENTS } from './trade-coa';
import type { GenColumn, GenRow, Sheet } from './trade-sheet.parser';

export const SUS_COA_TEMPLATE = 'CUSTOMER_COA_SUS_SUMMARY';
export const SUS_PL_TEMPLATE = 'CUSTOMER_PL_SUS_XLS';
export const isSusTemplate = (k: string | null | undefined) => k === SUS_COA_TEMPLATE || k === SUS_PL_TEMPLATE;

/** Vedanta's producer block as it heads the COA_集計ファイル (editable on the draft). */
export const VEDANTA_PRODUCER_BLOCK = [
  'Producer : VEDANTA ALUMINIUM METAL LIMITED',
  'Works : VILLAGE BHURKHAMUNDA, KUREBAGA & BRUNDAMAL, JHARSUGUDA, ODISHA-768202, INDIA',
  'Regd. office : 1ST FLOOR,C WING,UNIT 103, CORPORATE AVENUE,ATUL PROJECTS,CHAKALA, ANDHERI (E), MUMBAI, MAHARASHTRA-400099, INDIA',
].join('\n');

export const SUS_COA_COLUMNS: GenColumn[] = [
  { key: 'batch', label: 'Cast No', visible: true, kind: 'text' },
  { key: 'material', label: 'Material', visible: true, kind: 'text' },
  { key: 'netwt', label: 'Net WT', visible: true, kind: 'mt' },
  { key: 'grosswt', label: 'Gross WT', visible: true, kind: 'mt' },
  { key: 'bundles', label: 'Bundle', visible: true, kind: 'number' },
  { key: 'pieces', label: 'PIECES', visible: true, kind: 'number' },
  { key: 'length', label: 'Length', visible: true, kind: 'text' },
  { key: 'size', label: 'Size', visible: true, kind: 'text' },
  ...COA_ELEMENTS.map((e): GenColumn => ({ key: e.toLowerCase(), label: e, visible: true, kind: 'text' })),
];

export const SUS_PL_COLUMNS: GenColumn[] = [
  { key: 'no', label: 'Sl. No.', visible: true, kind: 'number' },
  { key: 'batch', label: 'Batch', visible: true, kind: 'text' },
  { key: 'cast', label: 'Batch', visible: true, kind: 'text' },
  { key: 'bundleNo', label: 'Bundle No', visible: true, kind: 'number' },
  { key: 'netMt', label: 'Net Wt.', visible: true, kind: 'mt' },
  { key: 'grossMt', label: 'Gross Wt.', visible: true, kind: 'mt' },
  { key: 'container', label: 'Container ID', visible: true, kind: 'text' },
];

export class SusFormatError extends Error {}

/** "ASIA DEAL HUB PTE. LTD. 12 MARINA BOULEVARD …" → "ASIA DEAL HUB PTE. LTD" (the sample prints the name only). */
export function applicantName(v: string | null | undefined): string {
  const t = String(v ?? '').trim();
  const m = /^(.*?\bPTE\.?\s*LTD)\b/i.exec(t);
  return m ? m[1] : t.split(/\n|,/)[0].trim();
}

const norm = (s: string) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const col = (h: string[], ...aliases: string[]) => {
  const n = h.map(norm);
  for (const a of aliases) {
    const i = n.indexOf(norm(a));
    if (i >= 0) return i;
  }
  return -1;
};
const toNum = (s: unknown) => {
  const t = String(s ?? '').replace(/,/g, '').trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const clean = (s: unknown) => String(s ?? '').trim();
const isId = (s: string) => /^(?=.*\d)[0-9A-Z]{5,}$/i.test(s);

/** Cast of a Vedanta bundle batch: "265C118609" → cast "265C1186", bundle 9 (the batch is the cast + a 2-digit bundle no.). */
export function splitBatch(batch: string): { cast: string; bundleNo: number | null } {
  const b = clean(batch);
  const m = /^([0-9]{3}[A-Z][0-9]{4})([0-9]{1,3})$/i.exec(b);
  if (!m) return { cast: b.length > 8 ? b.slice(0, 8) : b, bundleNo: b.length > 8 ? toNum(b.slice(8)) : null };
  return { cast: m[1], bundleNo: Number(m[2]) };
}

/**
 * COA_集計ファイル rows: one per cast. Per-bundle input (COA.xls: Batch + Cast No, or a batch only) is grouped by cast —
 * weights summed, bundles counted, chemistry averaged (4 dp, as Vedanta prints; equal within a cast); a cast summary
 * (a Bundle column) is taken as is. Pieces = the file's own, else bundles × piecesPerBundle (SUS sample: 5 per bundle).
 */
export function buildSusCoaSummary(sheet: Sheet, opts: { piecesPerBundle?: number | null } = {}): { columns: GenColumn[]; rows: GenRow[]; notes: string[]; totals: { netMt: number; grossMt: number; bundles: number; pieces: number | null } } {
  const grid = [sheet.headers, ...sheet.rows];
  let hi = -1;
  for (let i = 0; i < Math.min(grid.length, 12); i++) {
    if ((col(grid[i], 'Cast No', 'CastNo') >= 0 || col(grid[i], 'Batch') >= 0) && col(grid[i], 'FE') >= 0) {
      hi = i;
      break;
    }
  }
  if (hi < 0) throw new SusFormatError('Not a Vedanta COA: no header row with Cast No (or Batch) and the element columns (FE, SI …)');
  const h = grid[hi];
  const iCast = col(h, 'Cast No', 'CastNo');
  const iBatch = col(h, 'Batch', 'Batch No');
  const iMat = col(h, 'Material');
  const iNet = col(h, 'Net Wt', 'Net WT', 'NetWt', 'Net Weight');
  const iGross = col(h, 'Gross WT', 'Gross Wt', 'GrossWt', 'Gross Weight');
  const iBundle = col(h, 'Bundle', 'Bundles');
  const iPieces = col(h, 'PIECES', 'Pieces', 'PCS');
  const iLen = col(h, 'Length');
  const iSize = col(h, 'Size');
  const iEl = Object.fromEntries(COA_ELEMENTS.map((e) => [e, e === 'OTTOT' ? col(h, 'OTTOT', 'Other Total') : col(h, e)])) as Record<string, number>;
  const groups = new Map<string, string[][]>();
  for (const r of grid.slice(hi + 1)) {
    if (/total/i.test(r.join(' '))) continue;
    const cast = iCast >= 0 ? clean(r[iCast]) : iBatch >= 0 ? splitBatch(clean(r[iBatch])).cast : '';
    if (!isId(cast)) continue;
    groups.set(cast, [...(groups.get(cast) ?? []), r]);
  }
  if (!groups.size) throw new SusFormatError('The COA has no cast rows');
  const ppb = Number(opts.piecesPerBundle) > 0 ? Number(opts.piecesPerBundle) : null;
  const first = (rows: string[][], i: number) => (i < 0 ? null : rows.map((r) => clean(r[i])).find(Boolean) ?? null);
  const sum = (rows: string[][], i: number) => (i < 0 ? null : r3(rows.reduce((a, r) => a + (toNum(r[i]) ?? 0), 0)));
  // Casts in cast-number order (as every SUS sample: 265C1132, 265C1134 … 266C1139).
  const rows: GenRow[] = [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([cast, g]) => {
    const bundles = iBundle >= 0 ? g.reduce((a, r) => a + (toNum(r[iBundle]) ?? 0), 0) : g.length;
    const pieces = iPieces >= 0 ? g.reduce((a, r) => a + (toNum(r[iPieces]) ?? 0), 0) : ppb ? bundles * ppb : null;
    const row: GenRow = { batch: cast, material: first(g, iMat), netwt: sum(g, iNet), grosswt: sum(g, iGross), bundles, pieces, length: first(g, iLen), size: first(g, iSize) };
    for (const e of COA_ELEMENTS) {
      const vals = iEl[e] < 0 ? [] : g.map((r) => toNum(r[iEl[e]])).filter((v): v is number => v !== null);
      row[e.toLowerCase()] = vals.length ? (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(4) : null;
    }
    return row;
  });
  const totals = {
    netMt: r3(rows.reduce((a, r) => a + (Number(r.netwt) || 0), 0)),
    grossMt: r3(rows.reduce((a, r) => a + (Number(r.grosswt) || 0), 0)),
    bundles: rows.reduce((a, r) => a + (Number(r.bundles) || 0), 0),
    pieces: rows.some((r) => r.pieces !== null && r.pieces !== undefined) ? rows.reduce((a, r) => a + (Number(r.pieces) || 0), 0) : null,
  };
  const read = [...groups.values()].reduce((a, g) => a + g.length, 0);
  const missing = [...COA_ELEMENTS.filter((e) => iEl[e] < 0), ...(iGross < 0 ? ['Gross WT'] : []), ...(iMat < 0 ? ['Material'] : [])];
  const notes = [
    `${rows.length} cast${rows.length === 1 ? '' : 's'} from ${read} row${read === 1 ? '' : 's'} (${iBundle >= 0 ? 'cast summary' : 'per bundle, summed per cast'})`,
    ...(iPieces < 0 ? [ppb ? `PIECES = bundles × ${ppb} (Org Settings → pieces per bundle)` : 'PIECES left blank: the file has none and no pieces-per-bundle is set'] : []),
    ...(missing.length ? [`Not in the file (left blank): ${missing.join(', ')}`] : []),
  ];
  return { columns: SUS_COA_COLUMNS.map((c) => ({ ...c })), rows, notes, totals };
}

/** SUS PACKING LIST rows from Vedanta's PL (Sl. No. · Batch · Net · Gross · Container ID): cast + bundle no. added. */
export function buildSusPackingList(sheet: Sheet): { columns: GenColumn[]; rows: GenRow[]; notes: string[]; totals: { netMt: number; grossMt: number; bundles: number } } {
  const grid = [sheet.headers, ...sheet.rows];
  let hi = -1;
  for (let i = 0; i < Math.min(grid.length, 12); i++) {
    if (col(grid[i], 'Batch') >= 0 && col(grid[i], 'Net Wt.', 'Net Wt', 'NetWt') >= 0) {
      hi = i;
      break;
    }
  }
  if (hi < 0) throw new SusFormatError('Not a Vedanta packing list: no header row with Batch and Net Wt.');
  const h = grid[hi];
  const iBatch = col(h, 'Batch');
  const iNet = col(h, 'Net Wt.', 'Net Wt', 'NetWt');
  const iGross = col(h, 'Gross Wt.', 'Gross Wt', 'GrossWt');
  const iCont = col(h, 'Container ID', 'Container', 'Container No');
  const rows: GenRow[] = [];
  let sub: { net: number | null; gross: number | null } | null = null;
  for (const r of grid.slice(hi + 1)) {
    const batch = clean(r[iBatch]);
    if (!isId(batch) || /total/i.test(r.join(' '))) {
      if (toNum(r[iNet]) !== null) sub = { net: toNum(r[iNet]), gross: toNum(r[iGross]) };
      continue;
    }
    const { cast, bundleNo } = splitBatch(batch);
    rows.push({ no: rows.length + 1, batch, cast, bundleNo, netMt: toNum(r[iNet]), grossMt: iGross >= 0 ? toNum(r[iGross]) : null, container: iCont >= 0 ? clean(r[iCont]) || null : null });
  }
  if (!rows.length) throw new SusFormatError('The packing list has no bundle rows');
  const totals = { netMt: r3(rows.reduce((a, r) => a + (Number(r.netMt) || 0), 0)), grossMt: r3(rows.reduce((a, r) => a + (Number(r.grossMt) || 0), 0)), bundles: rows.length };
  const notes = [`${rows.length} bundle${rows.length === 1 ? '' : 's'} · net ${totals.netMt} t · gross ${totals.grossMt} t`];
  if (sub?.net !== null && sub?.net !== undefined && r3(sub.net) !== totals.netMt) notes.push(`Net total ${totals.netMt} differs from the file's subtotal ${sub.net}`);
  if (sub?.gross !== null && sub?.gross !== undefined && r3(sub.gross) !== totals.grossMt) notes.push(`Gross total ${totals.grossMt} differs from the file's subtotal ${sub.gross}`);
  return { columns: SUS_PL_COLUMNS.map((c) => ({ ...c })), rows, notes, totals };
}

/** The SUS PACKING LIST as an .xlsx in their sample's layout: one sheet "PL", the header row, the bundles, "Sub Total". */
export async function susPackingListXlsx(rows: GenRow[]): Promise<Buffer> {
  const wb = new Workbook();
  wb.creator = 'AIMS';
  const ws = wb.addWorksheet('PL');
  ws.columns = [8, 14, 12, 11, 10, 10, 16].map((width) => ({ width }));
  ws.addRow(SUS_PL_COLUMNS.map((c) => c.label)).font = { bold: true };
  const n = (v: unknown) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
  rows.forEach((r, i) => ws.addRow([n(r.no) ?? i + 1, r.batch ?? '', r.cast ?? '', n(r.bundleNo), n(r.netMt), n(r.grossMt), r.container ?? '']));
  const t = (k: string) => r3(rows.reduce((a, r) => a + (Number(r[k]) || 0), 0));
  ws.addRow(['', '', null, null, t('netMt'), t('grossMt'), 'Sub Total']).font = { bold: true };
  for (let i = 2; i <= rows.length + 2; i++) for (const c of [5, 6]) ws.getRow(i).getCell(c).numFmt = '0.000';
  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out as ArrayBuffer);
}

export interface SusCoaHeader {
  layout: 'sus';
  title: string;
  producerBlock: string;
  date: string;
  invoiceNo: string;
  goodsDescription: string;
  brand: string;
  origin: string;
  applicant: string;
  /** Printed under the table (blank by default — the sample carries Vedanta's e-signature text; ADH decides). */
  footer: string;
}

const esc = (v: unknown) =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
const mt = (v: unknown) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? '' : String(r3(Number(v))));
const dmy = (d: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d || '');
  return m ? `${m[3]}/${m[2]}/${m[1]}` : esc(d);
};

/**
 * The COA_集計ファイル body, in the layout of ADH's samples (A4 portrait): a boxed producer block (label · value), a
 * boxed "CERTIFICATE OF ANALYSIS:" block with the key lines, then the cast table without cell borders and its total
 * row under a rule. Vedanta's logo is not reproduced; the footer (their e-signature lines) is ADH's to fill.
 */
export function renderSusCoaHtml(h: Partial<Omit<SusCoaHeader, 'layout'>> & { layout?: string }, columns: GenColumn[], rows: GenRow[]): { css: string; body: string } {
  const cols = columns.filter((c) => c.visible);
  const num = (c: GenColumn) => c.kind === 'mt' || c.kind === 'number' || /^(fe|si|ti|mn|mg|zn|pb|cu|cr|al|ottot|zr|length)$/.test(c.key);
  const total = (k: string) => (rows.some((r) => r[k] !== null && r[k] !== undefined && r[k] !== '') ? rows.reduce((a, r) => a + (Number(r[k]) || 0), 0) : null);
  const totalCell = (c: GenColumn) => (c.key === 'netwt' || c.key === 'grosswt' ? mt(total(c.key)) : c.key === 'bundles' || c.key === 'pieces' ? String(total(c.key) ?? '') : '');
  const producer = String(h.producerBlock ?? '')
    .split('\n')
    .map((l) => {
      const m = /^([^:]+?)\s*:\s*(.*)$/.exec(l);
      return m ? `<tr><td class="pk">${esc(m[1])} :</td><td>${esc(m[2])}</td></tr>` : `<tr><td></td><td>${esc(l)}</td></tr>`;
    })
    .join('');
  const kv: Array<[string, string]> = [
    ['Date', dmy(h.date ?? '')],
    ['Invoice Number', esc(h.invoiceNo)],
    ['Description of Goods', esc(h.goodsDescription)],
    ['Brand', esc(h.brand)],
    ['Country of Origin', esc(h.origin)],
    ['Applicant', esc(h.applicant)],
  ];
  const css = `
  @page { size: A4; margin: 12mm 10mm; }
  body { font-size: 8pt; }
  .box { border: 1.2px solid #111; padding: 8px 12px; margin-bottom: 10px; }
  table.prod { margin-left: 45%; border-collapse: collapse; font-size: 7.6pt; } table.prod td { padding: 4px 6px; vertical-align: top; } td.pk { white-space: nowrap; width: 90px; }
  .ttl { text-align: center; font-size: 7.6pt; margin: 2px 0 10px; }
  table.kv { margin-left: 12%; border-collapse: collapse; font-size: 7.6pt; } table.kv td { padding: 6px 8px; } table.kv td.k { width: 230px; }
  table.grid { width: 100%; border-collapse: collapse; margin-top: 14px; font-size: 6.9pt; }
  table.grid th { font-weight: 400; padding: 2px 2px 14px; text-align: center; }
  table.grid td { padding: 2px; text-align: center; font-variant-numeric: tabular-nums; }
  table.grid td.num { text-align: right; }
  table.grid tr.tot td { border-top: 1px solid #111; }
  .foot { margin-top: 18px; white-space: pre-line; font-size: 7.4pt; }
  `;
  const body = `
  <div class="box"><table class="prod">${producer}</table></div>
  <div class="box">
    <div class="ttl">${esc(h.title || 'CERTIFICATE OF ANALYSIS')}:</div>
    <table class="kv">${kv.map(([k, v]) => `<tr><td class="k">${k}</td><td>:&nbsp; ${v}</td></tr>`).join('')}</table>
  </div>
  <table class="grid"><thead><tr>${cols.map((c) => `<th>${esc(c.label)}</th>`).join('')}</tr></thead>
  <tbody>${rows.map((r) => `<tr>${cols.map((c) => `<td class="${num(c) ? 'num' : ''}">${c.kind === 'mt' ? mt(r[c.key]) : esc(r[c.key] ?? '')}</td>`).join('')}</tr>`).join('')}
  <tr class="tot">${cols.map((c) => `<td class="${num(c) ? 'num' : ''}">${totalCell(c)}</td>`).join('')}</tr></tbody></table>
  ${h.footer ? `<div class="foot">${esc(h.footer)}</div>` : ''}
  `;
  return { css, body };
}

/** The SUS PACKING LIST as HTML (the editor preview; the final file is the .xlsx). */
export function renderSusPlHtml(title: string, rows: GenRow[]): { css: string; body: string } {
  const t = (k: string) => mt(rows.reduce((a, r) => a + (Number(r[k]) || 0), 0));
  const css = `
  @page { size: A4; margin: 12mm; }
  body { font-size: 8.5pt; }
  h1 { font-size: 12pt; margin: 0 0 8px; }
  table { border-collapse: collapse; } th, td { border: 1px solid #999; padding: 2px 6px; } th { background: #eee; }
  td.num { text-align: right; font-variant-numeric: tabular-nums; } tr.tot td { font-weight: 700; }
  .note { color: #666; margin-top: 6px; font-size: 7.5pt; }
  `;
  const body = `
  <h1>${esc(title || 'PACKING LIST')}</h1>
  <table><thead><tr>${SUS_PL_COLUMNS.map((c) => `<th>${esc(c.label)}</th>`).join('')}</tr></thead><tbody>
  ${rows.map((r) => `<tr><td class="num">${esc(r.no)}</td><td>${esc(r.batch)}</td><td>${esc(r.cast)}</td><td class="num">${esc(r.bundleNo)}</td><td class="num">${mt(r.netMt)}</td><td class="num">${mt(r.grossMt)}</td><td>${esc(r.container)}</td></tr>`).join('')}
  <tr class="tot"><td></td><td></td><td></td><td></td><td class="num">${t('netMt')}</td><td class="num">${t('grossMt')}</td><td>Sub Total</td></tr>
  </tbody></table>
  <div class="note">Preview — SUS receives this as an Excel file (.xlsx) when the document is finalized.</div>
  `;
  return { css, body };
}
