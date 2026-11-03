/**
 * "Delivery" vs "Job" (2026-11-03): WCT (enableWctOrders) calls its runs jobs
 * everywhere a person reads it; every other org keeps "Delivery". Wording only:
 * routes, API fields and DB names stay "delivery". A DO stays a DO.
 */
export type RunWords = {
  /** "Job" / "Delivery" */
  Noun: string;
  /** "job" / "delivery" */
  noun: string;
  /** "Jobs" / "Deliveries" */
  Nouns: string;
  /** "jobs" / "deliveries" */
  nouns: string;
  /** "Done" / "Delivered" (a finished run's status) */
  Done: string;
  /** "done" / "delivered" (per-item progress, e.g. "2 of 3 done") */
  done: string;
};

const JOB: RunWords = { Noun: "Job", noun: "job", Nouns: "Jobs", nouns: "jobs", Done: "Done", done: "done" };
const DELIVERY: RunWords = { Noun: "Delivery", noun: "delivery", Nouns: "Deliveries", nouns: "deliveries", Done: "Delivered", done: "delivered" };

export function runWords(isWct: boolean): RunWords {
  return isWct ? JOB : DELIVERY;
}

/** "Job #12" / "Delivery #12" / "Return #12". */
export function runTitle(w: RunWords, deliveryNumber: number | string | null | undefined, isReturn = false): string {
  const head = isReturn ? "Return" : w.Noun;
  return deliveryNumber != null && deliveryNumber !== "" ? `${head} #${deliveryNumber}` : head;
}

/** Fixed labels that say "deliver…" and what WCT reads instead (whole-label swaps; anything else passes through). */
const JOB_LABELS: Record<string, string> = {
  Delivered: "Done",
  "Not delivered": "Not done",
  Delivering: "In progress",
  DELIVERED: "DONE",
  "NOT DELIVERED": "NOT DONE",
  DELIVERING: "IN PROGRESS",
  DELIVERY: "JOB",
  "Delivery Started": "Job Started",
  "Delivery Acknowledged": "Job Acknowledged",
  "Delivery started": "Job started",
  "Delivery photo": "Job photo",
};

/** A fixed status / kind label as WCT reads it ("Delivered" → "Done"); other orgs: unchanged. */
export function jobLabel(label: string, isWct: boolean): string {
  return isWct ? (JOB_LABELS[label] ?? label) : label;
}
