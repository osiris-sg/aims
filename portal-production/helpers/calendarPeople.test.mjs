// Run: npm test (node --test, Node's built-in TypeScript stripping).
// 2026-11-19: jobs calendar people list, Schedule view and Generate sticker (WCT group, calendar style orgs).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  UNKNOWN_PERSON,
  filterByPeople,
  orgRowId,
  parseHidden,
  peopleRows,
  peopleStorageKey,
  rowOf,
  scheduleBadge,
  scheduleDays,
  scheduleScrollDay,
  selectAllRows,
  selectNoRows,
  toggleRow,
} from "../components/Dashboard/jobs-calendar/calendarModel.ts";
import { quickJobBody } from "./calendarAdd.ts";

const HQ = "org-wct";
const RACKING = "org-racking";
const AMY = "u-amy";
const HH = "u-hh";

const style = (over = {}) => ({ fill: "#8e24aa", text: "#ffffff", bar: null, icons: [], greyed: false, prefix: null, ...over });
const ev = (over = {}) => ({
  id: "aims:1", source: "aims", kind: "delivery", title: "ORD-1 · #1 Acme", start: "2026-11-19T02:00:00.000Z", end: "2026-11-19T03:00:00.000Z",
  allDay: false, status: "scheduled", statusLabel: "Scheduled", completed: false, cancelled: false, address: "1 Tuas Ave", site: "Acme",
  worker: null, rider: null, crew: [], href: "/portal/deliveries/1", siteclockUrl: null, deliveryNumber: 1, style: style(), createdBy: { id: AMY, name: "Amy" }, ...over,
});
const note = (over = {}) => ({
  id: "n1", title: "Leave", type: "LEAVE", staffId: null, staffName: "Ali", startDate: "2026-11-19", endDate: "2026-11-19", allDay: true,
  startTime: null, endTime: null, remark: null, createdBy: { id: HH, name: "Nat HH" }, ...over,
});
const payload = (over = {}) => ({
  people: [
    { id: AMY, name: "Amy", colour: "#8e24aa", auto: false },
    { id: HH, name: "Nat HH", colour: "#039be5", auto: false },
    { id: "u-joyna", name: "Joyna", colour: "#33b679", auto: true },
  ],
  events: [ev()],
  notes: [note()],
  group: { orgs: [{ id: HQ, name: "WCT (S)" }, { id: RACKING, name: "Racking" }] },
  ...over,
});

test("people list: everyone ticked by default, then a row per sister company", () => {
  const rows = peopleRows(payload(), []);
  assert.deepEqual(rows.map((r) => [r.label, r.checked, r.kind]), [
    ["Amy", true, "person"],
    ["Nat HH", true, "person"],
    ["Joyna", true, "person"],
    ["Racking", true, "company"],
  ]);
  assert.equal(rows[0].colour, "#8e24aa");
  // A Sales person with nothing made yet still has a row (Joyna).
});

test("people list: items with no creator recorded show under Unknown", () => {
  const rows = peopleRows(payload({ events: [ev(), ev({ id: "aims:old", createdBy: null })] }), []);
  assert.deepEqual(rows.find((r) => r.id === UNKNOWN_PERSON), { id: UNKNOWN_PERSON, label: "Unknown", colour: "#9e9e9e", checked: true, kind: "unknown" });
  // No such items on screen: no Unknown row, unless it is unticked (so it can be ticked again).
  assert.equal(peopleRows(payload(), []).some((r) => r.id === UNKNOWN_PERSON), false);
  assert.equal(peopleRows(payload(), [UNKNOWN_PERSON]).find((r) => r.id === UNKNOWN_PERSON).checked, false);
});

test("unticking a person hides the jobs and notes they made, nothing else", () => {
  const jobs = [ev(), ev({ id: "aims:2", createdBy: { id: HH, name: "Nat HH" } }), ev({ id: "aims:3", createdBy: null })];
  const notes = [note(), note({ id: "n2", createdBy: { id: AMY, name: "Amy" } })];
  assert.deepEqual(filterByPeople(jobs, [AMY]).map((e) => e.id), ["aims:2", "aims:3"]);
  assert.deepEqual(filterByPeople(notes, [AMY]).map((n) => n.id), ["n1"]);
  assert.deepEqual(filterByPeople(jobs, [UNKNOWN_PERSON]).map((e) => e.id), ["aims:1", "aims:2"]);
  // Nobody hidden: the very same array (nothing filtered).
  assert.equal(filterByPeople(jobs, []), jobs);
});

test("a company row hides that sister company's items; a person row never hides a sister company's item", () => {
  const child = ev({ id: "aims:c", foreign: true, orgId: RACKING, orgName: "Racking", createdBy: { id: AMY, name: "Amy" } });
  assert.equal(rowOf(child), orgRowId(RACKING));
  assert.deepEqual(filterByPeople([ev(), child], [orgRowId(RACKING)]).map((e) => e.id), ["aims:1"]);
  assert.deepEqual(filterByPeople([ev(), child], [AMY]).map((e) => e.id), ["aims:c"]);
});

test("select all / none and single ticks; the choice is stored as the hidden rows", () => {
  const rows = peopleRows(payload(), []);
  const none = selectNoRows(rows);
  assert.deepEqual(none, [AMY, HH, "u-joyna", orgRowId(RACKING)]);
  assert.equal(filterByPeople([ev()], none).length, 0);
  assert.deepEqual(selectAllRows(), []);
  assert.deepEqual(toggleRow([], AMY), [AMY]);
  assert.deepEqual(toggleRow([AMY, HH], AMY), [HH]);
  assert.deepEqual(parseHidden(JSON.stringify([AMY, 3, null])), [AMY]);
  assert.deepEqual(parseHidden("not json"), []);
  assert.deepEqual(parseHidden(null), []);
  assert.equal(peopleStorageKey("user_1"), "aims-jc-people-hidden:user_1");
  // A person who appears later is not in the hidden list, so they start ticked.
  assert.equal(peopleRows(payload({ people: [...payload().people, { id: "u-new", name: "New", colour: "#000000", auto: true }] }), [AMY]).find((r) => r.id === "u-new").checked, true);
});

test("Schedule view: grouped by date in order; notes and all-day first, then by time; dot, short time, PTW circle, icons, title, site", () => {
  const days = scheduleDays(
    [
      ev({ id: "aims:late", start: "2026-11-19T08:00:00.000Z", end: "2026-11-19T09:00:00.000Z", title: "Late" }),
      ev({ id: "aims:early", start: "2026-11-19T01:00:00.000Z", end: "2026-11-19T02:30:00.000Z", title: "Early", style: style({ icons: [{ icon: "✋", label: "PTW pending" }, { icon: "📌", label: "Generate sticker" }] }) }),
      ev({ id: "aims:allday", allDay: true, start: "2026-11-19", end: null, title: "All day job" }),
      ev({ id: "aims:next", start: "2026-11-20T02:00:00.000Z", title: "Tomorrow", site: null, address: "2 Jurong" }),
      ev({ id: "aims:sgt", start: "2026-11-20T17:30:00.000Z", end: "2026-11-20T18:00:00.000Z", title: "After midnight SGT" }),
    ],
    [note()],
    { from: "2026-11-01", to: "2026-11-30" },
  );
  assert.deepEqual(days.map((d) => d.date), ["2026-11-19", "2026-11-20", "2026-11-21"]);
  assert.deepEqual(days[0].rows.map((r) => r.title), ["Leave · Ali", "All day job", "Early", "Late"]);
  const early = days[0].rows[2];
  // 2026-11-19: Google Calendar's short times, as in Month rows.
  assert.equal(early.time, "9am – 10:30am");
  assert.equal(early.ptw ?? null, early.event.style.bar ?? null);
  assert.equal(early.icons, "✋ 📌");
  assert.equal(early.colour, "#8e24aa");
  assert.equal(early.site, "1 Tuas Ave");
  assert.equal(days[0].rows[0].icons, "📅");
  assert.equal(days[0].rows[1].time, "All day");
  assert.equal(days[1].rows[0].site, "2 Jurong");
  // No address: the site name, unless the title already carries it.
  assert.equal(scheduleDays([ev({ address: null })], [], null)[0].rows[0].site, null);
  assert.equal(scheduleDays([ev({ address: null, site: "Tuas yard" })], [], null)[0].rows[0].site, "Tuas yard");
  assert.equal(scheduleDays([], [note({ allDay: false, startTime: "09:00", endTime: "13:30" })], null)[0].rows[0].time, "9am – 1:30pm");
  // A timed note sits among the timed jobs by its clock time, after every all-day item.
  const mixed = scheduleDays([ev({ id: "aims:a", start: "2026-11-19T00:30:00.000Z", title: "Eight thirty" }), ev({ id: "aims:b", allDay: true, start: "2026-11-19", end: null, title: "Day job" })], [note({ allDay: false, startTime: "08:00", endTime: "09:00", title: "Bay closed", staffName: null })], null);
  assert.deepEqual(mixed[0].rows.map((r) => r.title), ["Day job", "Bay closed", "Eight thirty"]);
  // 17:30 UTC = 01:30 the next day in Singapore.
  assert.deepEqual(days[2].rows.map((r) => r.title), ["After midnight SGT"]);
});

test("Schedule view: a note over several days shows on each day in range; a sister company's item names it", () => {
  const days = scheduleDays([ev({ foreign: true, orgId: RACKING, orgName: "Racking" })], [note({ startDate: "2026-10-30", endDate: "2026-11-02" })], { from: "2026-11-01", to: "2026-11-30" });
  assert.deepEqual(days.map((d) => d.date), ["2026-11-01", "2026-11-02", "2026-11-19"]);
  assert.equal(days[2].rows[0].site, "1 Tuas Ave · Racking");
});

test("Schedule view: cancelled jobs follow the calendar (styled: kept greyed; plain: only with Show cancelled)", () => {
  const styled = scheduleDays([ev({ cancelled: true, style: style({ greyed: true }) })], [], null);
  assert.equal(styled[0].rows[0].greyed, true);
  assert.equal(styled[0].rows[0].cancelled, true);
  assert.equal(scheduleDays([ev({ cancelled: true, style: undefined })], [], null).length, 0);
  assert.equal(scheduleDays([ev({ cancelled: true, style: undefined })], [], null, { showCancelled: true }).length, 1);
});

test("Schedule view opens on today, else the next day with items", () => {
  const days = [{ date: "2026-11-03", rows: [] }, { date: "2026-11-21", rows: [] }];
  assert.equal(scheduleScrollDay(days, "2026-11-19"), "2026-11-21");
  assert.equal(scheduleScrollDay(days, "2026-11-03"), "2026-11-03");
  assert.equal(scheduleScrollDay(days, "2026-11-30"), "2026-11-21");
  assert.equal(scheduleScrollDay([], "2026-11-19"), null);
  assert.deepEqual(scheduleBadge("2026-11-19"), { day: "19", weekday: "THU", month: "Nov" });
});

test("New job sends Generate sticker with the calendar style fields only", () => {
  const f = {
    customerId: "c1", siteAddress: "", date: "2026-11-20", time: "10:00", allDay: false, durationMin: 60, workers: [], remarks: "",
    ptwStatus: "NOT_NEEDED", ptwRemark: "",
  };
  assert.equal("sticker" in quickJobBody(f).body, false);
  const body = quickJobBody({ ...f, style: { salesperson: null, ptwApplicant: null, cod: false, sticker: true } }).body;
  assert.equal(body.sticker, true);
  assert.equal(quickJobBody({ ...f, style: { salesperson: null, ptwApplicant: null, cod: false } }).body.sticker, false);
});

test("other orgs: no people list in the payload means no rows and nothing filtered", () => {
  const p = { events: [ev({ createdBy: undefined, style: undefined })], notes: undefined };
  assert.deepEqual(peopleRows({ ...p, people: undefined }, []).filter((r) => r.kind !== "unknown"), []);
  assert.equal(filterByPeople(p.events, []), p.events);
});

// 2026-11-19 (round 14): chip line 1 = category prefix + customer only.
import { chipTitle, styledTitle } from "../components/Dashboard/jobs-calendar/calendarModel.ts";

test("chip text: prefix + customer only; no customer = site address; neither = the title (per job type)", () => {
  const order = ev({ title: "ORD202611-003 · #41 Domino's Pizza", chipLabel: "Domino's Pizza", style: style({ prefix: "(SV)" }) });
  assert.equal(chipTitle(order), "(SV) Domino's Pizza");
  // The full title stays for the tooltip and the side panel.
  assert.equal(styledTitle(order), "(SV) ORD202611-003 · #41 Domino's Pizza");
  const quick = ev({ title: "#42 Yoshinoya", chipLabel: "Yoshinoya", style: style({ prefix: "(M)" }) });
  assert.equal(chipTitle(quick), "(M) Yoshinoya");
  const noCustomer = ev({ title: "#43 10 Anson Road", chipLabel: "10 Anson Road", style: style() });
  assert.equal(chipTitle(noCustomer), "10 Anson Road");
  const collect = ev({ title: "#44 Acme", chipLabel: "Acme", style: style({ prefix: "(CC)" }) });
  assert.equal(chipTitle(collect), "(CC) Acme");
  // An older API (no chipLabel) falls back to the title, without its order / job numbers (2026-11-19).
  assert.equal(chipTitle(ev({ title: "#45 X", style: style() })), "X");
  // Schedule rows use the same short text.
  const days = scheduleDays([order, noCustomer], [], null);
  assert.deepEqual(days[0].rows.map((r) => r.title), ["(SV) Domino's Pizza", "10 Anson Road"]);
});
