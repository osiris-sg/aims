// User management (2026-11-03): "set your password" for new logins, Edit User's email, never a Clerk id as an email.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const json = (p) => JSON.parse(read(p));

test("the set-password page is public (the visitor arrives signed out) and signs in with the ticket", () => {
  assert.match(read("middleware.ts"), /"\/set-password\(\.\*\)"/);
  const page = read("app/set-password/page.tsx");
  assert.match(page, /strategy: "ticket"/);
  assert.match(page, /updatePassword\(/);
});

test("Edit User: email is optional (a phone-only login can be saved) and a blank one shows a placeholder", () => {
  for (const p of ["app/portal/user-management/users/components/EditUser.tsx", "app/portal/admin/users/components/EditUser.tsx"]) {
    const src = read(p);
    const emailField = src.slice(src.indexOf('name="email"'), src.indexOf('name="email"') + 600);
    assert.doesNotMatch(emailField, /required:/, p);
  }
  assert.match(read("app/portal/user-management/users/components/EditUser.tsx"), /t\("noEmailPh"\)/);
});

test("the user list shows the name and phone when there is no email; the activity log never shows a person's id", () => {
  const list = read("app/portal/user-management/users/hooks/useUserTableHeader.tsx");
  assert.match(list, /user\.email \|\| user\.name/);
  assert.match(list, /t\("noEmail"\)/);
  assert.match(read("app/portal/audit/hooks/useActivityTableHeader.tsx"), /r\.actorType === "USER" \? r\.actorEmail \|\| t\("unnamedUser"\)/);
});

test("copy: both languages have the new strings, no em or en dashes in them", () => {
  for (const l of ["en", "ja"]) {
    const u = json(`i18n/messages/${l}/users.json`);
    const a = json(`i18n/messages/${l}/audit.json`);
    for (const s of [u.form.noEmailPh, u.list.noEmail, u.form.mobile, u.form.mobileHelp, u.form.mobileInvalid, u.form.needOne, u.form.added, u.form.passwordHelp, a.activity.unnamedUser]) {
      assert.ok(s && s.length, l);
      assert.doesNotMatch(s, /[\u2013\u2014]/, `${l}: ${s}`);
    }
  }
  assert.equal(json("i18n/messages/en/users.json").form.passwordHelp, "Optional. Leave blank to let them set their own.");
  assert.doesNotMatch(read("app/set-password/page.tsx"), /[\u2013\u2014]/);
});

test("Add user is the ORIGINAL side drawer again (not a pop-up), with every old field", () => {
  const users = read("app/portal/user-management/users/components/Users.tsx");
  assert.match(users, /<AddUser open=\{openDrawer\}/);
  assert.doesNotMatch(users, /AddUserDialog/);
  const src = read("app/portal/user-management/users/components/AddUser.tsx");
  assert.match(src, /<Drawer\s+anchor="right"/);
  assert.match(src, /t\("createTitle"\)/);
  const order = ['name="firstName"', 'name="lastName"', 'name="email"', 'name="mobile"', 'name="password"', 'name="salesmanCode"', 'name="salesmanMobile"', 'id="select-roles"'];
  const at = order.map((f) => src.indexOf(f));
  assert.ok(at.every((x) => x > 0), JSON.stringify(at));
  assert.deepEqual([...at].sort((a, b) => a - b), at, "field order");
  assert.match(src, /t\(showPassword \? "hidePassword" : "showPassword"\)|showPassword \? t\("hidePassword"\) : t\("showPassword"\)/);
});

test("the drawer: email optional, mobile optional, at least one; posts to add-member and shows the server's one message", () => {
  const src = read("app/portal/user-management/users/components/AddUser.tsx");
  const emailField = src.slice(src.indexOf('name="email"'), src.indexOf('name="email"') + 400);
  assert.doesNotMatch(emailField, /required:/);
  assert.match(src, /t\("needOne"\)/);
  assert.match(src, /phone: data\.mobile\.trim\(\)/);
  assert.match(src, /toast\.success\(res\?\.data\?\.message/);
  assert.match(read("app/portal/user-management/users/hooks/useAddUser.tsx"), /path: "\/users\/members\/add-member"/);
});

test("SG mobile check in the drawer", () => {
  const re = /^(?:\+?65)?[89]\d{7}$/;
  const ok = (v) => re.test(v.replace(/[\s\-().]/g, ""));
  for (const v of ["9123 4567", "+65 8123-4567", "6591234567"]) assert.ok(ok(v), v);
  for (const v of ["6123 4567", "912345", "+60 91234567"]) assert.ok(!ok(v), v);
  assert.ok(read("app/portal/user-management/users/components/AddUser.tsx").includes("/^(?:\\+?65)?[89]\\d{7}$/"));
});

test("set-password: a login with an admin-set password replaces it through the server once", () => {
  const page = read("app/set-password/page.tsx");
  assert.match(page, /\/users\/me\/first-password/);
  assert.match(page, /setViaServer\(true\)/);
});

test("last name is optional in Add user and both Edit User drawers; first name stays required; an emptied last name is sent to clear it", () => {
  for (const p of ["app/portal/user-management/users/components/AddUser.tsx", "app/portal/user-management/users/components/EditUser.tsx", "app/portal/admin/users/components/EditUser.tsx"]) {
    const src = read(p);
    const last = src.slice(src.indexOf('name="lastName"'), src.indexOf('name="lastName"') + 300);
    const first = src.slice(src.indexOf('name="firstName"'), src.indexOf('name="firstName"') + 300);
    assert.doesNotMatch(last, /required:/, p);
    assert.match(first, /required:/, p);
  }
  for (const p of ["app/portal/user-management/users/components/EditUser.tsx", "app/portal/admin/users/components/EditUser.tsx"]) {
    assert.match(read(p), /updateData\.lastName = \(data\.lastName \|\| ""\)\.trim\(\);/, p);
  }
  assert.match(read("app/portal/user-management/users/components/EditUser.tsx"), /user\.lastName !== undefined/);
});
