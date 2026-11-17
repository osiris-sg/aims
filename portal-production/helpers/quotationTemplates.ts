// Quotation templates (2026-11-18, WCT group; features.enableQuotationTemplates):
// the editor-toolbar rules and the line maths for the template dialogs. Pure so
// `npm test` covers them; the API (src/quotation-templates) re-checks everything.

export const QUOTATION_DOC_TYPES = ["QUOTATION", "QO", "QO1", "QO2", "QT"];

export const isQuotationDocType = (t?: string | null) => QUOTATION_DOC_TYPES.includes(String(t || "").toUpperCase());

/** Where the quotation keeps its Category (a plain string, round 6). Read with a fallback to the top level. */
export const CATEGORY_KEY = "quotationCategory";

export type LineType = "SERVICE" | "PRODUCT";

export interface TemplateLine {
  itemCode: string;
  inventoryItemId?: string;
  description: string;
  quantity: number;
  unitPrice: number;
  lineType: LineType;
  uom?: string;
  discount?: number;
  accountCode?: string;
  isGroupHeader?: boolean;
}

export interface QuotationTemplate {
  id: string;
  name: string;
  lines: TemplateLine[];
  subject: string | null;
  category: string | null;
  termsAndConditions: string | null;
  lineCount: number;
  total: number;
}

export interface ToolbarInput {
  enabled: boolean;
  documentType?: string | null;
  legacyLayout: boolean;
  templateMode: boolean;
}

/**
 * Which template controls the editor shows. With the setting off (every org but
 * the WCT group) all are false: the legacy toolbar keeps its plain "Add", the
 * standard toolbar gains nothing and the ⋮ menu is unchanged.
 */
export function quotationTemplateControls(i: ToolbarInput) {
  const on = !!i.enabled && isQuotationDocType(i.documentType) && !i.templateMode;
  return {
    legacyAddSplit: on && i.legacyLayout,
    standardAddSplit: on && !i.legacyLayout,
    saveAsTemplate: on,
  };
}

const n = (v: unknown, d: number) => {
  const x = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(x) ? x : d;
};
const round2 = (x: number) => Math.round(x * 100) / 100;

/** The editor's service-row rule (isServiceRow). */
export function isServiceLine(item: any): boolean {
  if (item?.isService) return true;
  if (item?.revenueTag === "service") return true;
  if (item?.inventoryItemId) return false;
  return /^SV\d+$/i.test(String(item?.itemCode || "").trim());
}

/** "Save as template": the editor's current lines, trimmed to what a template keeps. */
export function editorItemsToTemplateLines(items: any[] | null | undefined): TemplateLine[] {
  const out: TemplateLine[] = [];
  for (const it of Array.isArray(items) ? items : []) {
    if (!it || typeof it !== "object") continue;
    const description = String(it.description ?? "").trim();
    const itemCode = String(it.itemCode ?? "").trim();
    if (it.isGroupHeader) {
      if (description) out.push({ itemCode: "", description, quantity: 0, unitPrice: 0, lineType: "SERVICE", isGroupHeader: true });
      continue;
    }
    if (!description && !itemCode) continue;
    const lineType: LineType = isServiceLine(it) ? "SERVICE" : "PRODUCT";
    const line: TemplateLine = { itemCode, description, quantity: n(it.quantity, 1), unitPrice: n(it.unitPrice, 0), lineType };
    if (lineType === "PRODUCT" && it.inventoryItemId) line.inventoryItemId = String(it.inventoryItemId);
    if (typeof it.uom === "string" && it.uom.trim()) line.uom = it.uom.trim();
    if (n(it.discount, 0)) line.discount = n(it.discount, 0);
    if (typeof it.accountCode === "string" && it.accountCode.trim()) line.accountCode = it.accountCode.trim();
    out.push(line);
  }
  return out;
}

export function lineAmount(l: Partial<TemplateLine>): number {
  if (l.isGroupHeader) return 0;
  return round2(n(l.quantity, 0) * n(l.unitPrice, 0) - n(l.discount, 0));
}

export function templateTotals(lines: Partial<TemplateLine>[] | null | undefined) {
  const ls = (Array.isArray(lines) ? lines : []).filter((l) => l && !l.isGroupHeader);
  return { lineCount: ls.length, total: round2(ls.reduce((s, l) => s + lineAmount(l), 0)) };
}

export const money = (v: number) =>
  (Number.isFinite(v) ? v : 0).toLocaleString("en-SG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** The header fields a template carries, read from the editor's form data. */
export function templateHeaderFrom(formData: any) {
  const di = formData?.documentInfo || {};
  const pick = (...vals: unknown[]) => {
    for (const v of vals) if (typeof v === "string" && v.trim()) return v.trim();
    return "";
  };
  return {
    subject: pick(di.subject, formData?.subject),
    category: pick(di[CATEGORY_KEY], formData?.[CATEGORY_KEY]),
    termsAndConditions: pick(di.termsAndConditions, formData?.termsAndConditions),
  };
}
