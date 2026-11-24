// Run: npm test. Jobs calendar public holidays (WCT group, calendar style orgs, 2026-11-24).
import { test } from "node:test";
import assert from "node:assert/strict";
import { HOLIDAY_ORDER, cleanHolidays, holidayCalendarInputs, holidayExportLine, holidaysOn } from "./publicHolidays.ts";

const LIST = [
  { date: "2026-12-25", name: "Christmas Day" },
  { date: "2026-11-08", name: " Deepavali " },
  { date: "2026-12-25", name: "christmas day" },
  { date: "2026-12-25", name: "Christmas Eve (other)" },
  { date: "bad", name: "x" },
  { date: "2026-11-09", name: "" },
];

test("the export line", () => {
  assert.equal(holidayExportLine("Deepavali"), "Public holiday: Deepavali");
  assert.equal(holidayExportLine("  Hari  Raya Haji "), "Public holiday: Hari Raya Haji");
});

test("clean list: valid, one per holiday per day (date + name, any case, e.g. ticked by several companies), by date", () => {
  assert.deepEqual(cleanHolidays(LIST), [
    { date: "2026-11-08", name: "Deepavali" },
    { date: "2026-12-25", name: "Christmas Day" },
    { date: "2026-12-25", name: "Christmas Eve (other)" },
  ]);
  assert.deepEqual(cleanHolidays(null), []);
});

test("holidaysOn a day", () => {
  assert.deepEqual(holidaysOn(LIST, "2026-11-08"), [{ date: "2026-11-08", name: "Deepavali" }]);
  assert.deepEqual(holidaysOn(LIST, "2026-11-10"), []);
  assert.deepEqual(holidaysOn(undefined, "2026-11-08"), []);
});

test("calendar inputs: all-day banner, muted, not editable, before notes and jobs", () => {
  const [d] = holidayCalendarInputs(LIST);
  assert.equal(d.id, "holiday:2026-11-08|deepavali");
  assert.equal(d.title, "Public holiday: Deepavali");
  assert.equal(d.start, "2026-11-08");
  assert.equal(d.end, "2026-11-09");
  assert.equal(d.allDay, true);
  assert.equal(d.editable, false);
  assert.equal(d.interactive, false);
  assert.ok(d.classNames.includes("aims-jc-holiday"));
  assert.ok(d.displayOrder < 0 && d.displayOrder === HOLIDAY_ORDER);
  assert.deepEqual(d.extendedProps, { holiday: { date: "2026-11-08", name: "Deepavali" } });
  assert.equal(holidayCalendarInputs(LIST).length, 3);
  // Month end rolls over.
  assert.equal(holidayCalendarInputs([{ date: "2026-12-31", name: "x" }])[0].end, "2027-01-01");
});
