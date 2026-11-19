// WCT document screens (features.enableWctDocNav, WCT group 2026-11-17). Pure helpers, tested by
// helpers/wctDocUi.test.mjs. Off = every screen exactly as before.

/**
 * "Back to order ORD…" on the DO toolbar and the service report page: gone with enableWctDocNav, where
 * the left Back (helpers/appNav.ts) returns to the previous page (the order, when it was opened from there).
 * The quotation's "Go to order" toolbar button was removed 2026-11-19 (the page's "Order … created · Open order" banner stays).
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

/**
 * The editor's title bar (back arrow, title, order line) beside the action buttons. Off: as before (one row on
 * desktop; a long title is cut with "…" and the arrow can be squeezed when the legacy toolbar is full).
 * roomy (enableWctDocNav, WCT group 2026-11-18): the arrow never shrinks, the title is never cut (it wraps), and
 * the action buttons move onto the next row (right-aligned) when the row is too narrow for both.
 */
export function editorTitleBar(roomy: boolean) {
  if (!roomy) {
    return {
      barWrap: { xs: "wrap", md: "nowrap" } as Record<string, string>,
      left: { display: "flex", alignItems: "center", gap: 1, minWidth: 0, flex: "1 1 auto" } as Record<string, unknown>,
      back: {} as Record<string, unknown>,
      noWrap: true,
      title: { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" } as Record<string, unknown>,
      actions: {} as Record<string, unknown>,
    };
  }
  return {
    barWrap: { xs: "wrap", md: "wrap" } as Record<string, string>,
    left: { display: "flex", alignItems: "center", flexWrap: "wrap", columnGap: 1, rowGap: 0.25, minWidth: 0, maxWidth: "100%", flex: "1 0 auto" } as Record<string, unknown>,
    back: { flexShrink: 0 } as Record<string, unknown>,
    noWrap: false,
    title: { minWidth: 0, whiteSpace: "normal", overflowWrap: "anywhere" } as Record<string, unknown>,
    actions: { ml: "auto", flexShrink: 1, flexWrap: "wrap", justifyContent: "flex-end" } as Record<string, unknown>,
  };
}

/** The "All … for this organization" line under a document list's title: none for the WCT group (enableWctDocNav). */
export const documentListSubtitle = (plural: string, hide: boolean, wctDocNav: boolean): string | undefined =>
  hide || wctDocNav ? undefined : `All ${plural} for this organization`;
