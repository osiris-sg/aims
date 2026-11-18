// Run: npm test (node --test). Module home page box: full width only with a block under the tiles.
import { test } from "node:test";
import assert from "node:assert/strict";
import { moduleHomeBoxSx } from "./moduleHome.ts";

test("no block under the tiles (every module home without the jobs calendar): exactly as before", () => {
  assert.deepEqual(moduleHomeBoxSx(false), { p: { xs: 2, md: 3 }, maxWidth: 1440, mx: "auto" });
});

test("a block under the tiles (Sales + jobs calendar): one fixed width whatever the calendar view", () => {
  const sx = moduleHomeBoxSx(true);
  assert.equal(sx.width, "100%");
  assert.equal(sx.boxSizing, "border-box");
  assert.equal(sx.maxWidth, 1440);
  assert.equal(sx.mx, "auto");
});
