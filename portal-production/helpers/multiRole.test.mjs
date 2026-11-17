// Multi-role users (features.enableMultiRole, WCT group 2026-11-17): helpers/multiRole.ts and
// the Add / Edit User wiring. Orgs without the setting keep today's pickers and payloads.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { applySelect, makePrimary, primaryOf, removeRole, rolePayload, rolesAllowModule, rolesHavePermission, selectionFromUser, singleRolePicker } from "./multiRole.ts";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const P = (resource, action) => ({ resource, action });
const sales = { id: "s", name: "Sales", permissions: [P("documents", "read")], allowedModules: ["SALES"] };
const ops = { id: "o", name: "Operations", permissions: [P("deliveries", "update")], allowedModules: ["DELIVERIES"] };
const mgmt = { id: "m", name: "Management", permissions: [P("*", "*")], allowedModules: [] };

test("union permissions and modules across roles", () => {
  assert.equal(rolesHavePermission([sales, ops], "documents", "read"), true);
  assert.equal(rolesHavePermission([sales, ops], "deliveries", "update"), true);
  assert.equal(rolesHavePermission([sales, ops], "journal", "read"), false);
  assert.equal(rolesHavePermission([mgmt], "journal", "read"), true);
  assert.equal(rolesAllowModule([sales, ops], "DELIVERIES"), true);
  assert.equal(rolesAllowModule([sales, ops], "ACCOUNTING"), false);
  assert.equal(rolesAllowModule([sales, mgmt], "ACCOUNTING"), true);
  assert.equal(rolesAllowModule([], "ANY"), true);
});

test("primary role: first chosen, can be changed, removal promotes the next", () => {
  let sel = applySelect([], ["o"]);
  sel = applySelect(sel, ["o", "s"]);
  assert.deepEqual(sel, ["o", "s"]);
  assert.equal(primaryOf(sel), "o");
  // MUI may hand the values back in another order: kept roles stay in place
  assert.deepEqual(applySelect(["o", "s"], ["s", "o", "a"]), ["o", "s", "a"]);
  sel = makePrimary(sel, "s");
  assert.deepEqual(sel, ["s", "o"]);
  assert.deepEqual(makePrimary(sel, "zzz"), sel);
  sel = removeRole(sel, "s");
  assert.equal(primaryOf(sel), "o");
  assert.equal(primaryOf([]), null);
});

test("selection from the users list puts the primary first", () => {
  const user = { roles: [{ id: "a" }, { id: "b" }], primaryRoleId: "b" };
  assert.deepEqual(selectionFromUser(user), ["b", "a"]);
  assert.deepEqual(selectionFromUser({ roles: [{ id: "a" }, { id: "b" }] }), ["a", "b"]);
  assert.deepEqual(selectionFromUser(null), []);
});

test("payload: primaryRoleId only on multi-role orgs", () => {
  assert.deepEqual(rolePayload(["b", "a"], true), { roleIds: ["b", "a"], primaryRoleId: "b" });
  assert.deepEqual(rolePayload(["b", "a"], false), { roleIds: ["b", "a"] });
  assert.deepEqual(rolePayload([], true), { roleIds: [] });
});

test("picker: preset orgs pick one role unless multi-role is on; other orgs unchanged", () => {
  assert.equal(singleRolePicker(true, false), true);
  assert.equal(singleRolePicker(true, true), false);
  assert.equal(singleRolePicker(false, false), false);
});

test("Edit / Add User: subtitle + WhatsApp help gated on the setting; off = today's markup", () => {
  const edit = read("app/portal/user-management/users/components/EditUser.tsx");
  assert.match(edit, /\{!isMultiRoleEnabled && \(\s*<Typography[^>]*>\s*\{t\("editSub"\)\}/);
  assert.match(edit, /helperText=\{isMultiRoleEnabled \? undefined : t\("whatsappHelp"\)\}/);
  assert.match(edit, /<Tooltip title=\{t\("whatsappHelp"\)\}>/);
  assert.match(edit, /rolePayload\(selectedRoles, isMultiRoleEnabled\)/);
  const add = read("app/portal/user-management/users/components/AddUser.tsx");
  assert.match(add, /\.\.\.rolePayload\(selectedRoles, isMultiRoleEnabled\)/);
  assert.match(add, /multiple=\{!single\}/);
  const legacy = read("app/portal/admin/users/components/EditUser.tsx");
  assert.match(legacy, /\{!isMultiRoleEnabled && \(/);
  const feats = read("app/portal/hooks/useOrganizationFeatures.ts");
  assert.match(feats, /isMultiRoleEnabled: features\.enableMultiRole === true/);
  for (const lang of ["en", "ja"]) {
    const j = JSON.parse(read(`i18n/messages/${lang}/users.json`));
    assert.ok(j.form.primary && j.form.makePrimary, lang);
  }
});
