import { remainingToBill } from './imported-remaining';
import { importedOrderStatus, refreshImportedOrderStatus, IMPORTED_ORDER_SOURCE } from './imported-orders';
import { refreshOrderStatus } from './wct-orders';

/** ORD-Q-014154 (Bar Roque Grill): 2 x Maintenance agreement 1,200 + 10 $0 S- / G- lines; I-014521 billed 1 of 2. */
const zero = (d: string) => ({ description: d, quantity: 1, unitPrice: 0, amount: 0 });
const MA = 'Maintenance agreement of 2 times per year (every 6 months per year) package\n*S$1,200 per service';
const QUOTE = [zero('G- Provide tools, labor and materials'), zero('S- Chemical degreasing for kitchen exhaust hoods'), { description: MA, quantity: 2, unitPrice: 1200, amount: 2400 }, zero('S- Area cleaning')];
const BILLED = [[zero('G- Provide tools, labor and materials'), zero('S- Chemical degreasing for kitchen exhaust hoods'), { description: MA, quantity: 1, unitPrice: 1200, amount: 1200 }, zero('S- Area cleaning')]];

describe('imported orders: what is left to bill (2026-11-19)', () => {
  it('ORD-Q-014154: 1 x Maintenance agreement 1,200 left, the $0 lines kept in the quotation order, "1 of 2"', () => {
    const p = remainingToBill({ quoteItems: QUOTE, billedInvoiceItems: BILLED, quoteTotal: 2616, billed: 1308, gstPercent: 9, quotationNo: 'Q-014154' });
    expect(p.matched).toBe(true);
    expect(p.lines.map((l) => [l.description.split('\n')[0], l.quantity, l.unitPrice, l.amount])).toEqual([
      ['G- Provide tools, labor and materials', 1, 0, 0],
      ['S- Chemical degreasing for kitchen exhaust hoods', 1, 0, 0],
      ['Maintenance agreement of 2 times per year (every 6 months per year) package', 1, 1200, 1200],
      ['S- Area cleaning', 1, 0, 0],
    ]);
    expect(p).toMatchObject({ remainingNet: 1200, remainingGross: 1308, progress: { billed: 1, quoted: 2 } });
    expect(p.partQtyLines).toEqual([{ description: 'Maintenance agreement of 2 times per year (every 6 months per year) package', quoted: 2, billed: 1 }]);
  });
  it('matching ignores case, spacing and punctuation; falls back to the item code', () => {
    const p = remainingToBill({ quoteItems: [{ description: 'Chemical Degreasing, Hood', quantity: 3, unitPrice: 100, amount: 300, itemCode: 'CD1' }], billedInvoiceItems: [[{ description: 'chemical degreasing hood', quantity: 1, unitPrice: 100, amount: 100 }], [{ description: 'other words', quantity: 1, unitPrice: 100, amount: 100, itemCode: 'CD1' }]], quoteTotal: 327, billed: 218, gstPercent: 9 });
    expect(p).toMatchObject({ matched: true, remainingNet: 100, progress: { billed: 2, quoted: 3 } });
  });
  it('fallback: one line for the remaining amount when a billed line matches nothing, or the lines do not add up', () => {
    const odd = remainingToBill({ quoteItems: QUOTE, billedInvoiceItems: [[{ description: 'First service done', quantity: 1, unitPrice: 1200, amount: 1200 }]], quoteTotal: 2616, billed: 1308, gstPercent: 9, quotationNo: 'Q-014154', subject: 'Y2026 Chemical Degreasing' });
    expect(odd.matched).toBe(false);
    expect(odd.lines).toEqual([{ description: 'Balance of quotation Q-014154: Y2026 Chemical Degreasing', quantity: 1, unitPrice: 1200, amount: 1200, quotedQty: null, billedQty: null, priced: true }]);
    // The quotation had a discount: the lines say 1,200 left but only 1,000 + GST is left.
    const disc = remainingToBill({ quoteItems: QUOTE, billedInvoiceItems: BILLED, quoteTotal: 2398, billed: 1308, gstPercent: 9, quotationNo: 'Q-1' });
    expect(disc).toMatchObject({ matched: false, remainingGross: 1090, remainingNet: 1000 });
    expect(remainingToBill({ quoteItems: [zero('a')], billedInvoiceItems: [], quoteTotal: 100, billed: 0, gstPercent: 0, quotationNo: 'Q-2' }).reason).toMatch(/no priced line/);
  });
  it('nothing left: no lines', () => {
    const p = remainingToBill({ quoteItems: QUOTE, billedInvoiceItems: [[{ description: MA, quantity: 2, unitPrice: 1200, amount: 2400 }]], quoteTotal: 2616, billed: 2616, gstPercent: 9 });
    expect(p).toMatchObject({ matched: true, lines: [], remainingGross: 0 });
  });
});

describe('imported orders: status refresh routes imported orders to their own rules', () => {
  const order = (extra: any = {}) => ({
    id: 'o1',
    status: 'PAID',
    sourceQuotationId: 'q1',
    linkedDocuments: { invoice: [{ id: 'i1', name: 'I-014521' }], imported: { source: IMPORTED_ORDER_SOURCE, quoteTotal: 2616, credits: {}, partBilledRule: true, ...extra } },
  });
  const prisma = (o: any) => ({
    order: { findFirst: jest.fn(async () => o), update: jest.fn(async () => ({})) },
    document: { findMany: jest.fn(async () => [{ id: 'i1', status: 'paid', config: { totalWithTax: 1308, outstandingBalance: 0, paidToDate: 1308 } }]), findFirst: jest.fn() },
    organizationUIConfig: { findUnique: jest.fn(async () => ({ features: { enableManualOrderFlow: true } })) },
  });
  it('PAID with 1,308 of 2,616 billed is stored as PART_BILLED; refreshOrderStatus (after a payment) takes the same path', async () => {
    const p: any = prisma(order());
    expect((await refreshImportedOrderStatus(p, 'org', 'o1'))?.status).toBe('PART_BILLED');
    expect(p.order.update).toHaveBeenCalledWith({ where: { id: 'o1' }, data: { status: 'PART_BILLED' } });
    const q: any = prisma(order());
    expect(await refreshOrderStatus(q, 'org', 'o1')).toBe('PART_BILLED');
  });
  it('a completion mark wins (COMPLETED); a native order is left to the native rules', async () => {
    const p: any = prisma(order({ completed: { at: '2026-11-19T00:00:00Z', by: 'u1', byName: 'Elroy', reason: 'Customer cancelled the 2nd service', auto: false } }));
    expect((await refreshImportedOrderStatus(p, 'org', 'o1'))?.status).toBe('COMPLETED');
    const native: any = prisma({ id: 'o2', status: 'OPEN', linkedDocuments: { invoice: [] } });
    expect(await refreshImportedOrderStatus(native, 'org', 'o2')).toBeNull();
    expect(importedOrderStatus([], 0).status).toBe('PAID');
  });
});

describe('imported orders: the 2026-11-19 rule applies only to orders that carry its mark', () => {
  const inv = (gross: number, owed: number | null, paid = 0, extra: any = {}) => ({ status: owed === 0 ? 'paid' : 'pending_payment', config: { totalWithTax: gross, ...(owed == null ? {} : { outstandingBalance: owed }), paidToDate: paid, ...extra } });
  const B = { partBilledRule: true };
  it('without the mark: the 18 Nov rule (all paid = Paid whatever share was billed)', () => {
    expect(importedOrderStatus([inv(1308, 0, 1308)], 2616)).toMatchObject({ status: 'PAID', billedPct: 50 });
    expect(importedOrderStatus([inv(0, 0)], 16692)).toMatchObject({ status: 'INVOICED', billedPct: 0 });
  });
  it('with the mark: Part billed below the quotation total; Invoiced / Paid once billed in full', () => {
    expect(importedOrderStatus([inv(1308, 0, 1308)], 2616, B)).toMatchObject({ status: 'PART_BILLED', label: 'Part billed', billedPct: 50 });
    expect(importedOrderStatus([inv(545, 245, 300)], 1090, B)).toMatchObject({ status: 'PART_BILLED', partPaid: true });
    expect(importedOrderStatus([inv(0, 0)], 16692, B)).toMatchObject({ status: 'PART_BILLED', billed: 0 });
    expect(importedOrderStatus([{ ...inv(500, 0, 500), credit: 500 }], 500, B)).toMatchObject({ status: 'PART_BILLED', credited: 500 });
    expect(importedOrderStatus([inv(500, 0, 500), inv(590, 590)], 1090, B)).toMatchObject({ status: 'INVOICED', label: 'Invoiced, part paid' });
    expect(importedOrderStatus([inv(1090, 0, 1090)], 1090, B)).toMatchObject({ status: 'PAID' });
    expect(importedOrderStatus([inv(600, 0, 600), inv(600, 0, 600)], 1090, B)).toMatchObject({ status: 'PAID', billedPct: 110.1 });
    expect(importedOrderStatus([inv(0, 0)], 0, B)).toMatchObject({ status: 'PAID' });
  });
  it('a draft AIMS invoice is not billed until confirmed; a completion mark wins either way', () => {
    const draft = { status: 'unconfirmed', config: { totalWithTax: 1308, outstandingBalance: 1308 } };
    expect(importedOrderStatus([inv(1308, 0, 1308), draft], 2616, B)).toMatchObject({ status: 'PART_BILLED', billed: 1308 });
    expect(importedOrderStatus([inv(1308, 0, 1308), { ...draft, status: 'pending_payment' }], 2616, B)).toMatchObject({ status: 'INVOICED', billed: 2616 });
    const completed = { at: 'x', by: null, byName: null, reason: 'r', auto: false };
    expect(importedOrderStatus([inv(1308, 0, 1308)], 2616, { completed })).toMatchObject({ status: 'COMPLETED' });
  });
});
