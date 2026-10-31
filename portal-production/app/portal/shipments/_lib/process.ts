// Round AY — a customer's process (Clients › a customer › Process): which steps apply. Pure helpers.

export type ProcessStepLike = { code: string; no: string };

/** Same marker the server stamps on a step left out of the customer's process. */
export const PROCESS_SKIP_REASON = "Not in this customer's process";
export const isProcessSkipped = (s: { notApplicable?: boolean | null; skipReason?: string | null }) => !!s.notApplicable && s.skipReason === PROCESS_SKIP_REASON;
/** Steps moved to the order in round H, or left out of the customer's process: never shown on the record. */
export const hiddenStep = (s: { notApplicable?: boolean | null; skipReason?: string | null }) =>
  isProcessSkipped(s) || (!!s.notApplicable && !!s.skipReason?.startsWith("Moved to the order"));

const numOf = (no: string) => parseFloat(no.replace(/[a-z]$/i, (m) => (m.toLowerCase() === "a" ? ".1" : ".2")));

/** "The process ends at step `no`": every step after it is left out. */
export const skipAfter = (steps: ProcessStepLike[], no: string) => steps.filter((s) => numOf(s.no) > numOf(no)).map((s) => s.code);

/** The last step that applies when the skipped ones are exactly "everything after it" (else null). */
export function endsAt(steps: ProcessStepLike[], skip: string[]): string | null {
  const set = new Set(skip);
  if (!set.size) return null;
  const kept = steps.filter((s) => !set.has(s.code));
  const last = kept[kept.length - 1];
  return last && skipAfter(steps, last.no).every((c) => set.has(c)) && skipAfter(steps, last.no).length === set.size ? last.no : null;
}

/** Toggle one step in the skip list, kept in process order. Step 0 always applies. */
export function toggleSkip(steps: ProcessStepLike[], skip: string[], code: string): string[] {
  if (code === "CHECK_CONTRACT") return skip;
  const set = new Set(skip);
  if (set.has(code)) set.delete(code);
  else set.add(code);
  return steps.filter((s) => set.has(s.code)).map((s) => s.code);
}

export const sameSkips = (a: string[], b: string[]) => a.length === b.length && a.every((c, i) => c === b[i]);
