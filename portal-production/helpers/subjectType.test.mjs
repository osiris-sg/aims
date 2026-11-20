// node --experimental-strip-types --import ./helpers/test-alias.mjs --test helpers/subjectType.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { joinSubject, splitSubject } from "./subjectType.ts";

test("split and join round-trip", () => {
  assert.deepEqual(splitSubject("AA - Dismantle existing ductwork"), { types: ["AA"], text: "Dismantle existing ductwork" });
  assert.deepEqual(splitSubject("CD- Chemical degreasing"), { types: ["CD"], text: "Chemical degreasing" });
  assert.deepEqual(splitSubject("VO - "), { types: ["VO"], text: "" });
  assert.deepEqual(splitSubject("New MV System @ 39A Soon Lee Road"), { types: [], text: "New MV System @ 39A Soon Lee Road" });
  // Several types, as the old ERP wrote them; shown in the dropdown's order.
  assert.deepEqual(splitSubject("MV+CD - New MV System"), { types: ["CD", "MV"], text: "New MV System" });
  assert.deepEqual(splitSubject("AA + CD - x"), { types: ["AA", "CD"], text: "x" });
  assert.deepEqual(splitSubject("MACD - x"), { types: [], text: "MACD - x" });
  assert.deepEqual(splitSubject(null), { types: [], text: "" });
  assert.equal(joinSubject(["MV"], "New system"), "MV - New system");
  assert.equal(joinSubject(["MV", "CD"], "New system"), "CD+MV - New system");
  assert.equal(joinSubject([], "New system"), "New system");
  assert.equal(joinSubject(["TS"], ""), "TS - ");
  const s = joinSubject(["TS", "AA"], "Aircon servicing\nline 2");
  assert.deepEqual(splitSubject(s), { types: ["AA", "TS"], text: "Aircon servicing\nline 2" });
});
