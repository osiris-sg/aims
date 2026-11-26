// WCT document screens (features.enableWctDocNav, WCT group 2026-11-17). Pure helpers, tested by
// helpers/wctDocUi.test.mjs. Off = every screen exactly as before.

/**
 * "Back to order ORD…" on the DO toolbar and the service report page: gone with enableWctDocNav, where
 * the left Back (helpers/appNav.ts) returns to the previous page (the order, when it was opened from there).
 * The quotation's "Go to order" toolbar button was removed 2026-11-19 (the page's "Order … created · Open order" banner stays).
 */
export const showBackToOrder = (wctDocNav: boolean): boolean => !wctDocNav;

/**
 * The legacy editor chrome (every document editor, the PV / JV / OR / purchase journal): a 204px gutter on
 * BOTH sides of the document, the module rail (Audit Trail, Stock Card…) sitting in the left one. The gutters
 * only apply from this breakpoint (1200px) up — on a split screen they left the document a sliver (guru
 * 2026-11-26, "if a certain size width remove the margin"); narrower, the document gets the plain 16px gutter
 * and the rail sits ABOVE the content as a row of buttons (docRailSx / EditorRail responsive).
 */
export const DOC_GUTTER_BP = "lg" as const;
export const DOC_GUTTER = "204px";

/** Side padding/margin of the editor's toolbar, banner and body: the framed gutter from lg, 16px below. */
export function docGutter(framed: boolean): Record<string, number | string> {
  return framed ? { xs: 1, md: 2, [DOC_GUTTER_BP]: DOC_GUTTER } : { xs: 1, md: 2 };
}

/** The rail box: in the left gutter (absolute, `left` from the content's edge) from lg; a static row above the content below. */
export function docRailSx(framed: boolean, left: string | number = "-192px"): Record<string, unknown> | undefined {
  if (!framed) return undefined;
  return {
    position: { xs: "static", [DOC_GUTTER_BP]: "absolute" },
    left: { [DOC_GUTTER_BP]: left },
    top: { [DOC_GUTTER_BP]: 8 },
    width: { xs: "100%", [DOC_GUTTER_BP]: 172 },
    mb: { xs: 1, [DOC_GUTTER_BP]: 0 },
  };
}

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
    // Number columns are fixed in px (2026-11-21, guru: "a lot of things are going
    // beyond their row"): at 8% of a narrow table the 80-90px number boxes ran
    // into the next column. Description ("auto") absorbs whatever is left.
    case "uom":
      return "106px"; // its text box is 90px + cell padding
    case "quantity":
    case "tax":
      return "96px";
    case "unitPrice":
    case "salePrice":
    case "amount":
    case "discount":
    case "receivedQty":
      return "112px";
    default:
      return "auto";
  }
}

/** Whether the editor draws the S/No cell as the narrow wrapping box (else the generic text field). */
export const isNarrowSnoCell = (columnId: string, narrowSno: boolean): boolean => narrowSno && columnId === SNO_COLUMN;

/**
 * The editor's title bar is TWO ROWS for every org (guru 2026-11-23: "like WCT, move the back button and
 * invoice details to the top while the buttons go below"): row 1 = back arrow · document number · status
 * pills · Saved; row 2 = the action buttons, left-aligned (guru 2026-11-23 tried right-aligned, then "nvm move it back"),
 * wrapping when the window is narrow. The arrow never
 * shrinks and the number is never cut. (Until 2026-11-23 this was the WCT group's "roomy" variant only; every
 * other org squeezed both onto one row and the number and the Saved pill were the first things to go.)
 */
export function editorTitleBar(_roomy = true) {
  return {
    barWrap: { xs: "wrap", md: "wrap" } as Record<string, string>,
    left: { display: "flex", alignItems: "center", flexWrap: "wrap", columnGap: 1, rowGap: 0.25, minWidth: 0, maxWidth: "100%", flex: "1 0 100%" } as Record<string, unknown>,
    back: { flexShrink: 0 } as Record<string, unknown>,
    noWrap: false,
    title: { minWidth: 0, whiteSpace: "normal", overflowWrap: "anywhere" } as Record<string, unknown>,
    actions: { flex: "1 0 100%", ml: 0, flexShrink: 1, flexWrap: "wrap", justifyContent: "flex-start" } as Record<string, unknown>,
  };
}

/** The "All … for this organization" line under a document list's title: none for the WCT group (enableWctDocNav). */
export const documentListSubtitle = (plural: string, hide: boolean, wctDocNav: boolean): string | undefined =>
  hide || wctDocNav ? undefined : `All ${plural} for this organization`;
