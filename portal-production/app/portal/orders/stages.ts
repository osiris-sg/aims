/**
 * Pure status-derivation helpers for the slim Orders board (Phase B).
 *
 * These map a linked document's LIVE Document.status (as enriched server-side
 * by orders.service.getById) into the slim board's sub-states, plus per-item
 * pickers that mirror the rich component's `itemIds.includes(itemId)` filter.
 *
 * Deliberately self-contained: NO React, NO imports from CappitechOrderDetail.
 * Phase C (the slim UI) is the consumer; the rich component is untouched.
 */

// The MUI <Chip color> subset we actually use, so Phase C can pass these
// straight through without casting.
export type StageColor = "default" | "info" | "warning" | "success";

// --- Sub-state types -------------------------------------------------------
// null = nothing to show for that column (no doc / not confirmed / unknown).
export type QoStage = "confirmed" | null;
export type DoStage = "draft" | "confirmed" | "delivered" | "installed" | null;
export type InvoiceStage = "draft" | "confirmed" | null;

// --- Minimal data shapes (subset of the /orders/:id payload) ---------------
export interface SourceQuotationRef {
  id: string;
  name: string;
  status: string;
  type: string;
}

// A linkedDocuments bucket entry, as enriched by the backend getById: name +
// live Document.status, plus the order item ids this doc covers.
export interface LinkedDocEntry {
  id: string;
  name: string;
  status: string;
  itemIds?: number[];
}

export interface LinkedDocuments {
  po?: LinkedDocEntry[];
  do?: LinkedDocEntry[];
  invoice?: LinkedDocEntry[];
  salesOrder?: LinkedDocEntry[];
}

// --- Pure derivers ---------------------------------------------------------

/** 'confirmed' only when the originating quotation is confirmed; else null. */
export function qoStage(sourceQuotation?: SourceQuotationRef | null): QoStage {
  return sourceQuotation?.status === "confirmed" ? "confirmed" : null;
}

/** Map a DO's live Document.status into the slim DO sub-state. */
export function doStage(status: string): DoStage {
  switch (status) {
    case "draft":
      return "draft";
    case "confirmed":
      return "confirmed";
    case "delivered_not_installed":
      return "delivered";
    case "delivered_installed":
      return "installed";
    default:
      return null; // defensive: any other enum value isn't a slim DO state
  }
}

/** Map an invoice's live Document.status into the slim invoice sub-state. */
export function invoiceStage(status: string): InvoiceStage {
  switch (status) {
    case "draft":
      return "draft";
    case "confirmed":
      return "confirmed";
    default:
      return null; // pending_payment / paid etc. aren't slim "Confirmed" states
  }
}

// --- Per-item pickers (pure; mirror linkedDocsFor's itemIds filter) --------

function pickForItem(
  list: LinkedDocEntry[] | undefined,
  itemId?: number,
): LinkedDocEntry[] {
  if (itemId == null || !Array.isArray(list)) return [];
  return list.filter(
    (d) => Array.isArray(d.itemIds) && d.itemIds.includes(itemId),
  );
}

/** DO linked docs covering this order item. */
export function doForItem(
  linkedDocuments: LinkedDocuments | null | undefined,
  itemId?: number,
): LinkedDocEntry[] {
  return pickForItem(linkedDocuments?.do, itemId);
}

/** Invoice linked docs covering this order item. */
export function invoiceForItem(
  linkedDocuments: LinkedDocuments | null | undefined,
  itemId?: number,
): LinkedDocEntry[] {
  return pickForItem(linkedDocuments?.invoice, itemId);
}

// --- Label / colour maps (consumed by Phase C) -----------------------------

export const DO_STAGE_LABEL: Record<Exclude<DoStage, null>, string> = {
  draft: "Draft",
  confirmed: "Confirmed",
  delivered: "Delivered",
  installed: "Installed",
};

export const DO_STAGE_COLOR: Record<Exclude<DoStage, null>, StageColor> = {
  draft: "default",
  confirmed: "info",
  delivered: "warning",
  installed: "success",
};

export const INVOICE_STAGE_LABEL: Record<Exclude<InvoiceStage, null>, string> = {
  draft: "Draft",
  confirmed: "Confirmed",
};

export const INVOICE_STAGE_COLOR: Record<Exclude<InvoiceStage, null>, StageColor> = {
  draft: "default",
  confirmed: "info",
};

export const QO_STAGE_LABEL: Record<Exclude<QoStage, null>, string> = {
  confirmed: "Confirmed",
};

export const QO_STAGE_COLOR: Record<Exclude<QoStage, null>, StageColor> = {
  confirmed: "success",
};
