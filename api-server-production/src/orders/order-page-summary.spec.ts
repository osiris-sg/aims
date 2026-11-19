import { nativeInvoiceMoney, nativeOrderSummary } from './order-page-summary';

/** Round 24 (2026-11-19): an AIMS order's money summary, read like an imported order's. Pure, display only. */
describe('nativeOrderSummary', () => {
  const MA = 'Maintenance agreement of 2 times per year package';
  const quotation = { name: 'QO202611-0049', config: { gstPercent: 9, totalWithTax: 2616, subject: 'Degreasing', items: [{ description: 'G- Provide tools', quantity: 1, unitPrice: 0, amount: 0 }, { description: MA, quantity: 2, unitPrice: 1200, amount: 2400 }] } };
  const inv = (id: string, status: string, cfg: Record<string, unknown> = {}) => ({ id, status, config: { totalWithTax: 1308, outstandingBalance: 1308, date: '2026-11-10', items: [{ description: MA, quantity: 1, unitPrice: 1200, amount: 1200 }], ...cfg } });

  it('nothing billed yet: the whole quotation is left, nothing owed; a draft does not count', () => {
    const s = nativeOrderSummary({ quotation, invoices: [inv('d1', 'draft')] });
    expect(s).toMatchObject({ quoteTotal: 2616, billed: 0, billedPct: 0, owed: 0, billingSteps: [{ label: '1 of 2', state: 'Draft' }] });
    expect(s.remaining.remainingGross).toBe(2616);
    expect(s.remaining.lines.filter((l) => l.priced)).toEqual([expect.objectContaining({ description: MA, quantity: 2, unitPrice: 1200, amount: 2400 })]);
  });

  it('half billed and part paid: Billed, Billed %, Owed, 1 of 2, one line left', () => {
    const s = nativeOrderSummary({ quotation, invoices: [inv('i1', 'pending_payment', { outstandingBalance: 308, paidToDate: 1000 }), inv('i2', 'draft')] });
    expect(s).toMatchObject({ quoteTotal: 2616, billed: 1308, billedPct: 50, owed: 308 });
    expect(s.billingSteps).toEqual([{ label: '1 of 2', state: 'Part paid' }, { label: '2 of 2', state: 'Draft' }]);
    expect(s.progress).toEqual({ billed: 1, quoted: 2 });
    expect(s.remaining).toMatchObject({ matched: true, remainingGross: 1308, remainingNet: 1200 });
  });

  it('voided invoices (cancelled with the order) and $0 invoices bill nothing; over-billed reads above 100%', () => {
    expect(nativeOrderSummary({ quotation, invoices: [inv('v', 'confirmed', { voided: true })] })).toMatchObject({ billed: 0, owed: 0 });
    expect(nativeOrderSummary({ quotation, invoices: [inv('z', 'paid', { totalWithTax: 0, outstandingBalance: 0, items: [] })] })).toMatchObject({ billed: 0, billedPct: 0 });
    const over = nativeOrderSummary({ quotation, invoices: [inv('a', 'paid', { outstandingBalance: 0, items: [{ description: MA, quantity: 2, unitPrice: 1200, amount: 2400 }], totalWithTax: 2616 }), inv('b', 'paid', { outstandingBalance: 0, items: [{ description: 'Extra filter', quantity: 1, unitPrice: 100, amount: 100 }], totalWithTax: 109 })] });
    expect(over).toMatchObject({ billed: 2725, billedPct: 104.2, owed: 0 });
    expect(over.remaining.remainingGross).toBe(0);
  });

  it('no quotation: no total, no Billed %, nothing left', () => {
    const s = nativeOrderSummary({ quotation: null, invoices: [inv('i1', 'paid', { outstandingBalance: 0 })] });
    expect(s).toMatchObject({ quoteTotal: null, billed: 1308, billedPct: null, owed: 0 });
    expect(s.remaining).toMatchObject({ remainingGross: 0, lines: [] });
  });

  it('a row: gross with GST, owed only once the invoice counts, the invoice date', () => {
    expect(nativeInvoiceMoney(inv('i1', 'pending_payment'))).toEqual({ gross: 1308, owed: 1308, date: '2026-11-10' });
    expect(nativeInvoiceMoney(inv('d1', 'draft'))).toEqual({ gross: 1308, owed: null, date: '2026-11-10' });
    expect(nativeInvoiceMoney({ status: 'confirmed', config: { totalWithTax: 10 }, createdAt: new Date('2026-11-01T02:00:00Z') })).toEqual({ gross: 10, owed: 10, date: '2026-11-01T02:00:00.000Z' });
  });
});
