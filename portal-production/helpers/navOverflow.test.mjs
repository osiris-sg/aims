// Top bar tabs that overflow (WCT round 12): arrows over a soft fade, only on a side with hidden tabs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { overflowSides, scrollStep } from "./navOverflow.ts";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("arrows only on the side with hidden tabs; none when everything fits", () => {
  assert.deepEqual(overflowSides(0, 800, 800), { left: false, right: false });
  assert.deepEqual(overflowSides(0, 800, 800.5), { left: false, right: false });
  assert.deepEqual(overflowSides(0, 600, 1200), { left: false, right: true });
  assert.deepEqual(overflowSides(300, 600, 1200), { left: true, right: true });
  assert.deepEqual(overflowSides(600, 600, 1200), { left: true, right: false });
  assert.deepEqual(overflowSides(599.5, 600, 1200), { left: true, right: false });
});

test("one press scrolls most of the visible width", () => {
  assert.equal(scrollStep(600), 420);
  assert.equal(scrollStep(100), 120);
});

test("both bars use the scroller; the role-home bar scrolls its modules row and its sub-tabs", () => {
  // The 2026-11-12 two-level bar ([⌂] Module | tabs) was retired on 2026-11-21 when
  // the dropdowns came back, so there is no role-nav-home to order against any more.
  // Both of the role-home bar's rows still scroll: the modules row, and the sub-tabs
  // shown inline when a module is the only one the user can see.
  const role = read("app/portal/components/RoleHome/RoleTopBar.tsx");
  assert.doesNotMatch(role, /maskImage/);
  assert.doesNotMatch(role, /data-testid="role-nav-home"/);
  assert.match(role, /<NavTabsScroller[^>]*>\s*\{only\.tabs\.map/);
  assert.match(role, /<NavTabsScroller[^>]*>\s*\{bars\.map/);
  const dark = read("components/TopNav/TopNavBar.tsx");
  assert.match(dark, /<NavTabsScroller fade="#041627" arrowColor="#FFFFFF" testId="top-nav-scroller">/);
  const sc = read("components/TopNav/NavTabsScroller.tsx");
  assert.match(sc, /opacity: show \? 1 : 0/);
  assert.match(sc, /pointerEvents: show \? "auto" : "none"/);
});
