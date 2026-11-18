/**
 * QUOTATION TEMPLATES (2026-11-18, WCT group): the pure line rules shared by the
 * service and its tests.
 *
 * 2026-11-19 rework: a template is made ONLY from a real quotation ("Save as
 * template"), and each line is the editor line itself (config.items[n]) kept
 * exactly: product / service codes and their links (itemCode, inventoryItemId),
 * titles (isGroupHeader), qty, UOM, unit price, line type (isService /
 * revenueTag), tax, account, discount, in order. Only the row id is dropped;
 * "Use" gives each line a fresh id and nothing else changes. Stored as
 * { item } (format 2).
 *
 * Format 1 (the first version's typed lines: itemCode, description, quantity,
 * unitPrice, lineType...) still reads and still "Use"s as before.
 */

export const QUOTATION_TEMPLATES_FLAG = 'enableQuotationTemplates';

/** Quotation document types a template can start ("Use"). */
export const QUOTATION_TYPES = ['QUOTATION', 'QO', 'QO1', 'QO2', 'QT'];

/**
 * Where a quotation keeps its Category (Agent 2, round 6: a plain string on the
 * quotation). One constant so the key is changed in one place if it differs.
 */
export const CATEGORY_KEY = 'quotationCategory';

export const MAX_LINES = 200;
export const MAX_NAME = 120;

export type LineType = 'SERVICE' | 'PRODUCT';

export interface TemplateLine {
  itemCode: string;
  inventoryItemId: string;
  description: string;
  quantity: number;
  unitPrice: number;
  lineType: LineType;
  uom?: string;
  discount?: number;
  accountCode?: string;
  isGroupHeader?: boolean;
}

const str = (v: unknown, max: number) => (typeof v === 'string' ? v : v == null ? '' : String(v)).slice(0, max);
const num = (v: unknown, dflt: number) => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? n : dflt;
};
const round2 = (n: number) => Math.round(n * 100) / 100;

/** The editor's own service-row rule (TabbedDocumentCreator isServiceRow). */
export function isServiceLine(raw: any): boolean {
  if (raw?.isService) return true;
  if (raw?.revenueTag === 'service') return true;
  if (raw?.inventoryItemId) return false;
  return /^SV\d+$/i.test(String(raw?.itemCode || '').trim());
}

/**
 * Editor lines (or lines typed in the template dialog) to stored template lines.
 * Empty rows are dropped; a missing / unknown lineType is read from the row.
 */
export function sanitizeLines(raw: unknown): TemplateLine[] {
  if (!Array.isArray(raw)) return [];
  const out: TemplateLine[] = [];
  for (const r of raw.slice(0, MAX_LINES * 2)) {
    if (!r || typeof r !== 'object') continue;
    const row: any = r;
    const description = str(row.description, 4000).trim();
    const itemCode = str(row.itemCode, 100).trim();
    if (row.isGroupHeader) {
      if (!description) continue;
      out.push({ itemCode: '', inventoryItemId: '', description, quantity: 0, unitPrice: 0, lineType: 'SERVICE', isGroupHeader: true });
    } else {
      if (!description && !itemCode) continue;
      const lineType: LineType =
        row.lineType === 'SERVICE' || row.lineType === 'PRODUCT' ? row.lineType : isServiceLine(row) ? 'SERVICE' : 'PRODUCT';
      const line: TemplateLine = {
        itemCode,
        inventoryItemId: lineType === 'PRODUCT' ? str(row.inventoryItemId, 100).trim() : '',
        description,
        quantity: num(row.quantity, 1),
        unitPrice: round2(num(row.unitPrice, 0)),
        lineType,
      };
      if (typeof row.uom === 'string' && row.uom.trim()) line.uom = str(row.uom, 40).trim();
      const disc = num(row.discount, 0);
      if (disc) line.discount = disc;
      if (typeof row.accountCode === 'string' && row.accountCode.trim()) line.accountCode = str(row.accountCode, 40).trim();
      out.push(line);
    }
    if (out.length >= MAX_LINES) break;
  }
  return out;
}

/** Line count (header rows excluded) and total (sum of quantity x unit price less discount). */
export function templateTotals(lines: unknown): { lineCount: number; total: number } {
  const ls = Array.isArray(lines) ? (lines as TemplateLine[]) : [];
  let lineCount = 0;
  let total = 0;
  for (const l of ls) {
    if (!l || l.isGroupHeader) continue;
    lineCount++;
    total += lineAmount(l);
  }
  return { lineCount, total: round2(total) };
}

export function lineAmount(l: TemplateLine): number {
  const gross = num(l.quantity, 0) * num(l.unitPrice, 0);
  return round2(gross - num(l.discount, 0));
}

/** Stored template lines to editor lines (config.items) for a new quotation. */
export function linesToItems(lines: unknown, seed = Date.now()): any[] {
  const ls = Array.isArray(lines) ? (lines as TemplateLine[]) : [];
  return ls.map((l, i) => {
    const id = seed + i;
    if (l.isGroupHeader) return { id, isGroupHeader: true, description: l.description, quantity: null, unitPrice: null, amount: null };
    const service = l.lineType === 'SERVICE';
    const item: any = {
      id,
      itemCode: l.itemCode || '',
      inventoryItemId: service ? '' : l.inventoryItemId || '',
      description: l.description || '',
      quantity: num(l.quantity, 1),
      unitPrice: num(l.unitPrice, 0),
      uom: l.uom || '',
      discount: num(l.discount, 0),
      amount: lineAmount(l),
      isService: service,
    };
    if (service) item.revenueTag = 'service';
    if (l.accountCode) item.accountCode = l.accountCode;
    return item;
  });
}

export function cleanName(v: unknown): string {
  return str(v, MAX_NAME).replace(/\s+/g, ' ').trim();
}

export function cleanText(v: unknown, max = 8000): string | null {
  const s = str(v, max).trim();
  return s ? s : null;
}

// ── Format 2 (2026-11-19): the editor line kept as is ───────────────────────────────────────────────────────────

/** Keys of an editor line that belong to one quotation, never to a template (the row id). */
const DROP_KEYS = new Set(['id']);
const MAX_ITEM_JSON = 20_000;

export interface StoredItemLine {
  item: Record<string, unknown>;
}

export const isItemLine = (l: unknown): l is StoredItemLine => !!l && typeof l === 'object' && !!(l as any).item && typeof (l as any).item === 'object';

/** An editor row with nothing in it (the editor's blank last row) is not kept. */
function blankRow(it: any): boolean {
  if (it.isGroupHeader) return !String(it.description ?? '').trim();
  return !String(it.description ?? '').trim() && !String(it.itemCode ?? '').trim() && !String(it.inventoryItemId ?? '').trim();
}

/**
 * "Save as template": the quotation editor's lines, kept exactly (JSON copy, row id dropped, blank rows skipped).
 * Header fields are never part of a line, so Subject, T&Cs, customer, dates and Remarks cannot ride along.
 */
export function itemLinesFromEditor(raw: unknown): StoredItemLine[] {
  if (!Array.isArray(raw)) return [];
  const out: StoredItemLine[] = [];
  for (const r of raw.slice(0, MAX_LINES * 2)) {
    if (!r || typeof r !== 'object' || Array.isArray(r)) continue;
    if (blankRow(r)) continue;
    let copy: Record<string, unknown>;
    try {
      const json = JSON.stringify(r);
      if (json.length > MAX_ITEM_JSON) continue;
      copy = JSON.parse(json);
    } catch {
      continue;
    }
    for (const k of DROP_KEYS) delete copy[k];
    out.push({ item: copy });
    if (out.length >= MAX_LINES) break;
  }
  return out;
}

/** One stored line (either format) as the list / preview shows it. `linked` = has a product or service code. */
export interface LineView {
  itemCode: string;
  description: string;
  quantity: number;
  uom: string;
  unitPrice: number;
  amount: number;
  lineType: LineType;
  isGroupHeader: boolean;
  linked: boolean;
}

export function lineView(l: any): LineView {
  const src: any = isItemLine(l) ? l.item : l || {};
  const isGroupHeader = !!src.isGroupHeader;
  const lineType: LineType = isGroupHeader ? 'SERVICE' : isItemLine(l) ? (isServiceLine(src) ? 'SERVICE' : 'PRODUCT') : src.lineType === 'PRODUCT' ? 'PRODUCT' : 'SERVICE';
  const quantity = isGroupHeader ? 0 : num(src.quantity, 1);
  const unitPrice = isGroupHeader ? 0 : num(src.unitPrice, 0);
  const amount = isGroupHeader ? 0 : round2(quantity * unitPrice - num(src.discount, 0));
  const itemCode = str(src.itemCode, 100).trim();
  return {
    itemCode,
    description: str(src.description, 4000),
    quantity,
    uom: str(src.uom, 40).trim(),
    unitPrice,
    amount,
    lineType,
    isGroupHeader,
    linked: isGroupHeader || !!itemCode || !!str(src.inventoryItemId, 100).trim(),
  };
}

/** Line count (titles excluded), total, and lines with no product / service link (older typed templates). */
export function templateSummary(lines: unknown): { lineCount: number; total: number; unlinked: number } {
  const ls = (Array.isArray(lines) ? lines : []).map(lineView);
  const real = ls.filter((l) => !l.isGroupHeader);
  return { lineCount: real.length, total: round2(real.reduce((s, l) => s + l.amount, 0)), unlinked: real.filter((l) => !l.linked).length };
}

/** "Use": stored lines back to editor lines. Format 2 = the very same line with a fresh id; format 1 as before. */
export function storedToItems(lines: unknown, seed = Date.now()): any[] {
  const ls = Array.isArray(lines) ? lines : [];
  return ls.map((l, i) => (isItemLine(l) ? { ...JSON.parse(JSON.stringify(l.item)), id: seed + i } : linesToItems([l], seed + i)[0]));
}

/** "Save as new" on a name that exists: "Name (2)", "Name (3)"... (case-insensitive). */
export function nextFreeName(name: string, taken: string[]): string {
  const lower = new Set(taken.map((t) => t.toLowerCase()));
  if (!lower.has(name.toLowerCase())) return name;
  for (let n = 2; n < 1000; n++) {
    const suffix = ` (${n})`;
    const cand = name.slice(0, MAX_NAME - suffix.length) + suffix;
    if (!lower.has(cand.toLowerCase())) return cand;
  }
  return `${name.slice(0, MAX_NAME - 14)} (${Date.now()})`;
}
