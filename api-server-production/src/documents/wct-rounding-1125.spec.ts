// WCT group UAT 2026-11-25: one rounding rule for the editor, stored totals, print, order rows, split parts and a GST
// re-tax. The owner's QO: gross 1,700.00; an $800 line less 10%, a 2 x $350 line less $50, a $200 line; 5% document
// discount -> subtotal 1,491.50, GST 9% = 134.235 -> 134.24 (half up), Nett 1,625.74.
import { computeDocumentTotals, roundCents, wctTotalsFromNet } from '../common/document-money';
import { renderWctBody } from '../common/services/document-html/wct';
import { resolveDesign } from '../common/services/document-html/design';
import { planInvoiceSplit, retaxedSplitTotals, partConfig } from './invoice-split';

const GST = { gstPercent: 9, taxApplicable: 'Y', absorbTax: 'N' };
const items = [
  { description: 'Hood', quantity: 1, unitPrice: 800, discount: 10, discountType: 'percent', amount: 720 },
  { description: 'Duct', quantity: 2, unitPrice: 350, discount: 50, discountType: 'amount', amount: 650 },
  { description: 'Check', quantity: 1, unitPrice: 200, amount: 200 },
];
const cfg = { items, gstPercent: 9, taxApplicable: 'Y', absorbTax: 'N', discountAmount: 78.5, documentInfo: { gstPercent: 9, taxApplicable: 'Y', discountPercent: 5, discountType: 'percent', discountAmount: 78.5 } };
const sum = (xs: number[]) => roundCents(xs.reduce((s, x) => s + x, 0));

describe('roundCents: half up on cents, float-safe', () => {
  it('rounds the binary 134.23499999999999 up', () => {
    expect(1491.5 * 0.09).toBeLessThan(134.235); // the float trap
    expect(roundCents(1491.5 * 0.09)).toBe(134.24);
    expect(roundCents(1.005)).toBe(1.01);
    expect(roundCents(1625.735)).toBe(1625.74);
    expect(roundCents(-1.005)).toBe(-1.01);
    expect(roundCents(2.344)).toBe(2.34);
    expect(roundCents(0)).toBe(0);
    expect(roundCents(NaN)).toBe(0);
  });
  it('wctTotalsFromNet: GST once, Nett = net + GST; tax inclusive backs GST out once', () => {
    expect(wctTotalsFromNet(1491.5, 9, false)).toEqual({ subTotal: 1491.5, gstAmount: 134.24, nettTotal: 1625.74 });
    expect(wctTotalsFromNet(1625.74, 9, true)).toEqual({ subTotal: 1491.5, gstAmount: 134.24, nettTotal: 1625.74 });
    expect(wctTotalsFromNet(100, 0, false)).toEqual({ subTotal: 100, gstAmount: 0, nettTotal: 100 });
  });
});

describe('computeDocumentTotals, the UAT quotation', () => {
  it('WCT group (lineDiscounts): GST 134.24, Nett 1,625.74 = subtotal + GST', () => {
    const t = computeDocumentTotals(items, GST, { discountAmount: 78.5, lineDiscounts: true });
    expect(t).toMatchObject({ grossTotal: 1570, discountAmount: 78.5, subTotal: 1491.5, gstAmount: 134.24, nettTotal: 1625.74 });
    expect(roundCents(t.subTotal + t.gstAmount)).toBe(t.nettTotal);
  });
  it('every other org (no lineDiscounts): the old formula, unchanged', () => {
    const R = (n: number) => Math.round(n * 100) / 100;
    for (const amount of [1491.5, 100.5, 33.335, 12345.67]) {
      const t = computeDocumentTotals([{ amount }], GST);
      expect(t).toMatchObject({ subTotal: R(amount), gstAmount: R((amount * 9) / 100), nettTotal: R(amount + (amount * 9) / 100) });
    }
  });
});

describe('print (WCT layout)', () => {
  const design = resolveDesign({ layout: 'wct' } as any);
  const rows = (html: string) => [...html.matchAll(/<td class="l">([^<]+)<\/td><td class="v">([^<]*)<\/td>/g)].map((m) => [m[1], m[2]]);
  const doc = { name: 'X', customer: { name: 'C' }, items, documentInfo: { date: '2026-11-25', ...cfg.documentInfo } };
  it('quotation: GST 134.24 and Total Amount 1,625.74 (they add up)', () => {
    expect(rows(renderWctBody('quotation', doc as any, {}, design))).toEqual([
      ['Total:', '$1,700.00'],
      ['Discount:', '-$208.50'],
      ['GST 9%:', '$134.24'],
      ['Total Amount:', '$1,625.74'],
    ]);
  });
  it('invoice: Amount Due 1,625.74', () => {
    expect(rows(renderWctBody('invoice', doc as any, {}, design)).slice(2)).toEqual([
      ['GST 9%:', '$134.24'],
      ['Amount Paid:', '$0.00'],
      ['Amount Due:', '$1,625.74'],
    ]);
  });
});

describe('split parts add up to the unsplit invoice', () => {
  it('40% + $894.90 (the UAT split): GST 53.69 + 80.55 = 134.24, totals 1,625.74', () => {
    const { parts } = planInvoiceSplit(cfg, { mode: 'rate', parts: [40, { amount: 894.9 }] }, { lineDiscounts: true });
    expect(parts.map((p) => p.totals.subTotal)).toEqual([596.6, 894.9]);
    expect(parts.map((p) => p.totals.gstAmount)).toEqual([53.69, 80.55]);
    expect(sum(parts.map((p) => p.totals.gstAmount))).toBe(134.24);
    expect(sum(parts.map((p) => p.totals.nettTotal))).toBe(1625.74);
  });
  it('three equal-ish parts: GST and Nett sum to the unsplit figures', () => {
    const { parts } = planInvoiceSplit(cfg, { mode: 'rate', parts: [33.33, 33.33, 33.34] }, { lineDiscounts: true });
    expect(sum(parts.map((p) => p.totals.subTotal))).toBe(1491.5);
    expect(sum(parts.map((p) => p.totals.gstAmount))).toBe(134.24);
    expect(sum(parts.map((p) => p.totals.nettTotal))).toBe(1625.74);
    for (const p of parts.slice(0, -1)) expect(roundCents(p.totals.subTotal + p.totals.gstAmount)).toBe(p.totals.nettTotal);
  });
  it('a re-tax of the parts together (retaxedSplitTotals) keeps the last part\'s leftover cent', () => {
    const { parts } = planInvoiceSplit(cfg, { mode: 'rate', parts: [40, { amount: 894.9 }] }, { lineDiscounts: true });
    const ctx = { groupId: 'g', of: 2, baseNumber: 'INV1', mode: 'rate' as const, account: {} };
    const configs = parts.map((p) => partConfig(cfg, p, { ...ctx, number: `INV1-${p.part}` }));
    // Re-taxing each part on its own loses the cent (53.69 + 80.54 = 134.23).
    const alone = configs.map((c) => computeDocumentTotals(c.items, GST, { lineDiscounts: true }).gstAmount);
    expect(sum(alone)).toBe(134.23);
    const together = retaxedSplitTotals(configs, GST);
    expect(together.map((t) => t.gstAmount)).toEqual([53.69, 80.55]);
    expect(sum(together.map((t) => t.nettTotal))).toBe(1625.74);
    // Non-GST (the BC Air side): no GST at all.
    expect(retaxedSplitTotals(configs, { ...GST, taxApplicable: 'N' }).map((t) => t.gstAmount)).toEqual([0, 0]);
  });
});
