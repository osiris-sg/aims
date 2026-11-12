// Run: npm test. 2026-11-13: the DO page toolbar must show for a DO on an order, whatever shape the page passes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { doOrderIdOf } from "./doOrder.ts";

test("reads the order of a DO from the flattened config the document page passes (the prod bug)", () => {
  assert.equal(doOrderIdOf({ orderId: "o1", orderNo: "ORD202611-005", items: [] }), "o1");
});
test("and from a document row", () => {
  assert.equal(doOrderIdOf({ id: "d1", config: { orderId: "o2" } }), "o2");
});
test("no order: no toolbar", () => {
  assert.equal(doOrderIdOf({ items: [] }), null);
  assert.equal(doOrderIdOf(null), null);
  assert.equal(doOrderIdOf({ orderId: "" }), null);
});
