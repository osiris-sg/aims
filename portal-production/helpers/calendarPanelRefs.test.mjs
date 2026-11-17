// Run: npm test. 2026-11-17: WCT jobs calendar panel, numbered Order / Quotation / DO links (calendar add gate).
import { test } from "node:test";
import assert from "node:assert/strict";
import { panelRefs, panelLinks } from "../components/Dashboard/jobs-calendar/calendarModel.ts";

const ev = (over = {}) => ({
  id: "aims:1", source: "aims", kind: "service", title: "#12 Acme", start: "2026-11-03T02:00:00.000Z", end: null, allDay: false,
  status: "scheduled", statusLabel: "Scheduled", completed: false, cancelled: false, address: null, site: "Acme",
  worker: null, rider: null, crew: [], href: "/portal/deliveries/1", siteclockUrl: null, deliveryNumber: 12, ...over,
});
const orderJob = ev({
  title: "ORD202611-004 · #12 Acme",
  orderNumber: "ORD202611-004", orderHref: "/portal/orders/o4",
  quotationNumber: "QO202611-004", quotationHref: "/portal/documents/QUOTATION/tq/q4",
  doNumber: "DO202611021", doTag: "Pending", doHref: "/portal/documents/DELIVERY_ORDER/td/d21",
});
const quickJob = ev({ untagged: true, quotationNumber: "QO202611-012", quotationHref: "/portal/documents/QUOTATION/tq/q12" });
const miscJob = ev({ untagged: true });
const scJob = ev({ id: "sc:1", source: "siteclock", kind: "siteclock", href: null, siteclockUrl: "https://siteclock.osiris.sg/#/jobs" });

test("order job: Order, Quotation and DO rows link to their pages; the title opens the order", () => {
  const r = panelRefs(orderJob, true);
  assert.deepEqual(r, {
    titleHref: "/portal/orders/o4",
    rows: [
      { key: "order", label: "Order", number: "ORD202611-004", href: "/portal/orders/o4" },
      { key: "quotation", label: "Quotation", number: "QO202611-004", href: "/portal/documents/QUOTATION/tq/q4" },
      { key: "do", label: "DO", number: "DO202611021", href: "/portal/documents/DELIVERY_ORDER/td/d21" },
    ],
  });
});

test("quick job on an unsigned quotation: the Quotation link only, the title is not a link", () => {
  assert.deepEqual(panelRefs(quickJob, true), {
    titleHref: null,
    rows: [{ key: "quotation", label: "Quotation", number: "QO202611-012", href: "/portal/documents/QUOTATION/tq/q12" }],
  });
});

test("misc job: no Order or Quotation rows; SiteClock job: no rows and Open in SiteClock kept", () => {
  assert.deepEqual(panelRefs(miscJob, true), { titleHref: null, rows: [] });
  assert.deepEqual(panelRefs(scJob, true), { titleHref: null, rows: [] });
  assert.deepEqual(panelLinks(scJob), [{ label: "Open in SiteClock", href: "https://siteclock.osiris.sg/#/jobs", external: true }]);
  // Even if a SiteClock event carried numbers, it never shows AIMS rows.
  assert.deepEqual(panelRefs({ ...scJob, orderNumber: "X", quotationNumber: "Y", doNumber: "Z" }, true), { titleHref: null, rows: [] });
});

test("a number without a page shows unlinked; an order number without its page leaves the title plain", () => {
  const r = panelRefs(ev({ orderNumber: "ORD1", orderHref: null, quotationNumber: "QO1", quotationHref: null }), true);
  assert.equal(r.titleHref, null);
  assert.deepEqual(r.rows.map((x) => [x.label, x.href]), [["Order", null], ["Quotation", null]]);
});

test("gate off (no calendar add): no rows and no title link, the panel stays as it was", () => {
  for (const e of [orderJob, quickJob, miscJob, scJob]) assert.equal(panelRefs(e, false), null);
  // Today's buttons are untouched either way.
  assert.deepEqual(panelLinks(orderJob).map((l) => l.label), ["Open order", "View DO", "Open job"]);
});

test("links are in-app paths (pushed by next/link, no new tab), never external", () => {
  for (const r of panelRefs(orderJob, true).rows) assert.ok(r.href.startsWith("/portal/"));
});
