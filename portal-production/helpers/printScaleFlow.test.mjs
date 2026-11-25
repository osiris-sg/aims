// Biofuel DO print (DO202611114, 2026-11-25): the flow layout prints full width
// across pages instead of 0.7 in the corner that still spilled.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  DEFAULT_FIT_POLICY,
  FLOW_FIT_POLICY,
  computeFitScale,
  fitPolicyFor,
  fitToPageCss,
  planFitScale,
} from "../lib/printScale.ts";

const el = (flow) => ({ matches: (s) => flow && s === '[data-do-layout="biofuel"]', querySelector: () => null });

test("default policy is unchanged (other orgs): floor 0.7, top left", () => {
  assert.equal(planFitScale(470.7, 285, DEFAULT_FIT_POLICY), 0.7);
  assert.equal(planFitScale(470.7, 285), computeFitScale(470.7, 285));
  assert.equal(planFitScale(300, 285), computeFitScale(300, 285));
  assert.equal(planFitScale(200, 285), 1);
  assert.match(fitToPageCss("[x]", 0.7, 470.7), /transform-origin: top left/);
});

test("flow layout: DO202611114 (470.7mm) is not shrunk, it flows across pages", () => {
  assert.equal(planFitScale(470.7, 285, FLOW_FIT_POLICY), 1);
  assert.equal(planFitScale(402.4, 285, FLOW_FIT_POLICY), 1);
});

test("flow layout: a slightly long DO shrinks mildly and centred", () => {
  assert.equal(planFitScale(300, 285, FLOW_FIT_POLICY), 0.95);
  assert.equal(planFitScale(316, 285, FLOW_FIT_POLICY), 0.901);
  assert.equal(planFitScale(318, 285, FLOW_FIT_POLICY), 1);
  assert.match(fitToPageCss("[x]", 0.95, 300, FLOW_FIT_POLICY.origin), /transform-origin: top center/);
});

test("fitPolicyFor picks the flow policy only for the marked sheet", () => {
  assert.equal(fitPolicyFor(el(true)), FLOW_FIT_POLICY);
  assert.equal(fitPolicyFor(el(false)), DEFAULT_FIT_POLICY);
  assert.equal(fitPolicyFor(null), DEFAULT_FIT_POLICY);
  const parent = { matches: () => false, querySelector: (s) => (s === '[data-do-layout="biofuel"]' ? {} : null) };
  assert.equal(fitPolicyFor(parent), FLOW_FIT_POLICY);
});

test("the Biofuel DO sheet is marked and prints photos six to a row", () => {
  const src = readFileSync(new URL("../containers/DocumentTemplates/components/CleanDocumentPreview.tsx", import.meta.url), "utf8");
  assert.match(src, /data-do-layout=\{isBiofuel \? "biofuel" : undefined\}/);
  assert.match(src, /"@media print": \{ width: "15\.5%" \}/);
});
