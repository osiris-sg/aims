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

// 2026-11-23: never one summary line. A deposit / lump sum invoice: every quotation line in full, then "Less:" lines.
describe('balance invoice after a lump sum or deposit', () => {
  const { remainingToBill, lessLineText, invoiceRefOf } = jest.requireActual('./imported-remaining');
  const QUOTE = [
    { description: 'S- Kitchen exhaust', quantity: 1, unitPrice: 0, amount: 0 },
    { description: 'Degrease hood', quantity: 4, unitPrice: 500, amount: 2000, itemCode: 'DG1' },
    { description: 'UV lights', quantity: 2, unitPrice: 750, amount: 1500 },
  ];
  // Quotation 3,500 + 9% GST = 3,815; a 30% deposit invoice billed 1,144.50 (GST incl.).
  it('lists every quotation line in full and one Less line per earlier invoice; total = left to bill', () => {
    const plan = remainingToBill({
      quoteItems: QUOTE,
      billedInvoiceItems: [[{ description: '30% deposit for Q-014151', quantity: 1, unitPrice: 1050, amount: 1050 }]],
      quoteTotal: 3815,
      billed: 1144.5,
      gstPercent: 9,
      quotationNo: 'Q-014151',
      billedInvoices: [{ name: 'INV202611-0012', date: '2026-11-05', gross: 1144.5 }],
    });
    expect(plan.matched).toBe(false);
    expect(plan.lines.map((l: any) => [l.description, l.quantity, l.unitPrice])).toEqual([
      ['S- Kitchen exhaust', 1, 0],
      ['Degrease hood', 4, 500],
      ['UV lights', 2, 750],
      ['Less: INV202611-0012 (05/11/2026)', 1, -1050],
    ]);
    const net = plan.lines.reduce((t: number, l: any) => t + l.amount, 0);
    expect(Math.round(net * 1.09 * 100) / 100).toBe(plan.remainingGross);
    expect(plan.remainingGross).toBe(2670.5);
    expect(plan.lines.some((l: any) => /^Balance of quotation/.test(l.description))).toBe(false);
  });

  it('billed by line: each line with only what is left, fully billed lines skipped (no Less lines)', () => {
    const plan = remainingToBill({
      quoteItems: QUOTE,
      billedInvoiceItems: [[{ description: 'Degrease hood', quantity: 4, unitPrice: 500, amount: 2000 }, { description: 'UV lights', quantity: 1, unitPrice: 750, amount: 750 }]],
      quoteTotal: 3815,
      billed: 2997.5,
      gstPercent: 9,
      billedInvoices: [{ name: 'INV1', date: '2026-11-05', gross: 2997.5 }],
    });
    expect(plan.matched).toBe(true);
    expect(plan.lines.map((l: any) => [l.description, l.quantity])).toEqual([['S- Kitchen exhaust', 1], ['UV lights', 1]]);
  });

  it('a quotation discount is its own Less line so the total still equals what is left', () => {
    const plan = remainingToBill({
      quoteItems: QUOTE,
      billedInvoiceItems: [[{ description: 'Deposit', quantity: 1, unitPrice: 1000, amount: 1000 }]],
      quoteTotal: 3270, // 3,500 less a 500 discount, + 9%
      billed: 1090,
      gstPercent: 9,
      billedInvoices: [{ name: 'INV9', date: '2026-11-01', gross: 1090 }],
    });
    expect(plan.lines.at(-1)).toMatchObject({ description: 'Less: quotation discount', amount: -500 });
    expect(Math.round(plan.lines.reduce((t: number, l: any) => t + l.amount, 0) * 1.09 * 100) / 100).toBe(2180);
  });

  it('a quotation with no priced line keeps the one balance line; the Less text and refs', () => {
    const plan = remainingToBill({ quoteItems: [{ description: 'Note', quantity: 1, unitPrice: 0, amount: 0 }], billedInvoiceItems: [], quoteTotal: 109, billed: 0, gstPercent: 9, quotationNo: 'Q-1', billedInvoices: [] });
    expect(plan.lines).toHaveLength(1);
    expect(lessLineText({ name: 'I-014739', date: '2026-01-31', gross: 1 })).toBe('Less: I-014739 (31/01/2026)');
    expect(invoiceRefOf({ name: null, config: { documentNumber: 'INV7', date: '2026-02-03' } }, 10)).toEqual({ name: 'INV7', date: '2026-02-03', gross: 10 });
  });
});

describe('balance invoice rounding (2026-11-23 review)', () => {
  const { remainingToBill } = jest.requireActual('./imported-remaining');
  it('rounding cents go into the last Less line, never a fake discount line', () => {
    for (let k = 1; k <= 300; k++) {
      const unit = 37 + k * 1.13;
      const net = Math.round(unit * 3 * 100) / 100;
      const total = Math.round(net * 1.09 * 100) / 100;
      const dep = Math.round(total * 0.3 * 100) / 100;
      const plan = remainingToBill({ quoteItems: [{ description: 'Line', quantity: 3, unitPrice: unit, amount: net }], billedInvoiceItems: [[{ description: 'Deposit', quantity: 1, unitPrice: dep, amount: dep }]], quoteTotal: total, billed: dep, gstPercent: 9, billedInvoices: [{ name: 'INV1', date: '2026-11-01', gross: dep }] });
      expect(plan.lines.some((l: any) => /quotation discount|Adjustment/.test(l.description))).toBe(false);
      const sum = plan.lines.reduce((t: number, l: any) => t + l.amount, 0);
      expect(Math.abs(Math.round(sum * 100) / 100 - plan.remainingNet)).toBeLessThan(0.005);
    }
  });
});
