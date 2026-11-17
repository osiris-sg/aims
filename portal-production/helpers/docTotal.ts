/* eslint-disable @typescript-eslint/no-explicit-any */
// Gross total of a Document from its config blob — one reader for every list
// (Sales/Invoices lists, AR workspace, Documents hub). Candidates are tried in
// order and the first NON-ZERO number wins: a credit-style invoice (e.g. ADH
// "Invoice #2", where the first-shipment amount is deducted) stores a negative
// total, and a "> 0" test used to skip it and fall back to the tax-exclusive
// line sum. Returns 0 when nothing is stored.

const num = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
};

export function docGrossTotal(config: any): number {
  const cfg = config || {};
  const candidates = [cfg?.summary?.grandTotal, cfg?.nettTotal, cfg?.grandTotal, cfg?.total, cfg?.summary?.total, cfg?.totalWithTax];
  for (const c of candidates) {
    const n = num(c);
    if (n !== null && n !== 0) return n;
  }
  // Fallback: sum line items if present.
  if (Array.isArray(cfg.items)) {
    return cfg.items.reduce((s: number, it: any) => {
      const amt = num(it?.amount) || (num(it?.quantity) ?? 0) * (num(it?.unitPrice) ?? 0);
      return s + (amt || 0);
    }, 0);
  }
  return 0;
}

// What has been PAID on a document, and what is still DUE — the portal-side
// mirror of api-server/src/common/document-money.ts. Same canonical keys
// (paidToDate / outstandingBalance) with the same legacy fallbacks
// (xeroAmountPaid / xeroBalance), and the same rule that matters:
//
//   an outstanding balance that was never stamped is NOT zero — it means no
//   payment has been recorded, so the document is owed in FULL.
//
// Coercing that null to 0 is the bug that once emptied the Statement of
// Accounts of a $154k unpaid invoice; it must not be repeated in a list.
export function docPaidToDate(config: any): number {
  const cfg = config || {};
  if (cfg.voided) return 0;
  return num(cfg.paidToDate) ?? num(cfg.xeroAmountPaid) ?? 0;
}

export function docAmountDue(config: any): number {
  const cfg = config || {};
  if (cfg.voided) return 0;
  const stamped = num(cfg.outstandingBalance) ?? num(cfg.xeroBalance);
  if (stamped !== null) return Math.max(0, stamped);
  const gross = docGrossTotal(cfg);
  const paid = docPaidToDate(cfg);
  return Math.max(0, Math.round((gross - paid) * 100) / 100);
}
