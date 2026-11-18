/**
 * WCT Racking quotation in the editor (enableRackingLayout, 2026-11-18; WCT Racking only).
 * The PDF side is api-server-production/src/common/services/document-html/wct.ts (design.racking).
 */

/** Put a UOM column right after Qty (free text: unit, lot, bay, month...). Mutates and returns the list. */
export function withRackingUom(columns: string[]): string[] {
  if (columns.includes("uom")) return columns;
  const q = columns.indexOf("quantity");
  if (q >= 0) columns.splice(q + 1, 0, "uom");
  return columns;
}

/**
 * "Signed by" starts as the quotation's salesperson: filled once, while the field has never been set
 * (undefined). A name the user typed, or a field they cleared (""), is left alone. Returns the name to
 * fill, or null for no change.
 */
export function signedByDefault(documentInfo: Record<string, any> | null | undefined): string | null {
  const di = documentInfo || {};
  if (di.signedBy !== undefined && di.signedBy !== null) return null;
  const name = typeof di.salesPersonName === "string" ? di.salesPersonName.trim() : "";
  return name ? name : null;
}
