// Real DO numbers on schedule (WCT 2026-10-30, flag enableRealDoOnSchedule).
// A scheduled run's DO carries its real number from the start, so whether the
// job is done is shown as a tag NEXT to the number — never inside it.
// Mirrors api-server-production/src/deliveries/do-number.ts.

export type DoStatusTag = "Pending" | "Completed" | "Cancelled";

/** From the delivery run: scheduled / on the road → Pending, done → Completed, cancelled → Cancelled. */
export function runDoTag(status: string | null | undefined): DoStatusTag {
  if (status === "cancelled") return "Cancelled";
  if (status === "completed") return "Completed";
  return "Pending";
}

/** From the DO itself: voided with its run → Cancelled, delivered → Completed, else Pending. */
export function docDoTag(doc: { status?: string | null; config?: unknown; cancelled?: boolean | null }): DoStatusTag {
  if (doc.cancelled === true || (doc.config && (doc.config as any).cancelled === true)) return "Cancelled";
  if (doc.status === "delivered_installed") return "Completed";
  return "Pending";
}

export const DO_TAG_COLOR: Record<DoStatusTag, "warning" | "success" | "default"> = {
  Pending: "warning",
  Completed: "success",
  Cancelled: "default",
};
