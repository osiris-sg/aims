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

/** A template line as the API lists it (either stored format). `linked` = has a product / service code. */
export interface TemplateLineView {
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

export interface QuotationTemplate {
  id: string;
  name: string;
  lines: TemplateLineView[];
  category: string | null;
  lineCount: number;
  total: number;
  /** Lines with no product / service code (older typed templates only). */
  unlinked: number;
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

// ── 2026-11-19 rework: templates are made only from a real quotation ────────────────────────────────────────────

/** The editor rows a template keeps: every row but the blank ones (a title needs text). */
export function savableItems(items: any[] | null | undefined): any[] {
  return (Array.isArray(items) ? items : []).filter((it) => {
    if (!it || typeof it !== "object") return false;
    if (it.isGroupHeader) return !!String(it.description ?? "").trim();
    return !!(String(it.description ?? "").trim() || String(it.itemCode ?? "").trim() || String(it.inventoryItemId ?? "").trim());
  });
}

/** "12 lines, total 1,234.00" for the Save as template dialog (titles not counted). */
export function saveAsSummary(items: any[] | null | undefined) {
  return templateTotals(savableItems(items).map((it) => ({ ...it, isGroupHeader: !!it.isGroupHeader })));
}

/**
 * The Save as template request: the quotation's lines as they are in the editor, and its Category. Never the
 * Subject, T&Cs, customer, dates or Remarks. onExisting: what to do when the name is taken.
 */
export function saveAsBody(name: string, items: any[] | null | undefined, formData: any, onExisting?: "replace" | "new") {
  return {
    name: name.trim(),
    items: savableItems(items),
    category: templateHeaderFrom(formData).category || null,
    ...(onExisting ? { onExisting } : {}),
  };
}

/** The template already using this name (case-insensitive), or null. */
export function nameTaken(name: string, templates: Array<Pick<QuotationTemplate, "id" | "name">> | null | undefined) {
  const n = name.trim().toLowerCase();
  if (!n) return null;
  return (templates ?? []).find((t) => t.name.trim().toLowerCase() === n) ?? null;
}

/** The quotations list's "Create Quotation" arrow (Create from template): setting on and a quotation list only. */
export const quotationListTemplates = (enabled: boolean, createDocumentType?: string | null): boolean => !!enabled && isQuotationDocType(createDocumentType);
