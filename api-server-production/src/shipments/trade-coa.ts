/**
 * Vedanta COA → the customer COA (納品書兼分析試験成績報告書): one analysis row
 * per cast. Pure functions (unit tested). Accepted inputs, all reduced to the
 * same Sheet (headers + string rows):
 *  - the per-bundle COA spreadsheet (COA.XLS: Batch, Cast No, Net Wt …, FE … ZR)
 *    → bundles grouped by Cast No, chemistry averaged, net weight summed;
 *  - the cast summary PDF (COA_集計: Cast No, Net WT, Bundle, PIECES, FE …)
 *    and Vedanta's official COA PDF (per bundle) via their extracted text.
 */
import type { GenColumn, GenRow, Sheet } from './trade-sheet.parser';

/** The analysis columns ADH prints, in ADH's order. */
export const COA_ELEMENTS = ['FE', 'SI', 'TI', 'MN', 'MG', 'ZN', 'PB', 'CU', 'CR', 'AL', 'OTTOT', 'ZR'] as const;

/** Customer COA (ADH layout) columns: Batch (= cast), the elements, then bundles / net (summed into 品種). */
export const COA_JP_COLUMNS: GenColumn[] = [
  { key: 'batch', label: 'Batch', visible: true, kind: 'text' },
  ...COA_ELEMENTS.map((e): GenColumn => ({ key: e.toLowerCase(), label: e, visible: true, kind: 'text' })),
  { key: 'bundles', label: 'Bundles', visible: true, kind: 'number' },
  { key: 'netwt', label: 'Net Wt (MT)', visible: true, kind: 'mt' },
];
/** Columns that feed the 品種 box, not the analysis table. */
export const COA_JP_SUMMARY_KEYS = ['bundles', 'netwt'];

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const find = (headers: string[], ...aliases: string[]) => {
  const h = headers.map(norm);
  for (const a of aliases) {
    const i = h.indexOf(norm(a));
    if (i >= 0) return i;
  }
  return -1;
};
const toNum = (s: string | undefined) => {
  const t = (s ?? '').replace(/,/g, '').trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};
const r3 = (n: number) => Math.round(n * 1000) / 1000;

export class CoaFormatError extends Error {}

/**
 * Cast rows from any COA sheet. Per-bundle input (a Batch column, or no Bundle
 * column) is grouped by cast: elements averaged (4 dp, as Vedanta prints),
 * bundles counted, net summed. A cast summary (Bundle column) is taken as is.
 */
export function buildCustomerCoaJp(sheet: Sheet): { columns: GenColumn[]; rows: GenRow[]; notes: string[]; totals: { bundles: number; netMt: number; pieces: number | null } } {
  const grid = [sheet.headers, ...sheet.rows];
  let hi = -1;
  for (let i = 0; i < Math.min(grid.length, 12); i++) {
    if (find(grid[i], 'Cast No', 'Cast No.', 'CastNo') >= 0 || (find(grid[i], 'Batch', 'Batch No') >= 0 && find(grid[i], 'FE', 'Fe') >= 0)) {
      hi = i;
      break;
    }
  }
  if (hi < 0) throw new CoaFormatError('Not a Vedanta COA: no header row with Cast No (or Batch) and the element columns (FE, SI …)');
  const h = grid[hi];
  const iCast = find(h, 'Cast No', 'Cast No.', 'CastNo');
  const iBatch = find(h, 'Batch', 'Batch No');
  const iNet = find(h, 'Net Wt', 'Net WT', 'Net Wt.', 'NetWt', 'Net Weight');
  const iBundle = find(h, 'Bundle', 'Bundles');
  const iPieces = find(h, 'PIECES', 'Pieces', 'PCS');
  const iEl = Object.fromEntries(COA_ELEMENTS.map((e) => [e, e === 'OTTOT' ? find(h, 'OTTOT', 'Other Total', 'OtherTotal') : find(h, e)])) as Record<string, number>;
  const keyCol = iCast >= 0 ? iCast : iBatch;
  const groups = new Map<string, { rows: string[][] }>();
  for (const r of grid.slice(hi + 1)) {
    const key = (r[keyCol] ?? '').trim();
    // Data rows only: a cast / batch id (digits and letters); totals and repeated headers are skipped.
    if (!/^(?=.*\d)[0-9A-Z]{5,}$/i.test(key) || /total/i.test(r.join(' '))) continue;
    const g = groups.get(key) ?? { rows: [] };
    g.rows.push(r);
    groups.set(key, g);
  }
  if (!groups.size) throw new CoaFormatError('The COA has no cast rows');
  const missing = COA_ELEMENTS.filter((e) => iEl[e] < 0);
  const rows: GenRow[] = [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([cast, g]) => {
      const row: GenRow = { batch: cast };
      for (const e of COA_ELEMENTS) {
        const vals = iEl[e] < 0 ? [] : g.rows.map((r) => toNum(r[iEl[e]])).filter((v): v is number => v !== null);
        row[e.toLowerCase()] = vals.length ? (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(4) : null;
      }
      row.bundles = iBundle >= 0 ? g.rows.reduce((a, r) => a + (toNum(r[iBundle]) ?? 0), 0) : g.rows.length;
      row.netwt = iNet >= 0 ? r3(g.rows.reduce((a, r) => a + (toNum(r[iNet]) ?? 0), 0)) : null;
      if (iPieces >= 0) row.pieces = g.rows.reduce((a, r) => a + (toNum(r[iPieces]) ?? 0), 0);
      return row;
    });
  const bundles = rows.reduce((a, r) => a + (Number(r.bundles) || 0), 0);
  const netMt = r3(rows.reduce((a, r) => a + (Number(r.netwt) || 0), 0));
  const pieces = iPieces >= 0 ? rows.reduce((a, r) => a + (Number(r.pieces) || 0), 0) : null;
  const read = [...groups.values()].reduce((a, g) => a + g.rows.length, 0);
  const notes = [
    `${rows.length} cast${rows.length === 1 ? '' : 's'} from ${read} row${read === 1 ? '' : 's'} (${iBundle >= 0 ? 'cast summary' : 'per bundle, averaged per cast'})`,
    ...(missing.length ? [`Not in the file (left blank): ${missing.join(', ')}`] : []),
  ];
  return { columns: COA_JP_COLUMNS.map((c) => ({ ...c })), rows, notes, totals: { bundles, netMt, pieces } };
}

/**
 * Text of a Vedanta COA PDF → Sheet. Multi-word headers are joined into one
 * token ("Cast No" → CastNo, "Net WT" → NetWt, "Other Total" → OTTOT) so each
 * data line splits into exactly one value per header; lines that don't match a
 * header's width (addresses, sample dates, totals) are ignored. Repeated
 * headers on later pages are merged.
 */
export function parseCoaPdfText(text: string): Sheet & { date: string | null; invoiceNo: string | null } {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const headerize = (l: string) =>
    l
      .replace(/Batch\s+No\.?/gi, 'Batch')
      .replace(/Cast\s+No\.?/gi, 'CastNo')
      .replace(/Net\s+W[Tt]\.?/g, 'NetWt')
      .replace(/Gross\s+W[Tt]\.?/g, 'GrossWt')
      .replace(/Other\s+Total/gi, 'OTTOT')
      .split(/\s+/);
  let headers: string[] | null = null;
  const rows: string[][] = [];
  for (const l of lines) {
    const toks = headerize(l);
    if (toks.includes('CastNo') && ['FE', 'SI', 'MG'].filter((e) => toks.some((t) => t.toUpperCase() === e)).length >= 2) {
      headers = headers ?? toks;
      continue;
    }
    if (!headers) continue;
    const vals = l.split(/\s+/);
    if (vals.length === headers.length && /^(?=.*\d)[0-9A-Z]{5,}$/i.test(vals[0])) rows.push(vals);
  }
  if (!headers) throw new CoaFormatError('No COA table found in this PDF (expected a "Cast No … FE SI …" header)');
  // Vedanta's per-bundle COA PDF extracts its header date before the label ("22/07/2026DATE :"), the summary after it.
  const dateM = /Date\s*[:：]\s*(\d{2})\/(\d{2})\/(\d{4})/i.exec(text) ?? /(\d{2})\/(\d{2})\/(\d{4})\s*DATE\s*[:：]/i.exec(text);
  const invM = /Invoice\s+Number\s*[:：]\s*([A-Z0-9-]+)/i.exec(text);
  return {
    headers: headers.map((h) => (h === 'NetWt' ? 'Net Wt' : h === 'GrossWt' ? 'Gross Wt' : h === 'CastNo' ? 'Cast No' : h)),
    rows,
    date: dateM ? `${dateM[3]}-${dateM[2]}-${dateM[1]}` : null,
    invoiceNo: invM ? invM[1] : null,
  };
}

/** Text of a PDF (pdf-parse, loaded only when a PDF COA is imported). */
export async function pdfText(buf: Buffer): Promise<string> {
  const { PDFParse } = await import('pdf-parse');
  const r = await new PDFParse({ data: buf }).getText();
  return String(r?.text ?? '');
}

/** What a COA source holds — decides which one "Create from Vedanta file" uses first. */
export type CoaSourceKind = 'summary' | 'report' | 'unknown';
/**
 * Vedanta sends two COA PDFs: the summary (COA_集計: one row per cast with net /
 * gross weight, bundles, pieces and chemistry) and the per-cast test report
 * ("TEST REPORT", chemistry only). The summary is the better source.
 */
export function classifyCoaText(text: string): CoaSourceKind {
  const t = text ?? '';
  if (/cast\s*no/i.test(t) && /net\s*wt/i.test(t) && /bundle/i.test(t)) return 'summary';
  if (/test\s*report|test\s*certificate/i.test(t)) return 'report';
  return 'unknown';
}
