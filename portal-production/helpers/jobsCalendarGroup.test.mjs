// Run: npm test (node --test, Node's built-in TypeScript stripping).
// 2026-11-17: group calendar (enableGroupCalendar, parent org): child orgs' items are read only; links only for
// members, through an explicit switch; without the group view every helper behaves exactly as before.
import { test } from "node:test";
import assert from "node:assert/strict";
import { crossOrgTarget, eventClickTarget, isMovable, orgLabel, panelLinks, panelRefs, toCalendarInputs } from "../components/Dashboard/jobs-calendar/calendarModel.ts";

const ev = (over = {}) => ({
  id: "aims:1", source: "aims", kind: "delivery", title: "ORD1 · #12 Acme", start: "2026-11-03", end: null,
  allDay: true, status: "scheduled", statusLabel: "Scheduled", completed: false, cancelled: false, address: "1 Tuas Ave", site: "Acme",
  worker: "Ali", rider: null, crew: [], href: "/portal/deliveries/1", siteclockUrl: null, deliveryNumber: 12,
  orderNumber: "ORD1", orderHref: "/portal/orders/o1", doNumber: "DO1", doHref: "/portal/documents/DELIVERY_ORDER/t/d1",
  quotationNumber: "QO1", quotationHref: "/portal/documents/QUOTATION/t/q1", ...over,
});

test("gate off (no org tags): links, refs, drag and click are exactly as before", () => {
  const e = ev();
  assert.equal(crossOrgTarget(e), null);
  assert.equal(orgLabel(e), null);
  assert.equal(isMovable(e), true);
  assert.deepEqual(panelLinks(e).map((l) => l.href), ["/portal/orders/o1", "/portal/documents/DELIVERY_ORDER/t/d1", "/portal/deliveries/1"]);
  assert.deepEqual(panelRefs(e, true), {
    titleHref: "/portal/orders/o1",
    rows: [
      { key: "order", label: "Order", number: "ORD1", href: "/portal/orders/o1" },
      { key: "quotation", label: "Quotation", number: "QO1", href: "/portal/documents/QUOTATION/t/q1" },
      { key: "do", label: "DO", number: "DO1", href: "/portal/documents/DELIVERY_ORDER/t/d1" },
    ],
  });
  assert.deepEqual(eventClickTarget(e), { href: "/portal/orders/o1", external: false });
});

test("own org item with the group view on: company shown, links plain, still movable", () => {
  const e = ev({ orgId: "p", orgName: "WCT (S)" });
  assert.equal(orgLabel(e), "WCT (S)");
  assert.equal(crossOrgTarget(e), null);
  assert.equal(isMovable(e), true);
  assert.equal(panelLinks(e).length, 3);
});

test("a child org's item for a member: links go through an explicit switch; never draggable", () => {
  const e = ev({ orgId: "c", orgName: "WCT Racking", foreign: true });
  assert.deepEqual(crossOrgTarget(e), { orgId: "c", orgName: "WCT Racking" });
  assert.equal(isMovable(e), false);
  assert.equal(toCalendarInputs([e], false, true, true)[0].startEditable, undefined);
  assert.equal(panelRefs(e, true).titleHref, "/portal/orders/o1");
});

test("a child org's item for a non-member: view only, no links anywhere, never draggable", () => {
  const e = ev({ orgId: "c", orgName: "BC Air", foreign: true, viewOnly: true, href: null, orderHref: null, doHref: null, quotationHref: null });
  assert.equal(crossOrgTarget(e), null);
  assert.deepEqual(panelLinks(e), []);
  assert.equal(eventClickTarget(e), null);
  const refs = panelRefs(e, true);
  assert.equal(refs.titleHref, null);
  assert.deepEqual(refs.rows.map((r) => [r.number, r.href]), [["ORD1", null], ["QO1", null], ["DO1", null]]);
  // Even if a link slipped through, viewOnly wins.
  const leaky = ev({ orgId: "c", orgName: "BC Air", foreign: true, viewOnly: true });
  assert.deepEqual(panelLinks(leaky), []);
  assert.ok(panelRefs(leaky, true).rows.every((r) => r.href === null));
  assert.equal(panelRefs(leaky, true).titleHref, null);
  assert.equal(isMovable(leaky), false);
  assert.deepEqual(panelLinks(ev({ source: "siteclock", siteclockUrl: "https://sc", viewOnly: true, foreign: true })), []);
});

test("calendar add gate (numbered links): the panel keeps only Open job; gate off keeps Open order / View DO / Open job", () => {
  const e = ev();
  assert.deepEqual(panelLinks(e, true).map((l) => [l.label, l.href]), [["Open job", "/portal/deliveries/1"]]);
  assert.deepEqual(panelLinks(e, false).map((l) => l.label), ["Open order", "View DO", "Open job"]);
  assert.deepEqual(panelLinks(e).map((l) => l.label), ["Open order", "View DO", "Open job"]);
  // A misc / quick job keeps its DO row (a link) in the numbered rows.
  const misc = ev({ orderNumber: null, orderHref: null, quotationNumber: null, quotationHref: null });
  assert.deepEqual(panelRefs(misc, true).rows.map((r) => [r.label, r.href]), [["DO", "/portal/documents/DELIVERY_ORDER/t/d1"]]);
  assert.deepEqual(panelLinks(misc, true).map((l) => l.label), ["Open job"]);
  // Group view: a member's child job keeps Open job; a view-only one has none; SiteClock stays.
  assert.deepEqual(panelLinks(ev({ orgId: "c", orgName: "WCT Racking", foreign: true }), true).map((l) => l.label), ["Open job"]);
  assert.deepEqual(panelLinks(ev({ orgId: "c", orgName: "BC Air", foreign: true, viewOnly: true }), true), []);
  assert.deepEqual(panelLinks(ev({ source: "siteclock", href: null, siteclockUrl: "https://sc" }), true).map((l) => l.label), ["Open in SiteClock"]);
});
