// The document editor lives at /portal/documents/<TYPE>/<templateId>/<docId>,
// which is not under any module's own route — so the top nav highlighted no
// module while a document was open (guru 2026-11-14: "im in invoice why am i
// not in the sales tab"). This maps the editor path back to the list the
// document belongs to, so that module (and its sub-tab) lights up. Receipts,
// payment vouchers and journal vouchers are NOT /portal/documents routes —
// they live under /portal/accounting and already highlight Accounting.
//
// A record opened from a list still carries ?from=<list path>, which wins;
// this is the fallback when a document is opened directly (a deep link, Add,
// Previous / Next) with no ?from.

// Document type (the path's 3rd segment, upper-cased) → the list it belongs to.
const TYPE_TO_LIST: Record<string, string> = {
  // Sales
  QUOTATION: "/portal/sales/quotations",
  QT: "/portal/sales/quotations",
  QO: "/portal/sales/quotations",
  QO1: "/portal/sales/quotations",
  SO: "/portal/sales/sales-orders",
  DO: "/portal/sales/delivery-orders",
  RDO: "/portal/sales/return-delivery-orders",
  INVOICE: "/portal/sales/invoices",
  TI: "/portal/sales/invoices",
  TI2: "/portal/sales/invoices",
  DN: "/portal/sales/debit-notes",
  CN: "/portal/sales/credit-notes",
  // Purchases (Inventory module)
  PO: "/portal/inventory/purchases",
  PR: "/portal/inventory/purchases-return",
};

/**
 * For a document editor path, the list route the document belongs to (so the
 * owning module highlights); null for any other path, and for a document type
 * with no known list (the top bar then falls back to the raw path — a Sales
 * document still lands on the Sales module via its own route check upstream if
 * one is added here later).
 */
export function documentEditorNavPath(pathname: string): string | null {
  if (!pathname.startsWith("/portal/documents/")) return null;
  const parts = pathname.split("/").filter(Boolean); // ["portal","documents",TYPE,...]
  const type = (parts[2] || "").toUpperCase();
  return TYPE_TO_LIST[type] ?? "/portal/sales";
}
