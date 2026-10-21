// Run: npm test (node --test, Node's built-in TypeScript stripping).
// Round Q UI trims: short customer names, "Free days left" wording, the inbox row text.
import { test } from "node:test";
import assert from "node:assert/strict";
import { shortCustomer } from "../app/portal/shipments/_lib/format.ts";
import { freeDays } from "../app/portal/shipments/_lib/free-days.ts";
import { threadCounts, whatHappens } from "../app/portal/shipments/_lib/inbox-threads.ts";

test("customer short names in lists: Kato / SUS / Hoei, company-form suffixes dropped otherwise", () => {
  assert.equal(shortCustomer("Kato Light Metal Industry Co., Ltd."), "Kato");
  assert.equal(shortCustomer("加藤軽金属工業株式会社"), "Kato");
  assert.equal(shortCustomer("SUS Co., Ltd."), "SUS");
  assert.equal(shortCustomer("Houei"), "Hoei");
  assert.equal(shortCustomer("Vedanta Aluminium Metal Limited"), "Vedanta Aluminium Metal");
  assert.equal(shortCustomer(null), null);
});

test('"Free days left": starts on arrival in transit; "Container 12d · Port 18d" once arrived; red at ≤ 3 days; "over" past the end', () => {
  assert.deepEqual(freeDays({ tab: "in_transit", freeTime: null }).text, "starts on arrival");
  assert.equal(freeDays({ tab: "in_transit", freeTime: null }).tone, "pending");
  const arrived = freeDays({ tab: "arrived", freeTime: { from: "discharge", det: { ends: "2026-11-02", daysLeft: 12 }, dem: { ends: "2026-11-08", daysLeft: 18 } } });
  assert.equal(arrived.text, "Container 12d · Port 18d");
  assert.equal(arrived.tone, "normal");
  assert.match(arrived.title, /detention/);
  assert.equal(freeDays({ tab: "arrived", freeTime: { from: "eta", det: { ends: "x", daysLeft: 3 }, dem: { ends: "y", daysLeft: 9 } } }).tone, "warn");
  const over = freeDays({ tab: "arrived", freeTime: { from: "eta", det: { ends: "x", daysLeft: -2 }, dem: { ends: "y", daysLeft: 4 } } });
  assert.equal(over.text, "Container 2d over · Port 4d");
  assert.equal(over.tone, "over");
});

test("inbox row text: counts and what happens stay one line each", () => {
  assert.equal(threadCounts(4, 4), "4 emails · 4 files");
  assert.equal(whatHappens({ linked: null, done: [] }), "no order picked yet");
});
