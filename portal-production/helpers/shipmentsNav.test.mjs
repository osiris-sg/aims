// Run: npm test (node --test, Node's built-in TypeScript stripping).
// Round O: no Shipments Home page — Orders is the landing; tasks in the bell + the Orders "Tasks" panel.
import { test } from "node:test";
import assert from "node:assert/strict";
import { SHIPMENTS_HOME, SHIPMENTS_ORDERS, hiddenShipmentsSubmenu, shipmentsLanding } from "./shipmentsNav.ts";
import { bellBadge, isOverdue, taskCounts } from "../app/portal/shipments/_lib/tasks.ts";
import { IMPORT_NOTE, receiptNotTracked } from "../app/portal/shipments/_lib/receipt.ts";

test("menu without Home: the Shipments › Home row is dropped while the flag is off, kept with it on; other rows untouched", () => {
  const menu = [
    { key: "dashboard", label: "Home" },
    { key: "list", label: "Orders" },
    { key: "shipments", label: "Shipments" },
    { key: "inbox", label: "Inbox" },
  ];
  const shown = (flag) => menu.filter((s) => !hiddenShipmentsSubmenu("SHIPMENTS", s.key, flag)).map((s) => s.label);
  assert.deepEqual(shown(false), ["Orders", "Shipments", "Inbox"]);
  assert.deepEqual(shown(true), ["Home", "Orders", "Shipments", "Inbox"]);
  // Another module's "dashboard" submenu (e.g. Accounting › Dashboard) is never touched.
  assert.equal(hiddenShipmentsSubmenu("ACCOUNTING", "dashboard", false), false);
  assert.equal(hiddenShipmentsSubmenu("SHIPMENTS", undefined, false), false);
});

test("every landing goes to Orders with the flag off (portal root, org switch, nav), Home with it on", () => {
  assert.equal(shipmentsLanding(false), SHIPMENTS_ORDERS);
  assert.equal(shipmentsLanding(false), "/portal/shipments");
  assert.equal(shipmentsLanding(true), SHIPMENTS_HOME);
  assert.equal(SHIPMENTS_HOME, "/portal/shipments/dashboard");
});

test("task counts: overdue (before today, Tokyo day) / due today / upcoming; the bell badge adds due tasks without double counting", () => {
  const today = "2026-10-21";
  const tasks = [
    { id: "a", dueAt: "2026-07-21T16:00:00.000Z", status: "DUE" }, // overdue
    { id: "b", dueAt: "2026-10-18T16:00:00.000Z", status: "DUE" }, // overdue
    { id: "c", dueAt: "2026-10-21T00:00:00.000Z", status: "DUE" }, // today
    { id: "d", dueAt: "2026-10-24T16:00:00.000Z", status: "SCHEDULED" }, // upcoming
  ];
  assert.deepEqual(taskCounts(tasks, today), { total: 4, overdue: 2, dueToday: 1, upcoming: 1 });
  assert.deepEqual(taskCounts(undefined, today), { total: 0, overdue: 0, dueToday: 0, upcoming: 0 });
  assert.equal(isOverdue(tasks[0], today), true);
  assert.equal(isOverdue(tasks[3], today), false);
  // 5 unread rows, 2 of them the bell rows of tasks a and b (folded into the task rows): 3 + 3 due tasks.
  assert.equal(bellBadge(5, tasks, today, 2), 6);
  // Nothing trade: the badge is the unread count, as before.
  assert.equal(bellBadge(5, undefined, today, 0), 5);
  assert.equal(bellBadge(0, [], today, 0), 0);
});

test('"Imported, payment not tracked": a receiving step with no receipt on a closed order, or imported "completed before AIMS"', () => {
  // ADH-INV-2026-0001 / 0002: order #11 COMPLETED, steps 2 / 11 done, no receipt.
  assert.equal(receiptNotTracked("IN", null, false, null), true);
  // A step imported from the task list on an open order.
  assert.equal(receiptNotTracked("IN", null, true, IMPORT_NOTE), true);
  // A live order with no receipt yet: "No receipt recorded" (tracked, reminder applies).
  assert.equal(receiptNotTracked("IN", null, true, null), false);
  // A receipt recorded: tracked, whatever the order's state.
  assert.equal(receiptNotTracked("IN", { amount: 1 }, false, null), false);
  // Paying steps never say it.
  assert.equal(receiptNotTracked("OUT", null, false, null), false);
});
