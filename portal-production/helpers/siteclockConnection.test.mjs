// Run: npm test (node --test, Node's built-in TypeScript stripping).
// 2026-10-30: Admin → organisation → SiteClock tab — a failed save must surface the server's message, never look saved.
import { test } from "node:test";
import assert from "node:assert/strict";
import { unwrap, isConn, keyStoredLabel, secretsMissing, testResultText } from "../app/portal/admin/organizations/_lib/siteclock-connection.ts";

const conn = { connected: true, secretsReady: true, baseUrl: "https://api.siteclock.osiris.sg", siteclockCompanyId: "cmv0", apiKeyLast4: "u0XK", enabled: true, defaultDurationMin: 60 };

test("unwrap returns the data of a success envelope", () => {
  assert.deepEqual(unwrap({ success: true, data: conn, message: "Action Succeeded" }), conn);
});

test("unwrap throws the server's message for what request() returns on a 400 (it never throws itself)", () => {
  assert.throws(() => unwrap({ success: false, message: "SiteClock company id is required" }), /SiteClock company id is required/);
  assert.throws(() => unwrap({ success: false, message: "x", details: { message: ["a", "b"] } }), /a\. b/);
  assert.throws(() => unwrap({ success: false }, "Save failed"), /Save failed/);
  assert.throws(() => unwrap(undefined, "Save failed"), /Save failed/);
});

test("the old bug: an error object is not a connection, so it can never fill the form", () => {
  const failed = { success: false, message: "That does not look like a SiteClock API key (sck_live_…)" };
  assert.equal(isConn(failed?.data ?? failed), false);
  assert.equal(isConn(conn), true);
  // and the warning only shows when the server says secrets are missing
  assert.equal(secretsMissing(failed), false);
  assert.equal(secretsMissing({ connected: false, secretsReady: false }), true);
  assert.equal(secretsMissing(conn), false);
});

test("key stored label shows the last 4 only once a key is saved", () => {
  assert.equal(keyStoredLabel(conn), "Key stored (…u0XK)");
  assert.equal(keyStoredLabel({ connected: false, secretsReady: true }), null);
});

test("test connection: teams count or the error", () => {
  assert.deepEqual(testResultText({ ok: true, teams: 3 }), { ok: true, text: "Connected: 3 teams in SiteClock" });
  assert.deepEqual(testResultText({ ok: true, teams: 1 }), { ok: true, text: "Connected: 1 team in SiteClock" });
  assert.deepEqual(testResultText({ ok: false, error: "401 invalid key" }), { ok: false, text: "SiteClock said: 401 invalid key" });
});
