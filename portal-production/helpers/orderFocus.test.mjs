// Run: npm test (node --test). Round R: the order page lands on the current step; trimmed header / done-step text.
import { test } from "node:test";
import assert from "node:assert/strict";
import { defaultShipmentId, doneTooltip, firstOpenStep, focusStepId, headerLine2, headerStepText } from "../app/portal/shipments/_lib/order-focus.ts";

const st = (id, status, sortOrder, extra = {}) => ({ id, status, sortOrder, ...extra });

test("auto-scroll target: the order's early open step wins, else the shipment's open step, else the late order step", () => {
  const early = [st("s0", "DONE", 0), st("s1", "DONE", 10), st("s2", "DONE", 20)];
  const ship = [st("3a", "DONE", 30), st("3b", "IN_PROGRESS", 31), st("4", "NOT_STARTED", 40)];
  const late = [st("11", "NOT_STARTED", 110), st("13", "NOT_STARTED", 130)];
  assert.equal(focusStepId(early, ship, late), "3b");
  assert.equal(focusStepId([st("s0", "DONE", 0), st("s1", "IN_PROGRESS", 10)], ship, late), "s1");
  assert.equal(focusStepId(early, ship.map((s) => ({ ...s, status: "DONE" })), late), "11");
  assert.equal(focusStepId(early, [st("na", "NOT_STARTED", 30, { notApplicable: true }), st("x", "DONE", 31)], []), null);
  assert.equal(firstOpenStep([st("o", "NOT_STARTED", 5, { isOngoing: true }), st("p", "NOT_STARTED", 6)]).id, "p");
});

test("default shipment: the open shipment furthest behind; else the first", () => {
  const ships = [
    { id: "a", status: "COMPLETED", progress: { done: 10, total: 10 } },
    { id: "b", status: "OPEN", progress: { done: 7, total: 10 } },
    { id: "c", status: "OPEN", progress: { done: 2, total: 10 } },
  ];
  assert.equal(defaultShipmentId(ships), "c");
  assert.equal(defaultShipmentId([ships[0]]), "a");
  assert.equal(defaultShipmentId([]), undefined);
});

test('header line 2 is exactly "Vedanta → SUS · Contract 454003422 · Sep 26 → Nov 26 · Invoice #1 + #2"; step text "Step 4 · Customer docs"', () => {
  assert.equal(headerLine2({ supplierShort: "Vedanta", customerShort: "SUS", contractNo: "454003422", monthsLabel: "Sep 26 → Nov 26", single: false }), "Vedanta → SUS · Contract 454003422 · Sep 26 → Nov 26 · Invoice #1 + #2");
  assert.equal(headerLine2({ supplierShort: null, customerShort: "Kato", contractNo: null, monthsLabel: null, single: true }), "— → Kato · Single invoice");
  assert.equal(headerStepText({ displayNo: "4", title: "Customer docs" }, 15), "Step 4 · Customer docs");
  assert.equal(headerStepText(null, 15), "Completed");
  assert.equal(headerStepText({ position: 9, title: "Send arrival notice" }, 14), "Step 9 · Send arrival notice");
});

test('done step: only ✓ + name; who / when / "imported from the task list" live in the tooltip', () => {
  const fmt = (iso) => iso.slice(0, 10);
  assert.equal(doneTooltip({ updatedByName: "Task list import", completedAt: "2026-10-20T06:00:00Z", skipReason: "completed before AIMS (from task list)" }, fmt), "Imported from the task list · 2026-10-20");
  assert.equal(doneTooltip({ updatedByName: "Sayaka", completedAt: "2026-10-21T01:00:00Z", skipReason: null }, fmt), "Done by Sayaka · 2026-10-21");
  assert.equal(doneTooltip({ updatedByName: null, updatedAt: "2026-10-21T01:00:00Z", skipReason: "N/A for Kato" }, fmt), "Done · 2026-10-21 · N/A for Kato");
});
