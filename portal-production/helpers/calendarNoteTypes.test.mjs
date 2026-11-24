// Note types (WCT group, calendar style orgs, 2026-11-24): helpers/calendarAdd.ts note parts + NoteDialog wiring.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { NOTE_TYPES, STYLED_NOTE_TYPES, TSV_TYPE, defaultNoteType, noteBody, noteType, noteTypeLabel, noteTypeOptions } from "./calendarAdd.ts";

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

test("2026-11-25: a Technician Site Visit body is a General note's body (title, staff, dates / times, remark)", () => {
  const f = { ...base, title: " Visit Domino ", staffId: "w1", staffName: "Ali" };
  assert.deepEqual(noteBody(f).body, { title: "Visit Domino", type: "TECH_SITE_VISIT", staffId: "w1", staffName: "Ali", startDate: "2026-12-09", endDate: "2026-12-09", allDay: false, startTime: "10:00", endTime: "17:00", remark: "Check the hood" });
  assert.equal(noteBody({ ...f, title: "" }).error, "Give the note a title");
  for (const k of ["customerId", "shopName", "siteAddress", "workers", "team", "salesperson", "durationMin"]) assert.equal(k in noteBody(f).body, false, k);
  assert.equal(noteTypeLabel("OTHER", true), "General");
  assert.equal(noteTypeLabel("OTHER", false), "Other");
  assert.equal(noteTypeLabel(TSV_TYPE, true), "Technician Site Visit");
});

test("NoteDialog: Type list by calendar style; every type has the General fields only; Discard changes", () => {
  const src = read("components/Dashboard/jobs-calendar/NoteDialog.tsx");
  assert.match(src, /noteTypeOptions\(styled\)/);
  assert.match(src, /features\?\.enableCalendarStyle === true/);
  for (const label of ['label="Title"', 'label="Type"', 'label="Staff (optional)"', 'label="Start date"', 'label="End date"', 'label="All day"', 'label="From"', 'label="To"', 'label="Remark"']) assert.ok(src.includes(label), label);
  for (const label of ['label="Customer"', 'label="Shop name"', 'label="Site address"', 'label="Team / crew"', 'label="Salesperson"', 'label="Duration"', "tsv"]) assert.ok(!src.includes(label), label);
  assert.match(src, /<Dialog open=\{open\} onClose=\{requestClose\}/);
  assert.match(src, /<DiscardChangesDialog/);
  assert.doesNotMatch(src, /window\.confirm/);
  assert.doesNotMatch(src, /—/);
  assert.doesNotMatch(src, /helperText/);
});
