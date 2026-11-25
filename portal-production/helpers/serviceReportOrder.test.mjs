// Run: node --test helpers/serviceReportOrder.test.mjs. WCT group service report flow from the order page (UAT 2026-11-25).
import { test } from "node:test";
import assert from "node:assert/strict";
import { officeEmailPrefill, orderReportDos, prePickedDoId, reportDoLabel, reportLinkPills, reportNoText } from "./serviceReportOrder.ts";

const done = { id: "d1", name: "DO202611-0007", completed: true, awaitingSignature: false, jobs: [] };
const draft = { id: "d2", name: "DO202611-0008", completed: false, awaitingSignature: false, jobs: [] };
const scheduled = { id: "d3", name: "DO202611-0009", completed: false, awaitingSignature: false, jobs: [{ isDraft: false, status: "scheduled" }] };

test("the order's DOs: made on the order, its jobs' DOs, linked DOs, once each; drafts marked", () => {
  const o = {
    deliveryOrders: [done, draft, scheduled, { id: "dx", name: "DO-X", cancelled: true }],
    jobs: [{ status: "completed", isDraft: false, deliveryOrder: { id: "d1", name: "DO202611-0007" } }, { status: "scheduled", isDraft: false, deliveryOrder: { id: "d4", name: "DO-4" } }],
    linkedDos: [{ id: "d5", name: "DO-5" }, { id: "erp:DO123", name: "DO123" }],
  };
  assert.deepEqual(orderReportDos(o), [
    { id: "d1", name: "DO202611-0007", draft: false },
    { id: "d2", name: "DO202611-0008", draft: true },
    { id: "d3", name: "DO202611-0009", draft: false },
    { id: "d4", name: "DO-4", draft: false },
    { id: "d5", name: "DO-5", draft: false },
  ]);
  assert.deepEqual(orderReportDos(null), []);
});

test("pre-pick: the only DO; never a draft on its own; several = the person picks; a clicked DO wins", () => {
  const one = orderReportDos({ deliveryOrders: [done] });
  assert.equal(prePickedDoId(one), "d1");
  // The draft "Add DO" made is never picked silently.
  assert.equal(prePickedDoId(orderReportDos({ deliveryOrders: [draft] })), null);
  const several = orderReportDos({ deliveryOrders: [done, draft] });
  assert.equal(prePickedDoId(several), null);
  assert.equal(prePickedDoId(several, "d2"), "d2");
  assert.equal(prePickedDoId(several, "not-on-order"), null);
  assert.equal(prePickedDoId([]), null);
  assert.equal(reportDoLabel({ id: "d2", name: "DO202611-0008", draft: true }), "DO202611-0008 (Draft)");
  assert.equal(reportDoLabel({ id: "d1", name: null, draft: false }), "DO");
});

test("Finish email: never the customer's email on file", () => {
  // createOffice / a job's scheduled report stamped the customer's email: not shown.
  assert.equal(officeEmailPrefill({ reportNumber: null, serviceData: { clientEmail: "acme@x.sg" } }), "");
  // Typed on the form before (saved draft): kept.
  assert.equal(officeEmailPrefill({ reportNumber: null, serviceData: { clientEmail: "acme@x.sg", draft: { clientEmail: "typed@x.sg" } } }), "typed@x.sg");
  // A reopened completed report: the address it was completed with.
  assert.equal(officeEmailPrefill({ reportNumber: 7, serviceData: { clientEmail: "sent@x.sg" } }), "sent@x.sg");
  assert.equal(officeEmailPrefill({}), "");
});

test("report numbers: SR number first, else #n (padded where the page padded), else null", () => {
  assert.equal(reportNoText({ reportNumber: 5, srNumber: "SR202611-0001" }), "SR202611-0001");
  assert.equal(reportNoText({ reportNumber: 5, serviceData: { srNumber: "SR202611-0002" } }, { pad: true }), "SR202611-0002");
  assert.equal(reportNoText({ reportNumber: 4 }, { pad: true }), "#000004");
  assert.equal(reportNoText({ reportNumber: 4 }), "#4");
  assert.equal(reportNoText({ reportNumber: null }), null);
  assert.equal(reportNoText({ reportNumber: 4, srNumber: "junk" }), "#4");
});

test("report page pills: Order, DO, Job; each with its page", () => {
  assert.deepEqual(
    reportLinkPills({ order: { id: "o1", orderNumber: "ORDW202611-001" }, links: { do: { id: "d1", name: "DO202611-0007" }, job: { id: "j1", number: 88 } } }),
    [
      { key: "order", label: "ORDW202611-001", href: "/portal/orders/o1" },
      { key: "do", label: "DO202611-0007", href: "/portal/documents/open/d1" },
      { key: "job", label: "Job #88", href: "/portal/deliveries/j1" },
    ],
  );
  assert.deepEqual(reportLinkPills({ order: null, links: null }), []);
  assert.deepEqual(reportLinkPills({ links: { do: { id: "d1", name: null }, job: null } }), [{ key: "do", label: "DO", href: "/portal/documents/open/d1" }]);
});

test("doc chain: the order's service reports get their own section (only when there are some)", async () => {
  const { chainSections } = await import("./linkDoc.ts");
  const base = { kind: "DELIVERY_ORDER", order: { id: "o", orderNumber: "ORDW202611-001", href: "/o" }, quotations: [], dos: [{ id: "d", name: "DO1", href: "/d" }], invoices: [], canCreateDo: false, canCreateInvoice: false, direct: [] };
  const s = chainSections({ ...base, reports: [{ id: "r1", name: "SR202611-0001", href: "/portal/maintenance-reports/r1" }, { id: "r2", name: null, href: "/portal/maintenance-reports/r2" }] });
  assert.deepEqual(s.at(-1), { key: "report", label: "Service reports", items: [{ id: "r1", name: "SR202611-0001", href: "/portal/maintenance-reports/r1" }, { id: "r2", name: "Draft", href: "/portal/maintenance-reports/r2" }] });
  assert.equal(chainSections({ ...base, reports: [] }).some((x) => x.key === "report"), false);
  assert.equal(chainSections(base).some((x) => x.key === "report"), false);
});
