// Role preview ("Viewing as" a role, 2026-11-25): helpers/rolePreview.ts + wiring.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { previewableRoles, readRolePreview, rolePreviewFor, startRolePreview, stopRolePreview } from "./rolePreview.ts";

const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };

test("start, read, stop", () => {
  const s = mem();
  assert.equal(readRolePreview(s), null);
  startRolePreview({ orgId: "o1", roleId: "r1", name: "Salesperson" }, s);
  assert.deepEqual(readRolePreview(s), { orgId: "o1", roleId: "r1", name: "Salesperson" });
  assert.equal(rolePreviewFor("o2", s), null);
  assert.equal(rolePreviewFor("o1", s)?.roleId, "r1");
  stopRolePreview(s);
  assert.equal(readRolePreview(s), null);
});

test("lists the org's roles by name, custom ones included, platform roles left out", () => {
  assert.deepEqual(
    previewableRoles([{ id: "a", name: "Technician" }, { id: "b", name: "superadmin" }, { id: "c", name: "Salesperson" }, { id: "d", name: "" }]).map((r) => r.name),
    ["Salesperson", "Technician"],
  );
});

test("wired: the permissions hook reads the preview, the profile menu offers it", () => {
  const hook = readFileSync(new URL("../app/portal/hooks/useUserPermissions.ts", import.meta.url), "utf8");
  assert.match(hook, /\/roles\/\$\{encodeURIComponent\(preview\.roleId\)\}\/preview/);
  const bar = readFileSync(new URL("../app/portal/components/RoleHome/RoleTopBar.tsx", import.meta.url), "utf8");
  assert.match(bar, /Menus as role/);
  assert.match(bar, /Back to my own menus/);
});
