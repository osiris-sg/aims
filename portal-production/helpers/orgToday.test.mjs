// Run: npm test (node --test, Node's built-in TypeScript stripping).
// 2026-11-02: default document dates follow the org time zone, not UTC.
import { test } from "node:test";
import assert from "node:assert/strict";
import { orgTimeZone, setOrgTimeZone, todayIso } from "./orgToday.ts";

test("00:00-08:00 SGT is still today in Singapore (UTC is yesterday)", () => {
  const sgt0330 = new Date("2026-11-02T03:30:00+08:00"); // 2026-11-01T19:30Z
  assert.equal(sgt0330.toISOString().slice(0, 10), "2026-11-01");
  assert.equal(todayIso(sgt0330), "2026-11-02");
  assert.equal(todayIso(new Date("2026-11-02T23:59:00+08:00")), "2026-11-02");
});

test("org time zone setting, invalid falls back to Singapore", () => {
  setOrgTimeZone("Asia/Tokyo");
  assert.equal(orgTimeZone(), "Asia/Tokyo");
  assert.equal(todayIso(new Date("2026-11-01T23:30:00+08:00")), "2026-11-02"); // 00:30 JST
  setOrgTimeZone("Not/AZone");
  assert.equal(orgTimeZone(), "Asia/Singapore");
  setOrgTimeZone(null);
  assert.equal(orgTimeZone(), "Asia/Singapore");
});
