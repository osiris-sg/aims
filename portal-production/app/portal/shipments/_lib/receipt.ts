// Round O: a receiving step (2 Invoice #1, 11 Invoice #2 / single) with no
// receipt on a closed order, or imported "completed before AIMS", is money AIMS
// never tracked — the step reads "Imported, payment not tracked" and the
// invoice raises no "outstanding" reminder (api trade-alerts.ts
// receiptNotTracked — keep the two rules the same).

/** Steps imported from ADH's task list (api trade-open-orders.ts IMPORT_NOTE). */
export const IMPORT_NOTE = "completed before AIMS (from task list)";

export const receiptNotTracked = (direction: "IN" | "OUT", saved: unknown, recordOpen: boolean, skipReason: string | null | undefined) =>
  direction === "IN" && !saved && (!recordOpen || skipReason === IMPORT_NOTE);
