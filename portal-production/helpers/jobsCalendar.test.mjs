// Run: npm test (node --test, Node's built-in TypeScript stripping).
// 2026-10-30: Dashboard jobs calendar (WCT, enableJobsCalendar): range, colours, cancelled toggle, popup text, banner.
import { test } from "node:test";
import assert from "node:assert/strict";
import { rangeOf, toCalendarInputs, timeWindow, crewLine, siteclockBanner, KIND_COLOR, CANCELLED_COLOR } from "../components/Dashboard/jobs-calendar/calendarModel.ts";

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
