// Discounts on WCT quotations + invoices (enableWctDocNav, the WCT group; 2026-11-25). The editor already prices a
// line after its own discount (updateItem: % or $ for the line) and has a document "Disc" row (% or $). These two
// helpers only make them visible on the WCT quotation and invoice: a Discount column before Amount, and the Disc row
// under Gross Total. Every other org / document: unchanged.

/** The editor's line columns with "discount" before "amount" (or last), once. */
export function withLineDiscountColumn(columns: string[], on: boolean): string[] {
  if (!on || columns.includes("discount")) return columns;
  const i = columns.indexOf("amount");
  return i < 0 ? [...columns, "discount"] : [...columns.slice(0, i), "discount", ...columns.slice(i)];
}

/** A tab's fields with the document discount row ("Disc", % or $) right after Gross Total, once. */
export function withDocumentDiscountField<F extends { fieldName: string }>(fields: F[], on: boolean): F[] {
  if (!on || fields.some((f) => f.fieldName === "documentInfo.discountPercent")) return fields;
  const i = fields.findIndex((f) => f.fieldName === "documentInfo.grossTotal");
  if (i < 0) return fields;
  const disc = { fieldName: "documentInfo.discountPercent", displayLabel: "Disc", fieldType: "number", required: false } as unknown as F;
  return [...fields.slice(0, i + 1), disc, ...fields.slice(i + 1)];
}

/** On for a WCT-group (enableWctDocNav) quotation or invoice, outside template editing. */
export const wctDiscountsOn = (o: { wctDocNav: boolean; isQuotation: boolean; isInvoice: boolean; templateMode: boolean }) =>
  !!o.wctDocNav && !o.templateMode && (o.isQuotation || o.isInvoice);
