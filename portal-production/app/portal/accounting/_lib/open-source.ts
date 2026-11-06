// Where a ledger line leads when clicked (guru 2026-11-06: "when you click it
// goes to that document, then when done they can go back to that page").
//
// A line posted from a document opens THAT document in its own editor; a
// manual journal voucher (no source document) opens the read-only journal
// view with its double entry. Every target gets ?from=<the page the user was
// on, with its state in the query string>, which the editors' Back arrow and
// the journal view honour, so the user lands back on the same ledger.

export type LedgerSource = {
  journalEntryId?: string | null;
  documentId?: string | null;
  documentType?: string | null;
  templateId?: string | null;
};

const enc = (v: string) => encodeURIComponent(v);

export function sourceHref(src: LedgerSource, from: string): string | null {
  const back = from ? `from=${enc(from)}` : "";
  const q = (first: boolean) => (back ? `${first ? "?" : "&"}${back}` : "");
  const type = String(src.documentType || "").toUpperCase();
  if (src.documentId) {
    if (type === "OFFICIAL_RECEIPT") return `/portal/accounting/receipts/${src.documentId}${q(true)}`;
    if (type === "PAYMENT_VOUCHER") return `/portal/accounting/payment-vouchers/${src.documentId}${q(true)}`;
    if (type === "BILL") return `/portal/accounting/payables/purchase-journal?bill=${enc(src.documentId)}${q(false)}`;
    if (type === "SPEND_MONEY") return `/portal/accounting/payables?tab=spend-money&open=${enc(src.documentId)}${q(false)}`;
    if (type === "RECEIVE_MONEY") return `/portal/accounting/receivables?tab=receive-money&open=${enc(src.documentId)}${q(false)}`;
    if (src.templateId) return `/portal/documents/${type}/${src.templateId}/${src.documentId}${q(true)}`;
  }
  if (src.journalEntryId) return `/portal/accounting/journal/${src.journalEntryId}${q(true)}`;
  return null;
}

/** The current page with its query string — what ?from= should carry. */
export function currentPagePath(): string {
  if (typeof window === "undefined") return "";
  return `${window.location.pathname}${window.location.search}`;
}

/** Row styling for a ledger line that opens something. */
export const clickableRowSx = { cursor: "pointer" } as const;
