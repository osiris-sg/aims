/**
 * Supplier spreadsheet → rows for in-app Customer PL / Customer COA.
 *
 * Three input shapes, detected from the file's bytes (never the extension):
 *  1. Real Excel — .xlsx (ZIP) / .xls (OLE2) — read with SheetJS, first sheet,
 *     cached cell values only (no formula evaluation, no macros).
 *  2. Tab-delimited text — Vedanta's ".XLS" exports are NOT Excel: ASCII with
 *     CRLF line ends, every cell space-padded, a trailing empty column (header
 *     ends in a tab), blank chemistry columns, and (PL) a "Sub Total" footer
 *     row whose label sits in the Container ID column.
 *  3. CSV.
 * All three become the same string grid, so the row builders below behave
 * identically whatever the format. The header row may sit below a title
 * block: the builders scan the first HEADER_SCAN_ROWS rows for it.
 *
 * Pure functions (no Nest / Prisma) so they can be unit tested.
 */
import * as XLSX from 'xlsx';

export interface Sheet {
  headers: string[];
  rows: string[][];
}

export interface ParsedSheet extends Sheet {
  format: 'xlsx' | 'xls' | 'tsv' | 'csv';
  /** Excel only: the sheet that was read, and every sheet in the workbook. */
  sheetName?: string;
  sheetNames?: string[];
  notes: string[];
}

export interface GenColumn {
  key: string;
  label: string;
  visible: boolean;
  /** 'mt' = 3-decimal metric tonnes, summed in the totals row. */
  kind?: 'text' | 'mt' | 'number';
}

export type GenRow = Record<string, string | number | null>;

export class SheetFormatError extends Error {}

/** Same ceiling as trade-file uploads (TRADE_FILE_MAX_BYTES). */
export const SHEET_MAX_BYTES = 25 * 1024 * 1024;
/** Data rows a prefill will read; more is almost certainly the wrong file. */
export const SHEET_MAX_ROWS = 5000;
/** How far down the header row may sit (title blocks above it). */
export const HEADER_SCAN_ROWS = 10;

const isOle2 = (b: Buffer) => b.length >= 8 && b.readUInt32BE(0) === 0xd0cf11e0 && b.readUInt32BE(4) === 0xa1b11ae1;
const isZip = (b: Buffer) => b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;

/** Split one CSV line, honouring double quotes. */
function splitCsv(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

const tooManyRows = () => new SheetFormatError(`The sheet has more than ${SHEET_MAX_ROWS.toLocaleString('en-US')} rows — upload the packing list / COA on its own`);

/**
 * Grid → Sheet: trim cells, drop blank rows, pad short rows, drop trailing
 * columns that are empty everywhere (Vedanta's trailing tab). The first row
 * is provisionally the header; the builders re-locate it.
 */
function toSheet(grid: string[][]): Sheet {
  let rows = grid.map((r) => r.map((c) => c.trim())).filter((r) => r.some((c) => c !== ''));
  if (!rows.length) throw new SheetFormatError('The file is empty');
  if (rows.length > SHEET_MAX_ROWS + HEADER_SCAN_ROWS) throw tooManyRows();
  const width = Math.max(...rows.map((r) => r.length));
  rows = rows.map((r) => [...r, ...Array(width - r.length).fill('')]);
  let w = width;
  while (w > 0 && rows.every((r) => r[w - 1] === '')) w--;
  rows = rows.map((r) => r.slice(0, w));
  return { headers: rows[0], rows: rows.slice(1) };
}

/**
 * Parse delimited text (tab, else comma; CRLF / LF / CR; UTF-8 or the UTF-16
 * Excel writes for "Unicode text"). Cells are trimmed.
 */
export function parseDelimitedSheet(input: Buffer | string): Sheet {
  return readDelimited(input).sheet;
}

function readDelimited(input: Buffer | string): { sheet: Sheet; delim: '\t' | ',' } {
  let text: string;
  if (Buffer.isBuffer(input)) {
    if (input.length >= 2 && input[0] === 0xff && input[1] === 0xfe) text = input.subarray(2).toString('utf16le');
    else if (input.length >= 2 && input[0] === 0xfe && input[1] === 0xff) text = Buffer.from(input.subarray(2)).swap16().toString('utf16le');
    else {
      if (input.subarray(0, 4096).includes(0)) throw new SheetFormatError('This file could not be read as a spreadsheet (it is not Excel, tab-delimited text or CSV)');
      text = input.toString('utf8');
    }
  } else text = input;
  text = text.replace(/^\uFEFF/, '');
  const lines = text.split(/\r\n|\n|\r/).filter((l) => l.trim() !== '');
  if (!lines.length) throw new SheetFormatError('The file is empty');
  if (lines.length > SHEET_MAX_ROWS + HEADER_SCAN_ROWS) throw tooManyRows();
  // Tab-delimited if any of the first lines has a tab, else CSV.
  const delim: '\t' | ',' = lines.slice(0, HEADER_SCAN_ROWS + 1).some((l) => l.includes('\t')) ? '\t' : ',';
  return { sheet: toSheet(lines.map((l) => (delim === '\t' ? l.split('\t') : splitCsv(l)))), delim };
}

/**
 * A cell as text. Numbers keep the supplier's display ("0.1500") when that
 * text is exactly the stored value, else the full value (a "0.00" format must
 * not round 2.549 t to 2.55). Errors and empty cells are blank.
 */
function cellText(c: XLSX.CellObject | undefined): string {
  if (!c || c.v === undefined || c.v === null || c.t === 'e' || c.t === 'z') return '';
  if (c.t === 'n') {
    const shown = typeof c.w === 'string' ? c.w.trim() : '';
    return shown && Number(shown.replace(/,/g, '')) === c.v ? shown.replace(/,/g, '') : String(c.v);
  }
  return String(c.v);
}

/** Read a real .xlsx / .xls workbook: one sheet, cached cell values only. */
function parseWorkbook(buf: Buffer, format: 'xlsx' | 'xls', sheet?: string): ParsedSheet {
  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(buf, {
      type: 'buffer',
      cellFormula: false, // keep the cached value, never the formula
      cellHTML: false,
      cellNF: false,
      cellStyles: false,
      cellText: true, // formatted text, used below only when it equals the value
      cellDates: false,
      bookVBA: false, // macros are never extracted, let alone run
      sheetRows: SHEET_MAX_ROWS + HEADER_SCAN_ROWS + 1,
      ...(sheet ? { sheets: sheet } : {}),
    });
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    // Office encryption (an OLE2 wrapper with EncryptionInfo) reads as "File is password-protected".
    if (/password/i.test(msg)) throw new SheetFormatError('This Excel file is password-protected — remove the password in Excel (File → Info → Protect Workbook) and upload it again');
    throw new SheetFormatError(`This ${format === 'xlsx' ? '.xlsx' : '.xls'} file could not be read — it may be damaged, or not an Excel workbook`);
  }
  const names = wb.SheetNames ?? [];
  const name = sheet ?? names[0];
  const ws = name ? wb.Sheets[name] : undefined;
  if (!ws) throw new SheetFormatError(sheet ? `No sheet named "${sheet}" (sheets: ${names.join(', ')})` : 'The workbook has no sheets');
  const full = ws['!fullref'] ?? ws['!ref'];
  if (full) {
    const r = XLSX.utils.decode_range(full);
    if (r.e.r - r.s.r + 1 > SHEET_MAX_ROWS + HEADER_SCAN_ROWS) throw tooManyRows();
  }
  const grid: string[][] = [];
  if (ws['!ref']) {
    const r = XLSX.utils.decode_range(ws['!ref']);
    for (let R = r.s.r; R <= r.e.r; R++) {
      const row: string[] = [];
      for (let C = r.s.c; C <= r.e.c; C++) row.push(cellText(ws[XLSX.utils.encode_cell({ r: R, c: C })]));
      grid.push(row);
    }
  }
  const notes = names.length > 1 ? [`Read sheet "${name}" (the workbook has ${names.length} sheets: ${names.join(', ')})`] : [];
  return { ...toSheet(grid), format, sheetName: name, sheetNames: names, notes };
}

/**
 * Any supported spreadsheet → string grid. Detection by signature: ZIP →
 * .xlsx, OLE2 → .xls, else tab-delimited text, else CSV.
 */
export function parseSheetFile(buf: Buffer, opts: { sheet?: string } = {}): ParsedSheet {
  if (buf.length > SHEET_MAX_BYTES) throw new SheetFormatError('The file is larger than 25 MB');
  if (isZip(buf)) return parseWorkbook(buf, 'xlsx', opts.sheet);
  if (isOle2(buf)) return parseWorkbook(buf, 'xls', opts.sheet);
  const { sheet, delim } = readDelimited(buf);
  return { ...sheet, format: delim === '\t' ? 'tsv' : 'csv', notes: [] };
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Index of the first header matching any alias (normalized: "Net Wt." → "netwt"). */
function col(headers: string[], ...aliases: string[]): number {
  const n = headers.map(norm);
  for (const a of aliases) {
    const i = n.indexOf(norm(a));
    if (i >= 0) return i;
  }
  return -1;
}

/**
 * Find the header row: the first of the top HEADER_SCAN_ROWS rows that has
 * every required column (each given as aliases). Rows above it (title block,
 * supplier name) are dropped. Returns null when no row qualifies.
 */
function locateHeader(sheet: Sheet, required: string[][]): Sheet | null {
  const grid = [sheet.headers, ...sheet.rows];
  for (let i = 0; i < Math.min(HEADER_SCAN_ROWS, grid.length); i++) {
    if (required.every((aliases) => col(grid[i], ...aliases) >= 0)) return { headers: grid[i], rows: grid.slice(i + 1) };
  }
  return null;
}

const PL_BATCH = ['Batch', 'Bundle No', 'Bundle', 'Batch No'];
const PL_NET = ['Net Wt.', 'Net Wt', 'Net Weight', 'Net'];
const PL_GROSS = ['Gross Wt.', 'Gross Wt', 'Gross WT', 'Gross Weight', 'Gross'];

const num = (s: string | undefined): number | null => {
  if (s === undefined) return null;
  const t = s.replace(/,/g, '').trim();
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

const isTotalRow = (cells: string[]) => cells.some((c) => /\b(sub\s*)?total\b/i.test(c));

export const round3 = (n: number) => Math.round(n * 1000) / 1000;

export const CUSTOMER_PL_COLUMNS: GenColumn[] = [
  { key: 'no', label: 'No.', visible: true, kind: 'number' },
  { key: 'batch', label: 'Bundle / Batch No.', visible: true, kind: 'text' },
  { key: 'container', label: 'Container', visible: true, kind: 'text' },
  { key: 'netMt', label: 'Net (MT)', visible: true, kind: 'mt' },
  { key: 'grossMt', label: 'Gross (MT)', visible: true, kind: 'mt' },
];

/**
 * Packing list rows: No., Batch, Container, Net, Gross. Total / "Sub Total"
 * rows and rows without a batch are skipped; their figures are returned as
 * `sourceTotals` so the import can be cross-checked.
 */
export function buildCustomerPl(input: Sheet): { columns: GenColumn[]; rows: GenRow[]; sourceTotals: { netMt: number | null; grossMt: number | null } | null; notes: string[] } {
  const sheet = locateHeader(input, [PL_BATCH, PL_NET, PL_GROSS]);
  if (!sheet) {
    const h = input.headers;
    const missing = [col(h, ...PL_BATCH) < 0 && 'Batch', col(h, ...PL_NET) < 0 && 'Net Wt.', col(h, ...PL_GROSS) < 0 && 'Gross Wt.'].filter(Boolean);
    throw new SheetFormatError(`Not a packing list: no header row with ${missing.join(', ')} in the first ${HEADER_SCAN_ROWS} rows (first row: ${h.filter(Boolean).join(', ') || 'blank'})`);
  }
  const h = sheet.headers;
  const iBatch = col(h, ...PL_BATCH);
  const iNet = col(h, ...PL_NET);
  const iGross = col(h, ...PL_GROSS);
  const iCont = col(h, 'Container ID', 'Container', 'Container No');
  const notes: string[] = [];
  const rows: GenRow[] = [];
  let sourceTotals: { netMt: number | null; grossMt: number | null } | null = null;
  for (const r of sheet.rows) {
    if (isTotalRow(r) || !r[iBatch]) {
      if (num(r[iNet]) !== null) sourceTotals = { netMt: num(r[iNet]), grossMt: num(r[iGross]) };
      continue;
    }
    rows.push({ no: rows.length + 1, batch: r[iBatch], container: iCont >= 0 ? r[iCont] || null : null, netMt: num(r[iNet]), grossMt: num(r[iGross]) });
  }
  if (sourceTotals) {
    const t = plTotals(rows);
    if (sourceTotals.netMt !== null && round3(t.netMt) !== round3(sourceTotals.netMt)) notes.push(`Net total ${round3(t.netMt)} differs from the file's subtotal ${sourceTotals.netMt}`);
    if (sourceTotals.grossMt !== null && round3(t.grossMt) !== round3(sourceTotals.grossMt)) notes.push(`Gross total ${round3(t.grossMt)} differs from the file's subtotal ${sourceTotals.grossMt}`);
  }
  return { columns: CUSTOMER_PL_COLUMNS.map((c) => ({ ...c })), rows, sourceTotals, notes };
}

/** Bundles (row count) and net / gross MT sums, rounded to 3 decimals. */
export function plTotals(rows: GenRow[]): { bundles: number; netMt: number; grossMt: number } {
  const sum = (k: string) => round3(rows.reduce((s, r) => s + (Number(r[k]) || 0), 0));
  return { bundles: rows.length, netMt: sum('netMt'), grossMt: sum('grossMt') };
}

/**
 * COA rows: every column of the file (Batch, Cast No, Material, weights,
 * Length, Size, chemistry …). Columns empty in every row start hidden; the
 * user can toggle them. Weights become MT numbers, chemistry stays text so
 * the supplier's precision ("0.0170") is kept.
 */
export function buildCustomerCoa(input: Sheet): { columns: GenColumn[]; rows: GenRow[]; notes: string[] } {
  const sheet = locateHeader(input, [['Batch', 'Batch No']]);
  if (!sheet)
    throw new SheetFormatError(
      `Not a certificate of analysis: no header row with a Batch column in the first ${HEADER_SCAN_ROWS} rows (first row: ${input.headers.filter(Boolean).join(', ') || 'blank'})`,
    );
  const h = sheet.headers;
  const iBatch = col(h, 'Batch', 'Batch No');
  const used = new Set<string>();
  const columns: GenColumn[] = h.map((label, i) => {
    let key = norm(label) || `col${i + 1}`;
    while (used.has(key)) key = `${key}_${i}`;
    used.add(key);
    const n = norm(label);
    const kind: GenColumn['kind'] = ['netwt', 'netweight', 'grosswt', 'grossweight'].includes(n) ? 'mt' : 'text';
    return { key, label: label || `Column ${i + 1}`, visible: true, kind };
  });
  const rows: GenRow[] = [];
  for (const r of sheet.rows) {
    if (isTotalRow(r) || !r[iBatch]) continue;
    const row: GenRow = {};
    columns.forEach((c, i) => {
      const v = r[i] ?? '';
      row[c.key] = c.kind === 'mt' ? num(v) : v === '' ? null : v;
    });
    rows.push(row);
  }
  const hidden: string[] = [];
  for (const c of columns) {
    if (rows.every((r) => r[c.key] === null || r[c.key] === '')) {
      c.visible = false;
      hidden.push(c.label);
    }
  }
  const notes = hidden.length ? [`Hidden because empty in every row: ${hidden.join(', ')}`] : [];
  return { columns, rows, notes };
}
