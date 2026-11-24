// New job form (WCT group, 2026-11-23): every field is on the form, and none waits on the Quotation list.
// Fails if a field goes missing from the form or gets gated on another request again.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const dialog = read("components/Dashboard/jobs-calendar/QuickJobDialog.tsx");
const style = read("components/Dashboard/jobs-calendar/JobStyleFields.tsx");

test("every New job field of the WCT group is on the form", () => {
  assert.ok(dialog.includes('label={wctForm ? "Company" : "Customer"}'), "the WCT form calls the customer Company");
  for (const label of ["Organisation", "Quotation", "Job category", "Job title", "Site / address", "Date", "Time", "Duration", "No specific time", "Assigned workers", "Remarks", "PTW"]) {
    assert.ok(dialog.includes(`label="${label}"`), `New job is missing "${label}"`);
  }
  for (const label of ["Salesperson", "COD", "Generate sticker", "Team / crew", "PTW applicant"]) {
    assert.ok(style.includes(`label="${label}"`), `New job is missing "${label}"`);
  }
  assert.match(dialog, /<JobStyleFields/);
});

test("Company, Job category and the people fields show at once for the WCT group (no wait on any list)", () => {
  // The WCT group form = calendar style orgs (pending while the people load, or loaded and on).
  assert.match(dialog, /const wctForm = people\.pending \|\| people\.enabled;/);
  assert.match(dialog, /\{!companies && wctForm && <TextField label="Organisation"/);
  assert.match(dialog, /\{!categoryDef && !categoryLoaded && wctForm && <TextField required label="Job category"/);
  assert.match(dialog, /\{wctForm && form\.style && \(\s*<JobStyleFields/);
  // The style block starts filled while the people load.
  assert.match(dialog, /if \(!open \|\| editId \|\| !people\.pending\) return;/);
  assert.match(read("components/Dashboard/jobs-calendar/calendarAddApi.ts"), /pending: !state\.loaded/);
  // No field is rendered only after the quotation list: the Quotation field is its own component.
  const form = dialog.slice(dialog.indexOf("form={"), dialog.indexOf("function blank("));
  assert.ok(!/options\.length\s*&&/.test(form));
});

test("Quotation: a server search, 300 ms after typing, max 20, only the list fields", () => {
  assert.match(dialog, /\}, 300\);/);
  const helper = read("helpers/quickJobQuotation.ts");
  assert.match(helper, /limit = 20/);
  assert.match(helper, /\/deliveries\/quick-job\/quotations\?/);
});
