// WCT group money rounding (enableWctDocNav, 2026-11-25 UAT). The same as the API's
// src/common/document-money.ts roundCents / wctTotalsFromNet, so the editor, the stored totals,
// the print, the order rows and split parts agree to the cent. Tested by helpers/moneyRound.test.mjs.

/**
 * Money to the cent, half up, float-safe: 1491.50 x 9% is 134.23499999999999 in binary, which
 * toFixed(2) or Math.round(n * 100) take DOWN to 134.23; the cents are rounded from a 15-digit
 * reading, so 134.235 -> 134.24. Half away from zero for a negative amount.
 */
export function roundCents(n: number): number {
  const v = Number(n);
  if (!Number.isFinite(v) || v === 0) return 0;
  const cents = Math.round(Number((Math.abs(v) * 100).toPrecision(15)));
  return cents === 0 ? 0 : (v < 0 ? -cents : cents) / 100;
}

/**
 * Totals from the net (after every discount): GST rounded ONCE on the net, Nett = net + GST
 * (tax inclusive: GST backed out of the net once, subtotal = net - GST).
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
