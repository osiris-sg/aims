// "+N more" day card (WCT group, 2026-11-26): Google Calendar's day pop-over. Run: npm test.
import { test } from "node:test";
import assert from "node:assert/strict";
import { barClipPath, dayPopoverHeader, dayPopoverItems, dayPopoverPosition, dayPopoverWidth } from "../components/Dashboard/jobs-calendar/dayPopoverModel.ts";

const style = (over = {}) => ({ fill: "#039be5", text: "#ffffff", bar: null, icons: [], greyed: false, prefix: null, ...over });
const job = (over = {}) => ({
  id: "aims:1", source: "aims", kind: "delivery", title: "ORD202611-001 · #12 Acme", start: "2026-11-10T02:00:00.000Z", end: "2026-11-10T03:00:00.000Z",
  allDay: false, status: "scheduled", completed: false, cancelled: false, customer: "Acme", ptwStatus: "NOT_NEEDED", doCount: 0, style: style(), ...over,
});
const seg = (e, over = {}) => ({ id: e.id, title: e.title, allDay: e.allDay, start: e.start, end: e.end, backgroundColor: "#b3e1f7", textColor: "#1f2328", extendedProps: { event: e }, ...over });

test("every item of the day: all-day bars first, then timed by start time; duplicates and background shading dropped", () => {
  const late = job({ id: "aims:2", customer: "Late Co", start: "2026-11-10T14:00:00.000Z", end: null });
  const early = job({ id: "aims:3", customer: "Early Co", start: "2026-11-10T00:30:00.000Z", end: null });
  const note = { id: "note:n1", title: "AMY (MC) · AMY", allDay: true, start: "2026-11-10", end: "2026-11-11", backgroundColor: "#cfd8dc", textColor: "#37474f", extendedProps: { note: { id: "n1" } } };
  const hol = { id: "holiday:x", title: "Deepavali", allDay: true, start: "2026-11-10", end: "2026-11-11", backgroundColor: "#fde2e4", textColor: "#7a1f2b", extendedProps: { holiday: { date: "2026-11-10" } } };
  const shade = { id: "aims-jc-pick", title: "", allDay: false, start: "2026-11-10T01:00:00.000Z", end: null, display: "background" };
  const out = dayPopoverItems("2026-11-10", [seg(late), note, seg(early), hol, seg(late), shade]);
  assert.deepEqual(out.allDay.map((i) => i.key), ["note:n1", "holiday:x"]);
  assert.deepEqual(out.timed.map((i) => i.title), ["Early Co", "Late Co"]);
  assert.equal(out.timed[0].time, "8:30am");
  assert.equal(out.timed[1].time, "10pm");
  assert.equal(out.allDay[1].holiday, true);
  assert.equal(out.allDay[0].note.id, "n1");
  // The bar keeps its own colours.
  assert.deepEqual([out.allDay[1].bg, out.allDay[1].text], ["#fde2e4", "#7a1f2b"]);
});

test("timed rows: the dot is the salesperson colour, markers (⭕, PTW ✋ / ⏳ + applicant circle) come before the title", () => {
  const e = job({ postponed: true, ptwStatus: "REQUIRED", style: style({ fill: "#8e24aa", greyed: true, applicantIcon: "🔴" }) });
  const [r] = dayPopoverItems("2026-11-10", [seg(e)]).timed;
  assert.equal(r.dot, "#8e24aa");
  assert.equal(r.markers, "⭕ ✋ 🔴");
  // 2026-11-26: Pending (SUBMITTED) shows ⏳ in the "+N more" day card too.
  const [p] = dayPopoverItems("2026-11-10", [seg(job({ ptwStatus: "SUBMITTED", style: style({ applicantIcon: "🟢" }) }))]).timed;
  assert.equal(p.markers, "⏳ 🟢");
  assert.equal(r.greyed, true);
  assert.equal(r.event.id, "aims:1");
  const cancelled = dayPopoverItems("2026-11-10", [seg(job({ cancelled: true, style: style({ greyed: true }) }))]).timed[0];
  assert.equal(cancelled.cancelled, true);
  assert.equal(cancelled.markers, "❌");
});

test("all-day bands that carry on show a pointed end on that side", () => {
  const band = (start, end) => dayPopoverItems("2026-11-10", [{ id: "note:b", title: "Blockage", allDay: true, start, end, extendedProps: { note: { id: "b" } } }]).allDay[0];
  assert.deepEqual([band("2026-11-10", "2026-11-11").contBefore, band("2026-11-10", "2026-11-11").contAfter], [false, false]);
  assert.deepEqual([band("2026-11-08", "2026-11-11").contBefore, band("2026-11-08", "2026-11-11").contAfter], [true, false]);
  assert.deepEqual([band("2026-11-10", "2026-11-14").contBefore, band("2026-11-10", "2026-11-14").contAfter], [false, true]);
  assert.deepEqual([band("2026-11-01", "2026-12-01").contBefore, band("2026-11-01", "2026-12-01").contAfter], [true, true]);
  // No end = one day.
  assert.equal(band("2026-11-10", null).contAfter, false);
  assert.equal(barClipPath(false, false), undefined);
  assert.match(barClipPath(true, false), /^polygon\(8px 0, 100% 0, 100% 100%, 8px 100%, 0 50%\)$/);
  assert.match(barClipPath(false, true), /100% 50%/);
});

test("header, width and position: TUE 10; 240..340px wide; kept 16px inside the window", () => {
  assert.deepEqual(dayPopoverHeader("2026-11-10"), { weekday: "TUE", day: "10" });
  assert.equal(dayPopoverWidth(100), 240);
  assert.equal(dayPopoverWidth(200), 250);
  assert.equal(dayPopoverWidth(600), 340);
  // Centred on the cell, a little above it.
  assert.deepEqual(dayPopoverPosition({ left: 400, top: 300, width: 200 }, { width: 1400 }, 250), { left: 500, top: 292 });
  // Right edge: pulled in so the card's right side stays 16px inside.
  assert.deepEqual(dayPopoverPosition({ left: 1300, top: 300, width: 100 }, { width: 1400 }, 250), { left: 1400 - 16 - 125, top: 292 });
  // Left edge and top.
  assert.deepEqual(dayPopoverPosition({ left: 0, top: 4, width: 100 }, { width: 1400 }, 250), { left: 16 + 125, top: 16 });
});
