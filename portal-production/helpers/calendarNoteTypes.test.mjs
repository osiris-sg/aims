// Note types (WCT group, calendar style orgs, 2026-11-24): helpers/calendarAdd.ts note parts + NoteDialog wiring.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { NOTE_TYPES, STYLED_NOTE_TYPES, TSV_TYPE, blankTsv, defaultNoteType, durationLabel, noteBody, noteType, noteTypeOptions, tsvFormOf } from "./calendarAdd.ts";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const base = { title: "", type: TSV_TYPE, staffId: null, staffName: null, startDate: "2026-12-09", endDate: "2026-12-09", allDay: false, startTime: "10:00", endTime: "17:00", remark: " Check the hood " };

test("type list: calendar style orgs get General / Site visit / Technician Site Visit plus the old kinds; others unchanged", () => {
  assert.deepEqual(noteTypeOptions(false), NOTE_TYPES);
  assert.deepEqual(NOTE_TYPES.map((t) => t.value), ["LEAVE", "PTW", "BLOCKAGE", "OTHER"]);
  assert.deepEqual(noteTypeOptions(true).map((t) => [t.value, t.label]), [
    ["OTHER", "General"],
    ["SITE_VISIT", "Site visit"],
    ["TECH_SITE_VISIT", "Technician Site Visit"],
    ["LEAVE", "Leave"],
    ["PTW", "PTW"],
    ["BLOCKAGE", "Blockage"],
  ]);
  assert.equal(defaultNoteType(true), "OTHER");
  assert.equal(defaultNoteType(false), "LEAVE");
  assert.equal(noteType("OTHER").label, "Other");
  assert.equal(noteType("SITE_VISIT").label, "Site visit");
  assert.equal(STYLED_NOTE_TYPES.length, 6);
});

test("old note bodies are unchanged; Site visit is a plain note", () => {
  const f = { ...base, title: "Ali on leave", type: "LEAVE", staffId: "w1", staffName: "Ali", allDay: true, remark: "" };
  assert.deepEqual(noteBody(f).body, { title: "Ali on leave", type: "LEAVE", staffId: "w1", staffName: "Ali", startDate: "2026-12-09", endDate: "2026-12-09", allDay: true, remark: "" });
  assert.equal(noteBody({ ...f, type: "SITE_VISIT" }).body.type, "SITE_VISIT");
  assert.equal(noteBody({ ...f, type: "SITE_VISIT", title: "" }).error, "Give the note a title");
});

test("Technician Site Visit body: one day, time + duration, the job fields; no title needed", () => {
  const tsv = { ...blankTsv(), customerId: "c1", customerName: "Domino Pizza", siteAddress: " 1 Jalan Besar ", durationMin: 90, workers: [{ id: "w1", name: "Ali" }], team: " Team A ", salesperson: { id: "u1", name: "Amy" } };
  const { body } = noteBody({ ...base, tsv });
  assert.deepEqual(body, {
    type: "TECH_SITE_VISIT",
    title: "Domino Pizza",
    startDate: "2026-12-09",
    endDate: "2026-12-09",
    allDay: false,
    startTime: "10:00",
    durationMin: 90,
    customerId: "c1",
    shopName: null,
    siteAddress: "1 Jalan Besar",
    workers: [{ id: "w1", name: "Ali" }],
    team: "Team A",
    salesperson: { id: "u1", name: "Amy" },
    remark: "Check the hood",
  });
  assert.equal(noteBody({ ...base, tsv: { ...tsv, shopName: " Shop 7 " } }).body.title, "Shop 7");
  assert.equal(noteBody({ ...base, tsv: blankTsv() }).error, "Pick a customer or type a shop name");
  assert.equal(noteBody({ ...base, startDate: "", tsv }).error, "Pick a date");
  assert.equal(noteBody({ ...base, startTime: "", tsv }).error, "Pick a time");
  assert.equal("startTime" in noteBody({ ...base, allDay: true, tsv }).body, false);
});

test("a stored Technician Site Visit opens in the form with its fields", () => {
  const d = { customerId: "c1", customerName: "Domino", shopName: null, address: "1 Jalan Besar", durationMin: 120, workers: [{ id: "w1", name: "Ali" }], team: null, salesperson: { id: "u1", name: null } };
  assert.deepEqual(tsvFormOf({ details: d }), { customerId: "c1", customerName: "Domino", shopName: "", siteAddress: "1 Jalan Besar", durationMin: 120, workers: [{ id: "w1", name: "Ali" }], team: "", salesperson: { id: "u1", name: "" } });
  assert.deepEqual(tsvFormOf({}), blankTsv());
  assert.equal(durationLabel(90), "1 h 30 min");
});

test("NoteDialog: Type list by calendar style, Technician Site Visit fields, no Title for it", () => {
  const src = read("components/Dashboard/jobs-calendar/NoteDialog.tsx");
  assert.match(src, /noteTypeOptions\(styled\)/);
  assert.match(src, /features\?\.enableCalendarStyle === true/);
  assert.match(src, /\{!tsv && <TextField label="Title"/);
  for (const label of ['label="Customer"', 'label="Shop name"', 'label="Site address"', 'label="Date"', 'label="Time"', 'label="Duration"', 'label="Assigned workers"', 'label="Team / crew"', 'label="Salesperson"']) assert.ok(src.includes(label), label);
  assert.doesNotMatch(src, /—/);
  assert.doesNotMatch(src, /helperText/);
});
