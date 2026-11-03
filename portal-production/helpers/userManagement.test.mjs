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
    for (const s of [u.form.noEmailPh, u.list.noEmail, u.addUser.intro, u.addUser.done, a.activity.unnamedUser]) {
      assert.ok(s && s.length, l);
      assert.doesNotMatch(s, /[–—]/, `${l}: ${s}`);
    }
  }
  assert.equal(json("i18n/messages/en/users.json").addUser.done, "Added. They'll get an email to set their password, or can sign in with Google/phone if set up.");
  assert.doesNotMatch(read("app/set-password/page.tsx"), /[–—]/);
});
