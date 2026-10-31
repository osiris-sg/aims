// Run: npm test (node --test, Node's built-in TypeScript stripping).
// Round P: "Sales" nav — Dashboard · Orders · Shipments; the Dashboard is the landing page.
// Round W: Inbox left the menu — a stored `inbox` submenu row is dropped by the sidebar / top bar.
// (Round O: the tasks in the bell + the Orders "Tasks" panel; "Imported, payment not tracked".)
import { test } from "node:test";
import assert from "node:assert/strict";
import { CLIENTS_ROUTE, SALES_MENU_LABELS, SHIPMENTS_EMAILS, SHIPMENTS_HOME, SHIPMENTS_MONTHLY, SHIPMENTS_ORDERS, clientsNavModule, isClientsPath, navLangOf, shipmentsLanding, visibleSalesSubmenus, withoutSalesMonthly } from "./shipmentsNav.ts";
import { bellBadge, isOverdue, taskCounts } from "../app/portal/shipments/_lib/tasks.ts";
import { IMPORT_NOTE, receiptNotTracked } from "../app/portal/shipments/_lib/receipt.ts";

test("Sales menu: Dashboard · Orders · Shipments — no Inbox (round W)", () => {
  const menu = [
    { key: "dashboard", label: "Dashboard" },
    { key: "list", label: "Orders" },
    { key: "shipments", label: "Shipments" },
  ];
  assert.deepEqual(menu.map((s) => s.label), [...SALES_MENU_LABELS]);
  assert.ok(!SALES_MENU_LABELS.includes("Inbox"));
});

test("a stored `inbox` submenu row is filtered out whatever the org's module row says; the others stay in order", () => {
  const stored = [
    { key: "list", label: "Orders" },
    { key: "shipments", label: "Shipments" },
    { key: "inbox", label: "Inbox" },
  ];
  assert.deepEqual(visibleSalesSubmenus(stored).map((s) => s.key), ["list", "shipments"]);
  assert.deepEqual(visibleSalesSubmenus(["list", "inbox", "shipments"]), ["list", "shipments"]);
  assert.deepEqual(visibleSalesSubmenus([{ key: "inbox" }]), []);
  assert.deepEqual(visibleSalesSubmenus([]), []);
});

test("the emails live on the Dashboard now: the old Inbox URL's target is the Dashboard sub-view", () => {
  assert.equal(SHIPMENTS_EMAILS, "/portal?view=emails");
  assert.ok(SHIPMENTS_EMAILS.startsWith(SHIPMENTS_HOME));
});

test("every landing goes to Sales › Dashboard (portal root, org switch, nav); the URLs are unchanged", () => {
  assert.equal(shipmentsLanding(), SHIPMENTS_HOME);
  assert.equal(SHIPMENTS_HOME, "/portal");
  assert.equal(SHIPMENTS_ORDERS, "/portal/shipments");
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
  assert.equal(bellBadge(5, tasks, today, 2), 6);
  assert.equal(bellBadge(5, undefined, today, 0), 5);
  assert.equal(bellBadge(0, [], today, 0), 0);
});

test('"Imported, payment not tracked": a receiving step with no receipt on a closed order, or imported "completed before AIMS"', () => {
  assert.equal(receiptNotTracked("IN", null, false, null), true);
  assert.equal(receiptNotTracked("IN", null, true, IMPORT_NOTE), true);
  assert.equal(receiptNotTracked("IN", null, true, null), false);
  assert.equal(receiptNotTracked("IN", { amount: 1 }, false, null), false);
  assert.equal(receiptNotTracked("OUT", null, false, null), false);
});

test("round AM: Monthly list left the Sales menu (the Orders page's Monthly view); its URL goes there", () => {
  assert.deepEqual(withoutSalesMonthly([{ key: "list", label: "Orders" }, { key: "shipments", label: "Shipments" }, { key: "monthly", label: "Monthly list" }]).map((s) => s.key), ["list", "shipments"]);
  assert.deepEqual(withoutSalesMonthly(["list", "monthly"]), ["list"]);
  assert.equal(SHIPMENTS_MONTHLY, "/portal/shipments/orders?view=monthly");
});

test("round AM: Clients sits right after Sales (EN / JA), under the SHIPMENTS-guarded routes", () => {
  const en = clientsNavModule("en", -3);
  assert.equal(en.displayName, "Clients");
  assert.equal(en.sortOrder, -2.5);
  assert.deepEqual(en.config.subMenus.map((s) => s.label), ["Customers", "Suppliers", "Shipping lines"]);
  assert.deepEqual(clientsNavModule("ja", -3).config.subMenus.map((s) => s.label), ["顧客", "仕入先", "船会社"]);
  assert.equal(clientsNavModule("ja", -3).displayName, "取引先");
  assert.ok(CLIENTS_ROUTE.startsWith("/portal/shipments/"));
  assert.ok(isClientsPath("/portal/shipments/clients/customers/abc"));
  assert.ok(!isClientsPath("/portal/shipments/orders"));
  assert.equal(navLangOf("ja-JP"), "ja");
  assert.equal(navLangOf("en-SG"), "en");
});
