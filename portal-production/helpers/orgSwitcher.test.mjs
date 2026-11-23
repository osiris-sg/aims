// Org switcher (23 Nov): no hover tooltip for the platform admin (it covered the company list); member mode keeps its own.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../components/TopNav/TopNavBar.tsx", import.meta.url), "utf8");

test("the platform admin's switcher has no tooltip; the X back to home stays", () => {
  assert.ok(!src.includes('t("viewingAsTip"'), "the Viewing as tooltip is gone");
  assert.match(src, /<Tooltip title=\{memberMode \? t\("myOrgsTip"\) : ""\} disableHoverListener=\{!memberMode\}/);
  assert.match(src, /t\("resetTo", \{ home: realOrganization\?\.name \?\? "" \}\)/);
  assert.match(src, /onClick=\{\(\) => setActiveOrgId\(null\)\}/);
});
