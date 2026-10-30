// Delivery run display + destructive-action copy, shared by the Deliveries list
// and the delivery page (2026-10-30). Pure: tested by helpers/runActions.test.mjs.

type Status = "scheduled" | "in_progress" | "delivered" | "completed" | "cancelled" | string;

interface RunLike {
  status: Status;
  isDraft?: boolean;
  riderUserId?: string | null;
  items?: Array<{ deliveryStatus?: string | null; deliveringAt?: string | null; deliveredAt?: string | null }>;
}

/**
 * Whether anyone actually started this run. Delivery.startedAt defaults to the
 * creation time, so a run nobody picked up (scheduled, a draft, or cancelled
 * before a rider claimed it) carries a "start" that never happened. A claim or
 * a rider-started run sets riderUserId; a run that got as far as delivered /
 * completed, or a line that left not_delivered, was started too.
 */
export function runWasStarted(r: RunLike): boolean {
  if (r.isDraft || r.status === "scheduled") return false;
  if (r.riderUserId) return true;
  if (r.status === "delivered" || r.status === "completed") return true;
  return (r.items ?? []).some((i) => !!i.deliveringAt || !!i.deliveredAt || (!!i.deliveryStatus && i.deliveryStatus !== "not_delivered"));
}

interface SiteClockLike {
  workerId?: string | null;
  workerName?: string | null;
  lastPushedStatus?: string | null;
  syncState?: string | null;
}

/** The SiteClock job this run has (or is about to have), or null. A cancelled / completed one is final. */
export function liveSiteClockJob(sc: SiteClockLike | null | undefined): { workerName: string | null } | null {
  if (!sc || !sc.workerId) return null;
  const last = sc.lastPushedStatus ?? null;
  if (last === "CANCELLED" || last === "COMPLETED") return null;
  if (last === "SCHEDULED" || last === "IN_PROGRESS" || sc.syncState === "PENDING" || sc.syncState === "FAILED") return { workerName: sc.workerName ?? null };
  return null;
}

export type RunAction = "cancel" | "delete" | "purge";

/** Title, body and button for the confirm dialog of a destructive run action. */
export function confirmCopy(
  action: RunAction,
  run: { deliveryNumber: number; isDraft?: boolean; siteclock?: SiteClockLike | null },
  // enableRealDoOnSchedule: the run's DO already has its real number, so a cancel keeps it (as Cancelled).
  opts: { keepsDo?: boolean } = {},
): { title: string; body: string; siteclock: string | null; button: string } {
  const job = liveSiteClockJob(run.siteclock);
  const siteclock = job ? `This also cancels the SiteClock job${job.workerName ? ` for ${job.workerName}` : ""}.` : null;
  if (action === "cancel") {
    return {
      title: `Cancel delivery #${run.deliveryNumber}?`,
      body: `The run is marked cancelled and any reserved units are returned to stock.${opts.keepsDo ? " Its Delivery Order keeps its number and is marked Cancelled." : ""} This cannot be undone.`,
      siteclock,
      button: "Cancel delivery",
    };
  }
  if (action === "delete") {
    return {
      title: `Delete ${run.isDraft ? "draft" : "delivery"} #${run.deliveryNumber}?`,
      body: "This permanently removes the run and its unconfirmed draft Delivery Order. It cannot be undone. A run that has delivered or linked anything cannot be deleted; cancel it instead.",
      siteclock,
      button: "Delete",
    };
  }
  return {
    title: `Delete delivery #${run.deliveryNumber} permanently?`,
    body:
      "This removes the cancelled run, its lines and its placeholder Delivery Order for good. It is refused if the run has a real DO number, moved stock, or was invoiced. Recorded in the Activity Log.",
    siteclock: run.siteclock ? "Its SiteClock job is cancelled too if it is still live (SiteClock keeps cancelled jobs, hidden)." : null,
    button: "Delete permanently",
  };
}

/** Osiris admins may permanently delete a cancelled run (the backend re-checks that it committed nothing). */
export const canPurge = (r: { status: Status }, isOsirisAdmin: boolean) => isOsirisAdmin && r.status === "cancelled";
