// Orders list progress bar geometry + column widths (round M) — pure, so the
// layout rules are testable without a browser (helpers/ordersProgress.test.mjs).

/** Fixed pixel widths: the table is `table-layout: fixed`, so without these the
 * Progress cell's content spilled into the Status column (prod, round K). */
export const ORDERS_COLUMN_PX = { progress: 240, status: 96 } as const;

export type BarInput = { done: number; total: number; inProgress?: number; overdue?: boolean };

/**
 * One continuous bar: `fillPct` done (green); an amber marker right after it
 * when a step is being worked on (red when overdue); `tint` = red track when
 * anything is overdue. Same geometry on every row whatever the step count.
 */
export function barGeometry(b: BarInput): { fillPct: number; markerPct: number | null; markerWidthPct: number; tint: "none" | "overdue" } {
  const total = Math.max(0, b.total);
  if (!total) return { fillPct: 0, markerPct: null, markerWidthPct: 0, tint: "none" };
  const done = Math.min(Math.max(0, b.done), total);
  const fillPct = (done / total) * 100;
  const working = (b.inProgress ?? 0) > 0 && done < total;
  // One step wide, at least 3% so it shows on a 14-step bar.
  const markerWidthPct = working ? Math.max(100 / total, 3) : 0;
  // The marker follows the filled part (flex order); capped so fill + marker never pass 100%.
  return { fillPct: working ? Math.min(fillPct, 100 - markerWidthPct) : fillPct, markerPct: working ? Math.min(fillPct, 100 - markerWidthPct) : null, markerWidthPct, tint: b.overdue ? "overdue" : "none" };
}

/** "7/14" — the count on the bar's line. */
export const barCount = (b: BarInput) => `${b.done}/${b.total}`;
