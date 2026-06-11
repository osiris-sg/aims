// Maps a document type (the value used in /portal/documents/<type>/...) to the
// list-view page it belongs to. Used by the back button + sidebar highlight when
// the enableDocumentListView feature flag is on, so that creating / opening a
// document doesn't visually leave the originating list page.

const SALES_LIST_ROUTES: Record<string, string> = {
  QUOTATION: "/portal/sales/quotations",
  QO: "/portal/sales/quotations",
  QO1: "/portal/sales/quotations",
  QO2: "/portal/sales/quotations",
  QT: "/portal/sales/quotations",
  SALES_ORDER: "/portal/sales/sales-orders",
  SO: "/portal/sales/sales-orders",
  DELIVERY_ORDER: "/portal/sales/delivery-orders",
  DO: "/portal/sales/delivery-orders",
  INVOICE: "/portal/sales/invoices",
  TI: "/portal/sales/invoices",
  TI2: "/portal/sales/invoices",
  TAX_INVOICE: "/portal/sales/invoices",
  CREDIT_NOTE: "/portal/sales/credit-notes",
  CN: "/portal/sales/credit-notes",
  DEBIT_NOTE: "/portal/sales/debit-notes",
  DN: "/portal/sales/debit-notes",
};

const INVENTORY_LIST_ROUTES: Record<string, string> = {
  PURCHASE_ORDER: "/portal/inventory/purchases",
  PO: "/portal/inventory/purchases",
  PURCHASE_RETURN: "/portal/inventory/purchases-return",
  PR: "/portal/inventory/purchases-return",
  STOCK_ADJUSTMENT_IN: "/portal/inventory/adjustment-in",
  SAI: "/portal/inventory/adjustment-in",
  STOCK_ADJUSTMENT_OUT: "/portal/inventory/adjustment-out",
  SAO: "/portal/inventory/adjustment-out",
};

const LIST_ROUTES: Record<string, string> = {
  ...SALES_LIST_ROUTES,
  ...INVENTORY_LIST_ROUTES,
};

export function getDocumentListRoute(docType?: string | null): string | null {
  if (!docType) return null;
  return LIST_ROUTES[docType.toUpperCase()] ?? null;
}

// Given a portal pathname, return the list route this document page came from,
// or null if the pathname isn't a document-editor URL. Handles both the
// edit/create path (/portal/documents/<type>/<tplId>/<docId>) and the
// view/edit-template paths.
export function getListRouteFromPathname(pathname: string): string | null {
  if (!pathname?.startsWith("/portal/documents/")) return null;
  const segments = pathname.split("/").filter(Boolean);
  // segments[0]="portal", segments[1]="documents".
  // /portal/documents/<type>/...                → type at index 2
  // /portal/documents/view/<type>/...           → type at index 3
  // /portal/documents/edit/<type>/...           → type at index 3
  let type: string | undefined;
  if (segments[2] === "view" || segments[2] === "edit") {
    type = segments[3];
  } else {
    type = segments[2];
  }
  return getDocumentListRoute(type);
}
