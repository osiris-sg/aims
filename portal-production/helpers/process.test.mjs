// Run: npm test. Round AY: a customer's process (Clients › a customer › Process).
import { test } from "node:test";
import assert from "node:assert/strict";
import { endsAt, hiddenStep, sameSkips, skipAfter, toggleSkip } from "../app/portal/shipments/_lib/process.ts";

const steps = ["0", "1", "2", "3a", "3b", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14"].map((no, i) => ({ no, code: i === 0 ? "CHECK_CONTRACT" : `S${no}` }));

test("'ends at step 9' leaves out 10–14; endsAt reads it back", () => {
  assert.deepEqual(skipAfter(steps, "9"), ["S10", "S11", "S12", "S13", "S14"]);
  assert.equal(endsAt(steps, skipAfter(steps, "9")), "9");
  assert.equal(endsAt(steps, skipAfter(steps, "3a")), "3a");
  assert.equal(endsAt(steps, []), null);
  assert.equal(endsAt(steps, ["S10"]), null); // a gap is not "ends at"
});

test("toggling keeps process order and never drops step 0", () => {
  assert.deepEqual(toggleSkip(steps, ["S12"], "S10"), ["S10", "S12"]);
  assert.deepEqual(toggleSkip(steps, ["S10", "S12"], "S10"), ["S12"]);
  assert.deepEqual(toggleSkip(steps, [], "CHECK_CONTRACT"), []);
  assert.ok(sameSkips(["S10"], ["S10"]) && !sameSkips(["S10"], []));
});

test("hidden on the record: left out of the process, or moved to the order — other N/A steps still show", () => {
  assert.equal(hiddenStep({ notApplicable: true, skipReason: "Not in this customer's process" }), true);
  assert.equal(hiddenStep({ notApplicable: true, skipReason: "Moved to the order (round H)" }), true);
  assert.equal(hiddenStep({ notApplicable: true, skipReason: null }), false);
  assert.equal(hiddenStep({ notApplicable: false, skipReason: "Not in this customer's process" }), false);
});
