// Run: npm test (node --test, Node's built-in TypeScript stripping).
// Documents hub tabs (round L): Shipments-style tabs with counts; empty tabs hidden, All always shown.
import { test } from "node:test";
import assert from "node:assert/strict";
import { visibleTabs } from "../app/portal/shipments/_lib/hub-tabs.ts";

test("All · Supplier · Customer · Invoices · Customs & logistics · Payments · Other, with counts", () => {
  const t = visibleTabs({ SUPPLIER: 22, CUSTOMER: 4, INVOICES: 4, CUSTOMS_LOGISTICS: 14, PAYMENTS: 8, OTHER: 0 }, 52, "");
  assert.deepEqual(
    t.map((x) => `${x.label} (${x.count})`),
    ["All (52)", "Supplier (22)", "Customer (4)", "Invoices (4)", "Customs & logistics (14)", "Payments (8)"],
  );
});

test("a tab with 0 is hidden, except All and the one being viewed", () => {
  assert.deepEqual(visibleTabs({}, 0, "").map((x) => x.code), [""]);
  assert.deepEqual(visibleTabs({ SUPPLIER: 3 }, 3, "PAYMENTS").map((x) => x.code), ["", "SUPPLIER", "PAYMENTS"]);
});
