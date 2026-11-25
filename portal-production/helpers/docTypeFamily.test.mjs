import { test } from "node:test";
import assert from "node:assert/strict";
import { docTypeFamily } from "./docTypeFamily.ts";

test("every spelling of a type maps to the whole family", () => {
  assert.deepEqual(docTypeFamily("TI2"), ["INVOICE", "TAX_INVOICE", "INV", "TI", "TI2"]);
  assert.deepEqual(docTypeFamily("invoice"), docTypeFamily("INVOICE"));
  assert.deepEqual(docTypeFamily(["DO"]), ["DELIVERY_ORDER", "DO"]);
  assert.ok(docTypeFamily("QO1").includes("QUOTATION"));
});

test("an unknown type is its own family; nothing gives nothing", () => {
  assert.deepEqual(docTypeFamily("VARIATION_ORDER"), ["VARIATION_ORDER"]);
  assert.deepEqual(docTypeFamily(undefined), []);
  assert.deepEqual(docTypeFamily(""), []);
});
