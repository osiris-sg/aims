/**
 * Shared delivery-step routing for the field flow. One source of truth for
 * "which page does this item/run resume into", used by both the basket
 * (/scan/delivery/[id]) per-item buttons and the resume list
 * (/scan/deliveries) row tap — so the two never drift apart.
 *
 * Fine-grained resolution INSIDE after-ack (assign → install → sign → review)
 * is the after-ack page's own server-derived resolver; we deliberately don't
 * duplicate it here — we just route a delivering-with-draft-ack unit into
 * after-ack and let that resolver pick the sub-step.
 */

export type StepStatus = "not_delivered" | "delivering" | "not_installed" | "completed";

export interface StepItem {
  assetId: string;
  inventoryId: string | null;
  deliveryStatus: StepStatus;
}

export interface StepReport {
  kind: string;
  status: string;
  inventoryId: string | null;
}

/** An unsigned DO_ACK for this unit — ack captured, signature still pending. */
export function hasDraftAck(reports: StepReport[], inventoryId: string | null): boolean {
  return (
    !!inventoryId &&
    reports.some((r) => r.kind === "DO_ACK" && r.status !== "completed" && r.inventoryId === inventoryId)
  );
}

/**
 * The page a single item resumes into, or null when there's no deep-link (the
 * caller falls back to the basket):
 *   not_delivered → null (needs the basket's mandatory condition-photo dialog)
 *   delivering    → after-ack ONLY if a draft DO_ACK exists (mid-ack); else null
 *                   → basket. Every basket unit auto-fires DO_START, so
 *                   `delivering` alone can't mean "mid-acknowledgement" — only a
 *                   draft DO_ACK proves the rider started acking. Without one
 *                   they merely loaded the unit, so resume lands on the basket;
 *                   the basket's per-item "Acknowledge" button is where they
 *                   choose to START acking (that forward action still goes to ack).
 *   not_installed → install
 *   completed     → null (nothing left to do)
 */
export function itemStepHref(deliveryId: string, it: StepItem, reports: StepReport[]): string | null {
  const q = `assetId=${encodeURIComponent(it.assetId)}${
    it.inventoryId ? `&inventoryId=${encodeURIComponent(it.inventoryId)}` : ""
  }`;
  switch (it.deliveryStatus) {
    case "delivering":
      return hasDraftAck(reports, it.inventoryId)
        ? `/scan/delivery/${deliveryId}/after-ack?${q}`
        : null;
    case "not_installed":
      return `/scan/delivery/${deliveryId}/install?${q}`;
    default:
      return null;
  }
}

/**
 * Run-level resume target: drop the rider into the first unfinished item's
 * step. Falls back to the basket when the first unfinished item has no
 * deep-link (not_delivered) or when everything is done.
 */
export function resumeHref(run: {
  id: string;
  items: StepItem[];
  reports?: StepReport[];
}): string {
  const basket = `/scan/delivery/${run.id}`;
  const firstUnfinished = run.items.find((i) => i.deliveryStatus !== "completed");
  if (!firstUnfinished) return basket;
  return itemStepHref(run.id, firstUnfinished, run.reports ?? []) ?? basket;
}
