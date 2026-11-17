/**
 * QUOTATION TEMPLATES (2026-11-18, WCT group): the pure line rules shared by the
 * service and its tests. A template line is a trimmed copy of an editor line
 * (config.items[n]) with an explicit line type; "Use" turns the lines back into
 * editor lines with fresh ids and amount = quantity x unit price.
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
