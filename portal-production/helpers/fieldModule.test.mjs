// Field module (FIELD_PLAN.md, 2026-11-21): flags, nav group, access, phase 1 page helpers.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { FIELD_AREAS, FIELD_AREA_FLAGS, fieldAreasOn, fieldNavModule, fieldPagesFor } from "./fieldModule.ts";
import * as fieldModuleAll from "./fieldModule.ts";
import { filterWorkers, inviteState, ruleBadges, siteFormErrors, workerPatch } from "./fieldPeople.ts";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const allOn = (lv) => ({ levels: Object.fromEntries(FIELD_AREAS.map((a) => [a, lv])), scoped: {}, admin: lv === "approve" });

test("flags: nothing without enableFieldModule; an area needs both flags; every flag defaults off on both sides", () => {
  assert.deepEqual(fieldAreasOn({ enableFieldPeople: true }), []);
  assert.deepEqual(fieldAreasOn({ enableFieldModule: true }), []);
  assert.deepEqual(fieldAreasOn({ enableFieldModule: true, enableFieldPeople: true, enableFieldPayroll: false }), ["people"]);
  const api = read("../api-server-production/src/organizations/default-features.ts");
  const portal = read("app/portal/hooks/useOrganizationFeatures.ts");
  const flags = ["enableFieldModule", ...Object.values(FIELD_AREA_FLAGS), "fieldEngineLive"];
  for (const f of flags) {
    assert.match(api, new RegExp(`\\n  ${f}: false,`), `api default ${f}`);
    assert.match(portal, new RegExp(`\\n  ${f}: false,`), `portal default ${f}`);
  }
  const apiFlags = read("../api-server-production/src/field/common/field-flags.ts");
  for (const [area, flag] of Object.entries(FIELD_AREA_FLAGS)) assert.match(apiFlags, new RegExp(`${area}: '${flag}'`));
});

test("nav: the HR group only when an area is on and the person may view a page in it", () => {
  assert.equal(fieldNavModule([], allOn("approve")), null);
  assert.equal(fieldNavModule(["people"], null), null);
  assert.equal(fieldNavModule(["people"], allOn("none")), null);
  const nav = fieldNavModule(["people"], allOn("view"));
  assert.equal(nav.displayName, "HR");
  assert.deepEqual(nav.config.subMenus.map((s) => s.label), ["Workers", "Teams", "Sites", "Invites", "HR settings"]);
  assert.equal(fieldPagesFor(["payroll"], allOn("approve")).length, 1);
  assert.deepEqual(fieldPagesFor(["jobs"], allOn("view")).map((p) => p.label), ["Job plan", "Working hours"]);
  assert.deepEqual(fieldPagesFor(["reports"], allOn("view")).map((p) => p.label), ["Overview", "Reports", "Rules", "Terms", "Audit log"]);
  assert.equal(fieldNavModule(["reports", "people"], allOn("view")).config.route, "/portal/hr/overview");
  const nm = read("components/TopNav/useNavModules.ts");
  assert.match(nm, /fieldNavModule\(fieldAreas \?\? \[\], fieldMe\?\.access\)/);
});

test("access presets match the API (Operations, Accounting, supervisor grant)", () => {
  const api = read("../api-server-production/src/field/common/field-access.ts");
  assert.match(api, /operations: \{ people: 'view', jobs: 'edit', punches: 'approve', timesheets: 'approve', leave: 'approve', reports: 'view' \}/);
  assert.match(api, /accounting: \{ people: 'view', timesheets: 'view', payroll: 'edit', reports: 'view' \}/);
});

test("workers: badges, search, hidden, patch only what changed (\"\" = company rule)", () => {
  assert.deepEqual(ruleBadges({ selfiePolicy: "ALWAYS", payFollowsCrew: true, offSiteClocking: null }), ["Selfie every punch", "Pay follows crew"]);
  const rows = [
    { id: "1", name: "Ann", active: true, employeeNo: "E1", phone: "+6590000001", teams: [{ id: "t", name: "Team A" }], sites: [] },
    { id: "2", name: "Ben", active: false, employeeNo: null, phone: null, teams: [], sites: [{ siteId: "s", name: "Yard", isSupervisor: false }] },
  ];
  assert.deepEqual(filterWorkers(rows, "", false).map((r) => r.id), ["1"]);
  assert.deepEqual(filterWorkers(rows, "yard", true).map((r) => r.id), ["2"]);
  assert.deepEqual(filterWorkers(rows, "team a", false).map((r) => r.id), ["1"]);
  assert.deepEqual(workerPatch({ name: "Ann", selfiePolicy: "ALWAYS", payFollowsCrew: false }, { name: "Ann", selfiePolicy: null, payFollowsCrew: false }), { selfiePolicy: "" });
});

test("sites: SiteClock's ranges; invites: state", () => {
  const ok = { name: "Yard", lat: "1.3", lng: "103.8", radiusM: 150, maxAccuracyM: 50, autoCloseAfterH: 14 };
  assert.equal(siteFormErrors(ok), null);
  assert.match(siteFormErrors({ ...ok, radiusM: 10 }), /Radius must be 20 to 5000/);
  assert.match(siteFormErrors({ ...ok, lat: "" }), /latitude/);
  assert.equal(inviteState({ active: true, expiresAt: null, maxUses: 2, uses: 2 }), "Used up");
  assert.equal(inviteState({ active: true, expiresAt: "2000-01-01T00:00:00Z", maxUses: null, uses: 0 }), "Expired");
  assert.equal(inviteState({ active: false, expiresAt: null, maxUses: null, uses: 0 }), "Off");
});

test("UI copy: no em-dashes, no helper text, no subtitles in the Field pages", () => {
  for (const f of ["workers", "teams", "sites", "invites", "settings", "plan", "working-hours", "clock-ins", "timesheets", "leave", "payroll", "live-site", "shared-workers", "terms"]) {
    const src = read(`app/portal/hr/${f}/page.tsx`).replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    assert.ok(!src.includes("—"), f);
    assert.ok(!/helperText=/.test(src), f);
    assert.ok(!/subTitle=/.test(src), f);
  }
});

test("phase 2 helpers: days, weeks, told", async () => {
  const { daysText, mondayOf, addDaysIso, toldText } = await import("./fieldJobs.ts");
  assert.equal(daysText([1, 2, 3, 4, 5]), "Mon to Fri");
  assert.equal(daysText([1, 3, 6]), "Mon, Wed, Sat");
  assert.equal(daysText([1, 2, 3, 4, 5, 6, 7]), "Every day");
  assert.equal(mondayOf("2026-11-21"), "2026-11-16");
  assert.equal(mondayOf("2026-11-16"), "2026-11-16");
  assert.equal(addDaysIso("2026-11-30", 1), "2026-12-01");
  assert.equal(toldText([{ notifiedAt: "x" }, { notifiedAt: null }]), "1 of 2 told");
  assert.equal(toldText([]), "No crew");
});

test("phase 3 helpers: flag words, approve body only sends what moved", async () => {
  const { FLAG_LABEL, approveBody, toLocalInput } = await import("./fieldJobs.ts");
  assert.equal(Object.keys(FLAG_LABEL).length, 13);
  const rec = "2026-02-02T09:30:00.000Z";
  assert.deepEqual(approveBody({ clockInAt: "", punchAt: toLocalInput(rec), note: " " }, rec), {});
  const moved = approveBody({ clockInAt: "", punchAt: "2026-02-02T08:00", note: "ok" }, rec);
  assert.equal(moved.note, "ok");
  assert.ok(moved.punchAt);
});

test("phase 4 helpers: minutes, notes without dashes, the oddity warnings, bulk result", async () => {
  const { hm, plainNote, entryWarnings, bulkResultText } = await import("./fieldTimesheets.ts");
  assert.equal(hm(125), "2h 5m");
  assert.equal(hm(45), "45m");
  assert.equal(hm(120), "2h");
  assert.equal(plainNote("Not on any job's crew this day — paid as clocked."), "Not on any job's crew this day: paid as clocked.");
  assert.deepEqual(entryWarnings({ nlb: true, needsReview: true }), ["Needs review: approve it on its own", "No lunch break approved, but no credit is set"]);
  assert.deepEqual(entryWarnings({ nlb: true }, { nlbCreditMinutes: 30 }), []);
  assert.equal(bulkResultText({ approved: 3, needsReview: 2 }), "3 approved. 2 need review and were not approved.");
});

test("phase 6 helpers: money, cents, profile body and form", async () => {
  const { money, toCents, profileBody, profileForm } = await import("./fieldPayroll.ts");
  assert.equal(money(76022), "$760.22");
  assert.equal(toCents("$650"), 65000);
  assert.equal(toCents(""), null);
  const b = profileBody({ payType: "DAILY", dailyRateOverride: "100", workDaysPerWeek: "6", restDays: [6, 7], premiumMode: "OT_RATE", weekdayOt: true, otRateOverride: "" });
  assert.deepEqual([b.dailyRateCentsOverride, b.otRateCentsOverride, b.basicMonthlyCents, b.restDays.length], [10000, null, 0, 2]);
  assert.equal(profileForm({ basicMonthlyCents: 65000 }).basicMonthly, "650");
});

test("HR (2026-11-24): every SiteClock office tab has a page; the mobile menu and old links follow", () => {
  const { FIELD_PAGES } = fieldModuleAll;
  // SiteClock web sidebar (web/src/lib/permissions.ts COMPANY_TABS @62b7d9d) -> the HR page that holds it.
  const siteclock = { Overview: "overview", "Live Site": "live-site", Flagged: "clock-ins", Timesheets: "timesheets", Sites: "sites", Workers: "workers", Teams: "teams", Payroll: "payroll", Jobs: "plan", "Shared workers": "shared-workers", "Working hours": "working-hours", Rules: "rules", Terms: "terms", Leave: "leave", Reports: "reports" };
  const keys = FIELD_PAGES.map((p) => p.key);
  for (const [tab, key] of Object.entries(siteclock)) assert.ok(keys.includes(key), `${tab} -> ${key}`);
  for (const p of FIELD_PAGES) {
    assert.ok(p.path.startsWith("/portal/hr/"), p.path);
    assert.ok(read(`app/portal/hr/${p.key}/page.tsx`).includes("FieldGate"), p.key);
  }
  assert.equal(FIELD_PAGES[0].key, "overview");
  assert.match(read("components/Sidebar/DynamicSidebarContent.tsx"), /fieldNavModule\(fieldAreas \?\? \[\], fieldMe\?\.access\)/);
  assert.match(read("next.config.mjs"), /source: "\/portal\/field\/:path\*", destination: "\/portal\/hr\/:path\*"/);
});
