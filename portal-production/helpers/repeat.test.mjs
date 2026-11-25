// Run: npm test. Repeating jobs and notes (WCT group, 2026-11-25): the Repeat menu, Custom, occurrence ids.
import { test } from "node:test";
import assert from "node:assert/strict";
import { customRule, defaultCustom, occurrenceInPath, occurrenceOf, pickerOf, repeatOptions, ruleOf, shiftToAnchor } from "../components/Dashboard/jobs-calendar/repeat.ts";

test("the Repeat menu for Wed 18 Nov 2026 (third Wednesday) and for a last-week day", () => {
  const o = repeatOptions("2026-11-18");
  assert.deepEqual(o.map((x) => x.label), [
    "Does not repeat", "Daily", "Weekly on Wednesday", "Monthly on the third Wednesday", "Monthly on day 18", "Annually on 18 November", "Every weekday (Monday to Friday)", "Custom",
  ]);
  assert.equal(o.find((x) => x.value === "monthlyNth").rrule, "FREQ=MONTHLY;BYDAY=3WE");
  assert.ok(repeatOptions("2026-11-30").some((x) => x.rrule === "FREQ=MONTHLY;BYDAY=-1MO"));
});

test("Custom: every N, weekdays, ends never / on / after", () => {
  assert.equal(customRule({ ...defaultCustom("2026-11-18"), interval: 2, weekdays: [1, 4] }), "FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,TH");
  assert.equal(customRule({ interval: 3, unit: "DAILY", weekdays: [], ends: "on", until: "2027-03-31", count: 1 }), "FREQ=DAILY;INTERVAL=3;UNTIL=20270331");
  assert.equal(customRule({ interval: 1, unit: "MONTHLY", weekdays: [], ends: "after", until: "", count: 6 }), "FREQ=MONTHLY;COUNT=6");
});

test("a stored rule back to the menu; a Google rule that is no preset opens as Custom", () => {
  assert.equal(pickerOf("FREQ=WEEKLY;BYDAY=WE", "2026-11-18").preset, "weekly");
  assert.equal(pickerOf(null, "2026-11-18").preset, "none");
  const g = pickerOf("RRULE:FREQ=WEEKLY;WKST=SU;INTERVAL=2;BYDAY=TU,TH;UNTIL=20270331T155959Z", "2026-11-17");
  assert.equal(g.preset, "custom");
  assert.deepEqual([g.custom.interval, g.custom.weekdays, g.custom.ends, g.custom.until], [2, [2, 4], "on", "2027-03-31"]);
  assert.equal(ruleOf("none", "2026-11-18", g.custom), null);
  assert.equal(ruleOf("weekdays", "2026-11-18", g.custom), "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR");
});

test("occurrence ids in events and API paths; All events moves the template by the form's change", () => {
  assert.deepEqual(occurrenceOf("aims:5b1c2d3e-0000-4000-8000-000000000001~20261118"), { templateId: "5b1c2d3e-0000-4000-8000-000000000001", date: "2026-11-18" });
  assert.equal(occurrenceOf("aims:5b1c"), null);
  assert.equal(occurrenceInPath("/deliveries/5b1c2d3e-0000-4000-8000-000000000001~20261118/calendar-cancel"), "5b1c2d3e-0000-4000-8000-000000000001~20261118");
  assert.equal(occurrenceInPath("/deliveries/5b1c2d3e-0000-4000-8000-000000000001/ptw"), null);
  assert.deepEqual(shiftToAnchor("2026-11-19", "2026-11-20", "2026-11-18", "2026-11-04"), { startDate: "2026-11-05", endDate: "2026-11-06" });
});

test("the Export list over a range lists each occurrence on its own day (and the hover says it repeats)", async () => {
  const { exportText, hoverLines } = await import("../components/Dashboard/jobs-calendar/calendarPanel.ts");
  const occ = (day) => ({
    id: `aims:5b1c2d3e-0000-4000-8000-000000000001~${day.replace(/-/g, "")}`, source: "aims", kind: "service", title: "Weekly Shop", start: `${day}T02:00:00.000Z`, end: `${day}T03:00:00.000Z`,
    allDay: false, status: "scheduled", statusLabel: "Scheduled", completed: false, cancelled: false, address: "1 Road", site: "Weekly Shop", worker: null, rider: null, crew: [],
    href: null, siteclockUrl: null, deliveryNumber: 7, doNumber: null, doTag: null, doHref: null, customer: "Weekly Shop", ptwStatus: "NOT_NEEDED", doCount: 0, occurrence: true,
    repeat: { seriesId: "s1", date: day, rrule: "FREQ=WEEKLY", text: "Weekly on Wed, never ends", anchorDate: "2026-11-04" },
  });
  const text = exportText([occ("2026-11-18"), occ("2026-11-25")], { from: "2026-11-18", to: "2026-11-25", header: "" });
  assert.equal((text.match(/Weekly Shop/g) || []).length, 2);
  assert.ok(text.indexOf("18") < text.indexOf("25"));
  assert.ok(hoverLines(occ("2026-11-18"), "10am", null).includes("Repeats: Weekly on Wed, never ends"));
});
