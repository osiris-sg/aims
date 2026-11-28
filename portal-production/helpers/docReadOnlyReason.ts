// Why a document in the editor takes no edits (guru 2026-11-28: "if its confirmed i dont know and
// when i try to edit i cant"). One reason, the strongest wins; the editor shows it as a strip under
// the toolbar, in the status pill's popover and in the toast when someone tries to type. Pure,
// tested by helpers/docReadOnlyReason.test.mjs.

export type ReadOnlyAction = "edit" | "unlock" | "lockDates" | "offsets";

export type ReadOnlyReason = {
  kind: "voided" | "external" | "recordLocked" | "periodLocked" | "paid" | "signed" | "confirmed";
  /** Short, bold: what state the document is in. */
  title: string;
  /** One sentence: what that means and what to do about it. */
  detail: string;
  /** error = cannot be undone here; warning = a lock someone can lift; info = read-only by nature. */
  tone: "error" | "warning" | "info";
  action?: ReadOnlyAction;
  actionLabel?: string;
};

export type ReadOnlyInput = {
  voided?: boolean;
  /** The API's own read-only reason for a posting with no document behind it. */
  externalReason?: string | null;
  recordLocked?: boolean;
  recordLockedBy?: string | null;
  recordLockedAt?: string | null;
  /** The viewer may unlock a locked record (accounting adviser). */
  canUnlock?: boolean;
  periodLocked?: boolean;
  /** The lock date that binds this viewer, already formatted (lockDayLabel). */
  lockDayLabel?: string | null;
  /** The viewer may move the lock dates. */
  canMoveLockDate?: boolean;
  paid?: boolean;
  /** Receipt / credit note references that settled it, if known. */
  settledRefs?: string[];
  signed?: boolean;
  confirmed?: boolean;
  confirmedBy?: string | null;
  confirmedAt?: string | null;
  /** The viewer may unlock a confirmed document for editing (the Edit button's rule). */
  canEdit?: boolean;
};

export const whenLabel = (at: string | null | undefined): string => {
  if (!at) return "";
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
};

export function docReadOnlyReason(i: ReadOnlyInput): ReadOnlyReason | null {
  if (i.voided) {
    return { kind: "voided", tone: "error", title: "Voided.", detail: "It stays on file for reference and takes no edits." };
  }
  if (i.externalReason) {
    return { kind: "external", tone: "info", title: "Read-only.", detail: i.externalReason };
  }
  if (i.recordLocked) {
    const who = i.recordLockedBy ? ` by ${i.recordLockedBy}` : "";
    const when = whenLabel(i.recordLockedAt);
    return {
      kind: "recordLocked",
      tone: "error",
      title: `Locked${who}${when ? ` on ${when}` : ""}.`,
      detail: i.canUnlock ? "No edits until it is unlocked." : "No edits until an accounting admin unlocks it.",
      ...(i.canUnlock ? { action: "unlock" as const, actionLabel: "Unlock" } : {}),
    };
  }
  if (i.periodLocked) {
    return {
      kind: "periodLocked",
      tone: "warning",
      title: `Dated inside the locked period${i.lockDayLabel ? ` (lock date ${i.lockDayLabel})` : ""}.`,
      detail: i.canMoveLockDate
        ? "Move the lock date in Accounting Setup, Financial Settings, to change it."
        : "Ask an accounting admin to move the lock date if it must change.",
      ...(i.canMoveLockDate ? { action: "lockDates" as const, actionLabel: "Lock dates" } : {}),
    };
  }
  if (i.paid) {
    const refs = (i.settledRefs || []).filter(Boolean);
    return {
      kind: "paid",
      tone: "warning",
      title: `Paid in full${refs.length ? ` on ${refs.join(", ")}` : ""}.`,
      detail: "Money is recorded against it. Delete the receipt (the invoice goes back to Awaiting Payment) to change it.",
      ...(refs.length ? { action: "offsets" as const, actionLabel: "View receipts" } : {}),
    };
  }
  if (i.signed) {
    return { kind: "signed", tone: "info", title: "Signed by the customer.", detail: "A signed document takes no edits." };
  }
  if (i.confirmed) {
    const who = i.confirmedBy ? ` by ${i.confirmedBy}` : "";
    const when = whenLabel(i.confirmedAt);
    return {
      kind: "confirmed",
      tone: "warning",
      title: `Confirmed${who}${when ? ` on ${when}` : ""}.`,
      detail: i.canEdit
        ? "Fields are locked. Edit unlocks them; every save after that is recorded in the history under your name."
        : "Fields are locked. Ask an admin to unconfirm it.",
      ...(i.canEdit ? { action: "edit" as const, actionLabel: "Edit" } : {}),
    };
  }
  return null;
}
