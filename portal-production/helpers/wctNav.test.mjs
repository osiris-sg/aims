// WCT navigation + naming (enableWctOrders, 2026-11-03): helpers/wctNav.ts, helpers/jobWording.ts, the
// calendar's wording, and the screens that use them. Biofuel (and every other org) unchanged.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { hiddenFromMenu, menuOrderOverride, ordersTab, wctDeliveriesRedirect, ORDER_JOB_STATE_LABEL, orderJobStateColor } from "./wctNav.ts";
import { jobLabel, runTitle, runWords } from "./jobWording.ts";
import { calendarLegendItems, kindLabel } from "../components/Dashboard/jobs-calendar/calendarModel.ts";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("menu: WCT has Orders right after Sales and no Deliveries; other orgs as before", () => {
  // WCT's stored order: Dashboard 0, Inventory 1, Deliveries 2, Sales 3, Customers 4, Orders 5, ...
  const stored = { DASHBOARD: 0, INVENTORY: 1, DELIVERIES: 2, SALES: 3, CUSTOMERS: 4, ORDERS: 5, SUPPLIERS: 5, MAINTENANCE: 5, USER_MANAGEMENT: 5, ACCOUNTING: 7 };
  const order = (isWct) => {
    const o = menuOrderOverride(isWct);
    return Object.entries(stored)
      .filter(([c]) => !hiddenFromMenu(c, isWct))
      .sort((a, b) => (o[a[0]] ?? a[1]) - (o[b[0]] ?? b[1]))
      .map(([c]) => c);
  };
  assert.deepEqual(order(true).slice(0, 4), ["DASHBOARD", "SALES", "ORDERS", "INVENTORY"]);
  assert.ok(!order(true).includes("DELIVERIES"));
  assert.deepEqual(order(false).slice(0, 4), ["DASHBOARD", "SALES", "INVENTORY", "DELIVERIES"]);
  assert.deepEqual(menuOrderOverride(false), { SALES: 0.5 });
});

test("Orders tabs and the old deliveries links", () => {
  assert.equal(ordersTab(null), "orders");
  assert.equal(ordersTab("jobs"), "jobs");
  assert.equal(ordersTab("verify"), "verify");
  assert.equal(ordersTab("nope"), "orders");
  assert.equal(wctDeliveriesRedirect("/portal/deliveries"), "/portal/orders?tab=jobs");
  assert.equal(wctDeliveriesRedirect("/portal/deliveries/verification/"), "/portal/orders?tab=verify");
  assert.equal(wctDeliveriesRedirect("/portal/deliveries/abc"), null); // job pages still open
  for (const s of Object.keys(ORDER_JOB_STATE_LABEL)) assert.ok(orderJobStateColor(s));
});

test("wording: WCT says Job, everyone else Delivery; no em or en dashes", () => {
  const j = runWords(true);
  const d = runWords(false);
  assert.equal(runTitle(j, 12), "Job #12");
  assert.equal(runTitle(d, 12), "Delivery #12");
  assert.equal(runTitle(j, 12, true), "Return #12");
  assert.equal(`Start ${j.Noun}`, "Start Job");
  assert.equal(jobLabel("Delivered", true), "Done");
  assert.equal(jobLabel("NOT DELIVERED", true), "NOT DONE");
  assert.equal(jobLabel("Delivered", false), "Delivered");
  assert.equal(jobLabel("Completed", true), "Completed");
  for (const w of [j, d]) for (const v of Object.values(w)) assert.doesNotMatch(String(v), /[–—]/);
});

test("calendar: WCT's legend says Job (not Job / return), popup kind Job; others unchanged", () => {
  assert.equal(calendarLegendItems(true)[0].label, "Job");
  assert.equal(calendarLegendItems(false)[0].label, "Delivery / return");
  assert.equal(kindLabel("delivery", true), "Job");
  assert.equal(kindLabel("return", true), "Job");
  assert.equal(kindLabel("delivery", false), "Delivery");
  assert.equal(kindLabel("service", true), "Service run");
  const view = read("components/Dashboard/jobs-calendar/CalendarView.tsx");
  assert.match(view, /if \(openOnClick && e\.href\) return router\.push\(e\.href\);/);
  assert.match(view, /jobWords \? "Open job" : "Open delivery"/);
});

test("screens: Orders tabs, redirects, dashboard, removed buttons, field ad-hoc, quotation banner", () => {
  const ordersPage = read("app/portal/orders/WctOrdersPage.tsx");
  for (const t of ['"Orders"', '"Jobs"', '"To verify"']) assert.ok(ordersPage.includes(t), t);
  assert.match(ordersPage, /<VerificationQueue embedded \/>/);
  assert.match(read("app/portal/orders/page.tsx"), /isWctOrdersEnabled\)\s*return \(\s*<Suspense/);
  assert.match(read("app/portal/deliveries/page.tsx"), /router\.replace\("\/portal\/orders\?tab=jobs"\)/);
  assert.match(read("app/portal/deliveries/verification/page.tsx"), /router\.replace\("\/portal\/orders\?tab=verify"\)/);
  // Dashboard: the calendar alone, full height, for WCT only.
  assert.match(read("components/Dashboard/DashboardOverview.tsx"), /if \(isWctOrdersEnabled\)\s*return \(\s*<MainCard>\s*<JobsCalendar fullHeight \/>\s*<\/MainCard>/);
  // Field app: no Ad-hoc for WCT; its ad-hoc / scan-start pages send WCT to Jobs.
  assert.match(read("app/(field)/scan/page.tsx"), /onAdd=\{isWctOrdersEnabled \? undefined : \(\) => router\.push\("\/scan\/adhoc"\)\}/);
  for (const p of ["app/(field)/scan/adhoc/page.tsx", "app/(field)/scan/adhoc/return/page.tsx", "app/(field)/scan/asset/[assetId]/delivery-start/page.tsx", "app/(field)/scan/delivery/[deliveryId]/adhoc/page.tsx"]) {
    assert.match(read(p), /export default withNoAdhocForWct\(/, p);
  }
  // Quotation: banner + list line.
  assert.match(read("app/portal/documents/[type]/[id]/[documentId]/page.tsx"), /Order \{linkedOrder\.orderNumber\} created/);
  assert.match(read("app/portal/sales/components/SalesDocumentList.tsx"), /Order \{row\.original\.linkedOrder\.orderNumber\}/);
  // Job page title + field job screen use the wording helper.
  assert.match(read("app/portal/deliveries/[id]/page.tsx"), /runTitle\(w, run\.deliveryNumber\)/);
  assert.match(read("app/(field)/scan/delivery/[deliveryId]/page.tsx"), /title: run \? runTitle\(w, run\.deliveryNumber, run\.direction === "RETURN"\) : w\.Noun/);
});
