// Run: npm test (node --test, Node's built-in TypeScript stripping).
// 2026-11-19: PTW applicants list (Settings > Job fields, WCT group) and the calendar's softer chips.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CHIP_TEXT,
  GREYED_OPACITY,
  applicantLabel,
  applicantOptionLabel,
  chipFill,
  contrastRatio,
  toCalendarInputs,
} from "../components/Dashboard/jobs-calendar/calendarModel.ts";
import { moveEntry, newEntry, rowsOf, sameList, toSaveBody } from "../app/portal/settings/job-fields/_components/ptwApplicantsModel.ts";

const LIST = [
  { id: "pta_bala", name: "Bala", colour: "#d50000" },
  { id: "pta_joyna", name: "Joyna", colour: "#f6bf26" },
  { id: "pta_kherry", name: "Kherry", colour: "#0b8043" },
];

test("PTW applicant picker: list entries by name; a job's applicant outside the list is kept and marked", () => {
  assert.equal(applicantOptionLabel(LIST[2], LIST, true), "Kherry");
  assert.equal(applicantOptionLabel({ id: "user_richie", name: "Richie" }, LIST, true), "Richie (not in list)");
  // Orgs without a list: unchanged labels.
  assert.equal(applicantOptionLabel({ id: "user_richie", name: "Richie" }, LIST, false), "Richie");
  assert.equal(applicantLabel({ name: "Richie", inList: false }), "Richie (not in list)");
  assert.equal(applicantLabel({ name: "Bala" }), "Bala");
  assert.equal(applicantLabel({ name: null, inList: false }), "Unknown (not in list)");
});

test("PTW applicants editor: add, reorder, default by name for a new row, Save only when changed", () => {
  const saved = { entries: LIST.map((e) => ({ ...e, userId: null, hidden: false })), defaultId: "pta_bala" };
  const rows = rowsOf(saved);
  assert.equal(sameList(saved, rows, "pta_bala"), true);
  assert.equal(sameList(saved, rows, "pta_joyna"), false);
  const moved = moveEntry(rows, 2, -1);
  assert.deepEqual(moved.map((r) => r.name), ["Bala", "Kherry", "Joyna"]);
  assert.equal(moveEntry(rows, 0, -1), rows);
  const fresh = newEntry(rows, ["#d50000", "#f6bf26", "#0b8043", "#f4511e"]);
  assert.equal(fresh.colour, "#f4511e");
  const added = [...rows, { ...fresh, name: "Ravi" }];
  assert.deepEqual(toSaveBody(added, fresh.key), {
    entries: [...LIST.map((e) => ({ id: e.id, name: e.name, colour: e.colour, userId: null, hidden: false })), { name: "Ravi", colour: "#f4511e", userId: null, hidden: false }],
    defaultName: "Ravi",
  });
  assert.equal(toSaveBody(rows, "pta_joyna").defaultId, "pta_joyna");
});

// Calendar chips (2026-11-19): soft salesperson tints with dark text; the PTW bar on the right edge.
const hex = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const toHex = (c) => "#" + c.map((x) => Math.round(x).toString(16).padStart(2, "0")).join("");
const grey = (h) => { const [r, g, b] = hex(h); const y = 0.2126 * r + 0.7152 * g + 0.0722 * b; return toHex([y, y, y]); };
const over = (fg, bg, a) => toHex(hex(fg).map((c, i) => c * a + hex(bg)[i] * (1 - a)));
const SALES = { HH: "#039be5", Amy: "#8e24aa", PC: "#e67c73", Joyna: "#3f51b5" };
const NEUTRAL_FILL = "#b0bec5";

test("chips: each salesperson a soft tint (distinct), dark text readable on every tint", () => {
  const tints = [...Object.values(SALES), NEUTRAL_FILL].map(chipFill);
  for (const t of tints) assert.ok(contrastRatio(CHIP_TEXT, t) >= 7, `text on ${t}`);
  for (const t of tints) assert.ok(hex(t).every((c) => c >= 160), `${t} is a light tint`);
  const dist = (a, b) => Math.hypot(...hex(a).map((c, i) => c - hex(b)[i]));
  for (let i = 0; i < tints.length; i++) for (let j = i + 1; j < tints.length; j++) assert.ok(dist(tints[i], tints[j]) >= 30, `${tints[i]} vs ${tints[j]}`);
});

test("chips: cancelled / postponed (grey at GREYED_OPACITY) keep readable text on light and dark pages", () => {
  for (const f of [...Object.values(SALES), NEUTRAL_FILL]) {
    for (const page of ["#ffffff", "#121212"]) {
      const bg = over(grey(chipFill(f)), page, GREYED_OPACITY);
      const fg = over(grey(CHIP_TEXT), page, GREYED_OPACITY);
      assert.ok(contrastRatio(fg, bg) >= 4.5, `${f} greyed on ${page}`);
    }
  }
});

test("chips: the red, green and neutral PTW bars stand out on every tint (yellow gets an outline)", () => {
  for (const bar of ["#d50000", "#0b8043", "#455a64"]) for (const f of [...Object.values(SALES), NEUTRAL_FILL]) assert.ok(contrastRatio(bar, chipFill(f)) >= 2.7, `${bar} on ${f}`);
});

test("chips: FullCalendar gets the tint and dark text; the style's own fill stays full for the Schedule dot", () => {
  const e = { id: "aims:1", source: "aims", title: "Acme", start: "2026-11-20T02:00:00Z", end: null, allDay: false, cancelled: false, style: { fill: "#039be5", text: "#ffffff", bar: "#d50000", icons: [], greyed: false } };
  const [i] = toCalendarInputs([e], false);
  assert.equal(i.backgroundColor, chipFill("#039be5"));
  assert.equal(i.textColor, CHIP_TEXT);
  assert.equal(e.style.fill, "#039be5");
});

// Add-on 4 (2026-11-19): Month rows and the Schedule list use Google Calendar's short times; the Schedule row
// carries the PTW applicant's colour for its circle (none when no PTW is needed).
test("short times: 9am, 9:30pm, noon and midnight; a range; Schedule rows carry the PTW colour", async () => {
  const { compactHhmm, compactTime, compactRange, scheduleDays } = await import("../components/Dashboard/jobs-calendar/calendarModel.ts");
  assert.equal(compactHhmm("09:00"), "9am");
  assert.equal(compactHhmm("21:30"), "9:30pm");
  assert.equal(compactHhmm("12:00"), "12pm");
  assert.equal(compactHhmm("00:15"), "12:15am");
  assert.equal(compactTime("2026-11-19T01:00:00.000Z"), "9am");
  assert.equal(compactRange({ start: "2026-11-19T01:00:00.000Z", end: "2026-11-19T02:30:00.000Z" }), "9am – 10:30am");
  assert.equal(compactRange({ start: "2026-11-19T13:30:00.000Z", end: null }), "9:30pm");
  const base = { source: "aims", title: "Acme", start: "2026-11-19T01:00:00.000Z", end: null, allDay: false, cancelled: false };
  const [day] = scheduleDays([
    { ...base, id: "aims:1", style: { fill: "#039be5", text: "#fff", bar: "#d50000", icons: [], greyed: false } },
    { ...base, id: "aims:2", style: { fill: "#039be5", text: "#fff", bar: null, icons: [], greyed: false } },
  ], [], null);
  assert.deepEqual(day.rows.map((r) => r.ptw), ["#d50000", null]);
});

// Add-on 5 (2026-11-19): Month rows keep the customer readable.
test("rows: no order / job numbers in the title fallback; at most 2 icons by priority; People panel choice kept", async () => {
  const { titleWithoutNumbers, chipTitle, rowIcons, peopleOpenKey, parsePanelOpen } = await import("../components/Dashboard/jobs-calendar/calendarModel.ts");
  assert.equal(titleWithoutNumbers("ORD202611-003 · #41 Domino's Pizza (Tampines)"), "Domino's Pizza (Tampines)");
  assert.equal(titleWithoutNumbers("#41 Domino's"), "Domino's");
  assert.equal(titleWithoutNumbers("Return #7 Acme"), "Return Acme");
  assert.equal(titleWithoutNumbers("#41"), "#41");
  assert.equal(chipTitle({ title: "ORD202611-003 · #41 Domino's", chipLabel: null, style: { prefix: "(SV)" } }), "(SV) Domino's");
  assert.equal(chipTitle({ title: "#41 X", chipLabel: "Acme Pte Ltd" }), "Acme Pte Ltd");
  const i = (...xs) => xs.map((icon) => ({ icon, label: icon }));
  assert.equal(rowIcons(i("🟫", "📌", "2✅", "✋", "❌")), "❌ ✋");
  assert.equal(rowIcons(i("🟫", "📌", "2✅")), "2✅ 📌");
  assert.equal(rowIcons(i("🟫")), "🟫");
  assert.equal(rowIcons([]), "");
  assert.equal(peopleOpenKey("aims-jc-people-hidden:user_1"), "aims-jc-people-open:user_1");
  assert.equal(peopleOpenKey(null), null);
  assert.equal(parsePanelOpen("1"), true);
  assert.equal(parsePanelOpen("0"), false);
  assert.equal(parsePanelOpen(null), null);
});
