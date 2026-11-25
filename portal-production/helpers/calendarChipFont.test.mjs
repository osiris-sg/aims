// Run: npm test (node --test). Owner 25 Nov: WCT calendar style, timed jobs' chip text 1px smaller; all-day bars unchanged.
import { test } from "node:test";
import assert from "node:assert/strict";
import { CHIP_FONT_BASE, chipFontOf } from "../components/Dashboard/jobs-calendar/calendarModel.ts";

test("a timed job's chip is 1px smaller (text, time, second row)", () => {
  assert.deepEqual(chipFontOf({ allDay: false }), { text: "calc(0.85rem - 1px)", time: "calc(0.76rem - 1px)", row2: "calc(0.82rem - 1px)" });
});

test("an all-day bar keeps the old size", () => {
  assert.deepEqual(chipFontOf({ allDay: true }), { ...CHIP_FONT_BASE });
  assert.deepEqual(CHIP_FONT_BASE, { text: "0.85rem", time: "0.76rem", row2: "0.82rem" });
});
