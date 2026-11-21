// Field phase 4 (Timesheets): pure helpers (SiteClock web Timesheets.tsx @62b7d9d) and the oddity warnings
// (FIELD_PLAN.md §6.1): shown, never fixed.

export const ENTRY_STATUS_LABEL: Record<string, string> = { OPEN: "Clocked in", PENDING: "To approve", APPROVED: "Approved", REJECTED: "Rejected", AUTO_CLOSED: "Auto-closed" };

/** 125 -> "2h 5m", 45 -> "45m", null -> "". */
export function hm(min: number | null | undefined): string {
  if (min == null) return "";
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h ? `${h}h${m ? ` ${m}m` : ""}` : `${m}m`;
}

/** SiteClock's crew notes use " — "; shown with a colon in AIMS (the stored note keeps SiteClock's words). */
export const plainNote = (s: string | null | undefined) => (s ? s.replace(/ — /g, ": ") : "");

/** The warnings an entry row shows (each one is a SiteClock rule kept as it is). */
export function entryWarnings(e: { nlb?: boolean; breakMinutes?: number | null; needsReview?: boolean; editedById?: string | null; payFollowsCrew?: boolean; status?: string }, opts: { nlbCreditMinutes?: number } = {}): string[] {
  const out: string[] = [];
  if (e.needsReview) out.push("Needs review: approve it on its own");
  if (e.nlb && (opts.nlbCreditMinutes ?? 0) === 0) out.push("No lunch break approved, but no credit is set");
  if (e.payFollowsCrew && e.editedById) out.push("Paid as edited; crew hours not applied");
  return out;
}

/** "3 approved. 2 need review and were not approved." for the bulk approve result. */
export function bulkResultText(c: { approved: number; needsReview: number; notPending?: number }): string {
  const parts = [`${c.approved} approved.`];
  if (c.needsReview) parts.push(`${c.needsReview} ${c.needsReview === 1 ? "needs" : "need"} review and ${c.needsReview === 1 ? "was" : "were"} not approved.`);
  if (c.notPending) parts.push(`${c.notPending} ${c.notPending === 1 ? "was" : "were"} not waiting for approval.`);
  return parts.join(" ");
}
