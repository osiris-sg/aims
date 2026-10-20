// Run: npm test (node --test, Node's built-in TypeScript stripping).
// Orders list progress (round M): one continuous bar, same geometry on every row; fixed column widths.
import { test } from "node:test";
import assert from "node:assert/strict";
import { barCount, barGeometry, ORDERS_COLUMN_PX } from "../app/portal/shipments/_lib/progress.ts";

test("Progress and Status have their own fixed widths (the table is table-layout: fixed)", () => {
  assert.equal(ORDERS_COLUMN_PX.progress, 240);
  assert.ok(ORDERS_COLUMN_PX.status >= 88, "the Open / Completed chip fits");
});

test("fill = done / total; the in-progress marker follows it; a 14-step and a 4-step row look the same kind of bar", () => {
  const a = barGeometry({ done: 7, total: 14, inProgress: 1 });
  assert.equal(a.fillPct, 50);
  assert.equal(a.markerPct, 50);
  assert.ok(Math.abs(a.markerWidthPct - 100 / 14) < 1e-9);
  const b = barGeometry({ done: 2, total: 4, inProgress: 0 });
  assert.deepEqual(b, { fillPct: 50, partialPct: 0, markerPct: null, markerWidthPct: 0, tint: "none" });
});

test("overdue tints the track; fill + marker never pass 100%; nothing to show for 0 steps", () => {
  const g = barGeometry({ done: 13, total: 14, inProgress: 1, overdue: true });
  assert.equal(g.tint, "overdue");
  assert.ok(g.fillPct + g.markerWidthPct <= 100 + 1e-9);
  assert.deepEqual(barGeometry({ done: 0, total: 0 }), { fillPct: 0, partialPct: 0, markerPct: null, markerWidthPct: 0, tint: "none" });
  assert.equal(barGeometry({ done: 14, total: 14, inProgress: 0 }).fillPct, 100);
});

test("count on the bar's line", () => {
  assert.equal(barCount({ done: 2, total: 14 }), "2/14");
});

test("round N: partial fill (done on some shipments) sits between done and the marker; never over 100%", () => {
  const g = barGeometry({ done: 2, total: 15, partial: 1, inProgress: 1 });
  assert.ok(Math.abs(g.fillPct - (2 / 15) * 100) < 1e-9);
  assert.ok(Math.abs(g.partialPct - (1 / 15) * 100) < 1e-9);
  assert.ok(Math.abs(g.markerPct - (g.fillPct + g.partialPct)) < 1e-9);
  const full = barGeometry({ done: 14, total: 15, partial: 1, inProgress: 1 });
  assert.ok(full.fillPct + full.partialPct + full.markerWidthPct <= 100 + 1e-9);
});
