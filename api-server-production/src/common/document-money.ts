// ---------------------------------------------------------------------------
// The money facts AIMS keeps on a document's config.
//
// These are AIMS's OWN numbers — the outstanding balance is computed by
// payments.service.ts from AIMS payment records, not fetched from Xero. They
// only carry `xero*` names because they were introduced during the Xero import
// and never renamed (guru 2026-09-28).
//
// That naming caused a real bug: the Statement of Accounts read
// `config.xeroBalance ?? 0`, so a brand-new unpaid invoice — which has no
// balance stamped yet — looked like "nothing owed" and vanished from the
// statement entirely (BIPL-JPSG-20260928-0001, $154,531.48).
//
// Canonical names are now outstandingBalance / paidToDate / totalWithTax.
//
// TWO names were deliberately avoided because they ALREADY exist with other
// meanings: `grossTotal` (159 docs, = the pre-GST subtotal) and `amountPaid`
// (6,444 docs, AIMS-native paid — on 40 uploaded bills it says 0 while Xero
// says fully paid, so the two are NOT interchangeable).
//
// NOTE the gross key is `totalWithTax`, NOT `grossTotal`: `grossTotal` already
// exists on 159 documents meaning the PRE-GST subtotal (it equals subTotal on
// every one of them), while the figure AR/SOA needs is GST-INCLUSIVE — the same
// number as nettTotal / xeroGross. Reusing that name would have understated
// every statement by the tax (guru 2026-09-28).
// Readers use the accessors below, which prefer the canonical key and fall
// back to the legacy one so nothing breaks while the data is backfilled.
// Writers use stampDocumentMoney(), which writes BOTH until the legacy keys
// are dropped.
//
// IMPORTANT: outstandingOf() returns null when nothing has been stamped. That
// is NOT zero — it means "no payment recorded yet", so the caller should fall
// back to the document's gross. Never coerce it with `?? 0`.
// ---------------------------------------------------------------------------

const num = (v: any): number | null => {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
};

/** Outstanding balance, or null when never stamped (≠ zero). */
export function outstandingOf(config: any): number | null {
  const c = config || {};
  return num(c.outstandingBalance) ?? num(c.xeroBalance);
}

/** Amount paid, or null when never stamped. */
export function amountPaidOf(config: any): number | null {
  const c = config || {};
  return num(c.paidToDate) ?? num(c.xeroAmountPaid);
}

/**
 * The STAMPED gross only (canonical then legacy) — a drop-in for `c.xeroGross`.
 * Deliberately does NOT fall back to the document's own totals, so existing
 * call sites keep their own fallback order.
 */
export function grossStampOf(config: any): number | null {
  const c = config || {};
  return num(c.totalWithTax) ?? num(c.xeroGross);
}

/** Document gross (what the invoice is for), preferring the document's own total. */
export function grossOf(config: any): number | null {
  const c = config || {};
  return num(c.totalWithTax) ?? num(c.nettTotal) ?? num(c.xeroGross) ?? num(c.totalAmount) ?? num(c?.documentInfo?.nettTotal);
}

/**
 * What is still owed on this document, for AR / SOA / aging.
 * Falls back to the gross when no balance has ever been stamped — an invoice
 * nobody has paid yet is owed in FULL, not zero.
 */
export function owedOf(config: any): number {
  const c = config || {};
  if (c.voided) return 0;
  const outstanding = outstandingOf(c);
  if (outstanding !== null) return Math.max(0, outstanding);
  const gross = grossOf(c) ?? 0;
  const paid = amountPaidOf(c) ?? 0;
  return Math.max(0, Math.round((gross - paid) * 100) / 100);
}

/** Writers: stamp both the canonical and the legacy keys during the transition. */
export function stampDocumentMoney(
  config: any,
  vals: { outstanding?: number; paid?: number; gross?: number },
): any {
  const out: any = { ...(config || {}) };
  const R = (n: number) => Math.round(n * 100) / 100;
  if (vals.outstanding !== undefined) { out.outstandingBalance = R(vals.outstanding); out.xeroBalance = R(vals.outstanding); }
  if (vals.paid !== undefined) { out.paidToDate = R(vals.paid); out.xeroAmountPaid = R(vals.paid); }
  if (vals.gross !== undefined) { out.totalWithTax = R(vals.gross); out.xeroGross = R(vals.gross); }
  return out;
}
