// "Discard changes?" (WCT group, 2026-11-25): the Job pop-up (QuickJobDialog, new + edit) and the Note pop-up
// (NoteDialog) ask before Cancel / Esc / a click outside throws away typing. The form is compared with its baseline:
// the form as it opened, with every value the pop-up filled in by itself (defaults, loaded lists) applied to both,
// so only what the person changed counts. Tested by helpers/calendarDiscard.test.mjs.

/** A stable text of a form (key order kept as written; undefined keys dropped, like JSON). */
export const formKey = (v: unknown): string => JSON.stringify(v ?? null);

/** True when the person changed something since the pop-up opened. */
export const formDirty = (form: unknown, baseline: unknown): boolean => formKey(form) !== formKey(baseline);

/** What a close request does: close at once (nothing typed) or ask first. Saving in progress: nothing. */
export function closeAction(o: { dirty: boolean; busy: boolean }): "close" | "ask" | "none" {
  if (o.busy) return "none";
  return o.dirty ? "ask" : "close";
}

export const DISCARD_TEXT = { title: "Discard changes?", discard: "Discard", keep: "Keep editing" } as const;
