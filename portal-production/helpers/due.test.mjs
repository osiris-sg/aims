// Run: npm test. Round AY part 2: the order page's Overall process cells and schedule line.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cellView, scheduleParts, shortDay } from "../app/portal/shipments/_lib/due.ts";

test("cells: done with its date, overdue in red with days late, now / upcoming with the due date", () => {
  assert.deepEqual(cellView({ state: "done", doneAt: "2026-10-02", due: "2026-10-01", daysLate: null, dueSource: "rule" }, "en", "2026"), { head: "✓ Done", sub: "2 Oct", tone: "success" });
  assert.deepEqual(cellView({ state: "overdue", doneAt: null, due: "2026-10-24", daysLate: 7, dueSource: "rule" }, "en", "2026"), { head: "7d overdue", sub: "due 24 Oct", tone: "error" });
  assert.deepEqual(cellView({ state: "current", doneAt: null, due: "2027-01-05", daysLate: null, dueSource: "manual" }, "en", "2026"), { head: "Now", sub: "due 5 Jan 2027", tone: "primary" });
  assert.equal(cellView({ state: "upcoming", doneAt: null, due: null, daysLate: null, dueSource: null }, "en").sub, "no date yet");
  assert.equal(cellView({ state: "upcoming", doneAt: null, due: null, daysLate: null, dueSource: null, ongoing: true }, "en").sub, "ongoing");
  assert.equal(cellView({ state: "overdue", doneAt: null, due: "2026-10-24", daysLate: 7, dueSource: "rule" }, "ja", "2026").head, "7日超過");
});

test("schedule line: ETD, T/S port + dates, ETA, arrival, delivery dates", () => {
  const s = { etd: "2026-10-01", tsPort: "Singapore", tsEta: "2026-10-06", tsEtd: "2026-10-09", eta: "2026-10-25", arrived: null, deliveries: ["2026-10-28", "2026-10-30"] };
  assert.deepEqual(scheduleParts(s, "en", "2026"), ["ETD 1 Oct", "T/S Singapore 6 Oct → 9 Oct", "ETA 25 Oct", "Delivery 28 Oct, 30 Oct"]);
  assert.deepEqual(scheduleParts({ ...s, etd: null, tsPort: null, tsEta: null, tsEtd: null, deliveries: [] }, "en", "2026"), ["ETD —", "ETA 25 Oct"]);
  assert.equal(shortDay("bad"), "");
});
