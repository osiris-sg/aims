// Run: node --import ./helpers/test-alias.mjs --test helpers/calendarQuery.test.mjs
// Calendar speed (2026-11-25): the jobs calendar's React Query keys. One cache entry per org + range; every change
// on the calendar invalidates the shared prefix (all ranges), so an edit shows at once in every view.
import { test } from "node:test";
import assert from "node:assert/strict";
import { JOBS_CALENDAR_QUERY_KEY, activeOrgOf, jobsCalendarKey } from "../components/Dashboard/jobs-calendar/calendarQuery.ts";

test("each range has its own key under the shared prefix", () => {
  const nov = jobsCalendarKey("2026-10-26", "2026-12-06", true, "");
  const week = jobsCalendarKey("2026-11-23", "2026-11-29", true, "");
  assert.deepEqual(nov, ["jobs-calendar", "", true, "2026-10-26", "2026-12-06"]);
  assert.notDeepEqual(nov, week);
  for (const k of [nov, week]) assert.deepEqual(k.slice(0, JOBS_CALENDAR_QUERY_KEY.length), [...JOBS_CALENDAR_QUERY_KEY]);
});

test("the org on screen and the SiteClock-hidden flag are part of the key", () => {
  assert.notDeepEqual(jobsCalendarKey("2026-11-01", "2026-11-30", true, "org-a"), jobsCalendarKey("2026-11-01", "2026-11-30", true, "org-b"));
  assert.notDeepEqual(jobsCalendarKey("2026-11-01", "2026-11-30", true, "org-a"), jobsCalendarKey("2026-11-01", "2026-11-30", false, "org-a"));
});

test("no window / blocked storage: no org pick", () => {
  assert.equal(activeOrgOf(), "");
  const saved = globalThis.window;
  globalThis.window = { sessionStorage: { getItem: () => { throw new Error("blocked"); } } };
  try {
    assert.equal(activeOrgOf(), "");
    globalThis.window = { sessionStorage: { getItem: (k) => (k === "aims-admin-active-org" ? "org-x" : null) } };
    assert.equal(activeOrgOf(), "org-x");
    assert.equal(jobsCalendarKey("2026-11-01", "2026-11-30", false)[1], "org-x");
  } finally {
    globalThis.window = saved;
  }
});
