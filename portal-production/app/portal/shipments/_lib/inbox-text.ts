// Inbox wording (round N) — pure, tested in helpers/inboxText.test.mjs.
import type { InboxRow } from "./api";

/** Round N: say what Accept really did — "Linked to #15-1" for an email with nothing to file. */
export const acceptedText = (r: Pick<InboxRow, "done" | "matched">): string => {
  const done = (r.done ?? []).filter((a) => a.status === "done");
  const files = done.filter((a) => a.kind === "file").length;
  const fields = done.filter((a) => a.kind === "field").length;
  const where = r.matched ?? "the order";
  if (!files && !fields) return `Linked to ${where}`;
  return [files ? `Filed ${files} document${files === 1 ? "" : "s"}` : null, fields ? `filled ${fields} field${fields === 1 ? "" : "s"}` : null].filter(Boolean).join(", ") + ` on ${where}`;
};

