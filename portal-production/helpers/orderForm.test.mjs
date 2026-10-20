// Run: npm test (node --test, Node's built-in TypeScript stripping).
// New-order form (round N): delivery month default, the selected grade's contract premiums.
import { test } from "node:test";
import assert from "node:assert/strict";
import { addMonths, defaultDeliveryMonth, premiumHelp, premiumRowFor } from "../app/portal/shipments/_lib/order-form.ts";

test("delivery month = ship month + 2 (SUS, Kato), across a year end; blank without a ship month", () => {
  assert.equal(defaultDeliveryMonth("2026-07"), "2026-09");
  assert.equal(defaultDeliveryMonth("2026-11"), "2027-01");
  assert.equal(defaultDeliveryMonth(""), "");
  assert.equal(addMonths("2026-01", -1), "2025-12");
});

// Kato contract 454003598: 6005 → supplier +260 / client +285; an every-grade row +205 / +230 (6063).
const KATO = [
  { from: "2026-01", to: null, grade: "6005", supplierPremium: 260, clientPremium: 285, upcharge: null },
  { from: "2026-01", to: null, grade: null, supplierPremium: 205, clientPremium: 230, upcharge: null },
];

test("the selected grade's row, never another grade's (6005 → +260 / +285)", () => {
  const r = premiumRowFor(KATO, "2026-07", "6005");
  assert.equal(r.supplierPremium, 260);
  assert.equal(r.clientPremium, 285);
  assert.equal(premiumRowFor(KATO, "2026-07", "6063").supplierPremium, 205);
  const h = premiumHelp("454003598", r, "6005");
  assert.match(h.supplier, /Contract 454003598, 6005: supplier \+260/);
  assert.match(h.client, /Contract 454003598, 6005: client \+285/);
  assert.doesNotMatch(h.supplier + h.client, /6063|\+205|\+230/);
});

test("no row for the grade → says so; no contract → generic", () => {
  assert.match(premiumHelp("454003598", null, "P1020").supplier, /has no P1020 row/);
  assert.match(premiumHelp(null, null, "6005").supplier, /QMJP/);
});
