// Run: npm test. 2026-11-13: the order page opens the Service Reports page's flows, customer + DO prefilled.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readServiceReportFlow, serviceReportFlowHref } from "./serviceReportFlow.ts";

const prefill = { customer: { id: "c1", name: "Domino's Pizza & Co" }, doId: "d1" };

test("Create new: the New Report flow with the customer + DO", () => {
  const href = serviceReportFlowHref("new", prefill);
  assert.ok(href.startsWith("/portal/maintenance-reports?"));
  assert.deepEqual(readServiceReportFlow(href.split("?")[1]), { mode: "new", ...prefill });
});
test("Upload file: the upload flow with the customer + DO", () => {
  assert.deepEqual(readServiceReportFlow(serviceReportFlowHref("upload", prefill).split("?")[1]), { mode: "upload", ...prefill });
});
test("no customer / DO known: the flow opens empty", () => {
  assert.deepEqual(readServiceReportFlow(serviceReportFlowHref("new", { customer: null, doId: null }).split("?")[1]), { mode: "new", customer: null, doId: null });
});
test("a plain visit to the list opens nothing", () => {
  assert.equal(readServiceReportFlow(""), null);
  assert.equal(readServiceReportFlow("?page=2"), null);
});
