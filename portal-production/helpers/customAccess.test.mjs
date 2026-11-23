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

test("menus: Org Settings, Sales sub tabs, Calendar | Jobs (Calendar first)", () => {
  // No custom map: everything as before.
  assert.equal(settingsAllowed(null, "/portal/settings/company-profile"), true);
  assert.equal(salesSubmenuAllowed(null, "quotations"), true);
  assert.deepEqual(jobsSubmenus(null).map((s) => s.label), ["Calendar", "Jobs"]);
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
  // Roles is a tab of User Management (23 Nov), shown only with enableCustomAccess + Org Settings edit; no menu entry.
  assert.ok(!nav.includes('path: "/portal/settings/roles"'));
  assert.match(read("app/portal/user-management/users/components/Users.tsx"), /const showRoles = !!isCustomAccessEnabled && canManageRoles/);
  // Jobs calendar orgs: everyone with Jobs gets Calendar | Jobs (Elroy 2026-11-21), custom access or not.
  assert.match(nav, /m\.moduleCode !== "DELIVERIES" \|\| !isJobsCalendarEnabled\) return m;/);
  assert.match(nav, /subMenus: jobsSubmenus\(customTabs\)/);
  const side = read("components/Sidebar/DynamicSidebarContent.tsx");
  assert.ok(!side.includes("path: '/portal/settings/roles'"));
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
  assert.match(read("app/portal/deliveries/calendar/page.tsx"), /!isJobsCalendarEnabled \|\| !calendarAllowed\(customTabs\)/);
  // The Roles list (a User Management tab since 23 Nov): row menus at the click; loads only inside the custom access tab.
  const roles = read("app/portal/settings/roles/_components/RolesPanel.tsx");
  assert.match(roles, /anchorReference="anchorPosition"/);
  assert.match(read("app/portal/user-management/users/components/Users.tsx"), /showRoles && tab === "roles" \? \(\s*<RolesPanel \/>/);
});

test("no em-dashes or helper text in the new screens' copy", () => {
  for (const f of ["app/portal/settings/roles/_components/RolesPanel.tsx", "app/portal/settings/roles/_components/AccessGrid.tsx", "app/portal/user-management/users/components/CustomAccessSection.tsx", "app/portal/deliveries/calendar/page.tsx"]) {
    const src = read(f);
    const jsxText = src.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    assert.ok(!jsxText.includes("—"), f);
    assert.ok(!/helperText=/.test(jsxText), f);
  }
});


test("Roles tab (23 Nov): built-in roles Duplicate only; custom roles Edit / Duplicate / Delete; copies get a free name", async () => {
  const { roleMenuItems, copyName } = await import("./customAccess.ts");
  assert.deepEqual(roleMenuItems(true).map((i) => i.key), ["duplicate"]);
  assert.deepEqual(roleMenuItems(false).map((i) => i.key), ["edit", "duplicate", "delete"]);
  assert.equal(copyName("Sales", ["Sales", "Admin"]), "Sales copy");
  assert.equal(copyName("Sales", ["Sales", "sales COPY"]), "Sales copy 2");
  assert.ok(copyName("x".repeat(60), []).length <= 40);
});

test("Roles tab wiring: a tab of User Management for people who may manage roles; one grid and one area list", () => {
  const users = read("app/portal/user-management/users/components/Users.tsx");
  assert.match(users, /<Tab value="users" label="Users" \/>/);
  assert.match(users, /<Tab value="roles" label="Roles"/);
  assert.match(users, /const showRoles = !!isCustomAccessEnabled && canManageRoles/);
  const panel = read("app/portal/settings/roles/_components/RolesPanel.tsx");
  assert.match(panel, /New role/);
  assert.match(panel, /orgSettingsEdit/);
  assert.match(panel, /disabled=\{!!toDelete\?\.users\}/);
  assert.ok(!/—/.test(panel), "no em-dashes in the Roles copy");
  // Custom access and roles both draw the same AccessGrid, which reads the one ACCESS_TABS list.
  const grid = read("app/portal/settings/roles/_components/AccessGrid.tsx");
  assert.match(grid, /ACCESS_TABS\.map/);
  assert.match(read("app/portal/user-management/users/components/CustomAccessSection.tsx"), /import AccessGrid from/);
  assert.match(read("app/portal/settings/roles/page.tsx"), /user-management\/users\?tab=roles/);
});
