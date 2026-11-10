import { test } from "node:test";
import assert from "node:assert/strict";
import { unpaidText } from "@/app/portal/shipments/_lib/unpaidText";

test("Unpaid reasons / notes: English as is, Japanese piece by piece", () => {
  assert.equal(unpaidText("step 6 not done · a CI payment proof is filed — check step 6", "en"), "step 6 not done · a CI payment proof is filed — check step 6");
  assert.equal(unpaidText("step 6 not done · a CI payment proof is filed — check step 6", "ja"), "ステップ6未完了 · CI支払証憑あり — ステップ6を確認");
  assert.equal(unpaidText("invoice 2FMEJAEF0204 · step 12 not done (#15-1, #16-1)", "ja"), "請求書 2FMEJAEF0204 · ステップ12未完了（#15-1, #16-1）");
  assert.equal(unpaidText("step 2 not done (no receipt recorded)", "ja"), "ステップ2未完了（入金記録なし）");
  assert.equal(unpaidText("CI 551,667.12 − deposit paid 54,901.50", "ja"), "CI 551,667.12 − 支払済み前払金 54,901.50");
  assert.equal(unpaidText("paid with Invoice 202611_01", "ja"), "Invoice 202611_01 と合算");
  assert.equal(unpaidText("something new", "ja"), "something new");
  assert.equal(unpaidText(null, "ja"), "");
});
