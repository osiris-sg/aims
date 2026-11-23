import test from "node:test";
import assert from "node:assert/strict";
import { nextRevisionName } from "./quotationRevision.ts";

test("the first revision is -R1, then -R2, never (Rev-1)", () => {
  assert.equal(nextRevisionName("QO202611-0016"), "QO202611-0016-R1");
  assert.equal(nextRevisionName("QO202611-0016-R1"), "QO202611-0016-R2");
  assert.equal(nextRevisionName("QO202611-0016-R9"), "QO202611-0016-R10");
});
test("no number yet, no revision number", () => {
  assert.equal(nextRevisionName(""), "");
  assert.equal(nextRevisionName(null), "");
});
