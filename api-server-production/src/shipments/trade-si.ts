/**
 * Round BF — 出庫・納入依頼書 (SHIPPING_INSTRUCTIONS) helpers, pure:
 *  - the product cell ("ビレット") printed line by line, never breaking a word
 *    (ハイスピード / (High speed) / ビレット / (billet) / 152×5800), from the
 *    customer's product "document name" (Clients › Products) or today's text;
 *  - the per-customer SI format (Clients › Document formats › 出庫・納入依頼書):
 *    product line style, weights, default remarks, 運送会社, 倉庫名 — new SIs only;
 *  - the .xlsx: AIMS's own A4 sheet, or ADH's uploaded template filled through a
 *    field → cell mapping (placeholders {{field}}, else the printed labels).
 */
import { Workbook, Worksheet, Borders } from 'exceljs';
import type { ClientProduct } from './clients-products';
import { parseSize } from './clients-products';

// ── product document name ───────────────────────────────────────────────────
export type SiProductStyle = 'JA' | 'JA_EN';
export type SiWeightMode = 'NET_GROSS' | 'GROSS';

/** The customer's SI settings (docFormats.SHIPPING_INSTRUCTIONS.si). */
export interface SiFormat {
  productStyle?: SiProductStyle;
  weightMode?: SiWeightMode;
  /** 備考 lines added under the delivery site's own lines. */
  defaultRemarks?: string;
  carrier?: string;
  warehouseName?: string;
  /** Field → cell overrides for the uploaded .xlsx template ("vessel": "C9", "rows.billet": "D13"). */
  xlsxMapping?: Record<string, string>;
}

const lines = (s: string | null | undefined) =>
  (s ?? '')
    .split(/\r?\n|\s*\/\s*/)
    .map((l) => l.trim())
    .filter(Boolean);

/** The product's document name as cell lines, or null when it has none. */
export function productDocLines(p: Pick<ClientProduct, 'docNameJa' | 'docNameEn' | 'docSize'> | null | undefined, style: SiProductStyle = 'JA_EN'): string[] | null {
  if (!p) return null;
  const ja = lines(p.docNameJa);
  const en = style === 'JA_EN' ? lines(p.docNameEn) : [];
  if (!ja.length && !en.length) return null;
  const out: string[] = [];
  for (let i = 0; i < Math.max(ja.length, en.length); i++) {
    if (ja[i]) out.push(ja[i]);
    if (en[i]) out.push(/^\(.*\)$/.test(en[i]) ? en[i] : `(${en[i]})`);
  }
  const size = (p.docSize ?? '').trim();
  if (size) out.push(size);
  return out;
}

const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, '').toUpperCase();

/** The customer product a shipment ships: same grade (a "6063 HSB" grade matches 6063) and size, a document name first. */
export function siProductFor(products: ClientProduct[] | null | undefined, grade: string | null | undefined, sizeSpec: string | null | undefined): ClientProduct | null {
  const g = norm(grade).match(/^[A-Z]?\d{4}/)?.[0] ?? norm(grade);
  const sz = parseSize(sizeSpec);
  const fits = (products ?? []).filter((p) => {
    if (p.hidden) return false;
    if (p.grade && g && !norm(p.grade).startsWith(g) && !g.startsWith(norm(p.grade))) return false;
    if (sz && p.diameterMm && p.lengthMm && (p.diameterMm !== sz.diameterMm || p.lengthMm !== sz.lengthMm)) return false;
    return !!(p.grade || p.diameterMm);
  });
  return fits.find((p) => productDocLines(p)) ?? null;
}

// ── fitting a cell: lines never break inside a word ─────────────────────────
/** Approximate width of a text in em: full-width (CJK, kana, full-width forms) 1, ASCII ~0.6, space 0.3. */
export function textEm(s: string): number {
  let w = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0) ?? 0;
    if (ch === ' ') w += 0.3;
    else if (c < 0x2e80 || (c >= 0xff61 && c <= 0xff9f)) w += /[()|.,:;'!il]/.test(ch) ? 0.35 : 0.6;
    else w += 1;
  }
  return w;
}
const PT_MM = 0.3528;

/**
 * The cell's lines and font size: each stored line prints on its own line; a line too wide for the cell is split at
 * spaces (never inside a word) and before a size ("ハイスピードビレット152 X 5800" → … / 152 X 5800); then the font
 * shrinks only as much as the widest line needs (down to `minPt`).
 */
export function fitCell(text: string, widthMm: number, basePt: number, minPt: number): { lines: string[]; pt: number } {
  const fits = (s: string, pt: number) => textEm(s) * pt * PT_MM <= widthMm;
  const out: string[] = [];
  for (const raw of (text ?? '').split(/\r?\n/)) {
    let l = raw.trim();
    if (!l) continue;
    // A size glued to the name goes on its own line (today's "…ビレット152 X 5800").
    const m = /^(.*?\D)\s*(\d+(?:\.\d+)?\s*(?:MM)?\s*[X×x]\s*\d+(?:\.\d+)?\s*(?:MM)?)$/i.exec(l);
    const parts = m && m[1].trim() ? [m[1].trim(), m[2].trim()] : [l];
    for (const p of parts) {
      l = p;
      if (fits(l, basePt) || !l.includes(' ')) {
        out.push(l);
        continue;
      }
      let cur = '';
      for (const w of l.split(/\s+/)) {
        const next = cur ? `${cur} ${w}` : w;
        if (cur && !fits(next, basePt)) {
          out.push(cur);
          cur = w;
        } else cur = next;
      }
      if (cur) out.push(cur);
    }
  }
  const widest = Math.max(0, ...out.map(textEm));
  const pt = widest ? Math.max(minPt, Math.min(basePt, Math.floor((widthMm / (widest * PT_MM)) * 10) / 10)) : basePt;
  return { lines: out, pt };
}

// ── SI format (Clients › Document formats) ──────────────────────────────────
const isText = (v: unknown, max: number) => typeof v === 'string' && v.length <= max;
const CELL = /^[A-Z]{1,3}[1-9]\d{0,4}$/;
export const SI_XLSX_FIELDS = ['requestDate', 'toName', 'issuerName', 'title', 'vessel', 'voyageNo', 'blNumber', 'warehouseName', 'weight', 'shipper', 'carrier', 'remarks', 'rows.shipDate', 'rows.deliveryDate', 'rows.destination', 'rows.billet', 'rows.bundles'] as const;

/** Validate the SI settings from the screen; `fail` throws. Empty text clears a value. */
export function cleanSiFormat(raw: unknown, fail: (m: string) => never): SiFormat {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail('si must be an object');
  const r = raw as Record<string, unknown>;
  const out: SiFormat = {};
  if (r.productStyle !== undefined && r.productStyle !== null && r.productStyle !== '') {
    if (r.productStyle !== 'JA' && r.productStyle !== 'JA_EN') fail('productStyle must be JA or JA_EN');
    out.productStyle = r.productStyle;
  }
  if (r.weightMode !== undefined && r.weightMode !== null && r.weightMode !== '') {
    if (r.weightMode !== 'NET_GROSS' && r.weightMode !== 'GROSS') fail('weightMode must be NET_GROSS or GROSS');
    out.weightMode = r.weightMode;
  }
  for (const [k, max] of [
    ['defaultRemarks', 2000],
    ['carrier', 120],
    ['warehouseName', 120],
  ] as const) {
    const v = r[k];
    if (v === undefined || v === null || v === '') continue;
    if (!isText(v, max)) fail(`${k} must be text (up to ${max} characters)`);
    const t = (v as string).trim();
    if (t) out[k] = t;
  }
  if (r.xlsxMapping !== undefined && r.xlsxMapping !== null) {
    if (typeof r.xlsxMapping !== 'object' || Array.isArray(r.xlsxMapping)) fail('xlsxMapping must be an object');
    const m: Record<string, string> = {};
    for (const [k, v] of Object.entries(r.xlsxMapping as Record<string, unknown>)) {
      if (!(SI_XLSX_FIELDS as readonly string[]).includes(k)) fail(`Unknown field "${k}"`);
      if (v === null || v === '') continue;
      const cell = String(v).trim().toUpperCase();
      if (!CELL.test(cell)) fail(`"${v}" is not a cell (e.g. C9)`);
      m[k] = cell;
    }
    if (Object.keys(m).length) out.xlsxMapping = m;
  }
  return out;
}

/** 備考 for a new SI: the delivery site's lines, then the customer's default remarks (a line already there is not repeated). */
export function siRemarks(siteRemarks: string, defaults: string | null | undefined): string {
  const have = siteRemarks.split(/\r?\n/).map((l) => l.trim());
  const extra = (defaults ?? '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !have.includes(l));
  return [siteRemarks, ...extra].filter(Boolean).join('\n');
}

// ── .xlsx ───────────────────────────────────────────────────────────────────
export interface SiSheetHeader {
  requestDate: string;
  toName: string;
  issuerName: string;
  title: string;
  vessel: string;
  voyageNo: string;
  blNumber: string;
  warehouseName: string;
  grossWeightMt: number | null;
  netWeightMt: number | null;
  weightMode?: SiWeightMode;
  /** Round BG: each row carries its own net / gross (the 重量 column per row). */
  weightsPerRow?: boolean;
  shipper: string;
  carrier: string;
  remarks: string;
}
export interface SiSheetRow {
  shipDate: string;
  deliveryDate: string;
  destination: string;
  billet: string;
  bundles: number | null;
  /** Round BG: per-row weights (header.weightsPerRow) — bundles × the LOT's average bundle weight. */
  netMt?: number | null;
  grossMt?: number | null;
}

const has = (v: unknown) => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v));
const t3 = (v: unknown) => Number(v).toLocaleString('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
/** "総重量 41.015トン" / "(正味重量 40.855トン)", as the PDF's 重量 cell. */
export function siWeightLines(h: Pick<SiSheetHeader, 'grossWeightMt' | 'netWeightMt' | 'weightMode'>): string[] {
  return [has(h.grossWeightMt) ? `総重量\n${t3(h.grossWeightMt)}トン` : '', h.weightMode !== 'GROSS' && has(h.netWeightMt) ? `(正味重量\n${t3(h.netWeightMt)}トン)` : ''].filter(Boolean);
}
const md = (d: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d ?? '');
  return m ? `${Number(m[2])}/${Number(m[3])}` : d ?? '';
};
const slashDay = (d: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d ?? '');
  return m ? `${m[1]}/${Number(m[2])}/${Number(m[3])}` : d ?? '';
};
const addressee = (t: string) => (!t.trim() || /御中$/.test(t.trim()) ? t.trim() : `${t.trim()} 御中`);
const blFull = (bl: string) =>
  (bl ?? '')
    .split(/\s*[,;/\n]+\s*|\s{2,}/)
    .map((s) => s.trim())
    .filter(Boolean)
    .join(' / ');

/** The value written for each mapped field. */
export function siFieldValues(h: SiSheetHeader): Record<string, string> {
  return {
    requestDate: slashDay(h.requestDate),
    toName: addressee(h.toName),
    issuerName: h.issuerName,
    title: h.title || '出庫・納入依頼書',
    vessel: h.vessel,
    voyageNo: h.voyageNo,
    blNumber: blFull(h.blNumber),
    warehouseName: h.warehouseName,
    weight: siWeightLines(h).join('\n'),
    shipper: h.shipper,
    carrier: h.carrier,
    remarks: (h.remarks ?? '')
      .split(/\r?\n/)
      .map((l, i) => (i === 0 && l.trim() ? `・　${l.trim()}` : l.trim()))
      .join('\n'),
  };
}

export const SI_XLSX_FONT = '游ゴシック';
const thin = { style: 'thin' as const, color: { argb: 'FF111111' } };
const box: Partial<Borders> = { top: thin, left: thin, bottom: thin, right: thin };

/**
 * AIMS's own .xlsx of the SI: the PDF's A4 layout on one sheet (columns 出荷日 · 納入日 · 納入先 · ビレット · 束数 ·
 * 重量), Japanese font, print area + fit to one A4 page, every cell editable.
 */
export async function siXlsx(h: SiSheetHeader, rows: SiSheetRow[]): Promise<Buffer> {
  const wb = new Workbook();
  wb.creator = 'AIMS';
  const ws = wb.addWorksheet('出庫・納入依頼書', {
    pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 1, horizontalCentered: true, margins: { left: 0.45, right: 0.45, top: 0.5, bottom: 0.55, header: 0.2, footer: 0.2 } },
    views: [{ showGridLines: false }],
  });
  ws.columns = [10.5, 11.5, 33, 17, 7.5, 16].map((width) => ({ width }));
  ws.properties.defaultRowHeight = 18;
  const font = (size = 10.5, bold = false) => ({ name: SI_XLSX_FONT, size, bold, charset: 128 });
  const v = siFieldValues(h);
  const put = (addr: string, value: string | number | null, opts: { size?: number; bold?: boolean; align?: 'left' | 'center' | 'right'; border?: Partial<Borders>; wrap?: boolean; valign?: 'top' | 'middle' } = {}) => {
    const c = ws.getCell(addr);
    c.value = value === null ? null : value;
    c.font = font(opts.size, opts.bold);
    c.alignment = { horizontal: opts.align ?? 'left', vertical: opts.valign ?? 'middle', wrapText: opts.wrap ?? true };
    if (opts.border) c.border = opts.border;
    return c;
  };
  ws.getRow(1).height = 10;
  ws.mergeCells('D2:F2');
  put('D2', `手配依頼日　　${v.requestDate}`, { align: 'right' });
  ws.mergeCells('A3:C3');
  put('A3', v.toName, { size: 12, bold: true, border: { bottom: thin } });
  ws.mergeCells('C5:F5');
  put('C5', v.issuerName, { size: 12, bold: true, align: 'right' });
  ws.getRow(6).height = 24;
  ws.mergeCells('A7:F7');
  const title = put('A7', v.title, { size: 13, align: 'center' });
  title.font = { ...font(13), underline: true };
  ws.getRow(7).height = 26;
  ws.getRow(8).height = 10;
  const kv = (r: number, l1: string, v1: string, l2: string, v2: string) => {
    put(`A${r}`, l1, { border: { bottom: thin } });
    ws.mergeCells(`B${r}:C${r}`);
    put(`B${r}`, v1, { border: { bottom: thin } });
    put(`D${r}`, l2, { border: { bottom: thin }, align: 'right' });
    ws.mergeCells(`E${r}:F${r}`);
    put(`E${r}`, v2, { border: { bottom: thin } });
    ws.getRow(r).height = 22;
  };
  kv(9, '本船', v.vessel, '海事№', v.voyageNo);
  kv(10, 'B/L №', v.blNumber, '倉庫名', v.warehouseName);
  ws.getRow(11).height = 10;
  const head = 12;
  ['出荷日', '納入日', '納入先', 'ビレット', '束数', '重 量'].forEach((label, i) => put(`${'ABCDEF'[i]}${head}`, label, { align: 'center', border: box }));
  const list = rows.length ? rows : [{ shipDate: '', deliveryDate: '', destination: '', billet: '', bundles: null }];
  list.forEach((r, i) => {
    const n = head + 1 + i;
    const billet = fitCell(r.billet, 30, 10.5, 7).lines;
    put(`A${n}`, md(r.shipDate), { align: 'center', border: box, valign: 'top' });
    put(`B${n}`, md(r.deliveryDate), { align: 'center', border: box, valign: 'top' });
    put(`C${n}`, r.destination, { align: 'center', border: box, valign: 'top' });
    put(`D${n}`, billet.join('\n'), { align: 'center', border: box, valign: 'top' });
    put(`E${n}`, has(r.bundles) ? Number(r.bundles) : null, { align: 'center', border: box, valign: 'top' });
    ws.getRow(n).height = Math.max(28, 15 * billet.length + 4);
  });
  const last = head + list.length;
  if (h.weightsPerRow) {
    // Round BG: weights per row (bundles × the LOT's average bundle weight).
    list.forEach((r, i) => put(`F${head + 1 + i}`, siRowWeightLines(r, h.weightMode).join('\n'), { align: 'center', border: box, size: 9.5, valign: 'top' }));
  } else {
    if (list.length > 1) ws.mergeCells(`F${head + 1}:F${last}`);
    put(`F${head + 1}`, v.weight, { align: 'center', border: box, size: 9.5 });
  }
  for (let n = head + 1; n <= last; n++) ws.getCell(`F${n}`).border = box;
  let r = last + 2;
  for (const [label, value] of [
    ['出 荷 主', v.shipper],
    ['運送会社', v.carrier],
  ]) {
    ws.mergeCells(`A${r}:B${r}`);
    put(`A${r}`, label, { align: 'center', border: box });
    ws.getCell(`B${r}`).border = box;
    ws.mergeCells(`C${r}:D${r}`);
    put(`C${r}`, value, { border: box });
    ws.getCell(`D${r}`).border = box;
    ws.getRow(r).height = 20;
    r++;
  }
  r++;
  const notes = v.remarks.split('\n');
  const remStart = r;
  for (let i = 0; i < Math.max(notes.length + 1, 4); i++, r++) {
    ws.mergeCells(`C${r}:F${r}`);
    put(`C${r}`, notes[i] ?? '', { border: { bottom: thin } });
    // C:F is ~73 characters wide (≈ 135 mm): a longer line wraps, so its row grows.
    ws.getRow(r).height = 20 * Math.max(1, Math.ceil((textEm(notes[i] ?? '') * 10.5 * PT_MM) / 135));
  }
  ws.mergeCells(`A${remStart}:B${remStart}`);
  put(`A${remStart}`, '備　　考', { align: 'center', border: box, valign: 'top' });
  ws.pageSetup.printArea = `A1:F${r - 1}`;
  return Buffer.from(await wb.xlsx.writeBuffer());
}

// ── ADH's own template ──────────────────────────────────────────────────────
/** The printed labels the mapping looks for (spaces and full-width spaces ignored). */
const LABELS: Record<string, string[]> = {
  requestDate: ['手配依頼日'],
  vessel: ['本船'],
  voyageNo: ['海事№', '海事No', '海事NO'],
  blNumber: ['B/L№', 'B/LNo', 'B/LNO', 'BL№'],
  warehouseName: ['倉庫名'],
  shipper: ['出荷主'],
  carrier: ['運送会社'],
  remarks: ['備考'],
  'rows.shipDate': ['出荷日'],
  'rows.deliveryDate': ['納入日'],
  'rows.destination': ['納入先'],
  'rows.billet': ['ビレット', '品名'],
  'rows.bundles': ['束数'],
  weight: ['重量'],
};
const squash = (s: string) => s.replace(/[\s　]+/g, '').replace(/[：:]$/, '');
const cellText = (v: unknown): string => {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object' && v && 'richText' in v) return ((v as { richText: Array<{ text: string }> }).richText ?? []).map((x) => x.text).join('');
  if (typeof v === 'object' && v && 'text' in v) return String((v as { text: unknown }).text ?? '');
  return String(v);
};
const colName = (n: number) => {
  let s = '';
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
  return s;
};

export interface SiMappingEntry {
  field: string;
  cell: string | null;
  /** placeholder ({{field}} in the template) · label (next to the printed label) · manual (typed in Document formats) · none */
  how: 'placeholder' | 'label' | 'manual' | 'none';
}

/** The first cell right of `addr` that isn't part of the same merged block. */
function rightOf(ws: Worksheet, row: number, col: number): string {
  const master = ws.getCell(row, col).master?.address;
  for (let c = col + 1; c <= col + 12; c++) {
    const cell = ws.getCell(row, c);
    if (cell.master?.address !== master) return cell.master?.address ?? cell.address;
  }
  return ws.getCell(row, col + 1).address;
}

/** Where each field goes in the template: {{field}} placeholders, else next to / under the printed label; manual overrides win. */
export function siTemplateMapping(ws: Worksheet, manual: Record<string, string> = {}): SiMappingEntry[] {
  const found = new Map<string, SiMappingEntry>();
  let headRow = 0;
  ws.eachRow({ includeEmpty: false }, (row, r) => {
    row.eachCell({ includeEmpty: false }, (cell, c) => {
      if (cell.isMerged && cell.master.address !== cell.address) return;
      const text = cellText(cell.value);
      const ph = /\{\{\s*([\w.]+)\s*\}\}/.exec(text);
      if (ph && (SI_XLSX_FIELDS as readonly string[]).includes(ph[1])) {
        found.set(ph[1], { field: ph[1], cell: cell.address, how: 'placeholder' });
        return;
      }
      const s = squash(text);
      if (/御中$/.test(s) && !found.has('toName')) found.set('toName', { field: 'toName', cell: cell.address, how: 'label' });
      for (const [field, labels] of Object.entries(LABELS)) {
        if (found.get(field)?.how === 'placeholder' || found.has(field)) continue;
        if (!labels.some((l) => squash(l) === s)) continue;
        if (field.startsWith('rows.') || field === 'weight') {
          headRow = headRow || r;
          found.set(field, { field, cell: `${colName(c)}${r + 1}`, how: 'label' });
        } else found.set(field, { field, cell: rightOf(ws, r, c), how: 'label' });
      }
    });
  });
  return (SI_XLSX_FIELDS as readonly string[]).map((field) => (manual[field] ? { field, cell: manual[field], how: 'manual' as const } : (found.get(field) ?? { field, cell: null, how: 'none' as const })));
}

/** Fill ADH's template: header fields into their cells, the delivery rows from each column's first row down. */
export async function fillSiTemplate(template: Buffer, h: SiSheetHeader, rows: SiSheetRow[], manual: Record<string, string> = {}): Promise<{ buffer: Buffer; mapping: SiMappingEntry[] }> {
  const wb = new Workbook();
  await wb.xlsx.load(template as unknown as ArrayBuffer);
  const ws = wb.worksheets[0];
  if (!ws) throw new Error('The template has no sheet');
  const mapping = siTemplateMapping(ws, manual);
  const values = siFieldValues(h);
  const write = (addr: string, value: string | number | null) => {
    const c = ws.getCell(addr);
    c.value = value;
    c.alignment = { ...(c.alignment ?? {}), wrapText: true };
  };
  for (const m of mapping) {
    if (!m.cell || m.field.startsWith('rows.')) continue;
    write(m.cell, values[m.field] ?? '');
  }
  for (const m of mapping) {
    if (!m.cell || !m.field.startsWith('rows.')) continue;
    const key = m.field.slice(5) as keyof SiSheetRow;
    const cell = ws.getCell(m.cell);
    const col = Number(cell.col);
    const first = Number(cell.row);
    rows.forEach((r, i) => {
      const v = r[key];
      const out = key === 'shipDate' || key === 'deliveryDate' ? md(String(v ?? '')) : key === 'bundles' ? (has(v) ? Number(v) : null) : key === 'billet' ? fitCell(String(v ?? ''), 30, 10.5, 7).lines.join('\n') : String(v ?? '');
      write(ws.getCell(first + i, col).address, out);
    });
  }
  return { buffer: Buffer.from(await wb.xlsx.writeBuffer()), mapping };
}

/** Mapping only (the Document formats screen), from the template bytes. */
export async function siTemplateMappingOf(template: Buffer, manual: Record<string, string> = {}): Promise<SiMappingEntry[]> {
  const wb = new Workbook();
  await wb.xlsx.load(template as unknown as ArrayBuffer);
  const ws = wb.worksheets[0];
  if (!ws) throw new Error('The template has no sheet');
  return siTemplateMapping(ws, manual);
}

// ── Round BG: delivery rows (paste from Excel / fill days) ──────────────────
const ymd = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : '');
/**
 * The rows the PDF / .xlsx print: rows without a date (出荷日 or 納入日) are left out, the rest sorted by 納入日 (then
 * 出荷日; a typed non-date text keeps its place at the end). Never prints an empty row.
 */
export function siPrintRows<T extends { shipDate?: unknown; deliveryDate?: unknown }>(rows: T[]): T[] {
  const dated = rows.filter((r) => String(r?.shipDate ?? '').trim() || String(r?.deliveryDate ?? '').trim());
  return dated
    .map((r, i) => ({ r, i }))
    .sort((a, b) => {
      const da = ymd(a.r.deliveryDate) || ymd(a.r.shipDate);
      const db = ymd(b.r.deliveryDate) || ymd(b.r.shipDate);
      if (da && db) return da.localeCompare(db) || ymd(a.r.shipDate).localeCompare(ymd(b.r.shipDate)) || a.i - b.i;
      return da ? -1 : db ? 1 : a.i - b.i;
    })
    .map((x) => x.r);
}

/** One row's 重量 lines (weights per row): "総重量 20.150トン" / "(正味重量 20.080トン)". */
export function siRowWeightLines(r: { netMt?: unknown; grossMt?: unknown }, weightMode?: SiWeightMode | null): string[] {
  return siWeightLines({ grossWeightMt: r.grossMt as any, netWeightMt: r.netMt as any, weightMode: weightMode ?? 'NET_GROSS' } as any);
}
