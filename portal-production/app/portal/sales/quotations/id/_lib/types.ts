// Interior-design quotation — the `config.quote` tree saved on a Document
// (type QUOTATION, config.templateVariant = "ID"). Mirrors the server renderer
// (api-server-production/src/common/services/document-html/id-quotation.ts).

export type PricingMode = "priced" | "inclusive" | "complimentary";

export interface QuoteInclude {
  id: string;
  text: string;
  qty?: number | null;
  /** Internal: what this include costs us (adds to the item's cost). */
  cost?: number | null;
  /** Only used when pricingMode === "priced" (an include billed separately). */
  amount?: number | null;
  pricingMode?: PricingMode;
}

export interface QuoteItem {
  id: string;
  workItemId?: string | null;
  code?: string | null;
  description: string;
  qty: number | null;
  uom: string; // sqft | ft | nos | trip | lot | ...
  /** Lump-sum amount for the line (their sheet quotes per line, not per unit). */
  amount: number | null;
  pricingMode: PricingMode;
  /** Internal: lump-sum cost for the line (excl. includes' costs). */
  cost: number | null;
  includes: QuoteInclude[];
  /** Internal: reason recorded when the line sits below the margin floor. */
  marginNote?: string;
}

export interface QuoteArea {
  id: string;
  name: string; // "Living Room Area", "Kitchen Area", "General"
  items: QuoteItem[];
}

export interface QuoteSection {
  id: string;
  letter: string;
  title: string;
  notes: string[];
  areas: QuoteArea[];
}

export interface QuoteHeader {
  title: string;
  /**
   * The printed contract / quotation number. Optional: existing quotations
   * have never written it, and the editor falls back to Document.name when it
   * is unset. Editing it renames the document — buildConfig copies it into
   * config.documentInfo.documentNumber, which updateDocument() writes to
   * Document.name. The server renderer already reads it FIRST
   * (id-quotation.ts: `h.contractNo || documentInfo.documentNumber || name`),
   * so this populates a key the print layout has always expected.
   */
  contractNo?: string | null;
  clientName: string;
  nric: string;
  address: string;
  contact: string;
  agreementDate: string | null; // ISO date
  remarks: string;
  designer: string;
  designerPhone: string;
  paymentTerms: string;
}

export interface QuoteDiscount {
  id: string;
  label: string;
  amount: number;
}

export interface IdQuote {
  version: 1;
  header: QuoteHeader;
  sections: QuoteSection[];
  summary: { designFeePct: number; discounts: QuoteDiscount[] };
  terms: { paymentTerms: string[]; clauses: string[] };
  settings: { marginGuidelinePct: number; marginFloorPct: number };
}

// ── work library (RevenueItem + WorkSection from the API) ──────────────────
export interface WorkSection {
  id: string;
  letter: string | null;
  title: string;
  defaultNotes: string[];
  sortOrder: number;
  isActive: boolean;
}

export interface WorkItem {
  id: string;
  code: string | null;
  name: string;
  unitPrice: number | null;
  unitCost: number | null;
  uom: string | null;
  pricingMode: PricingMode | string;
  descriptionTemplate: string | null;
  includes: Array<{ text: string; qty?: number }> | null;
  workSectionId: string | null;
  workSection?: { id: string; letter: string | null; title: string } | null;
  accountCode: string;
  isActive: boolean;
}

export interface QuoteDocument {
  id: string;
  name: string | null;
  type: string;
  status: string;
  version: number;
  documentTemplateId: string;
  projectId?: string | null;
  config: any;
  createdAt?: string;
  updatedAt?: string;
}
