// Discounts on WCT quotations + invoices (2026-11-25): line discount (% or $ per line) and the document ("bulk")
// discount (% or $); GST after every discount. Lines carry their amount AFTER their own discount (the editor's
// updateItem); the bulk discount is documentInfo.discountAmount.
import { computeDocumentTotals } from '../common/document-money';
import { renderWctBody } from '../common/services/document-html/wct';
import { resolveDesign } from '../common/services/document-html/design';
import { remainingToBill, importedInvoicePrefill } from '../orders/imported-remaining';
import { remainderInvoiceItems } from './documents.service';
import { taxedInvoiceConfig } from '../gst-switch/gst-switch';
import { planInvoiceSplit } from './invoice-split';

const GST = { gstPercent: 9, taxApplicable: 'Y', absorbTax: 'N' };
const NOGST = { gstPercent: 9, taxApplicable: 'N', absorbTax: 'N' };
// Line A: 2 x $100 less 10% = 180; line B: 1 x $300 less $50 = 250; line C: 1 x $70, no discount.
const lineA = { description: 'Hood degrease', quantity: 2, unitPrice: 100, discount: 10, discountType: 'percent', amount: 180 };
const lineB = { description: 'Duct clean', quantity: 1, unitPrice: 300, discount: 50, discountType: 'amount', amount: 250 };
const lineC = { description: 'Filter', quantity: 1, unitPrice: 70, amount: 70 };

describe('totals: GST after all discounts', () => {
  it('line %, line $, no bulk: GST and non-GST', () => {
    expect(computeDocumentTotals([lineA, lineB, lineC], GST)).toMatchObject({ grossTotal: 500, subTotal: 500, gstAmount: 45, nettTotal: 545 });
    expect(computeDocumentTotals([lineA, lineB, lineC], NOGST)).toMatchObject({ grossTotal: 500, gstAmount: 0, nettTotal: 500 });
  });
  it('bulk % (10% of 500 = 50) and bulk $ (40) on top of line discounts', () => {
    expect(computeDocumentTotals([lineA, lineB, lineC], GST, { discountAmount: 50 })).toMatchObject({ subTotal: 450, gstAmount: 40.5, nettTotal: 490.5, discountAmount: 50 });
    expect(computeDocumentTotals([lineA, lineB, lineC], GST, { discountAmount: 40 })).toMatchObject({ subTotal: 460, gstAmount: 41.4, nettTotal: 501.4 });
    expect(computeDocumentTotals([lineA, lineB, lineC], NOGST, { discountAmount: 40 })).toMatchObject({ subTotal: 460, gstAmount: 0, nettTotal: 460 });
  });
});

describe('WCT print: Total > Discount (-$x) > GST > Amount Paid / Due (invoice) or Total Amount (QO)', () => {
  const design = resolveDesign({ layout: 'wct' } as any);
  const doc = (di: any, extra: any = {}) => ({ name: 'X', customer: { name: 'C' }, items: [lineA, lineB, lineC], documentInfo: { date: '2026-11-25', gstPercent: 9, taxApplicable: 'Y', ...di }, ...extra });
  const rows = (html: string) => [...html.matchAll(/<td class="l">([^<]+)<\/td><td class="v">([^<]*)<\/td>/g)].map((m) => [m[1], m[2]]);

  it('invoice, bulk %: rows in order, discount as -$', () => {
    const h = renderWctBody('invoice', doc({ discountPercent: 10, discountType: 'percent', discountAmount: 50 }), {}, design);
    // 2026-11-25b: Total = before any discount (200 + 300 + 70); Discount = lines (20 + 50) + document (50).
    expect(rows(h)).toEqual([
      ['Total:', '$570.00'],
      ['Discount:', '-$120.00'],
      ['GST 9%:', '$40.50'],
      ['Amount Paid:', '$0.00'],
      ['Amount Due:', '$490.50'],
    ]);
  });
  it('quotation, bulk $ typed (no stored amount): Total Amount last', () => {
    const h = renderWctBody('quotation', doc({ discountPercent: 40, discountType: 'amount' }), {}, design);
    expect(rows(h)).toEqual([
      ['Total:', '$570.00'],
      ['Discount:', '-$110.00'],
      ['GST 9%:', '$41.40'],
      ['Total Amount:', '$501.40'],
    ]);
  });
  it('no discount: no Discount row; non-GST: no GST row', () => {
    const h = renderWctBody('invoice', doc({ taxApplicable: 'N' }, { items: [lineC] }), {}, design);
    expect(rows(h).map((r) => r[0])).toEqual(['Total:', 'Amount Paid:', 'Amount Due:']);
  });
  it('line discounts print under their line; the Amount column is the line after it', () => {
    const h = renderWctBody('quotation', doc({}), {}, design);
    expect(h).toContain('<div class="ldisc">Discount 10%: -$20.00</div>');
    expect(h).toContain('<div class="ldisc">Discount: -$50.00</div>');
    expect(h).toContain('$180.00');
    expect(h).toContain('$250.00');
    expect((h.match(/class="ldisc"/g) || []).length).toBe(2);
    // The DO never prints prices or discounts.
    expect(renderWctBody('do', doc({}), {}, design)).not.toContain('class="ldisc"');
  });
});

describe('carried through: QO > balance / remainder invoice', () => {
  it('what is left keeps each line\'s discount (%: as is; $: prorated to the qty left)', () => {
    const plan = remainingToBill({
      quoteItems: [{ ...lineA, quantity: 4, amount: 360 }, { ...lineB, quantity: 2, unitPrice: 300, discount: 100, amount: 500 }],
      // One earlier invoice billed 1 of line A and 1 of line B (with their discounts): 90 + 250 = 340 + GST.
      billedInvoiceItems: [[{ ...lineA, quantity: 1, amount: 90 }, { ...lineB, quantity: 1, discount: 50, amount: 250 }]],
      quoteTotal: (360 + 500) * 1.09,
      billed: 340 * 1.09,
      gstPercent: 9,
    });
    expect(plan.matched).toBe(true);
    expect(plan.lines.map((l) => [l.quantity, l.amount, l.discount, l.discountType])).toEqual([
      [3, 270, 10, 'percent'],
      [1, 250, 50, 'amount'],
    ]);
    expect(plan.remainingNet).toBe(520);
    // The remainder invoice's items keep them, and their totals are the left-to-bill amount.
    const items = remainderInvoiceItems(plan.lines as any, 9);
    expect(items.map((i: any) => [i.amount, i.discount, i.discountType])).toEqual([
      [270, 10, 'percent'],
      [250, 50, 'amount'],
    ]);
    expect(computeDocumentTotals(items, GST).nettTotal).toBe(566.8);
  });
  it('create invoice prefill (nothing billed yet): the quotation lines with their discounts', () => {
    const pre = importedInvoicePrefill({ lines: [] }, [lineA, lineB, lineC]);
    expect(pre.map((l) => [l.amount, l.discount ?? null])).toEqual([
      [180, 10],
      [250, 50],
      [70, null],
    ]);
  });
  it('a line with only an amount (no unit price) is not discounted twice', () => {
    const plan = remainingToBill({ quoteItems: [{ description: 'Lump', quantity: 1, amount: 900, discount: 10 }], billedInvoiceItems: [], quoteTotal: 981, billed: 0, gstPercent: 9 });
    expect(plan.lines[0].amount).toBe(900);
  });
});

describe('carried through: split payments and the GST re-tax', () => {
  const inv = { items: [lineA, lineB, lineC], ...GST, discountAmount: 50, documentInfo: { ...GST, discountAmount: 50 } };
  it('a split divides the contract value after every discount', () => {
    const out = planInvoiceSplit(inv, { mode: 'rate', parts: [50, 50] });
    expect(out.contractValue).toBe(450);
    expect(out.parts.map((p) => p.amount)).toEqual([225, 225]);
    expect(out.parts.reduce((s, p) => s + p.totals.nettTotal, 0)).toBeCloseTo(490.5, 2);
  });
  it('the GST switch re-tax keeps line + bulk discounts (GST 0 after them)', () => {
    const non = taxedInvoiceConfig(inv, false);
    expect([non.subTotal, non.gstAmount, non.nettTotal, non.outstandingBalance]).toEqual([450, 0, 450, 450]);
    const back = taxedInvoiceConfig(non, true);
    expect([back.subTotal, back.gstAmount, back.nettTotal]).toEqual([450, 40.5, 490.5]);
  });
});
