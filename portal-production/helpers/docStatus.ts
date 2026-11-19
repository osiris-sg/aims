// Document display status (moved from components/StatusChip.tsx, 2026-11-17, so it is unit-tested;
// StatusChip re-exports it). One rule added: an invoice voided with its cancelled order
// (manual order flow: config.voided + cancelledWithOrder, api orders/order-cancel.ts) reads "voided".
// Every other document reads exactly as before (helpers/docStatus.test.mjs).

const num = (v: any): number | null => {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// Money stamped on the document by the server after every payment
// (common/document-money.ts: canonical paidToDate / outstandingBalance,
// legacy xeroAmountPaid / xeroBalance twins).
export const docPaidOf = (config: any): number | null => num(config?.paidToDate) ?? num(config?.xeroAmountPaid);
export const docOutstandingOf = (config: any): number | null => num(config?.outstandingBalance) ?? num(config?.xeroBalance);

// A partly paid invoice stays `pending_payment` in the database (there is no
// such enum value); what makes it "partially paid" is money stamped on it:
// something paid AND something still owed. Derive the display status here so
// every list reads the same (guru 2026-11-06, BIPL-JPSG-20260929-0002: a part
// payment showed as plain "Awaiting Payment").
export const PARTIALLY_PAID = "partially_paid";
// An invoice is never "Confirmed" (guru 2026-11-14): once confirmed it is
// AWAITING PAYMENT until it is paid. Rows that still carry the generic
// `confirmed` status (imported books) read as Awaiting Payment here, and the
// same rule drives the list filters.
const INVOICE_TYPES = new Set(["INVOICE", "TI", "TI2"]);
export const isInvoiceType = (t?: string | null) => INVOICE_TYPES.has(String(t || "").toUpperCase());
// WCT group (Elroy 2026-11-19, same rule as the API's common/erp-import.ts): an imported quotation the ERP still
// has open (Draft / Sent) reads as Unconfirmed with an "ERP draft" / "ERP sent" tag; one open at import that the
// ERP cancelled since reads as Cancelled. Display only: the stored status stays confirmed (locked).
const QUOTE_TYPES = new Set(["QUOTATION", "QO", "QT", "QO1"]);
const ERP_OPEN = new Set(["draft", "sent"]);
const ERP_CANCELLED = new Set(["cancelled", "canceled", "declined", "rejected", "lost", "void", "voided"]);
export function erpQuotationDisplayStatus(type: string | null | undefined, config: any): "unconfirmed" | "cancelled" | null {
  const m = config?.erpImport;
  if (!m || m.source !== "wct-erp" || !QUOTE_TYPES.has(String(type || "").toUpperCase())) return null;
  const st = String(m.status ?? "").trim().toLowerCase();
  if (ERP_OPEN.has(st)) return "unconfirmed";
  if (ERP_CANCELLED.has(st) && ERP_OPEN.has(String(m.statusAtFirstImport ?? "").trim().toLowerCase())) return "cancelled";
  return null;
}
export const erpQuotationTag = (type: string | null | undefined, config: any): string | null =>
  erpQuotationDisplayStatus(type, config) === "unconfirmed" ? `ERP ${String(config?.erpImport?.status ?? "").trim().toLowerCase()}` : null;

export function docDisplayStatus(doc: { status?: string | null; config?: any; type?: string | null } | null | undefined): string {
  const erpQuote = erpQuotationDisplayStatus(doc?.type, doc?.config);
  if (erpQuote) return erpQuote;
  let s = (doc?.status || "unconfirmed").toLowerCase();
  if (s === "confirmed" && isInvoiceType(doc?.type)) s = "pending_payment";
  if (["paid", "cancelled", "voided", "returned"].includes(s)) return s;
  const c = doc?.config || {};
  if (c.voided && c.cancelledWithOrder === true) return "voided";
  if (c.voided) return s;
  const paid = docPaidOf(c);
  const outstanding = docOutstandingOf(c);
  if (paid !== null && paid > 0.005 && outstanding !== null && outstanding > 0.005) return PARTIALLY_PAID;
  return s;
}


/** An invoice voided with its cancelled order (manual order flow). */
export const isVoidedWithOrder = (config: any): boolean => config?.voided === true && config?.cancelledWithOrder === true;
