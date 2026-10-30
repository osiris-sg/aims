/**
 * Real DO numbers on schedule (WCT 2026-10-30, flag enableRealDoOnSchedule,
 * default OFF). With the flag on, a scheduled run's Delivery Order gets its
 * REAL number the moment the run is scheduled (createScheduled / draft
 * promotion) instead of a DO-PENDING-NN placeholder; completion keeps that
 * number, and cancelling the run keeps the DO as Cancelled rather than
 * deleting it. Whether the job is done is shown as a status tag next to the
 * number, never inside it.
 */
export const REAL_DO_ON_SCHEDULE_FLAG = 'enableRealDoOnSchedule';

export type DoStatusTag = 'Pending' | 'Completed' | 'Cancelled';

/** Config stamp on a DO issued at schedule time (cancel keeps such a DO; delete refuses it). */
export const isIssuedOnSchedule = (config: unknown) => !!config && (config as any).issuedOnSchedule === true;

/** A DO voided because its run was cancelled (number kept). */
export const isCancelledDo = (config: unknown) => !!config && (config as any).cancelled === true;

/** The run's tag: scheduled / on the road → Pending, done → Completed, cancelled → Cancelled. */
export function runStatusTag(status: string | null | undefined): DoStatusTag {
  if (status === 'cancelled') return 'Cancelled';
  if (status === 'completed') return 'Completed';
  return 'Pending';
}

/** The DO's tag: voided → Cancelled, delivered (terminal) → Completed, else Pending. */
export function doStatusTag(doc: { status?: string | null; config?: unknown }): DoStatusTag {
  if (isCancelledDo(doc.config)) return 'Cancelled';
  if (doc.status === 'delivered_installed') return 'Completed';
  return 'Pending';
}

/** Config keys only the server writes on a DO (issued at schedule time / voided with its run). */
export const SERVER_DO_KEYS = ['issuedOnSchedule', 'cancelled', 'cancelledAt', 'cancelledReason'] as const;

/**
 * The editor rebuilds a document's config from its own field list on save and
 * would drop these keys; carry them over from the stored config unless the
 * incoming config sets them itself. Mutates and returns `next`.
 */
export function carryServerDoKeys(prev: unknown, next: Record<string, any>) {
  const p = prev && typeof prev === 'object' ? (prev as Record<string, any>) : {};
  for (const k of SERVER_DO_KEYS) if (p[k] !== undefined && next[k] === undefined) next[k] = p[k];
  return next;
}

/** The config stamped onto a DO when its run is cancelled: same number, marked void. */
export function cancelledDoConfig(config: unknown, deliveryNumber: number, at = new Date()) {
  const cfg = config && typeof config === 'object' ? (config as Record<string, any>) : {};
  return { ...cfg, cancelled: true, cancelledAt: at.toISOString(), cancelledReason: `Delivery #${deliveryNumber} was cancelled` };
}
