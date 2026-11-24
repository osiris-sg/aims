// Jobs calendar batch 2026-11-25 (WCT group, calendar style orgs): no plain-calendar flash, Schedule search filter,
// free-typed Team / crew never a clash, "Remarks:" prefix, no PTW remark field, no job title / postponed line /
// category tag on the chips, Category removed, Technician Site Visit = General fields + job-style card, note side
// panel, "Discard changes?", calendar Settings (Calendar colours).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { hoverLines, jobRemarks, parseFilters, remarksLine } from "../components/Dashboard/jobs-calendar/calendarPanel.ts";
import { filterSchedule, matchesQuery } from "./calendarSearch.ts";
import { closeAction, formDirty, DISCARD_TEXT } from "./calendarDiscard.ts";
import { resolveTyped, chipsToValue } from "./crewPicker.ts";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const ev = (over = {}) => ({
  id: "aims:1", source: "aims", kind: "delivery", title: "Acme", start: "2026-11-03T02:00:00.000Z", end: "2026-11-03T03:00:00.000Z", allDay: false,
  status: "scheduled", statusLabel: "Scheduled", completed: false, cancelled: false, address: null, site: null, worker: null, rider: null, crew: [],
  customer: "Acme", ptwStatus: "NOT_NEEDED", doCount: 0, ...over,
});

test("B1 no flash: the calendar waits for the org's settings and shows a skeleton of the real layout", () => {
  const cal = read("components/Dashboard/JobsCalendar.tsx");
  assert.match(cal, /if \(featuresLoading\) return <CalendarSkeleton fullHeight=\{fullHeight\} \/>;/);
  assert.match(cal, /pendingStyle=\{expectStyled && !data && !error\}/);
  assert.match(cal, /const styled = !!data\?\.style \|\| pendingStyle;/);
  assert.match(cal, /<FilterRowSkeleton \/>/);
  assert.match(cal, /<GridSkeleton \/>/);
  assert.match(cal, /visibility: "hidden"/);
  const page = read("app/portal/deliveries/calendar/page.tsx");
  assert.match(page, /<CalendarSkeleton fullHeight \/>/);
  assert.doesNotMatch(page, /return null;/);
});

test("B2 Schedule search: filters the list live, all words, any case; empty = everything", () => {
  assert.equal(matchesQuery("Jewel Changi Team A", "changi  jewel"), true);
  assert.equal(matchesQuery("Jewel Changi", "ion"), false);
  assert.equal(matchesQuery("x", "  "), true);
  const events = [ev({ id: "a", customer: "Jewel Changi" }), ev({ id: "b", customer: "Ion", remarks: "call Ali", quotationNumber: "Q-013776", deliveryNumber: 41 }), ev({ id: "c", customer: "Bugis", crew: [{ name: "Guru" }] })];
  const notes = [{ id: "n1", title: "Ali on leave", staffName: "Ali" }, { id: "n2", title: "Road closed" }];
  assert.deepEqual(filterSchedule(events, notes, "ali").events.map((e) => e.id), ["b"]);
  assert.deepEqual(filterSchedule(events, notes, "ali").notes.map((n) => n.id), ["n1"]);
  assert.deepEqual(filterSchedule(events, notes, "Q-0137").events.map((e) => e.id), ["b"]);
  assert.deepEqual(filterSchedule(events, notes, "guru").events.map((e) => e.id), ["c"]);
  const all = filterSchedule(events, notes, "");
  assert.equal(all.events, events);
  assert.equal(all.notes, notes);
  const cal = read("components/Dashboard/JobsCalendar.tsx");
  assert.match(cal, /const scheduleSearch = viewType === "schedule" && !!searchText\.trim\(\);/);
  assert.match(cal, /filterMode=\{viewType === "schedule"\}/);
  assert.match(cal, /onViewChange=\{setViewType\}/);
  const box = read("components/Dashboard/jobs-calendar/CalendarSearch.tsx");
  assert.match(box, /<Popper open=\{open && !filterMode && q\.trim\(\)\.length >= 2\}/);
  assert.match(box, /onText\?\.\(""\);/);
});

test("B3 Team / crew: only picks compare; a typed name of a real team / worker becomes the pick; free text stays outlined", () => {
  const options = { teams: [{ id: "t-a", name: "A" }], workers: [{ id: "w-elroy", name: "Elroy" }] };
  assert.deepEqual(resolveTyped(["team a", "elroy", "+2PT"], options), [{ kind: "team", id: "t-a", name: "A" }, { kind: "worker", id: "w-elroy", name: "Elroy" }, "+2PT"]);
  assert.deepEqual(chipsToValue(resolveTyped(["A", "+2PT"], options)), { crew: [{ kind: "team", id: "t-a", name: "A" }], team: "+2PT" });
  assert.deepEqual(resolveTyped(["+2PT"], null), ["+2PT"]);
  const picker = read("components/Dashboard/jobs-calendar/CrewPicker.tsx");
  assert.match(picker, /variant=\{typeof c === "string" \? "outlined" : "filled"\}/);
  assert.match(picker, /chipsToValue\(resolveTyped\(chips, options\)\)/);
  assert.match(read("components/Dashboard/jobs-calendar/QuickJobDialog.tsx"), /crew=\{form\.style\?\.crew \?\? null\}/);
  assert.match(read("components/Dashboard/jobs-calendar/StyledJobPanel.tsx"), /crew=\{e\.crewPicks \?\? null\}/);
});

test("B4 Remarks: 'Remarks: <text>' in panel, hover, Schedule and Export; no PTW remark field anywhere", () => {
  assert.equal(remarksLine(" call first "), "Remarks: call first");
  assert.equal(remarksLine(""), "");
  assert.ok(hoverLines(ev({ remarks: "Normal Remarks" }), "2am", null).includes("Remarks: Normal Remarks"));
  // Remarks that only repeat the subject / job title are not repeated.
  assert.equal(jobRemarks({ remarks: "Cleaning", subject: "cleaning" }), "");
  assert.equal(jobRemarks({ remarks: "Cleaning", jobTitle: "Cleaning" }), "");
  assert.match(read("components/Dashboard/jobs-calendar/StyledJobPanel.tsx"), /\{remarksLine\(remarks\)\}/);
  assert.match(read("components/Dashboard/jobs-calendar/CalendarView.tsx"), /` \| \$\{remarksLine\(sl\.remarks\)\}`/);
  for (const f of ["components/Dashboard/jobs-calendar/QuickJobDialog.tsx", "app/portal/deliveries/_components/JobPtwLinkPanel.tsx", "components/Dashboard/jobs-calendar/CalendarView.tsx"]) {
    assert.doesNotMatch(read(f), /label="PTW remark"|ptw\.remark \?/, f);
  }
});

test("B5 + B6: chips carry no job title and no postponed line; hover and Schedule keep them", () => {
  const view = read("components/Dashboard/jobs-calendar/CalendarView.tsx");
  assert.doesNotMatch(view, /chip-job-title|FitLine/);
  assert.match(view, /sl\.postponed/);
  const h = hoverLines(ev({ jobTitle: "Cleaning and WC", postponedTo: { id: "b", date: "2026-10-28" } }), "2:00 am – 3:00 am", null);
  assert.deepEqual(h.slice(0, 4), ["Acme", "Cleaning and WC", "2:00 am – 3:00 am", "Postponed to 28/10"]);
});

test("B7 Category: no form field, no panel pills, no filter, no chip tag; a stored filter is ignored", () => {
  assert.doesNotMatch(read("components/Dashboard/jobs-calendar/QuickJobDialog.tsx"), /label="Job category"|\/deliveries\/job-category/);
  assert.doesNotMatch(read("components/Dashboard/jobs-calendar/StyledJobPanel.tsx"), /kind: "category"/);
  assert.doesNotMatch(read("components/Dashboard/jobs-calendar/CalendarFilterBar.tsx"), /label="Category"/);
  assert.doesNotMatch(read("components/Dashboard/JobsCalendar.tsx"), /\/deliveries\/job-category/);
  assert.deepEqual(parseFilters(JSON.stringify({ categories: ["Site visit"], ptw: ["needed"] })).categories, []);
});

test("B8 notes: every note opens the side panel (title, type, when, staff, remarks; Edit opens the form)", () => {
  const view = read("components/Dashboard/jobs-calendar/CalendarView.tsx");
  assert.match(view, /const notesInPanel = openOnClick && styled && !mini;/);
  assert.match(view, /if \(notesInPanel\) return setPanel\(\{ event: null, day: null, note: n \}\);/);
  assert.match(view, /function NotePanelCard/);
  for (const label of ['label="Type"', 'label="When"', 'label="Staff"', 'label="Remarks"']) assert.ok(view.includes(`<Row ${label}`), label);
  assert.match(view, /data-tour="jobs-calendar-note-edit"/);
  // Clicks on a note chip, a Schedule row, a TSV card and a search pick all go through openNote.
  assert.equal((view.match(/openNote\(/g) || []).length >= 5, true);
});

test("B9 Discard changes: closes at once when nothing was typed, asks otherwise, never while saving", () => {
  assert.equal(formDirty({ a: 1, b: "x" }, { a: 1, b: "x" }), false);
  assert.equal(formDirty({ a: 1, b: "xy" }, { a: 1, b: "x" }), true);
  assert.equal(closeAction({ dirty: false, busy: false }), "close");
  assert.equal(closeAction({ dirty: true, busy: false }), "ask");
  assert.equal(closeAction({ dirty: true, busy: true }), "none");
  assert.deepEqual(DISCARD_TEXT, { title: "Discard changes?", discard: "Discard", keep: "Keep editing" });
  const job = read("components/Dashboard/jobs-calendar/QuickJobDialog.tsx");
  assert.match(job, /onClose=\{requestClose\}/);
  assert.match(job, /<Button onClick=\{requestClose\} disabled=\{saving\}>/);
  // Values the pop-up fills in by itself move the baseline too (so opening and loading never count as typing).
  assert.ok((job.match(/loadForm\(/g) || []).length >= 5);
  assert.doesNotMatch(job, /window\.confirm/);
  const dlg = read("components/Dashboard/jobs-calendar/DiscardChangesDialog.tsx");
  assert.match(dlg, /DISCARD_TEXT\.keep/);
  assert.match(dlg, /DISCARD_TEXT\.discard/);
});

test("A6 calendar Settings: the Calendar colours editor in a dialog, Org Settings edit only, beside Export list", () => {
  const bar = read("components/Dashboard/jobs-calendar/CalendarFilterBar.tsx");
  assert.match(bar, /Export list\s*<\/Button>\s*\)\}\s*\{onSettings && \(/);
  assert.match(bar, /data-tour="jobs-calendar-settings"/);
  const cal = read("components/Dashboard/JobsCalendar.tsx");
  assert.match(cal, /const canColours = !rolesLoading && wctSettingsEntry\(CALENDAR_COLOURS_PATH, \{ customAccess: false, calendarStyle: expectStyled, orgSettingsEdit: orgSettingsEditOf\(userRoles\) \}\) != null;/);
  assert.match(cal, /onSettings=\{canColours \? \(\) => setColoursOpen\(true\) : undefined\}/);
  const dlg = read("components/Dashboard/jobs-calendar/CalendarColoursDialog.tsx");
  assert.match(dlg, /CalendarColoursTables/);
  assert.match(read("app/portal/settings/calendar-colours/page.tsx"), /CalendarColoursTables/);
});
