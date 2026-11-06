// Run: npm test. Round BL: the AIMEE side panel's suggested questions (static, per step / email / dashboard), its header
// line ("#18-1 · Step 7"), and every suggestion key present in both catalogs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { contextLabel, STEP_SUGGESTIONS, suggestionKeys } from "../app/portal/shipments/_components/aimee/suggestions.ts";

const en = JSON.parse(readFileSync(new URL("../i18n/messages/en/aimee.json", import.meta.url), "utf8"));
const ja = JSON.parse(readFileSync(new URL("../i18n/messages/ja/aimee.json", import.meta.url), "utf8"));
const fmt = (cat) => (k, v = {}) => Object.entries(v).reduce((s, [a, b]) => s.replace(`{${a}}`, b), cat.dock[k]);

test("step 7 asks about the tax and the CIF first, then next / overdue / show me how", () => {
  assert.deepEqual(suggestionKeys({ orderId: "o", shipmentId: "s", step: { code: "CUSTOMS_TAX_ESTIMATE" } }), ["CUSTOMS_TAX_ESTIMATE_1", "CUSTOMS_TAX_ESTIMATE_2", "next", "overdue", "showHow"]);
  assert.deepEqual(suggestionKeys({ orderId: "o", step: { code: "BL_DRAFT_APPROVAL" } }).slice(0, 1), ["BL_DRAFT_APPROVAL_1"]);
  assert.equal(en.suggest.CUSTOMS_TAX_ESTIMATE_1, "How is this import tax calculated?");
  assert.equal(en.suggest.BL_DRAFT_APPROVAL_1, "What's missing on this B/L?");
});

test("an email card asks which shipment it is; the dashboard and a step without its own questions have defaults", () => {
  assert.deepEqual(suggestionKeys({ email: { id: "e" }, orderId: "o" }), ["email_1", "email_2", "email_3"]);
  assert.equal(en.suggest.email_1, "Which shipment is this?");
  assert.deepEqual(suggestionKeys(null), ["dash_1", "dash_2", "dash_3"]);
  assert.deepEqual(suggestionKeys({ orderId: "o", step: { code: "CHECK_CONTRACT" } }), ["order_1", "next", "overdue", "showHow"]);
});

test("every suggestion key exists in English and Japanese", () => {
  const keys = new Set(["next", "overdue", "showHow", "showHowPrompt", "email_1", "email_2", "email_3", "dash_1", "dash_2", "dash_3", "order_1", "order_2"]);
  for (const [code, n] of Object.entries(STEP_SUGGESTIONS)) for (let i = 1; i <= n; i++) keys.add(`${code}_${i}`);
  for (const k of keys) {
    assert.ok(en.suggest[k], `en ${k}`);
    assert.ok(ja.suggest[k], `ja ${k}`);
  }
});

test("the header line names the record and the open step, in both languages", () => {
  assert.equal(contextLabel({ ref: "#18-1", step: { no: "7" } }, fmt(en)), "#18-1 · Step 7");
  assert.equal(contextLabel({ ref: "#18-1", step: { no: "7" } }, fmt(ja)), "#18-1 · ステップ7");
  assert.equal(contextLabel({ ref: "#18", step: { no: null, title: "Check contract" } }, fmt(en)), "#18 · Check contract");
  assert.equal(contextLabel({ email: { subject: "B/L draft 198GX06522" } }, fmt(en)), "Email · B/L draft 198GX06522");
  assert.equal(contextLabel({ view: "Dashboard" }, fmt(ja)), "ダッシュボード");
  assert.equal(contextLabel(null, fmt(en)), "Shipments");
});
