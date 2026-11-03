// Several service reports at once: helpers/serviceReportFiles.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { serviceReportFileBase, savedMessage, serviceReportsZipName } from "./serviceReportFiles.ts";

test("serviceReportFileBase: number, customer without the company tail, service date", () => {
  const r = { id: "abcdef123", reportNumber: 145, serviceData: { customerName: "Capital Cranes Global Pte Ltd", serviceDate: "2026-11-03" } };
  assert.equal(serviceReportFileBase(r), "Service report #145 Capital Cranes Global 2026-11-03");
  assert.equal(
    serviceReportFileBase({ ...r, serviceData: { customerName: "A/B Marine Pte. Ltd." }, signedAt: "2026-11-02T17:30:00Z" }),
    "Service report #145 A B Marine 2026-11-03",
  );
  assert.equal(serviceReportFileBase({ id: "abcdef123", reportNumber: null, serviceData: null, createdAt: "2026-11-01T02:00:00Z" }), "Service report abcdef12 2026-11-01");
});

test("savedMessage: one line, names what failed", () => {
  assert.equal(savedMessage(12, 12, []), "12 reports saved to Downloads");
  assert.equal(savedMessage(1, 1, []), "1 report saved to Downloads");
  assert.equal(savedMessage(10, 12, ["#140", "#141"]), "10 of 12 reports saved to Downloads. Could not save #140, #141");
  assert.equal(savedMessage(0, 1, ["#140"]), "Could not save #140");
});

test("serviceReportsZipName: Singapore date and count", () => {
  assert.equal(serviceReportsZipName(12, new Date("2026-11-02T17:30:00Z")), "Service reports 2026-11-03 (12).zip");
});
