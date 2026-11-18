// Run: npm test. The salesperson name saved beside a code-less salesman's user id (2026-11-18, all orgs).
import { test } from "node:test";
import assert from "node:assert/strict";
import { salesPersonNameToSave } from "./salesPersonName.ts";

test("a user id gets its resolved name", () => {
  assert.deepEqual(salesPersonNameToSave("user_3Ld8L6i0KO2BXMybjx5mYkWUdoh", "Nee Meng WCTR"), { salesPersonName: "Nee Meng WCTR" });
});
test("a salesman code, no salesperson, or no resolved name: nothing added", () => {
  assert.deepEqual(salesPersonNameToSave("S004", "Nee Meng Tan"), {});
  assert.deepEqual(salesPersonNameToSave("", "X"), {});
  assert.deepEqual(salesPersonNameToSave(undefined, "X"), {});
  assert.deepEqual(salesPersonNameToSave("user_abc", ""), {});
  assert.deepEqual(salesPersonNameToSave("user_abc", undefined), {});
});
