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
// Round 35: an open one dated MORE than 6 months before today (Singapore) reads "Expired" (same tag); one the owner
// confirmed in AIMS reads as the stored Confirmed. List rows carry the server's own reading (erpQuoteStatus).
const QUOTE_TYPES = new Set(["QUOTATION", "QO", "QT", "QO1"]);
const ERP_OPEN = new Set(["draft", "sent"]);
const ERP_CANCELLED = new Set(["cancelled", "canceled", "declined", "rejected", "lost", "void", "voided"]);
export type ErpQuoteDisplay = "unconfirmed" | "expired" | "cancelled";
/** Today in Singapore (YYYY-MM-DD). */
export const sgTodayIso = (now = new Date()): string => new Date(now.getTime() + 8 * 3600e3).toISOString().slice(0, 10);
/** The first date that is not expired: today minus 6 calendar months (day clamped), as the API's erpDraftExpiryCut. */
export function erpDraftExpiryCut(today: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(today));
  if (!m) return "0000-00-00";
  let y = Number(m[1]);
  let mo = Number(m[2]) - 6;
  if (mo < 1) {
    mo += 12;
    y -= 1;
  }
  const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${y}-${pad(mo)}-${pad(Math.min(Number(m[3]), last))}`;
}
const isoDay = (v: unknown): string | null => {
  const s = typeof v === "string" ? v.trim() : "";
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  return dmy ? `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}` : null;
};
export function erpQuotationDisplayStatus(type: string | null | undefined, config: any, today: string = sgTodayIso()): ErpQuoteDisplay | null {
  const m = config?.erpImport;
  if (!m || m.source !== "wct-erp" || !QUOTE_TYPES.has(String(type || "").toUpperCase())) return null;
  const st = String(m.status ?? "").trim().toLowerCase();
  if (ERP_OPEN.has(st)) {
    if (m.ownerConfirmed) return null;
    const date = isoDay(config?.date) ?? isoDay(config?.documentInfo?.date);
    return date && date < erpDraftExpiryCut(today) ? "expired" : "unconfirmed";
  }
  if (ERP_CANCELLED.has(st) && ERP_OPEN.has(String(m.statusAtFirstImport ?? "").trim().toLowerCase())) return "cancelled";
  return null;
}
export const erpQuotationTag = (type: string | null | undefined, config: any, today?: string): string | null => {
  const d = erpQuotationDisplayStatus(type, config, today);
  return d === "unconfirmed" || d === "expired" ? `ERP ${String(config?.erpImport?.status ?? "").trim().toLowerCase()}` : null;
};

export function docDisplayStatus(doc: { status?: string | null; config?: any; type?: string | null } | null | undefined): string {
  const erpQuote = erpQuotationDisplayStatus(doc?.type, doc?.config);
  if (erpQuote) return erpQuote;
  let s = (doc?.status || "unconfirmed").toLowerCase();
  if (s === "confirmed" && isInvoiceType(doc?.type)) s = "pending_payment";
  if (["paid", "cancelled", "voided", "returned"].includes(s)) return s;
  const c = doc?.config || {};
  // Voided (2026-11-20: the Void button, a voided journal, a cancelled order, Xero's voided
  // imports): config.voided is the one marker, so every voided document reads Voided.
  if (c.voided === true) return "voided";
  const paid = docPaidOf(c);
  const outstanding = docOutstandingOf(c);
  if (paid !== null && paid > 0.005 && outstanding !== null && outstanding > 0.005) return PARTIALLY_PAID;
  return s;
}


/** A voided document (Void button / voided journal / cancelled order): read-only, owes nothing. */
export const isDocVoided = (config: any): boolean => config?.voided === true;

/** An invoice voided with its cancelled order (manual order flow). */
export const isVoidedWithOrder = (config: any): boolean => config?.voided === true && config?.cancelledWithOrder === true;
