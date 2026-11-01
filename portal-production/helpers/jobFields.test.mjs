// Run: npm test (node --test, Node's built-in TypeScript stripping).
// 2026-11-01: custom job fields (enableJobFields): form checks, diff, settings display block, summary.
import { test } from "node:test";
import assert from "node:assert/strict";
import { jobFieldText, jobFieldProblem, changedValues, displayFromForm, displaySummary } from "./jobFields.ts";

const permit = { id: "f1", fieldName: "permit_approved", displayLabel: "Permit approved", fieldType: "boolean", required: true };
const link = { id: "f2", fieldName: "permit_link", displayLabel: "Permit link", fieldType: "url" };

test("value text", () => {
  assert.equal(jobFieldText("boolean", true), "Yes");
  assert.equal(jobFieldText("boolean", false), "No");
  assert.equal(jobFieldText("file", { fileKey: "k", fileName: "permit.pdf" }), "permit.pdf");
  assert.equal(jobFieldText("text", null), "");
});

test("form checks: required only on a real schedule; links and dates", () => {
  assert.equal(jobFieldProblem(permit, null, { checkRequired: true }), "Permit approved is required");
  assert.equal(jobFieldProblem(permit, null, { checkRequired: false }), null);
  assert.equal(jobFieldProblem(link, "permits.gov.sg", { checkRequired: true }), "Permit link: a link starting with https://");
  assert.equal(jobFieldProblem(link, "https://permits.gov.sg/1", { checkRequired: true }), null);
});

test("only changed values go to the API; cleared ones as null", () => {
  assert.deepEqual(changedValues({ f1: true, f2: "https://a" }, { f1: true, f2: "" }), { f2: null });
  assert.deepEqual(changedValues({}, { f1: false }), { f1: false });
  assert.deepEqual(changedValues({ f1: false }, { f1: false }), {});
});

test("settings: display block per type, and its summary", () => {
  assert.deepEqual(displayFromForm("boolean", { showOnCalendar: true, icon: "verified", yesColour: "#2e7d32", noColour: "#c62828" }), { showOnCalendar: true, icon: "verified", colourByValue: { true: "#2e7d32", false: "#c62828" } });
  assert.deepEqual(displayFromForm("date", { showOnCalendar: true, icon: "event", colour: "#1565c0" }), { showOnCalendar: true, icon: "event", colour: "#1565c0" });
  assert.deepEqual(displayFromForm("boolean", { showOnCalendar: false, icon: "permit" }), { showOnCalendar: false, icon: "permit" });
  assert.equal(displaySummary({ ...permit, display: { showOnCalendar: true, colourByValue: { true: "#2e7d32", false: "#c62828" } } }), "On the calendar: green when yes, red when no");
  assert.equal(displaySummary({ ...permit, display: { showOnCalendar: false } }), "Not on the calendar");
});
