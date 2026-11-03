// WCT finish modes + verification (2026-11-01, flag enableWctFinishModes).
// Pure helpers for the field finish page, the verification queue and the
// verification blocks; tested by helpers/wctFinishModes.test.mjs. Mirrors
// api-server-production/src/deliveries/finish-modes.ts.

export type FinishMode = "signature" | "stamped_do" | "paper";
export type VerificationState = "pending" | "verified" | "rejected";

export const FINISH_OPTIONS: { value: FinishMode; label: string; hint: string }[] = [
  { value: "signature", label: "Customer signs on this device", hint: "Done at once" },
  { value: "stamped_do", label: "Photo of the stamped DO", hint: "The customer stamped the paper DO; the office verifies the photo" },
  { value: "paper", label: "Mark completed, paper copy later", hint: "The office verifies when the signed copy comes back" },
];

export const COMPLETION_MODE_LABEL: Record<FinishMode, string> = {
  signature: "Customer signed on device",
  stamped_do: "Photo of stamped DO",
  paper: "Paper copy to follow",
};

export const VERIFICATION_LABEL: Record<VerificationState, string> = {
  pending: "Awaiting verification",
  verified: "Verified",
  rejected: "Rejected",
};

export const VERIFICATION_COLOR: Record<VerificationState, "warning" | "success" | "error"> = {
  pending: "warning",
  verified: "success",
  rejected: "error",
};

export const verificationLabel = (s: string | null | undefined) => (s ? VERIFICATION_LABEL[s as VerificationState] ?? s : null);
export const completionModeLabel = (m: string | null | undefined) => (m ? COMPLETION_MODE_LABEL[m as FinishMode] ?? m : null);

/** Why a stamped-DO / paper finish can't be sent yet (null = go). */
export function finishProblem(mode: FinishMode, photoCount: number): string | null {
  if (mode === "stamped_do" && photoCount === 0) return "Take a photo of the stamped DO first.";
  return null;
}

export function finishButtonLabel(mode: FinishMode): string {
  return mode === "stamped_do" ? "Complete with stamped DO" : mode === "paper" ? "Mark completed" : "Complete job";
}

/** The admin's reject needs a reason. */
export function rejectProblem(reason: string): string | null {
  return reason.trim() ? null : "Say why the job is rejected (the worker sees this).";
}
