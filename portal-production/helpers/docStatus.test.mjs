// Run: npm test. 2026-11-17: invoices voided with a cancelled order read "Voided"; every other document as before.
import { test } from "node:test";
import assert from "node:assert/strict";
import { docDisplayStatus, isVoidedWithOrder } from "./docStatus.ts";
import { invoiceStatusOptions, INVOICE_STATUS_BASE } from "./invoiceStatusOptions.ts";
import { splitButtons } from "./invoiceSplit.ts";

// The function as it was before (components/StatusChip.tsx at af2ad41b), to prove no change for any other document.
const num = (v) => (v === undefined || v === null || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);
function before(doc) {
  let s = (doc?.status || "unconfirmed").toLowerCase();
  if (s === "confirmed" && ["INVOICE", "TI", "TI2"].includes(String(doc?.type || "").toUpperCase())) s = "pending_payment";
  if (["paid", "cancelled", "voided", "returned"].includes(s)) return s;
  const c = doc?.config || {};
  if (c.voided) return s;
  const paid = num(c.paidToDate) ?? num(c.xeroAmountPaid);
  const out = num(c.outstandingBalance) ?? num(c.xeroBalance);
  if (paid !== null && paid > 0.005 && out !== null && out > 0.005) return "partially_paid";
  return s;
}

const DOCS = [
  null,
  {},
  { status: "unconfirmed", type: "INVOICE" },
  { status: "draft", type: "INVOICE", config: {} },
  { status: "confirmed", type: "INVOICE" },
  { status: "confirmed", type: "QUOTATION" },
  { status: "pending_payment", type: "INVOICE", config: { paidToDate: 10, outstandingBalance: 5 } },
  { status: "pending_payment", type: "INVOICE", config: { xeroAmountPaid: 10, xeroBalance: 0 } },
  { status: "paid", type: "INVOICE", config: { voided: true } },
  // Biofuel-style voided invoices (81 on prod, config.voided without the order marker): unchanged.
  { status: "pending_payment", type: "INVOICE", config: { voided: true, paidToDate: 1, outstandingBalance: 1 } },
  { status: "unconfirmed", type: "INVOICE", config: { voided: true } },
  { status: "delivered_installed", type: "DELIVERY_ORDER", config: { cancelled: true } },
  { status: "returned", type: "RDO" },
];

test("every document without the order-cancel marker reads exactly as before", () => {
  for (const d of DOCS) assert.equal(docDisplayStatus(d), before(d), JSON.stringify(d));
});

test("an invoice voided with its cancelled order reads Voided", () => {
  const d = { status: "unconfirmed", type: "INVOICE", config: { voided: true, cancelledWithOrder: true } };
  assert.equal(docDisplayStatus(d), "voided");
  assert.equal(isVoidedWithOrder(d.config), true);
  assert.equal(isVoidedWithOrder({ voided: true }), false);
});

test("Status filter: the same four options for every org; Voided only on the manual order flow", () => {
  assert.deepEqual(invoiceStatusOptions(false), [
    { value: "unconfirmed", label: "Unconfirmed" },
    { value: "pending_payment", label: "Awaiting Payment" },
    { value: "partially_paid", label: "Partially Paid" },
    { value: "paid", label: "Paid" },
  ]);
  assert.equal(invoiceStatusOptions(false), INVOICE_STATUS_BASE);
  assert.deepEqual(invoiceStatusOptions(true).at(-1), { value: "voided", label: "Voided" });
});

test("no Split payment / Undo split on a voided invoice", () => {
  assert.deepEqual(splitButtons({ enabled: true, isInvoice: true, saved: true, status: "unconfirmed", config: { voided: true, cancelledWithOrder: true } }), { split: false, undo: false });
});

test("WCT imported quotations: ERP Draft / Sent read Unconfirmed with a tag; cancelled since import reads Cancelled (2026-11-19)", async () => {
  const { docDisplayStatus, erpQuotationDisplayStatus, erpQuotationTag } = await import("./docStatus.ts");
  const q = (erp, extra = {}) => ({ type: "QUOTATION", status: "confirmed", config: { erpImport: { source: "wct-erp", status: erp, ...extra } } });
  assert.equal(docDisplayStatus(q("Draft")), "unconfirmed");
  assert.equal(erpQuotationTag("QUOTATION", q("Draft").config), "ERP draft");
  assert.equal(docDisplayStatus(q("Sent")), "unconfirmed");
  assert.equal(erpQuotationTag("QUOTATION", q("Sent").config), "ERP sent");
  // The weekly run moved it on: Accepted = the stored Confirmed; Cancelled (open at import) = Cancelled.
  assert.equal(docDisplayStatus(q("Accepted", { statusAtFirstImport: "Draft" })), "confirmed");
  assert.equal(erpQuotationTag("QUOTATION", q("Accepted", { statusAtFirstImport: "Draft" }).config), null);
  assert.equal(docDisplayStatus(q("Cancelled", { statusAtFirstImport: "Sent" })), "cancelled");
  // Unchanged: imported as Declined, imported Accepted, other sources, other types, native quotations.
  assert.equal(docDisplayStatus(q("Declined")), "confirmed");
  assert.equal(docDisplayStatus(q("Accepted")), "confirmed");
  assert.equal(erpQuotationDisplayStatus("QUOTATION", { erpImport: { source: "other-erp", status: "Draft" } }), null);
  assert.equal(erpQuotationDisplayStatus("INVOICE", { erpImport: { source: "wct-erp", status: "Draft" } }), null);
  assert.equal(docDisplayStatus({ type: "QUOTATION", status: "confirmed", config: {} }), "confirmed");
  assert.equal(docDisplayStatus({ type: "QUOTATION", status: "unconfirmed", config: {} }), "unconfirmed");
});

test("round 35: an ERP Draft / Sent quotation dated more than 6 months ago reads Expired (tag kept); owner-confirmed reads Confirmed", async () => {
  const { docDisplayStatus, erpQuotationDisplayStatus, erpQuotationTag, erpDraftExpiryCut, sgTodayIso } = await import("./docStatus.ts");
  const q = (erp, date, extra = {}) => ({ type: "QUOTATION", status: "confirmed", config: { date, erpImport: { source: "wct-erp", status: erp, ...extra } } });
  const T = "2026-11-19";
  assert.equal(erpDraftExpiryCut(T), "2026-05-19");
  assert.equal(erpDraftExpiryCut("2026-08-31"), "2026-02-28");
  assert.equal(erpQuotationDisplayStatus("QUOTATION", q("Draft", "2026-05-18").config, T), "expired");
  assert.equal(erpQuotationDisplayStatus("QUOTATION", q("Draft", "2026-05-19").config, T), "unconfirmed");
  assert.equal(erpQuotationDisplayStatus("QUOTATION", q("Sent", "2019-01-01").config, T), "expired");
  assert.equal(erpQuotationTag("QUOTATION", q("Sent", "2019-01-01").config, T), "ERP sent");
  assert.equal(erpQuotationDisplayStatus("QUOTATION", q("Draft", "2019-01-01", { ownerConfirmed: { at: "x" } }).config, T), null);
  assert.equal(erpQuotationDisplayStatus("QUOTATION", q("Cancelled", "2019-01-01", { statusAtFirstImport: "Draft" }).config, T), "cancelled");
  // docDisplayStatus reads today's Singapore date: a 2017 draft is Expired, today's is Unconfirmed; native unchanged.
  assert.equal(docDisplayStatus(q("Draft", "2017-03-01")), "expired");
  assert.equal(docDisplayStatus(q("Draft", sgTodayIso())), "unconfirmed");
  assert.equal(docDisplayStatus({ type: "QUOTATION", status: "unconfirmed", config: { date: "2017-03-01" } }), "unconfirmed");
  // The chip prefers the server's reading on list rows.
  const chip = (await import("node:fs")).readFileSync(new URL("../components/StatusChip.tsx", import.meta.url), "utf8");
  assert.match(chip, /doc\.erpQuoteStatus \|\| erpQuotationDisplayStatus/);
  assert.match(chip, /expired: "default"/);
});

