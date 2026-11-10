/**
 * WCT finish modes + verification (flag enableWctFinishModes, 2026-11-01, Phase 3).
 *
 * A job is finished in the field one of three ways:
 *   signature   the customer signs on the device (as always) → verified at once
 *   stamped_do  a photo of the DO the customer stamped → waits for an admin
 *   paper       marked completed, the signed paper copy comes back later → waits
 *   sign_link   no signature now (SiteClock's "Skip", 2026-11-11): the office sends the
 *               customer the DO sign link; the customer's signature there verifies it
 * The run's status is `completed` in every case (no new DeliveryRunStatus
 * values); Delivery.verificationState carries the office check: pending /
 * verified / rejected. A rejected job goes back for new evidence (a new photo
 * or a note), which puts it back to pending.
 *
 * Runs finished before the flag (verificationState null) count as verified:
 * they were signed. Pure helpers, no I/O.
 */
export const WCT_FINISH_MODES_FLAG = 'enableWctFinishModes';

export const COMPLETION_MODES = ['signature', 'stamped_do', 'paper', 'sign_link'] as const;
export type CompletionMode = (typeof COMPLETION_MODES)[number];
export type VerificationState = 'pending' | 'verified' | 'rejected';

export const COMPLETION_MODE_LABEL: Record<CompletionMode, string> = {
  signature: 'Customer signed on device',
  stamped_do: 'Photo of stamped DO',
  paper: 'Paper copy to follow',
  sign_link: 'Customer to sign by link',
};

export const VERIFICATION_LABEL: Record<VerificationState, string> = {
  pending: 'Awaiting verification',
  verified: 'Verified',
  rejected: 'Rejected',
};

export const isCompletionMode = (v: unknown): v is CompletionMode => typeof v === 'string' && (COMPLETION_MODES as readonly string[]).includes(v);

/** The verification a completion starts with: a signature is verified on the spot, the others wait. */
export function initialVerification(mode: CompletionMode, at = new Date()) {
  return mode === 'signature'
    ? { verificationState: 'verified' as const, verifiedAt: at, verifiedByUserId: null, verifiedByName: 'Customer signature' }
    : { verificationState: 'pending' as const, verifiedAt: null, verifiedByUserId: null, verifiedByName: null };
}

/** Done AND checked: completed, and verified (or finished before verification existed). */
export function isVerifiedJob(j: { status: string; verificationState?: string | null }): boolean {
  if (j.status !== 'completed') return false;
  return j.verificationState == null || j.verificationState === 'verified';
}

/** Completed but still waiting on the office (pending or rejected). */
export function awaitsVerification(j: { status: string; verificationState?: string | null }): boolean {
  return j.status === 'completed' && (j.verificationState === 'pending' || j.verificationState === 'rejected');
}

/** Why a finish request is refused, or null when it may go ahead. */
export function finishModeProblem(input: { mode: CompletionMode; flagOn: boolean; signature?: string; photos?: string[]; partial: boolean }): string | null {
  if (input.mode === 'signature') return input.signature ? null : 'Customer signature is required';
  if (!input.flagOn) return 'This finish option is not enabled for this organisation';
  if (input.partial) return 'Only a customer signature can sign off part of a job. Finish every item first, or ask the customer to sign.';
  if (input.mode === 'stamped_do' && !(input.photos ?? []).some((k) => String(k || '').trim())) return 'Take a photo of the stamped DO first';
  return null;
}
