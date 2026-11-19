// Custom access (features.enableCustomAccess, WCT group 2026-11-19): helpers/customAccess.ts and the
// screens that use it. Orgs without the setting keep today's menus, pickers and users list.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  ACCESS_TABS,
  accessSummary,
  calendarAllowed,
  customSummary,
  effectiveTabAccess,
  isCustomRole,
  jobsSubmenus,
  levelLabel,
  noAccess,
  readTabAccess,
  salesSubmenuAllowed,
  settingsAllowed,
  unionTabAccess,
} from "./customAccess.ts";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const map = (m) => ({ ...noAccess(), ...m });

test("the tab list matches the API's ACCESS_TABS (same keys, same order, same levels)", () => {
  const api = read("../api-server-production/src/access/tab-access.ts");
  const block = api.slice(api.indexOf("export const ACCESS_TABS"), api.indexOf("export const TAB_KEYS"));
  const keys = [...block.matchAll(/key: '([a-zA-Z]+)'/g)].map((m) => m[1]);
  assert.deepEqual(keys, ACCESS_TABS.map((t) => t.key));
  const viewOnly = [...block.matchAll(/key: '([a-zA-Z]+)', label: '[^']+', levels: \['none', 'view'\]/g)].map((m) => m[1]);
  assert.deepEqual(viewOnly, ACCESS_TABS.filter((t) => !t.levels.includes("edit")).map((t) => t.key));
});

test("custom only when EVERY role carries a map; union across roles", () => {
  assert.equal(effectiveTabAccess([]), null);
  assert.equal(effectiveTabAccess([{ name: "Sales" }]), null);
  assert.equal(effectiveTabAccess([{ name: "Sales" }, { name: "Desk", tabAccess: { orders: "edit" } }]), null);
  const one = effectiveTabAccess([{ id: "custom-access", tabAccess: { sales: "view" } }]);
  assert.equal(one.sales, "view");
  assert.equal(one.orders, "none");
  const two = effectiveTabAccess([{ tabAccess: { orders: "view", jobs: "edit" } }, { tabAccess: { orders: "edit", accounting: "view" } }]);
  assert.deepEqual([two.orders, two.jobs, two.accounting, two.sales], ["edit", "edit", "view", "none"]);
  assert.deepEqual(unionTabAccess([]), noAccess());
  assert.equal(readTabAccess({ dashboard: "edit", sales: "x" }).dashboard, "none");
});

test("menus: Org Settings, Sales sub tabs, Jobs | Calendar", () => {
  // No custom map: everything as before.
  assert.equal(settingsAllowed(null, "/portal/settings/company-profile"), true);
  assert.equal(salesSubmenuAllowed(null, "quotations"), true);
  assert.deepEqual(jobsSubmenus(null).map((s) => s.label), ["Jobs", "Calendar"]);
  assert.equal(calendarAllowed(null), true);
  // Custom map.
  const desk = map({ orders: "edit", calendar: "view", salesReport: "view" });
  assert.equal(settingsAllowed(desk, "/portal/settings/company-profile"), false);
  assert.equal(settingsAllowed(map({ orgSettings: "view" }), "/portal/masterfiles"), true);
  assert.equal(settingsAllowed(map({ orgSettings: "edit" }), "/portal/settings/roles"), false);
  assert.equal(salesSubmenuAllowed(desk, "quotations"), false);
  assert.equal(salesSubmenuAllowed(desk, "sales-report"), true);
  assert.deepEqual(jobsSubmenus(desk).map((s) => s.label), ["Calendar"]);
  assert.deepEqual(jobsSubmenus(map({ jobs: "view" })).map((s) => s.label), ["Jobs"]);
  assert.equal(calendarAllowed(map({ jobs: "edit" })), false);
});

test("labels: Sales report reads Own / All; summaries; custom roles told apart by description", () => {
  assert.equal(levelLabel("salesReport", "view"), "Own");
  assert.equal(levelLabel("salesReport", "edit"), "All");
  assert.equal(levelLabel("orders", "none"), "No access");
  assert.equal(accessSummary(map({ orders: "edit", salesReport: "view" })), "Orders edit, Sales report own");
  assert.equal(accessSummary(noAccess()), "No access");
  assert.equal(isCustomRole({ description: "Custom · Orders edit" }), true);
  assert.equal(isCustomRole({ description: "Preset · Sales — x" }), false);
  assert.equal(customSummary({ description: "Custom · Orders edit" }), "Orders edit");
  for (const t of ACCESS_TABS) for (const l of t.levels) assert.ok(!levelLabel(t.key, l).includes("—"));
});

test("wiring: every new screen is behind enableCustomAccess (default off)", () => {
  const feats = read("app/portal/hooks/useOrganizationFeatures.ts");
  assert.match(feats, /enableCustomAccess: false,/);
  assert.match(feats, /isCustomAccessEnabled: features\.enableCustomAccess === true/);
  const nav = read("components/TopNav/useNavModules.ts");
  assert.match(nav, /s\.path !== "\/portal\/settings\/roles" \|\| \(!!isCustomAccessEnabled && isAdminUser\)/);
  assert.match(nav, /m\.moduleCode === "DELIVERIES" && isCustomAccessEnabled && isJobsCalendarEnabled/);
  const side = read("components/Sidebar/DynamicSidebarContent.tsx");
  assert.match(side, /s\.key !== 'roles' \|\| \(!!isCustomAccessEnabled && isAdminUser\)/);
  for (const f of ["app/portal/user-management/users/components/EditUser.tsx", "app/portal/user-management/users/components/AddUser.tsx"]) {
    const src = read(f);
    assert.match(src, /isPresetRole\(r\) \|\| \(isCustomAccessEnabled && isCustomRole\(r\)\)/, f);
    assert.match(src, /isCustomAccessEnabled \? "\/roles\?limit=200" : "\/roles"/, f);
    assert.match(src, /<CustomAccessSection/, f);
  }
  assert.match(read("app/portal/user-management/users/components/EditUser.tsx"), /if \(!open \|\| !isCustomAccessEnabled \|\| !user\?\.id\) return;/);
  assert.match(read("app/portal/user-management/users/components/AddUser.tsx"), /if \(!open \|\| !isCustomAccessEnabled\) return;/);
  assert.match(read("app/portal/user-management/users/hooks/useUserTableHeader.tsx"), /customAccess[\s\S]*label="Custom"/);
  assert.match(read("app/portal/sales/page.tsx"), /isJobsCalendarEnabled && calendarAllowed\(customTabs\)/);
  assert.match(read("app/portal/deliveries/calendar/page.tsx"), /!isJobsCalendarEnabled \|\| !isCustomAccessEnabled \|\| !calendarAllowed\(customTabs\)/);
  const roles = read("app/portal/settings/roles/page.tsx");
  assert.match(roles, /anchorReference="anchorPosition"/);
  assert.match(roles, /isCustomAccessEnabled\) void load\(\)/);
});

test("no em-dashes or helper text in the new screens' copy", () => {
  for (const f of ["app/portal/settings/roles/page.tsx", "app/portal/settings/roles/_components/AccessGrid.tsx", "app/portal/user-management/users/components/CustomAccessSection.tsx", "app/portal/deliveries/calendar/page.tsx"]) {
    const src = read(f);
    const jsxText = src.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    assert.ok(!jsxText.includes("—"), f);
    assert.ok(!/helperText=/.test(jsxText), f);
  }
});
