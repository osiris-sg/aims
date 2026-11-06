// Run: npm test. Round BG: link a file to several orders / shipments in one go.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ciTotals, groupItems, matches, toggleAll, toggleOne } from "../app/portal/shipments/_lib/link-checklist.ts";

const items = [
  { key: "o:18", kind: "order", ref: "#18", customer: "SUS" },
  { key: "o:180", kind: "order", ref: "#180", customer: "Kato" },
  { key: "s:18-2", kind: "shipment", ref: "#18-2", orderRef: "#18", customer: "SUS", bl: "MEDUJ1234567", ciNo: "XP2652100012", ciAmount: 146868.33, currency: "USD" },
  { key: "s:18-1", kind: "shipment", ref: "#18-1", orderRef: "#18", customer: "SUS", bl: "MEDUJ7654321", ciNo: "XP2652100011", ciAmount: 944256.79, currency: "USD" },
  { key: "s:19-1", kind: "shipment", ref: "#19-1", orderRef: "#19", customer: "SUS", bl: null, ciAmount: null },
];

test("search: #n = the order and its shipments (never #180); #n-s; B/L; customer", () => {
  assert.deepEqual(items.filter((i) => matches(i, "#18")).map((i) => i.ref), ["#18", "#18-2", "#18-1"]);
  assert.deepEqual(items.filter((i) => matches(i, "18-1")).map((i) => i.ref), ["#18-1"]);
  assert.deepEqual(items.filter((i) => matches(i, "7654321")).map((i) => i.ref), ["#18-1"]);
  assert.deepEqual(items.filter((i) => matches(i, "b/l meduj1234")).map((i) => i.ref), ["#18-2"]);
  assert.deepEqual(items.filter((i) => matches(i, "kato")).map((i) => i.ref), ["#180"]);
});

test("groups: orders, shipments by order in number order; ticked rows stay visible", () => {
  const g = groupItems(items, "#19", new Set(["s:18-1"]));
  assert.deepEqual(g.orders.map((x) => x.ref), []);
  assert.deepEqual(g.shipments.map((x) => [x.orderRef, x.items.map((i) => i.ref)]), [["#18", ["#18-1"]], ["#19", ["#19-1"]]]);
  assert.deepEqual(groupItems(items, "", new Set()).shipments[0].items.map((i) => i.ref), ["#18-1", "#18-2"]);
});

test("select all shipments of #18 (and again = none); one toggle", () => {
  assert.deepEqual(toggleAll(["o:18"], ["s:18-1", "s:18-2"]), ["o:18", "s:18-1", "s:18-2"]);
  assert.deepEqual(toggleAll(["o:18", "s:18-1", "s:18-2"], ["s:18-1", "s:18-2"]), ["o:18"]);
  assert.deepEqual(toggleAll(["s:18-1"], ["s:18-1", "s:18-2"]), ["s:18-1", "s:18-2"]);
  assert.deepEqual(toggleOne(["a"], "a"), []);
});

test("CI totals: the sum of the ticked CIs and the difference to the proof (no block)", () => {
  const t = ciTotals(items, ["s:18-1", "s:18-2", "o:18"], 1091125.12);
  assert.equal(t.total, 1091125.12);
  assert.equal(t.difference, 0);
  assert.equal(ciTotals(items, ["s:18-1", "s:18-2"], 1091000).difference, -125.12);
  const m = ciTotals(items, ["s:18-1", "s:19-1"]);
  assert.equal(m.missing, 1);
  assert.equal(m.difference, null);
});
