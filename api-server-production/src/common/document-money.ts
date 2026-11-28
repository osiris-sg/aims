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


/**
 * A credit note's money after its allocations (Manual Offsets / receipts consume it through Payment rows,
 * 2026-11-24): owed = gross - applied (never below 0), paid = applied.
 *
 * AN IMPORTED NOTE STARTS FROM ITS IMPORT-TIME CREDIT, NOT FROM ZERO (guru
 * 2026-11-28). Xero folds an applied credit into the invoice, so the importer's
 * `xeroRemainingCredit` is what was STILL unused on the day of the import —
 * anything AIMS applies since comes off that, never off the full gross, or a
 * note half-used in Xero would hand back credit it no longer has.
 *
 * Until Xero was retired (2026-11-13) an imported note was skipped here
 * entirely, because Xero owned its balance. That left VCE's CN202608005 showing
 * its full 10,680.24 on the statement after a Manual Offset had consumed it:
 * the Payment row existed, the invoices went to paid, and the note alone kept
 * the old stamp. With AIMS as the record, an application made HERE must move
 * the note. An imported note with nothing applied in AIMS is still left exactly
 * as the importer stamped it (null = leave the config alone).
 */
export function creditNoteMoneyAfterApplied(config: any, applied: number): any | null {
  const c = config || {};
  const gross = Math.abs(grossOf(c) ?? 0);
  if (!(gross > 0)) return null;
  const used = Math.max(0, Math.round((Number(applied) || 0) * 100) / 100);
  const imported = !!(c.xeroImported || c.erpImport);
  if (imported && used <= 0.005) return null;
  // What the note could still give when AIMS took over: the importer's figure
  // for an imported note, the whole note for one raised here.
  const remainingAtImport = Number(c.xeroRemainingCredit);
  const openable = imported && Number.isFinite(remainingAtImport) ? Math.max(0, Math.min(gross, remainingAtImport)) : gross;
  const outstanding = Math.max(0, Math.round((openable - used) * 100) / 100);
  return stampDocumentMoney(c, { gross, outstanding, paid: Math.max(0, Math.round((gross - outstanding) * 100) / 100) });
}

/**
 * Totals for a document built OUTSIDE the editor (an invoice auto-drafted from
 * a delivery order). Mirrors the editor's standard formula (TabbedDocumentCreator
 * totals effect) so the stored numbers equal what the office sees on opening it:
 *   gross = Σ line amounts; net = gross − document discount (0 unless given);
 *   tax inclusive (absorbTax 'Y'): gst = net × g / (100 + g), nett = net, subTotal = net − gst
 *   otherwise:                    gst = net × g / 100,       nett = net + gst, subTotal = net
 * An invoice saved with NO totals posted Dr 0 against Cr <lines> in the posting
 * review (guru 2026-10-27, WCT INV202610-0002). The discount (a WCT order's
 * first invoice carrying its quotation's discount) is capped at gross, as in the editor.
 * adjust.lineDiscounts: the WCT group only (LINE_DISCOUNT_FLAG); see amountOf. It also rounds the WCT way
 * (wctTotalsFromNet: GST half up once, Nett = net + GST); every other org keeps the formula below.
 */
/** The org flag that prices a line after its own discount in computeDocumentTotals (the WCT group). */
export const LINE_DISCOUNT_FLAG = 'enableWctDocNav';

/**
 * Money to the cent, half up, float-safe (WCT group, 2026-11-25 UAT): 1491.50 x 9% is 134.23499999999999 in binary,
 * which Math.round(n * 100) or toFixed(2) take DOWN to 134.23; the cents are rounded from a 15-digit reading, so
 * 134.235 -> 134.24. Half away from zero for a negative amount. The portal's helpers/moneyRound.ts is the same.
 */
export function roundCents(n: number): number {
  const v = Number(n);
  if (!Number.isFinite(v) || v === 0) return 0;
  const cents = Math.round(Number((Math.abs(v) * 100).toPrecision(15)));
  return cents === 0 ? 0 : (v < 0 ? -cents : cents) / 100;
}

/**
 * The WCT group's totals from the net (after every discount): GST rounded ONCE on the net, Nett = net + GST
 * (tax inclusive: GST backed out of the net once, subtotal = net - GST). Editor, stored totals, print, order rows and
 * split parts all use this, so they agree to the cent.
 */
export function wctTotalsFromNet(net: number, gstPercent: number, absorb: boolean): { subTotal: number; gstAmount: number; nettTotal: number } {
  const n = roundCents(net);
  const g = Number(gstPercent) || 0;
  if (absorb && g > 0) {
    const gstAmount = roundCents((n * g) / (100 + g));
    return { subTotal: roundCents(n - gstAmount), gstAmount, nettTotal: n };
  }
  const gstAmount = roundCents((n * g) / 100);
  return { subTotal: n, gstAmount, nettTotal: roundCents(n + gstAmount) };
}

export function computeDocumentTotals(
  lines: Array<{ amount?: any; quantity?: any; unitPrice?: any; discount?: any; discountType?: any }>,
  tax: { gstPercent?: any; taxApplicable?: any; absorbTax?: any },
  adjust: { discountAmount?: any; lineDiscounts?: boolean } = {},
): { grossTotal: number; subTotal: number; gstAmount: number; nettTotal: number; gstPercent: number; taxApplicable: 'Y' | 'N'; absorbTax: 'Y' | 'N'; discountAmount?: number } {
  const R = adjust?.lineDiscounts ? roundCents : (n: number) => Math.round(n * 100) / 100;
  const amountOf = (l: any) => {
    const a = Number(l?.amount);
    if (isFinite(a) && a !== 0) return a;
    const q = Number(l?.quantity), u = Number(l?.unitPrice);
    const gross = isFinite(q) && isFinite(u) ? q * u : 0;
    // WCT group (lineDiscounts, enableWctDocNav, 2026-11-25): a line with its own discount is priced after it, so a
    // 100% line (amount 0) counts 0, not qty x price. Every other org: unchanged.
    const d = Number(l?.discount);
    if (adjust?.lineDiscounts && isFinite(d) && d > 0) return l?.discountType === 'amount' ? Math.max(0, gross - d) : gross * (1 - Math.min(d, 100) / 100);
    return gross;
  };
  const grossTotal = R((Array.isArray(lines) ? lines : []).reduce((s, l) => s + amountOf(l), 0));
  const applicable = !(tax?.taxApplicable === 'N' || tax?.taxApplicable === false);
  const absorb = tax?.absorbTax === 'Y' || tax?.absorbTax === true;
  const raw = Number(tax?.gstPercent);
  const g = !applicable ? 0 : isFinite(raw) && raw >= 0 ? raw : 9;
  const d = Number(adjust?.discountAmount);
  const discountAmount = R(isFinite(d) && d > 0 ? Math.min(d, Math.max(0, grossTotal)) : 0);
  const net = grossTotal - discountAmount;
  // WCT group (lineDiscounts, 2026-11-25 UAT): GST rounded half up once on the net, Nett = net + GST.
  if (adjust?.lineDiscounts) {
    const w = wctTotalsFromNet(net, g, absorb);
    return { grossTotal, ...w, gstPercent: g, taxApplicable: applicable ? 'Y' : 'N', absorbTax: absorb ? 'Y' : 'N', ...(discountAmount > 0 ? { discountAmount } : {}) };
  }
  let gstAmount: number, nettTotal: number, subTotal: number;
  if (absorb && g > 0) {
    gstAmount = (net * g) / (100 + g);
    nettTotal = net;
    subTotal = net - gstAmount;
  } else {
    gstAmount = (net * g) / 100;
    nettTotal = net + gstAmount;
    subTotal = net;
  }
  return { grossTotal, subTotal: R(subTotal), gstAmount: R(gstAmount), nettTotal: R(nettTotal), gstPercent: g, taxApplicable: applicable ? 'Y' : 'N', absorbTax: absorb ? 'Y' : 'N', ...(discountAmount > 0 ? { discountAmount } : {}) };
}
