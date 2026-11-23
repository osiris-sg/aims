// Jobs calendar search (23 Nov): a box first in the filter row, server search 300 ms after typing, a pick jumps and opens.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { hitWhen, SEARCH_DEBOUNCE_MS } from "./calendarSearch.ts";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("result date line and debounce", () => {
  assert.equal(hitWhen({ date: "2026-11-24", time: "2pm" }), "Tue 24/11/2026 · 2pm");
  assert.equal(hitWhen({ date: "2026-11-24", time: null }), "Tue 24/11/2026 · All day");
  assert.equal(SEARCH_DEBOUNCE_MS, 300);
});

test("wired: only behind the group calendar flag, Companies filter sent, the calendar jumps and opens, never filtered", () => {
  const cal = read("components/Dashboard/JobsCalendar.tsx");
  assert.match(cal, /searchJobs=\{isGroupCalendarEnabled \? searchJobs : undefined\}/);
  assert.match(cal, /\/dashboard\/jobs-calendar\/search\?/);
  assert.match(cal, /searchJobs\(q, filters\.companies\)/);
  assert.match(cal, /focus=\{focus\}/);
  const bar = read("components/Dashboard/jobs-calendar/CalendarFilterBar.tsx");
  assert.match(bar, /data-tour="jobs-calendar-filters">\s*\{search\}/);
  const view = read("components/Dashboard/jobs-calendar/CalendarView.tsx");
  assert.match(view, /calRef\.current\?\.getApi\(\)\.gotoDate\(f\.date\)/);
  assert.match(view, /jumpTo\(focus\)/);
  assert.match(view, /if \(openOnClick\) setPanel\(\{ event: e, day: null \}\)/);
  const box = read("components/Dashboard/jobs-calendar/CalendarSearch.tsx");
  assert.match(box, /if \(e\.key === "Escape"\) clear\(\)/);
});
