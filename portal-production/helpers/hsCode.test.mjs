// Run: npm test. Round BJ: HS code warning (#18-1 typed 7201.60, product 7601.20) and the "B/L: … · Use this" comparison.
import { test } from "node:test";
import assert from "node:assert/strict";
import { hsDiffers, normHs, sameFieldValue } from "../app/portal/shipments/_lib/hs.ts";

test("HS codes compare at 6 digits", () => {
  assert.equal(normHs("76012000"), "7601.20");
  assert.equal(normHs(" 7601.20.00 "), "7601.20");
  assert.equal(normHs(""), null);
  assert.equal(hsDiffers("7201.60", "7601.20"), true);
  assert.equal(hsDiffers("7601.20", "76012000"), false);
  assert.equal(hsDiffers("", "7601.20"), false);
});

test("a B/L value equal to the field (case, spacing, PORT, numbers) is not offered", () => {
  assert.equal(sameFieldValue("VISAKHAPATNAM PORT, INDIA", "Visakhapatnam, India"), true);
  assert.equal(sameFieldValue("183.693", "183.6930"), true);
  assert.equal(sameFieldValue("YOKOHAMA, JAPAN", "Yokohama"), false);
  assert.equal(sameFieldValue("9", "8"), false);
});
