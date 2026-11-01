// Run: npm test (node --test, Node's built-in TypeScript stripping).
// 2026-11-01: WCT finish modes (enableWctFinishModes): options, checks, labels.
import { test } from "node:test";
import assert from "node:assert/strict";
import { FINISH_OPTIONS, finishProblem, finishButtonLabel, verificationLabel, completionModeLabel, rejectProblem } from "./wctFinishModes.ts";

test("three finish options, signature first", () => {
  assert.deepEqual(FINISH_OPTIONS.map((o) => o.value), ["signature", "stamped_do", "paper"]);
});

test("a stamped DO needs its photo; paper needs nothing", () => {
  assert.match(finishProblem("stamped_do", 0), /photo of the stamped DO/);
  assert.equal(finishProblem("stamped_do", 1), null);
  assert.equal(finishProblem("paper", 0), null);
  assert.equal(finishButtonLabel("paper"), "Mark completed");
});

test("labels", () => {
  assert.equal(verificationLabel("pending"), "Awaiting verification");
  assert.equal(verificationLabel(null), null);
  assert.equal(completionModeLabel("stamped_do"), "Photo of stamped DO");
  assert.match(rejectProblem("  "), /Say why/);
  assert.equal(rejectProblem("blurry"), null);
});
