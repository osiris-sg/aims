// WCT discounts, round 1125b (2026-11-25): the totals' Discount row is every discount (lines + document) under a
// Total before any discount, GST and the amounts after it unchanged; a 100% line discount counts $0 in the shared
// computeDocumentTotals for the WCT group only (lineDiscounts), every other org unchanged.
import { computeDocumentTotals } from '../common/document-money';
import { renderWctBody, lineDiscountsTotal } from '../common/services/document-html/wct';
import { resolveDesign } from '../common/services/document-html/design';
import { remainderInvoiceItems } from './documents.service';
import { planInvoiceSplit } from './invoice-split';

const GST = { gstPercent: 9, taxApplicable: 'Y', absorbTax: 'N' };
// The owner's example: 4 x $200 less 10% (-$80) = 720; 1 x $350 less $50 = 300; gross $1,150; document 5% of 1,020 = 51.
const l1 = { description: 'Hood', quantity: 4, unitPrice: 200, discount: 10, discountType: 'percent', amount: 720 };
const l2 = { description: 'Duct', quantity: 1, unitPrice: 350, discount: 50, discountType: 'amount', amount: 300 };
const free = { description: 'Free check', quantity: 2, unitPrice: 100, discount: 100, discountType: 'percent', amount: 0 };

const design = resolveDesign({ layout: 'wct' } as any);
const rows = (html: string) => [...html.matchAll(/<td class="l">([^<]+)<\/td><td class="v">([^<]*)<\/td>/g)].map((m) => [m[1], m[2]]);
const doc = (items: any[], di: any = {}, extra: any = {}) => ({ name: 'X', customer: { name: 'C' }, items, documentInfo: { date: '2026-11-25', gstPercent: 9, taxApplicable: 'Y', ...di }, ...extra });

describe('print: Total before any discount, Discount = lines + document', () => {
  it('invoice: $1,150 / -$181 / GST and Amount Due unchanged', () => {
    const h = renderWctBody('invoice', doc([l1, l2], { discountPercent: 5, discountType: 'percent', discountAmount: 51 }), {}, design);
    expect(rows(h)).toEqual([
      ['Total:', '$1,150.00'],
      ['Discount:', '-$181.00'],
      ['GST 9%:', '$87.21'],
      ['Amount Paid:', '$0.00'],
      ['Amount Due:', '$1,056.21'],
    ]);
    // Lines stay net with their note.
    expect(h).toContain('<div class="ldisc">Discount 10%: -$80.00</div>');
    expect(h).toContain('$720.00');
  });
  it('quotation: line discounts only (no document discount) still show a Discount row', () => {
    const h = renderWctBody('quotation', doc([l1, l2]), {}, design);
    expect(rows(h)).toEqual([
      ['Total:', '$1,150.00'],
      ['Discount:', '-$130.00'],
      ['GST 9%:', '$91.80'],
      ['Total Amount:', '$1,111.80'],
    ]);
  });
  it('a 100% line: Total counts its gross, Discount takes it all off, the amounts after are unchanged', () => {
    const h = renderWctBody('quotation', doc([l2, free]), {}, design);
    expect(rows(h)).toEqual([
      ['Total:', '$550.00'],
      ['Discount:', '-$250.00'],
      ['GST 9%:', '$27.00'],
      ['Total Amount:', '$327.00'],
    ]);
  });
  it('no discounts at all: no Discount row, Total as before', () => {
    const h = renderWctBody('quotation', doc([{ description: 'A', quantity: 1, unitPrice: 70, amount: 70 }]), {}, design);
    expect(rows(h)).toEqual([['Total:', '$70.00'], ['GST 9%:', '$6.30'], ['Total Amount:', '$76.30']]);
  });
  it('Racking quotation: Total Amount before any discount, Goodwill Discount = lines + document, Final Amount unchanged', () => {
    const rk = resolveDesign({ layout: 'wct', racking: true } as any);
    const h = renderWctBody('quotation', doc([l1, l2], { discountPercent: 51, discountType: 'amount', discountAmount: 51 }, { design: { racking: true } }), {}, rk);
    expect(rows(h)).toEqual([
      ['Total Amount:', '$1,150.00'],
      ['Goodwill Discount:', '$181.00'],
      ['GST 9%:', '$87.21'],
      ['Final Amount:', '$1,056.21'],
    ]);
  });
  it('lineDiscountsTotal skips group headers and merged-rate rows', () => {
    expect(lineDiscountsTotal([l1, l2, free, { isGroupHeader: true, discount: 10, quantity: 1, unitPrice: 1000 }, { rateMerge: true, discount: 10, quantity: 1, unitPrice: 1000 }])).toBe(330);
  });
});

describe('computeDocumentTotals: a 100% line discount', () => {
  it('WCT group (lineDiscounts): the line counts $0', () => {
    expect(computeDocumentTotals([l2, free], GST, { lineDiscounts: true })).toMatchObject({ grossTotal: 300, gstAmount: 27, nettTotal: 327 });
    // A line given without an amount is priced after its discount too.
    const { amount: _a, ...noAmount } = l1;
    expect(computeDocumentTotals([noAmount], GST, { lineDiscounts: true }).grossTotal).toBe(720);
  });
  it('every other org (no lineDiscounts): unchanged, the 0 amount still falls back to qty x price', () => {
    expect(computeDocumentTotals([l2, free], GST)).toMatchObject({ grossTotal: 500, gstAmount: 45, nettTotal: 545 });
    expect(computeDocumentTotals([l2, free], GST, { lineDiscounts: false })).toMatchObject({ grossTotal: 500, nettTotal: 545 });
    // Lines without a discount are the same either way.
    const plain = [{ quantity: 2, unitPrice: 50, amount: 100 }, { quantity: 1, unitPrice: 30 }];
    expect(computeDocumentTotals(plain, GST, { lineDiscounts: true })).toEqual(computeDocumentTotals(plain, GST));
  });
  it('a remainder invoice with a 100% line (WCT): its total is the paid lines only', () => {
    const items = remainderInvoiceItems([l2, free] as any, 9);
    expect(items.map((i: any) => i.amount)).toEqual([300, 0]);
    expect(computeDocumentTotals(items, GST, { lineDiscounts: true }).nettTotal).toBe(327);
  });
  it('split payment: WCT divides after the 100% line; other orgs as before', () => {
    const inv = { items: [l2, free], ...GST, documentInfo: { ...GST } };
    expect(planInvoiceSplit(inv, { mode: 'rate', parts: [50, 50] }, { lineDiscounts: true }).contractValue).toBe(300);
    expect(planInvoiceSplit(inv, { mode: 'rate', parts: [50, 50] }).contractValue).toBe(500);
  });
});
