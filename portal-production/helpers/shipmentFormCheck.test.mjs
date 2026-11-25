// Run: npm test. Round BY (Sayaka, #24): the B/L details form never fails silently; a contract only to create outside an order.
import { test } from "node:test";
import assert from "node:assert/strict";
import { formProblems } from "../app/portal/shipments/_lib/shipment-form-check.ts";

const ok = { creating: false, underOrder: false, contractId: "", lineRequired: false, lineId: "", currency: "USD", deliveryMonth: "2026-12", dateError: false, badNumbers: [] };

test("#24-1 (PI-only order, no contract): the step 3a form saves the B/L values", () => {
  assert.deepEqual(formProblems(ok), []);
});

test("a contract is needed only to create a shipment outside an order", () => {
  assert.deepEqual(formProblems({ ...ok, creating: true }), [{ key: "contract" }]);
  assert.deepEqual(formProblems({ ...ok, creating: true, underOrder: true }), []);
  assert.deepEqual(formProblems({ ...ok, creating: true, contractId: "c1" }), []);
});

test("every blocker is named (product line, currency, month, dates, numbers)", () => {
  const p = formProblems({ ...ok, lineRequired: true, currency: "us", deliveryMonth: "12/2026", dateError: true, badNumbers: ["Net weight (MT)"] });
  assert.deepEqual(p.map((x) => x.key), ["productLine", "currency", "deliveryMonth", "dates", "number"]);
  assert.equal(p[4].field, "Net weight (MT)");
});
