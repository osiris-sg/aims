// Run: npm test. Round AZ: the portal language's date / number formats.
import { test } from "node:test";
import assert from "node:assert/strict";
import { formatDay, formatDate, formatMonth, formatMoney, formatShortDay, setCurrentLang, currentLang } from "../i18n/lang.ts";

test("calendar days: English 05 Oct 2026, Japanese 2026/10/05 (UTC, never shifted)", () => {
  assert.equal(formatDay("2026-10-05T00:00:00.000Z", "en"), "05 Oct 2026");
  assert.equal(formatDay("2026-10-05T00:00:00.000Z", "ja"), "2026/10/05");
  assert.equal(formatDay(null, "ja"), "—");
});
test("the current language drives the default", () => {
  setCurrentLang("ja");
  assert.equal(currentLang(), "ja");
  assert.equal(formatMonth("2026-10"), "2026年10月");
  assert.equal(formatShortDay("2026-10-05", "2026"), "10/5");
  assert.equal(formatShortDay("2025-10-05", "2026"), "2025/10/5");
  setCurrentLang("en");
  assert.equal(formatMonth("2026-10"), "Oct 2026");
  assert.equal(formatShortDay("2026-10-05", "2026"), "5 Oct");
});
test("money: 2 decimals; yen in Japanese as ¥ without decimals", () => {
  assert.equal(formatMoney(1234.5, "USD", "en"), "USD 1,234.50");
  assert.equal(formatMoney(1234.5, "JPY", "ja"), "¥1,235");
  assert.equal(formatMoney(1234.5, "JPY", "en"), "JPY 1,234.50");
  assert.equal(formatMoney(null, "USD", "ja"), "—");
  assert.ok(formatDate(new Date(2026, 9, 5), "ja") === "2026/10/05");
});
