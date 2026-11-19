// WCT group status set (features.enableWctStatuses, 2026-11-19; same rule as the API's common/wct-statuses.ts).
// Quotation, DO and invoice lists show and filter by these; the API sends each row's `wctStatus`. Display only:
// stored statuses are unchanged and every other org keeps its own. An invoice past its due date with some paid
// reads "Overdue · part paid" (overdue_part_paid, Elroy 2026-11-19); the ONE "Overdue" filter option lists both
// overdue values (the API matches them, common/wct-statuses.ts wctStatusMatches).
export type WctFamily = "QUOTATION" | "DO" | "INVOICE";

export const WCT_STATUS_OPTIONS: Record<WctFamily, Array<{ value: string; label: string }>> = {
  QUOTATION: [
    { value: "unconfirmed", label: "Unconfirmed" },
    { value: "confirmed", label: "Confirmed" },
    // Round 35: an imported ERP Draft / Sent quotation dated more than 6 months ago (never Unconfirmed / Pending).
    { value: "expired", label: "Expired" },
    { value: "cancelled", label: "Cancelled" },
    { value: "declined", label: "Declined" },
  ],
  DO: [
    { value: "draft", label: "Draft" },
    { value: "completed", label: "Completed" },
    { value: "cancelled", label: "Cancelled" },
  ],
  INVOICE: [
    { value: "draft", label: "Draft" },
    { value: "unpaid", label: "Unpaid" },
    { value: "part_paid", label: "Part paid" },
    { value: "paid", label: "Paid" },
    { value: "overdue", label: "Overdue" },
    { value: "credited", label: "Credited" },
    { value: "voided", label: "Voided" },
  ],
};

const FAMILY: Record<string, WctFamily> = { QUOTATION: "QUOTATION", QO: "QUOTATION", QT: "QUOTATION", QO1: "QUOTATION", DELIVERY_ORDER: "DO", DO: "DO", INVOICE: "INVOICE", TI: "INVOICE", TI2: "INVOICE" };
export const wctFamilyOf = (type: unknown): WctFamily | null => FAMILY[String(type ?? "").toUpperCase()] ?? null;
/** One family for the whole list's type set, else null (the list keeps its usual statuses). */
export function wctFamilyOfTypes(types: unknown[] | null | undefined): WctFamily | null {
  if (!types?.length) return null;
  const fams = new Set(types.map((t) => wctFamilyOf(t)));
  return fams.size === 1 && !fams.has(null) ? ([...fams][0] as WctFamily) : null;
}

/** The WCT Status filter options for a list, or null (flag off, or a list that is not one family). */
export const wctStatusOptionsFor = (documentTypes: unknown[] | null | undefined, enabled: boolean) => {
  const fam = enabled ? wctFamilyOfTypes(documentTypes) : null;
  return fam ? WCT_STATUS_OPTIONS[fam] : null;
};

const LABEL: Record<string, string> = {
  unconfirmed: "Unconfirmed",
  confirmed: "Confirmed",
  cancelled: "Cancelled",
  declined: "Declined",
  expired: "Expired",
  draft: "Draft",
  completed: "Completed",
  unpaid: "Unpaid",
  part_paid: "Part paid",
  paid: "Paid",
  overdue: "Overdue",
  overdue_part_paid: "Overdue · part paid",
  credited: "Credited",
  voided: "Voided",
};
const COLOR: Record<string, "default" | "primary" | "success" | "warning" | "info" | "error"> = {
  unconfirmed: "default",
  expired: "default",
  draft: "default",
  confirmed: "primary",
  completed: "success",
  paid: "success",
  unpaid: "warning",
  part_paid: "warning",
  overdue: "error",
  overdue_part_paid: "error",
  credited: "info",
  cancelled: "error",
  declined: "error",
  voided: "error",
};
export const wctStatusLabel = (s: string): string => LABEL[s] ?? s;
export const wctStatusColor = (s: string) => COLOR[s] ?? "default";
