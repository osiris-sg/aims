// Dashboard "Today's jobs" card + Jobs > Calendar as the first Jobs tab (WCT group, Elroy 2026-11-21).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { todaysJobs, TODAY_MAX } from "./todaysJobs.ts";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const ev = (o) => ({ id: o.id, source: "aims", kind: "delivery", title: o.title ?? "Job", start: o.start, end: null, allDay: !!o.allDay, status: "", statusLabel: "", completed: false, cancelled: !!o.cancelled, address: null, site: null, worker: null, rider: null, crew: [], href: o.href ?? `/portal/deliveries/${o.id}`, siteclockUrl: null, deliveryNumber: null, customer: o.customer, ...o.extra });

test("today's jobs: all-day first, then by time; cancelled left out; icons and customer as the chips", () => {
  const { rows, more } = todaysJobs([
    ev({ id: "b", start: "2026-11-21T14:00:00+08:00", customer: "Beta" }),
    ev({ id: "x", start: "2026-11-21T08:00:00+08:00", customer: "Gone", cancelled: true }),
    ev({ id: "a", start: "2026-11-21T09:30:00+08:00", customer: "Alpha", extra: { cod: true, sticker: true } }),
    ev({ id: "d", start: "2026-11-21", allDay: true, customer: "Allday" }),
  ]);
  assert.deepEqual(rows.map((r) => r.customer), ["Allday", "Alpha", "Beta"]);
  assert.equal(rows[0].time, "");
  assert.equal(rows[1].icons, "📌 🟫");
  assert.equal(rows[1].href, "/portal/deliveries/a");
  assert.equal(more, 0);
});

test("today's jobs: at most 6, then +N more; another company's job has no link", () => {
  const many = Array.from({ length: 9 }, (_, i) => ev({ id: `j${i}`, start: `2026-11-21T0${i}:00:00+08:00`, customer: `C${i}` }));
  many[0].foreign = true;
  const { rows, more } = todaysJobs(many);
  assert.equal(TODAY_MAX, 6);
  assert.equal(rows.length, 6);
  assert.equal(more, 3);
  assert.equal(rows[0].href, null);
});

test("wiring: the card on the role home, View calendar opens Jobs > Calendar, Jobs opens on Calendar", () => {
  const home = read("app/portal/components/RoleHome/RoleHome.tsx");
  assert.match(home, /<TodaysJobsCard sx=\{card\} \/>/);
  assert.ok(!/<JobsCalendar/.test(home));
  const card = read("components/Dashboard/TodaysJobsCard.tsx");
  assert.match(card, /CALENDAR_PATH = "\/portal\/deliveries\/calendar"/);
  assert.match(card, /isJobsCalendarEnabled && !isLoading && calendarAllowed\(customTabs\)/);
  assert.match(card, /View calendar/);
  const bar = read("app/portal/components/RoleHome/RoleTopBar.tsx");
  assert.match(bar, /b\.code === "DELIVERIES" && b\.tabs\[0\]\?\.path === "\/portal\/deliveries\/calendar"/);
  for (const f of ["components/Dashboard/TodaysJobsCard.tsx"]) {
    const jsx = read(f).replace(/\/\/.*$/gm, "");
    assert.ok(!jsx.includes("—") && !jsx.includes("…") && !/helperText=/.test(jsx), f);
  }
});
