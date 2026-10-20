// Orders list progress bar geometry + column widths (round M) — pure, so the
// layout rules are testable without a browser (helpers/ordersProgress.test.mjs).

/** Fixed pixel widths: the table is `table-layout: fixed`, so without these the
 * Progress cell's content spilled into the Status column (prod, round K). */
export const ORDERS_COLUMN_PX = { progress: 240, status: 96 } as const;

export type BarInput = { done: number; total: number; inProgress?: number; overdue?: boolean; partial?: number };

/**
 * One continuous bar, left to right: `fillPct` done (green), `partialPct` done on some shipments but not all
 * (lighter green, round N — #28: 3b done on #28-1 only), then an amber marker when a step is being worked on
 * (red when overdue); `tint` = red track when anything is overdue. Never more than 100% in total.
 */
export function barGeometry(b: BarInput): { fillPct: number; partialPct: number; markerPct: number | null; markerWidthPct: number; tint: "none" | "overdue" } {
  const total = Math.max(0, b.total);
  if (!total) return { fillPct: 0, partialPct: 0, markerPct: null, markerWidthPct: 0, tint: "none" };
  const done = Math.min(Math.max(0, b.done), total);
  const partial = Math.min(Math.max(0, b.partial ?? 0), total - done);
  const working = (b.inProgress ?? 0) > 0 && done + partial < total;
  // One step wide, at least 3% so it shows on a 15-step bar.
  const markerWidthPct = working ? Math.max(100 / total, 3) : 0;
  const room = 100 - markerWidthPct;
  const fillPct = Math.min((done / total) * 100, room);
  const partialPct = Math.min((partial / total) * 100, room - fillPct);
  return { fillPct, partialPct, markerPct: working ? fillPct + partialPct : null, markerWidthPct, tint: b.overdue ? "overdue" : "none" };
}

/** "7/14" — the count on the bar's line. */
export const barCount = (b: BarInput) => `${b.done}/${b.total}`;
