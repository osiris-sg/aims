// Stepped schedule (enableScheduleWizard, Biofuel #122): typed line vs catalog product.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { matchTypedLine, typedLineQueries } from "../app/portal/deliveries/_components/typedLineMatch.ts";

const LION375 = { id: "a-375", name: "LION375", skuKey: "LION375" };
const LION250 = { id: "a-250", name: "LION250", skuKey: "LION250" };
const GEN_A = { id: "g-a", name: "Generator", skuKey: "GEN-A" };
const GEN_B = { id: "g-b", name: "Generator", skuKey: "GEN-B" };
const CABLE_DRUM = { id: "c-1", name: "Cable drum 50m", skuKey: "CD50" };

test("exact name/code (case-insensitive, trimmed) auto-links", () => {
  assert.deepEqual(matchTypedLine("  lion375 ", [LION375, LION250]), { kind: "exact", product: LION375 });
  assert.deepEqual(matchTypedLine("gen-b", [GEN_A, GEN_B]), { kind: "exact", product: GEN_B });
});

test("no match stays typed", () => {
  assert.deepEqual(matchTypedLine("60 es DG", [LION375, CABLE_DRUM]), { kind: "none" });
  assert.deepEqual(matchTypedLine("25mm 5 core cable 10 meter", [LION375, LION250]), { kind: "none" });
});

test("2+ exact matches ask to pick, no auto-link", () => {
  assert.deepEqual(matchTypedLine("Generator", [GEN_A, GEN_B]), { kind: "pick", candidates: [GEN_A, GEN_B] });
});

test("near match asks to pick", () => {
  assert.equal(matchTypedLine("LION375 BESS", [LION375, LION250]).kind, "pick");
  assert.deepEqual(matchTypedLine("LION 375", [LION375, LION250]), { kind: "pick", candidates: [LION375] });
});

test("search words for near matches", () => {
  assert.deepEqual(typedLineQueries("LION375 BESS"), ["LION375 BESS", "LION375", "BESS"]);
  assert.deepEqual(typedLineQueries("  "), []);
});

test("dialog: gated on enableScheduleWizard, not on drafts; prompt offers Keep as typed", () => {
  const src = readFileSync(new URL("../app/portal/deliveries/_components/ScheduleDeliveryDialog.tsx", import.meta.url), "utf8");
  assert.match(src, /if \(isScheduleWizardEnabled && !asDraft\)/);
  assert.match(src, /items: sendRows\.map/);
  assert.match(src, /Pick the product for "/);
  assert.match(src, /Keep as typed/);
});
