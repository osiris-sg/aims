/**
 * The DO / RDO timeline's "Delivery Ended" (2026-11-11). It is when the run
 * was COMPLETED (Delivery.completedAt, folded into the document data as
 * runCompletedAt), never the time a proof row was written later: a customer
 * signing by link days afterwards, or a repaired proof row, must not move it
 * (Biofuel RDO202611-002/003). A run not completed yet (or a document with no
 * run) keeps the old reading: the latest DO_ACK.
 */
export function deliveryEndedAt(
  runCompletedAt: string | Date | null | undefined,
  reports: Array<{ kind?: string | null; createdAt?: string | Date | null }> | null | undefined,
): Date | null {
  const completed = runCompletedAt ? new Date(runCompletedAt) : null;
  if (completed && !Number.isNaN(completed.getTime())) return completed;
  const acks = (reports ?? [])
    .filter((r) => r.kind === "DO_ACK" && r.createdAt)
    .map((r) => new Date(r.createdAt as string | Date).getTime())
    .filter((t) => !Number.isNaN(t));
  return acks.length ? new Date(Math.max(...acks)) : null;
}
