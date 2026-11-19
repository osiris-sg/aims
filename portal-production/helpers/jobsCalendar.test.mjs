// Run: npm test (node --test, Node's built-in TypeScript stripping).
// 2026-10-30: Dashboard jobs calendar (WCT, enableJobsCalendar): range, colours, cancelled toggle, popup text, banner.
import { test } from "node:test";
import assert from "node:assert/strict";
import { rangeOf, toCalendarInputs, timeWindow, crewLine, siteclockBanner, KIND_COLOR, CANCELLED_COLOR, badgeTitle, legendTitle, PTW_STATE_COLOR, ptwStateOf, calendarLegendItems, eventClickTarget, wctStateOf, isMiscJob, panelLinks, dayJobsOf, dayOfInstant, wctKindLabel, eventColor, MORE_LINK_HANDLED, panelMoreLink } from "../components/Dashboard/jobs-calendar/calendarModel.ts";

const ev = (over = {}) => ({
  id: "aims:1", source: "aims", kind: "delivery", title: "#12 Acme", start: "2026-11-03T02:00:00.000Z", end: "2026-11-03T03:30:00.000Z",
  allDay: false, status: "scheduled", statusLabel: "Scheduled", completed: false, cancelled: false, address: "1 Tuas Ave", site: "Acme",
  worker: "Ali", rider: null, crew: [], href: "/portal/deliveries/1", siteclockUrl: null, deliveryNumber: 12, ...over,
});

test("the visible range becomes inclusive API days (FullCalendar's end is exclusive)", () => {
  // Month view of Nov 2026, Monday first: 26 Oct .. 7 Dec (exclusive).
  assert.deepEqual(rangeOf("2026-10-26T00:00:00+08:00", "2026-12-07T00:00:00+08:00"), { from: "2026-10-26", to: "2026-12-06" });
  assert.deepEqual(rangeOf("2026-11-03", "2026-11-04"), { from: "2026-11-03", to: "2026-11-03" });
});

test("colours: deliveries and returns blue, service orange, SiteClock green, cancelled grey", () => {
  const out = toCalendarInputs([ev(), ev({ id: "r", kind: "return" }), ev({ id: "s", kind: "service" }), ev({ id: "c", kind: "siteclock", source: "siteclock" }), ev({ id: "x", cancelled: true })], true);
  const color = Object.fromEntries(out.map((o) => [o.id, o.backgroundColor]));
  assert.equal(color["aims:1"], KIND_COLOR.delivery);
  assert.equal(color.r, KIND_COLOR.delivery);
  assert.equal(color.s, KIND_COLOR.service);
  assert.equal(color.c, KIND_COLOR.siteclock);
  assert.equal(color.x, CANCELLED_COLOR);
  assert.notEqual(KIND_COLOR.delivery, KIND_COLOR.service);
  assert.notEqual(KIND_COLOR.service, KIND_COLOR.siteclock);
});

test("cancelled events are hidden unless Show cancelled is ticked; completed fade, cancelled strike", () => {
  const list = [ev(), ev({ id: "done", completed: true }), ev({ id: "gone", cancelled: true })];
  assert.deepEqual(toCalendarInputs(list, false).map((o) => o.id), ["aims:1", "done"]);
  const all = toCalendarInputs(list, true);
  assert.ok(all.find((o) => o.id === "done").classNames.includes("aims-jc-completed"));
  assert.ok(all.find((o) => o.id === "gone").classNames.includes("aims-jc-cancelled"));
  assert.equal(all[0].extendedProps.event.title, "#12 Acme");
});

test("popup time window is Singapore time", () => {
  assert.equal(timeWindow(ev()), "Tue, 3 Nov · 10:00 am – 11:30 am");
  assert.equal(timeWindow(ev({ allDay: true, start: "2026-11-04", end: null })), "Wed, 4 Nov · All day");
  assert.match(timeWindow(ev({ end: "2026-11-04T01:00:00.000Z" })), /Tue, 3 Nov · 10:00 am – Wed, 4 Nov · 9:00 am/);
});

test("crew line shows SiteClock arrive / leave", () => {
  assert.equal(crewLine({ name: "Ali", arrivedAt: "2026-11-03T02:05:00.000Z", leftAt: "2026-11-03T03:20:00.000Z" }), "Ali · arrived 10:05 am · left 11:20 am");
  assert.equal(crewLine({ name: "Ali", arrivedAt: null, leftAt: null }), "Ali");
});

test("banner only when SiteClock was unavailable", () => {
  assert.match(siteclockBanner({ siteclock: { state: "unavailable" } }), /SiteClock unavailable/);
  assert.equal(siteclockBanner({ siteclock: { state: "ok" } }), null);
  assert.equal(siteclockBanner({ siteclock: { state: "off" } }), null);
  assert.equal(siteclockBanner(null), null);
});

test("custom job fields: icon tooltip and legend tooltip", () => {
  assert.equal(badgeTitle({ fieldId: "f", label: "Permit approved", icon: "verified", colour: "#2e7d32", text: "Yes" }), "Permit approved: Yes");
  assert.equal(legendTitle({ fieldId: "f", label: "Permit approved", icon: "verified", colours: [{ value: "Yes", colour: "#2e7d32" }, { value: "No", colour: "#c62828" }] }), "Permit approved: green = Yes, red = No");
  assert.equal(legendTitle({ fieldId: "g", label: "Permit date", icon: "event", colours: [{ value: "set", colour: "#1565c0" }] }), "Permit date: blue when filled in");
});

test("all-day jobs (2026-11-10): only a scheduled AIMS all-day job is draggable, and only when drag is on", async () => {
  const { isMovable, runIdOf } = await import("../components/Dashboard/jobs-calendar/calendarModel.ts");
  const base = { id: "aims:r1", source: "aims", kind: "delivery", title: "#9", start: "2026-11-11", end: null, allDay: true, status: "scheduled", statusLabel: "Scheduled", completed: false, cancelled: false, address: null, site: null, worker: null, rider: null, crew: [], href: null, siteclockUrl: null, deliveryNumber: 9 };
  assert.equal(isMovable(base), true);
  assert.equal(isMovable({ ...base, allDay: false }), false); // timed: never dragged
  assert.equal(isMovable({ ...base, status: "in_progress" }), false);
  assert.equal(isMovable({ ...base, source: "siteclock" }), false);
  assert.equal(runIdOf("aims:r1"), "r1");
  const [on] = toCalendarInputs([base], false, true);
  assert.equal(on.startEditable, true);
  assert.equal(on.durationEditable, false);
  assert.equal(on.allDay, true);
  const [off] = toCalendarInputs([base], false);
  assert.equal("startEditable" in off, false);
  const [timed] = toCalendarInputs([{ ...base, allDay: false, start: "2026-11-11T01:00:00.000Z" }], false, true);
  assert.equal("startEditable" in timed, false);
});

// WCT (2026-11-16): colours by PTW, a short legend, a click opens the job.
test("WCT colours by PTW state: AIMS and SiteClock jobs the same blue, needed amber, approved green, cancelled grey", () => {
  const list = [
    ev({ id: "a", orderNumber: "ORD1" }),
    ev({ id: "sc", kind: "siteclock", source: "siteclock" }),
    ev({ id: "s", kind: "service", orderNumber: "ORD1", ptw: { status: "NOT_NEEDED", label: "Not needed", remark: null } }),
    ev({ id: "r", ptw: { status: "REQUIRED", label: "Required", remark: null } }),
    ev({ id: "sub", ptw: { status: "SUBMITTED", label: "Submitted", remark: null } }),
    ev({ id: "ok", ptw: { status: "APPROVED", label: "Approved", remark: null } }),
    ev({ id: "x", cancelled: true, ptw: { status: "APPROVED", label: "Approved", remark: null } }),
  ];
  const c = Object.fromEntries(toCalendarInputs(list, true, false, true).map((o) => [o.id, o.backgroundColor]));
  assert.deepEqual(c, { a: PTW_STATE_COLOR.job, sc: PTW_STATE_COLOR.misc, s: PTW_STATE_COLOR.job, r: PTW_STATE_COLOR.needed, sub: PTW_STATE_COLOR.needed, ok: PTW_STATE_COLOR.approved, x: CANCELLED_COLOR });
  assert.equal(ptwStateOf({}), "job");
  // Other orgs keep the source colours.
  assert.equal(toCalendarInputs([ev({ kind: "service", ptw: { status: "APPROVED", label: "Approved", remark: null } })], true)[0].backgroundColor, KIND_COLOR.service);
});

test("WCT legend: Job, Misc job, PTW needed, PTW approved, Note (others unchanged)", () => {
  assert.deepEqual(calendarLegendItems(true).map((l) => l.label), ["Job", "Misc job", "PTW needed", "PTW approved", "Note"]);
  assert.deepEqual(calendarLegendItems(false).map((l) => l.label), ["Delivery / return", "Service run", "SiteClock job", "Cancelled"]);
});

test("WCT click: an AIMS job opens its order, else its DO, else the job; a SiteClock job opens in SiteClock", () => {
  assert.deepEqual(eventClickTarget(ev({ orderHref: "/portal/orders/o1", doHref: "/d" })), { href: "/portal/orders/o1", external: false });
  assert.deepEqual(eventClickTarget(ev({ doHref: "/portal/documents/DELIVERY_ORDER/t/d1" })), { href: "/portal/documents/DELIVERY_ORDER/t/d1", external: false });
  assert.deepEqual(eventClickTarget(ev()), { href: "/portal/deliveries/1", external: false });
  assert.deepEqual(eventClickTarget(ev({ source: "siteclock", href: null, siteclockUrl: "https://siteclock.example/#/jobs/9" })), { href: "https://siteclock.example/#/jobs/9", external: true });
  assert.equal(eventClickTarget(ev({ source: "siteclock", href: null, siteclockUrl: null })), null);
});

// 2026-11-16: WCT group calendar: Misc job colour, side panel links, "+n more" list, one chip = one job.
test("WCT Misc job: no order (or a SiteClock job) is purple; PTW colours win; order jobs stay blue; cancelled grey", () => {
  assert.equal(PTW_STATE_COLOR.misc, "#8e24aa");
  assert.equal(wctStateOf(ev({ orderNumber: "ORD1" })), "job");
  assert.equal(wctStateOf(ev()), "misc");
  assert.equal(wctStateOf(ev({ source: "siteclock", kind: "siteclock", orderNumber: "ORD1" })), "misc");
  assert.equal(wctStateOf(ev({ ptw: { status: "REQUIRED", label: "Required", remark: null } })), "needed");
  assert.equal(wctStateOf(ev({ source: "siteclock", ptw: { status: "APPROVED", label: "Approved", remark: null } })), "approved");
  assert.equal(eventColor(ev({ cancelled: true }), true), CANCELLED_COLOR);
  assert.equal(isMiscJob(ev({ untagged: true })), true);
  assert.equal(wctKindLabel(ev()), "Misc job");
  assert.equal(wctKindLabel(ev({ source: "siteclock", kind: "siteclock" })), "Misc job (SiteClock)");
  assert.equal(wctKindLabel(ev({ orderNumber: "ORD1" })), "Job");
  // Other orgs: colours by kind, a job with no order is still the delivery blue.
  assert.equal(eventColor(ev(), false), KIND_COLOR.delivery);
  assert.equal(eventColor(ev({ source: "siteclock", kind: "siteclock" }), false), KIND_COLOR.siteclock);
});

test("WCT panel links: order > DO > job; a SiteClock job only opens in SiteClock", () => {
  assert.deepEqual(panelLinks(ev({ orderHref: "/portal/orders/o1", doHref: "/d" })).map((l) => l.label), ["Open order", "View DO", "Open job"]);
  assert.deepEqual(panelLinks(ev()).map((l) => [l.label, l.href]), [["Open job", "/portal/deliveries/1"]]);
  assert.deepEqual(panelLinks(ev({ source: "siteclock", href: null, siteclockUrl: "https://sc/#/jobs/9" })), [{ label: "Open in SiteClock", href: "https://sc/#/jobs/9", external: true }]);
  assert.deepEqual(panelLinks(ev({ source: "siteclock", href: null, siteclockUrl: null })), []);
});

test("a busy day: every chip carries its own job (a click opens that one), and +n more lists the day's jobs once each, notes left out", () => {
  const day = ["a", "b", "c", "d", "e", "f"].map((id, i) => ev({ id, title: `Job ${id}`, start: `2026-11-03T0${i}:00:00.000Z` }));
  const inputs = toCalendarInputs(day, false, false, true);
  assert.deepEqual(inputs.map((i) => i.id), day.map((e) => e.id));
  for (const i of inputs) assert.equal(i.extendedProps.event.id, i.id);
  const segs = [...inputs, inputs[2], { event: { extendedProps: { note: { id: "n1" } } } }].map((i) => ("event" in i ? i : { event: { extendedProps: i.extendedProps } }));
  assert.deepEqual(dayJobsOf(segs).map((e) => e.id), ["a", "b", "c", "d", "e", "f"]);
  assert.equal(dayOfInstant(new Date("2026-11-16T16:00:00.000Z")), "2026-11-17");
  assert.equal(dayOfInstant(new Date("2026-11-17T00:00:00.000Z")), "2026-11-17");
});

// FullCalendar 6.1.21 MoreLinkContainer.handleClick, verbatim branch order: no result or "popover" opens its
// pop-over, a string zooms to that view, anything else does nothing more.
const fcMoreLinkOutcome = (r) => (!r || r === "popover" ? "popover" : typeof r === "string" ? "zoom" : "none");

test('"+n more" (WCT, 2026-11-18 crash): the day goes to the panel and FullCalendar opens no pop-over', () => {
  // The old handler returned undefined: FullCalendar still mounted its (hidden) pop-over, which crashed the page.
  assert.equal(fcMoreLinkOutcome(undefined), "popover");
  assert.equal(fcMoreLinkOutcome(MORE_LINK_HANDLED), "none");
  let shown = null;
  const handler = panelMoreLink((day) => (shown = day));
  const a = ev({ id: "aims:1" });
  const b = ev({ id: "aims:2", title: "#13 Beta" });
  const segs = [a, b, a].map((e) => ({ event: { extendedProps: { event: e } } })).concat([{ event: { extendedProps: { note: { id: "n1" } } } }]);
  const out = handler({ date: new Date("2026-11-12T16:30:00.000Z"), allSegs: segs });
  assert.equal(fcMoreLinkOutcome(out), "none");
  assert.equal(shown.date, "2026-11-13");
  assert.deepEqual(shown.events.map((e) => e.id), ["aims:1", "aims:2"]);
});

// Hide SiteClock jobs (hideSiteClockJobs, WCT group 2026-11-18): only jobs made in AIMS.
test("hide SiteClock jobs: SiteClock-created events dropped, AIMS jobs (pushed or not) kept; off = unchanged", async () => {
  const { withoutSiteClockJobs } = await import("../components/Dashboard/jobs-calendar/calendarModel.ts");
  const events = [ev(), ev({ id: "aims:2", crew: [{ name: "Ravi", arrivedAt: null, leftAt: null }] }), ev({ id: "sc:1", source: "siteclock", kind: "siteclock" })];
  const p = { events, siteclock: { state: "ok" } };
  assert.equal(withoutSiteClockJobs(p, false), p);
  const on = withoutSiteClockJobs(p, true);
  assert.deepEqual(on.events.map((e) => e.id), ["aims:1", "aims:2"]);
  assert.equal(on.siteclockJobsHidden, true);
  assert.deepEqual(withoutSiteClockJobs({ ...p, siteclockJobsHidden: true }, false).events.map((e) => e.id), ["aims:1", "aims:2"]);
  assert.deepEqual(calendarLegendItems(false, true).map((l) => l.label), ["Delivery / return", "Service run", "Cancelled"]);
  assert.deepEqual(calendarLegendItems(true, true).map((l) => l.label), ["Job", "Misc job", "PTW needed", "PTW approved", "Note"]);
  assert.equal(siteclockBanner({ siteclock: { state: "unavailable" }, siteclockJobsHidden: true }), null);
});

