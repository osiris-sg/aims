// WCT navigation + naming (enableWctOrders, 2026-11-03): helpers/wctNav.ts, helpers/jobWording.ts, the
// calendar's wording, and the screens that use them. Biofuel (and every other org) unchanged.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JOB_TABS, jobsHref, jobsTab, menuOrderOverride, ordersTabRedirect, verifiedText, wctMenuModule, ORDER_JOB_STATE_LABEL, orderJobStateColor } from "./wctNav.ts";
import { jobLabel, runTitle, runWords } from "./jobWording.ts";
import { calendarLegendItems, kindLabel } from "../components/Dashboard/jobs-calendar/calendarModel.ts";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("menu: WCT reads Dashboard, Sales, Orders, Jobs (the Deliveries module renamed); other orgs as before", () => {
  // WCT's stored order: Dashboard 0, Inventory 1, Deliveries 2, Sales 3, Customers 4, Orders 5, ...
  const stored = { DASHBOARD: 0, INVENTORY: 1, DELIVERIES: 2, SALES: 3, CUSTOMERS: 4, ORDERS: 5, SUPPLIERS: 5, MAINTENANCE: 5, USER_MANAGEMENT: 5, ACCOUNTING: 7 };
  const menu = (isWct) => {
    const o = menuOrderOverride(isWct);
    return Object.entries(stored)
      .sort((a, b) => (o[a[0]] ?? a[1]) - (o[b[0]] ?? b[1]))
      .map(([c]) => wctMenuModule({ moduleCode: c, displayName: c === "DELIVERIES" ? "Deliveries" : c }, isWct).displayName);
  };
  assert.deepEqual(menu(true).slice(0, 5), ["DASHBOARD", "SALES", "ORDERS", "Jobs", "INVENTORY"]);
  assert.equal(menu(true).filter((n) => n === "Jobs" || n === "Deliveries").length, 1); // one entry, no duplicate
  assert.deepEqual(menu(false).slice(0, 4), ["DASHBOARD", "SALES", "INVENTORY", "Deliveries"]);
  assert.deepEqual(menuOrderOverride(false), { SALES: 0.5 });
});

test("Jobs page tabs, the old Orders ?tab= links, the Verified column", () => {
  assert.equal(ordersTabRedirect("jobs"), "/portal/deliveries");
  assert.equal(ordersTabRedirect("verify"), "/portal/deliveries?status=to_verify");
  assert.equal(ordersTabRedirect(null), null);
  assert.equal(ordersTabRedirect("all"), null);
  assert.equal(jobsHref(), "/portal/deliveries");
  assert.equal(jobsTab("to_verify"), "to_verify");
  assert.equal(jobsTab("nope"), "");
  assert.deepEqual(JOB_TABS.map((t) => t.key), ["", "draft", "scheduled", "in_progress", "done", "to_verify", "rejected", "completed", "cancelled"]);
  for (const t of JOB_TABS.slice(1)) assert.equal(ORDER_JOB_STATE_LABEL[t.key], t.label);
  for (const s of Object.keys(ORDER_JOB_STATE_LABEL)) assert.ok(orderJobStateColor(s));
  assert.equal(verifiedText({ verificationState: "verified", verifiedByName: "Hui" }), "Verified by Hui");
  assert.equal(verifiedText({ verificationState: "pending" }), "To verify");
  assert.equal(verifiedText({ verificationState: null }), "-");
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

test("screens: Orders is one list (title, then status tabs, then table); Jobs is its own page; redirects; dashboard; field ad-hoc; banner", () => {
  const orders = read("app/portal/orders/WctOrdersList.tsx");
  assert.match(orders, /tableName="Orders"/);
  assert.match(orders, /headerContent=\{statusTabs\}/); // tabs between the title and the table
  assert.doesNotMatch(read("app/portal/orders/page.tsx"), /WctOrdersPage|WctJobsList|VerificationQueue/);
  assert.match(read("app/portal/orders/page.tsx"), /ordersTabRedirect\(useSearchParams\(\)\.get\("tab"\)\)/);
  const jobs = read("app/portal/deliveries/_components/WctJobsList.tsx");
  assert.match(jobs, /tableName="Jobs"/);
  assert.match(jobs, /header: "Verified"/);
  assert.match(jobs, /counts\[t\.key \|\| "all"\]/);
  assert.match(jobs, /label: "Verify"/);
  assert.match(read("app/portal/deliveries/page.tsx"), /if \(isWctOrdersEnabled\)\s*return \(\s*<Suspense fallback=\{null\}>\s*<WctJobsList \/>/);
  assert.match(read("app/portal/deliveries/verification/page.tsx"), /router\.replace\("\/portal\/deliveries\?status=to_verify"\)/);
  assert.match(read("app/portal/deliveries/[id]/page.tsx"), /router\.push\("\/portal\/deliveries"\)/);
  assert.doesNotMatch(read("app/portal/deliveries/[id]/page.tsx"), /orders\?tab=/);
  // Dashboard: the calendar alone, full height, for WCT only.
  assert.match(read("components/Dashboard/DashboardOverview.tsx"), /if \(isWctOrdersEnabled\)\s*return \(\s*<MainCard>\s*<JobsCalendar fullHeight \/>\s*<\/MainCard>/);
  // Field app: no Ad-hoc for WCT; its ad-hoc / scan-start pages send WCT to Jobs.
  assert.match(read("app/(field)/scan/page.tsx"), /onAdd=\{isWctOrdersEnabled \? undefined : \(\) => router\.push\("\/scan\/adhoc"\)\}/);
  for (const p of ["app/(field)/scan/adhoc/page.tsx", "app/(field)/scan/adhoc/return/page.tsx", "app/(field)/scan/asset/[assetId]/delivery-start/page.tsx", "app/(field)/scan/delivery/[deliveryId]/adhoc/page.tsx"]) {
    assert.match(read(p), /export default withNoAdhocForWct\(/, p);
  }
  assert.match(read("app/portal/documents/[type]/[id]/[documentId]/page.tsx"), /Order \{linkedOrder\.orderNumber\} created/);
  assert.match(read("app/portal/sales/components/SalesDocumentList.tsx"), /Order \{row\.original\.linkedOrder\.orderNumber\}/);
  assert.match(read("app/portal/deliveries/[id]/page.tsx"), /runTitle\(w, run\.deliveryNumber\)/);
});
