// WCT document screens (features.enableWctDocNav, WCT group 2026-11-17). Pure helpers, tested by
// helpers/wctDocUi.test.mjs. Off = every screen exactly as before.

/**
 * "Back to order ORD…" on the DO toolbar and the service report page: gone with enableWctDocNav, where
 * the left Back (helpers/appNav.ts) returns to the previous page (the order, when it was opened from there).
 * The quotation's "Go to order" stays (it is not a back).
 */
export const showBackToOrder = (wctDocNav: boolean): boolean => !wctDocNav;

/** The S/No line column ("no"). */
export const SNO_COLUMN = "no";

/** WCT narrow S/No: about 4 characters wide (cell padding included); longer text wraps to a 2nd line. */
export const WCT_SNO_WIDTH = "56px";

/**
 * A line table column's header width in the document editor (both layouts). The map is the editor's own;
 * narrowSno (enableWctDocNav) only changes the S/No column, which is otherwise "auto" like any custom column.
 */
export function lineColumnWidth(columnId: string, narrowSno = false): string {
  if (narrowSno && columnId === SNO_COLUMN) return WCT_SNO_WIDTH;
  switch (columnId) {
    case "description":
      return "auto";
    case "item":
      return "10%";
    case "uom":
      return "8%";
    case "quantity":
      return "8%";
    case "unitPrice":
      return "10%";
    case "salePrice":
      return "10%";
    case "tax":
      return "8%";
    case "discount":
      return "11%";
    case "amount":
      return "10%";
    case "receivedQty":
      return "10%";
    default:
      return "auto";
  }
}

/** Whether the editor draws the S/No cell as the narrow wrapping box (else the generic text field). */
export const isNarrowSnoCell = (columnId: string, narrowSno: boolean): boolean => narrowSno && columnId === SNO_COLUMN;
