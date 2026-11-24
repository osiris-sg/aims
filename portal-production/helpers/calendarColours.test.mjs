// Run: npm test. Org Settings > Calendar colours (WCT group, 2026-11-25) and the WCT Org Settings menu entries
// ("Users & roles", "Calendar colours"; Org Settings edit only). Orgs without the settings keep today's menus.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { colourChanges, pickOf, pickerOptions, shownColour } from "./calendarColours.ts";
import { orgSettingsEditOf, wctSettingsEntry, CALENDAR_COLOURS_PATH, USERS_PATH } from "./customAccess.ts";

const page = {
  people: [
    { id: "hh", name: "Nat HH", colour: "#039be5", auto: false },
    { id: "henry", name: "Henry Hoo", colour: "#f09300", auto: true },
  ],
  ptw: [
    { status: "REQUIRED", label: "Required", colour: null },
    { status: "SUBMITTED", label: "Pending", colour: null },
    { status: "APPROVED", label: "Approved", colour: "#0b8043" },
    { status: "REJECTED", label: "Rejected", colour: null },
  ],
  applicants: [{ name: "Bala", colour: "#d50000" }],
  palettes: { people: ["#039be5", "#8e24aa"], ptw: ["#d50000", "#0b8043"] },
};
const loaded = () => ({ people: Object.fromEntries(page.people.map((p) => [p.id, pickOf(p)])), ptw: Object.fromEntries(page.ptw.map((r) => [r.status, r.colour])) });

test("nothing changed: no save", () => {
  const { people, ptw } = loaded();
  assert.equal(colourChanges(page, people, ptw), null);
  // An automatic person loads as "Automatic" (null), not their automatic colour.
  assert.equal(people.henry, null);
  assert.equal(people.hh, "#039be5");
});

test("only what changed is sent: a person picked, a person back to automatic, statuses set and cleared", () => {
  const { people, ptw } = loaded();
  const body = colourChanges(page, { ...people, henry: "#8e24aa", hh: null }, { ...ptw, REQUIRED: "#f4511e", APPROVED: null });
  assert.deepEqual(body, {
    people: [
      { id: "hh", colour: null },
      { id: "henry", colour: "#8e24aa" },
    ],
    ptw: { REQUIRED: "#f4511e", APPROVED: null },
  });
});

test("swatches: today's colour, the pick, automatic colour when known", () => {
  assert.equal(shownColour(page.people[1], undefined), "#f09300");
  assert.equal(shownColour(page.people[1], null), "#f09300");
  assert.equal(shownColour(page.people[0], null), null);
  assert.equal(shownColour(page.people[0], "#8e24aa"), "#8e24aa");
  assert.deepEqual(pickerOptions(["#039BE5"], "#123456"), ["#123456", "#039be5"]);
  assert.deepEqual(pickerOptions(["#039be5"], "#039be5"), ["#039be5"]);
});

test("Org Settings edit: Admin / superadmin, a custom map at Edit; Sales or a map at View no", () => {
  assert.equal(orgSettingsEditOf([{ name: "Admin" }]), true);
  assert.equal(orgSettingsEditOf([{ name: "superadmin" }]), true);
  assert.equal(orgSettingsEditOf([{ name: "Sales" }]), false);
  assert.equal(orgSettingsEditOf([{ name: "Salesperson", tabAccess: { orgSettings: "view", sales: "edit" } }]), false);
  assert.equal(orgSettingsEditOf([{ name: "Office", tabAccess: { orgSettings: "edit" } }]), true);
  // A custom role at Edit beside a built-in role (the server unions the maps).
  assert.equal(orgSettingsEditOf([{ name: "Sales" }, { name: "Office", tabAccess: { orgSettings: "edit" } }]), true);
  // Own Custom access at View decides alone.
  assert.equal(orgSettingsEditOf([{ name: "Custom · x", tabAccess: { orgSettings: "view" } }]), false);
});

test("menu entries: WCT group with Org Settings edit only; every other org keeps its own rules", () => {
  const wct = { customAccess: true, calendarStyle: true, orgSettingsEdit: true };
  assert.equal(wctSettingsEntry(USERS_PATH, wct), "Users & roles");
  assert.equal(wctSettingsEntry(CALENDAR_COLOURS_PATH, wct), "Calendar colours");
  assert.equal(wctSettingsEntry(USERS_PATH, { ...wct, orgSettingsEdit: false }), null);
  assert.equal(wctSettingsEntry(CALENDAR_COLOURS_PATH, { ...wct, orgSettingsEdit: false }), null);
  // YMM: custom access, no calendar style.
  assert.equal(wctSettingsEntry(CALENDAR_COLOURS_PATH, { ...wct, calendarStyle: false }), null);
  assert.equal(wctSettingsEntry(USERS_PATH, { ...wct, calendarStyle: false }), "Users & roles");
  // Any other org (no custom access): Users left to the old rule, Calendar colours hidden.
  const other = { customAccess: false, calendarStyle: false, orgSettingsEdit: true };
  assert.equal(wctSettingsEntry(USERS_PATH, other), undefined);
  assert.equal(wctSettingsEntry(CALENDAR_COLOURS_PATH, other), null);
  assert.equal(wctSettingsEntry("/portal/settings/job-fields", wct), undefined);
});

test("top bar and sidebar both use the WCT entries", () => {
  const nav = readFileSync(new URL("../components/TopNav/useNavModules.ts", import.meta.url), "utf8");
  assert.match(nav, /\{ label: "Calendar colours", path: "\/portal\/settings\/calendar-colours" \}/);
  assert.match(nav, /const own = wctSettingsEntry\(s\.path, wct\);/);
  assert.match(nav, /label: wctSettingsEntry\(s\.path, wct\) \?\? s\.label/);
  const side = readFileSync(new URL("../components/Sidebar/DynamicSidebarContent.tsx", import.meta.url), "utf8");
  assert.match(side, /key: 'calendar-colours', label: 'Calendar colours', path: '\/portal\/settings\/calendar-colours'/);
  assert.match(side, /wctSettingsEntry\(s\.path, wctSettings\) \?\? settingLabel\(s\)/);
});

test("the calendar legend lists the PTW stripe colours sent by the server", () => {
  const panel = readFileSync(new URL("../components/Dashboard/jobs-calendar/PeoplePanel.tsx", import.meta.url), "utf8");
  assert.match(panel, /stripes\.map\(\(s\) =>/);
  const cal = readFileSync(new URL("../components/Dashboard/JobsCalendar.tsx", import.meta.url), "utf8");
  assert.match(cal, /stripes=\{data\?\.style\?\.stripes \?\? \[\]\}/);
});
