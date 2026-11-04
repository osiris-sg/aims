// WCT jobs calendar add (2026-11-04): helpers/calendarAdd.ts + where it is wired.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { noteBody, noteTitle, noteToCalendarInput, noteWhen, ptwLabel, quickJobBody, sgtInstant, sgtParts, slotOf } from "./calendarAdd.ts";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("Singapore date + time round-trips", () => {
  assert.equal(sgtInstant("2026-12-09", "10:00"), "2026-12-09T02:00:00.000Z");
  assert.equal(sgtInstant("2026-12-09", ""), null);
  assert.deepEqual(sgtParts("2026-12-09T02:00:00.000Z"), { date: "2026-12-09", time: "10:00" });
  assert.deepEqual(sgtParts("2026-12-09T17:30:00.000Z"), { date: "2026-12-10", time: "01:30" });
});

test("a clicked slot: month day → 09:00, a week slot keeps its time", () => {
  assert.deepEqual(slotOf("2026-12-09", true), { date: "2026-12-09", time: "09:00" });
  assert.deepEqual(slotOf("2026-12-09T14:30:00+08:00", false), { date: "2026-12-09", time: "14:30" });
});

test("quick job body: needs a customer and a time; PTW remark only when needed", () => {
  const f = { customerId: "c1", siteAddress: " 1 Tuas ", date: "2026-12-09", time: "10:00", durationMin: 90, workers: [{ id: "w1", name: "Ali" }], remarks: " bring ladder ", ptwStatus: "NOT_NEEDED", ptwRemark: "x" };
  assert.deepEqual(quickJobBody(f).body, { customerId: "c1", siteAddress: "1 Tuas", scheduledFor: "2026-12-09T02:00:00.000Z", durationMin: 90, workers: [{ id: "w1", name: "Ali" }], remarks: "bring ladder", ptwStatus: "NOT_NEEDED", ptwRemark: "" });
  assert.equal(quickJobBody({ ...f, ptwStatus: "REQUIRED" }).body.ptwRemark, "x");
  assert.equal(quickJobBody({ ...f, customerId: null }).error, "Pick a customer");
  assert.equal(quickJobBody({ ...f, time: "" }).error, "Pick a date and time");
});

test("note body: title, dates, times", () => {
  const f = { title: " Ali on leave ", type: "LEAVE", staffId: "w1", staffName: "Ali", startDate: "2026-12-09", endDate: "", allDay: true, startTime: "", endTime: "", remark: "" };
  assert.deepEqual(noteBody(f).body, { title: "Ali on leave", type: "LEAVE", staffId: "w1", staffName: "Ali", startDate: "2026-12-09", endDate: "2026-12-09", allDay: true, remark: "" });
  assert.equal(noteBody({ ...f, title: " " }).error, "Give the note a title");
  assert.equal(noteBody({ ...f, endDate: "2026-12-08" }).error, "The end date is before the start date");
  assert.match(noteBody({ ...f, allDay: false, startTime: "12:00", endTime: "09:00" }).error, /end after start/);
  assert.deepEqual(noteBody({ ...f, allDay: false, startTime: "09:00", endTime: "12:00" }).body.startTime, "09:00");
});

test("a note is an all-day bar (end exclusive), coloured by type, before the jobs", () => {
  const n = { id: "n1", title: "Road closed", type: "BLOCKAGE", staffId: null, staffName: null, startDate: "2026-12-09", endDate: "2026-12-11", allDay: false, startTime: "09:00", endTime: "12:00", remark: null };
  const e = noteToCalendarInput(n);
  assert.equal(e.allDay, true);
  assert.equal(e.start, "2026-12-09");
  assert.equal(e.end, "2026-12-12");
  assert.equal(e.backgroundColor, "#c62828");
  assert.equal(e.displayOrder, 0);
  assert.equal(e.title, "09:00–12:00 Road closed");
  assert.equal(noteTitle({ ...n, allDay: true, staffName: "Ali" }), "Road closed · Ali");
  assert.equal(noteWhen({ ...n, allDay: true }), "Wed, 9 Dec to Fri, 11 Dec · All day");
  assert.equal(ptwLabel(null), "Not needed");
  assert.equal(ptwLabel("SUBMITTED"), "Submitted");
});

test("wiring: interaction plugin pinned like the others; add only for WCT calendar orgs", () => {
  const pkg = JSON.parse(read("package.json"));
  const fc = Object.entries(pkg.dependencies).filter(([k]) => k.startsWith("@fullcalendar/"));
  assert.ok(fc.some(([k]) => k === "@fullcalendar/interaction"));
  assert.equal(new Set(fc.map(([, v]) => v)).size, 1, JSON.stringify(fc));
  assert.ok(!fc.some(([, v]) => /[\^~]/.test(v)));
  const view = read("components/Dashboard/jobs-calendar/CalendarView.tsx");
  assert.match(view, /dateClick=\{canAdd \? onDateClick : undefined\}/);
  const cal = read("components/Dashboard/JobsCalendar.tsx");
  assert.match(cal, /const canAdd = !!isWctOrdersEnabled && Array\.isArray\(data\?\.notes\);/);
});
