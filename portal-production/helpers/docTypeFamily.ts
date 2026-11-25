/*
 * Document.type is stored inconsistently — canonical long names ("DELIVERY_ORDER",
 * "QUOTATION") next to the short variant codes ("DO", "QO1", "TI2"). This maps any
 * spelling to its family so the editor's Previous / Next can walk EVERY document of
 * the type, whichever template each one was built on (guru 2026-11-25: "how come I
 * can't Previous and Next for this document?" — the arrows used to look only at the
 * route's template id, so a document on another template of the same type had no
 * neighbours; the shared template library lets an org run several per type).
 * Pure; tested by helpers/docTypeFamily.test.mjs.
 */
const FAMILIES: Record<string, string[]> = {
  QUOTATION: ["QUOTATION", "QO", "QO1", "QO2", "QT"],
  DELIVERY_ORDER: ["DELIVERY_ORDER", "DO"],
  RECEIVED_DELIVERY_ORDER: ["RECEIVED_DELIVERY_ORDER", "RDO", "RETURN_DELIVERY_ORDER"],
  PURCHASE_ORDER: ["PURCHASE_ORDER", "PO"],
  PURCHASE_RETURN: ["PURCHASE_RETURN", "PR"],
  TAKE_IN: ["TAKE_IN", "TKI"],
  MATERIAL_SERVICE_REPORT: ["MATERIAL_SERVICE_REPORT", "MSR"],
  SALES_ORDER: ["SALES_ORDER", "SO"],
  INVOICE: ["INVOICE", "TAX_INVOICE", "INV", "TI", "TI2"],
  CREDIT_NOTE: ["CREDIT_NOTE", "CN"],
  DEBIT_NOTE: ["DEBIT_NOTE", "DN"],
  STOCK_ADJUSTMENT_IN: ["STOCK_ADJUSTMENT_IN", "SAI"],
  STOCK_ADJUSTMENT_OUT: ["STOCK_ADJUSTMENT_OUT", "SAO"],
  BILL: ["BILL"],
};

/** Every stored spelling of this document type, the given one included. */
export function docTypeFamily(type: string | string[] | null | undefined): string[] {
  const t = String(Array.isArray(type) ? type[0] : type ?? "").trim().toUpperCase();
  if (!t) return [];
  for (const members of Object.values(FAMILIES)) if (members.includes(t)) return members;
  return [t];
}

// The document type's display name for the editor's title row (guru 2026-11-25:
// "there is no indication of the document type I'm editing in") — one name per
// family, whichever stored spelling the document uses; a few spellings carry their
// own wording (RDO is a return; MSR keeps its legacy name).
const FAMILY_TITLES: Record<string, string> = {
  QUOTATION: "Quotation",
  DELIVERY_ORDER: "Delivery Order",
  RECEIVED_DELIVERY_ORDER: "Received Delivery Order",
  PURCHASE_ORDER: "Purchase Order",
  PURCHASE_RETURN: "Purchase Return",
  TAKE_IN: "Take In",
  MATERIAL_SERVICE_REPORT: "Maintenance Service Report",
  SALES_ORDER: "Sales Order",
  INVOICE: "Invoice", // not "Tax Invoice": not every org is GST-registered (guru 2026-11-25)
  CREDIT_NOTE: "Credit Note",
  DEBIT_NOTE: "Debit Note",
  STOCK_ADJUSTMENT_IN: "Stock Adjustment In",
  STOCK_ADJUSTMENT_OUT: "Stock Adjustment Out",
  BILL: "Supplier Invoice",
};
const SPELLING_TITLES: Record<string, string> = {
  RDO: "Return Delivery Order",
  RETURN_DELIVERY_ORDER: "Return Delivery Order",
  OR: "Official Receipt",
  OFFICIAL_RECEIPT: "Official Receipt",
  PV: "Payment Voucher",
  PAYMENT_VOUCHER: "Payment Voucher",
  JV: "Journal Voucher",
  JOURNAL_VOUCHER: "Journal Voucher",
};

/** Display name of a document type; "Document" when unknown. */
export function docTypeTitle(type: string | null | undefined): string {
  const t = String(type ?? "").trim().toUpperCase();
  if (!t) return "Document";
  if (SPELLING_TITLES[t]) return SPELLING_TITLES[t];
  const family = Object.keys(FAMILIES).find((k) => FAMILIES[k].includes(t));
  return (family && FAMILY_TITLES[family]) || "Document";
}
