// Run: npm test (node --test, Node's built-in TypeScript stripping).
// 2026-11-18: jobs calendar style (WCT group, enableCalendarStyle): fill by salesperson, PTW bar, icons,
// greyed cancelled / postponed (never hidden), Leave 📅, category prefixes; gate off = unchanged.
import { test } from "node:test";
import assert from "node:assert/strict";
import { CHIP_TEXT, chipBorder, chipFill } from "../components/Dashboard/jobs-calendar/calendarModel.ts";
import { toCalendarInputs, styledTitle, chipTimeRange, chipIcons, panelColor, eventColor, LEAVE_ICON } from "../components/Dashboard/jobs-calendar/calendarModel.ts";
import { noteToCalendarInput, ptwOptions, PTW_OPTIONS, quickJobBody } from "./calendarAdd.ts";

const ev = (over = {}) => ({
  id: "aims:1", source: "aims", kind: "delivery", title: "#12 Acme", start: "2026-11-03T02:00:00.000Z", end: "2026-11-03T03:30:00.000Z",
  allDay: false, status: "scheduled", statusLabel: "Scheduled", completed: false, cancelled: false, address: null, site: "Acme",
  worker: null, rider: null, crew: [], href: "/portal/deliveries/1", siteclockUrl: null, deliveryNumber: 12, ...over,
});
const style = (over = {}) => ({ fill: "#039be5", text: "#ffffff", bar: null, icons: [], greyed: false, prefix: null, ...over });

// 2026-11-19: chips are a soft tint of the salesperson colour the server sent, with dark text (the side panel and
// the Schedule dot keep the full colour).
test("fill = a soft tint of the salesperson colour the server sent, dark text", () => {
  const [a, b] = toCalendarInputs([ev({ style: style() }), ev({ id: "aims:2", style: style({ fill: "#b0bec5", text: "#212121" }) })], false, false, true);
  assert.equal(a.backgroundColor, chipFill("#039be5"));
  assert.equal(a.borderColor, chipBorder("#039be5"));
  assert.equal(a.textColor, CHIP_TEXT);
  assert.equal(b.backgroundColor, chipFill("#b0bec5"));
  assert.equal(b.textColor, CHIP_TEXT);
  assert.ok(a.classNames.includes("aims-jc-styled"));
  assert.equal(panelColor(ev({ style: style({ fill: "#8e24aa" }) }), true), "#8e24aa");
});

test("cancelled and postponed stay on the calendar, greyed (Show cancelled no longer hides them)", () => {
  const list = [ev({ id: "c", cancelled: true, status: "cancelled", style: style({ greyed: true, icons: [{ icon: "❌", label: "Cancelled" }] }) }), ev({ id: "p", postponed: true, style: style({ greyed: true }) })];
  const out = toCalendarInputs(list, false, true, true);
  assert.deepEqual(out.map((o) => o.id), ["c", "p"]);
  for (const o of out) assert.ok(o.classNames.includes("aims-jc-greyed"));
  // A greyed all-day job is not draggable.
  const drag = toCalendarInputs([ev({ allDay: true, start: "2026-11-03", end: null, postponed: true, style: style({ greyed: true }) })], false, true, true);
  assert.equal(drag[0].startEditable, undefined);
});

test("chip: line 1 icons + prefixed title, line 2 the time range", () => {
  const e = ev({ style: style({ prefix: "(SV)", icons: [{ icon: "✋", label: "PTW pending" }, { icon: "2✅", label: "2 DOs completed" }, { icon: "🟫", label: "COD" }] }) });
  assert.equal(styledTitle(e), "(SV) #12 Acme");
  assert.equal(chipIcons(e), "✋ 2✅ 🟫");
  assert.equal(chipTimeRange(e), "10:00 am – 11:30 am");
  assert.equal(chipTimeRange(ev({ allDay: true, start: "2026-11-03", end: null })), "All day");
  assert.equal(styledTitle(ev()), "#12 Acme");
  assert.equal(toCalendarInputs([e], false)[0].title, "(SV) #12 Acme");
});

test("each icon reaches the chip as sent: ✋ ⏳ 👍 👎 ✅ ❌ ⭕ 🟫", () => {
  for (const i of ["✋", "⏳", "👍", "👎", "✅", "❌", "⭕", "🟫"]) assert.equal(chipIcons(ev({ style: style({ icons: [{ icon: i, label: i }] }) })), i);
});

test("Leave notes lead with 📅 only when styled; other notes and unstyled calendars are unchanged", () => {
  const leave = { id: "n1", title: "Ali on leave", type: "LEAVE", staffId: null, staffName: null, startDate: "2026-11-09", endDate: "2026-11-09", allDay: true, startTime: null, endTime: null, remark: null };
  assert.equal(noteToCalendarInput(leave, true).title, `${LEAVE_ICON} Ali on leave`);
  assert.equal(noteToCalendarInput(leave).title, "Ali on leave");
  assert.deepEqual(noteToCalendarInput(leave), noteToCalendarInput(leave, false));
  assert.equal(noteToCalendarInput({ ...leave, type: "PTW" }, true).title, "Ali on leave");
});

test("gate off: events without style draw exactly as before (WCT colours / kind colours, cancelled hidden)", () => {
  const list = [ev(), ev({ id: "x", cancelled: true }), ev({ id: "p", ptw: { status: "REQUIRED", label: "Required", remark: null }, orderNumber: "ORD1" })];
  const out = toCalendarInputs(list, false, false, true);
  assert.deepEqual(out.map((o) => o.id), ["aims:1", "p"]);
  assert.equal(out[0].backgroundColor, eventColor(list[0], true));
  assert.deepEqual(out[0].classNames, ["aims-jc-event"]);
  assert.equal(out[1].textColor, "#3e2723");
  assert.equal(JSON.stringify(out).includes("aims-jc-styled"), false);
  // Other orgs (kind colours): unchanged too.
  assert.equal(toCalendarInputs([ev()], true)[0].backgroundColor, "#1e88e5");
});

test("PTW Rejected only with the style; the job form sends the style fields only when the org has them", () => {
  assert.deepEqual(ptwOptions(false), PTW_OPTIONS);
  assert.equal(ptwOptions(false).some((o) => o.value === "REJECTED"), false);
  assert.equal(ptwOptions(true).at(-1).value, "REJECTED");
  const form = { customerId: "c1", siteAddress: "", date: "2026-11-20", time: "09:00", durationMin: 60, workers: [], remarks: "", ptwStatus: "REQUIRED", ptwRemark: "" };
  const plain = quickJobBody(form).body;
  assert.equal("salesperson" in plain, false);
  assert.equal("cod" in plain, false);
  const styled = quickJobBody({ ...form, style: { salesperson: { id: "u1", name: "Amy" }, ptwApplicant: { id: "b", name: "Bala" }, cod: true } }).body;
  assert.deepEqual([styled.salesperson, styled.ptwApplicant, styled.cod], [{ id: "u1", name: "Amy" }, { id: "b", name: "Bala" }, true]);
});
