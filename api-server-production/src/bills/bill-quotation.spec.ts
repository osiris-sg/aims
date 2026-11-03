import { lineQuotationsOf, pickQuotation, quotationCandidates, quotationLinesAmount, quotationSummary, taggedSinsView } from './bill-quotation';

// WCT: a supplier invoice's Quotation No. (2026-11-03).
describe('quotation numbers on a supplier invoice', () => {
  it('finds quotation-number tokens in the model refs, reference, notes and lines', () => {
    const c = quotationCandidates({
      quotationRefs: ['Your ref: qo202611-0020'],
      reference: 'PO 123',
      description: 'see QO202611-0021',
      lines: [{ description: 'Exhaust fan install\\nQuote QO202611-0020' }, { description: 'Ducting 2m' }],
    });
    expect(c).toEqual(expect.arrayContaining(['QO202611-0020', 'QO202611-0021']));
    expect(c).not.toContain('PO 123');
    // a ref the model read that is not in the usual QO pattern is still a candidate (matched exactly later)
    expect(quotationCandidates({ quotationRefs: ['Your ref: QO-E2E-12'] })).toEqual(expect.arrayContaining(['QO-E2E-12']));
    expect(quotationCandidates({ lines: [{ description: 'nothing here 12345' }] })).toEqual([]);
    expect(quotationCandidates(null)).toEqual([]);
  });

  it('pre-fills only on exactly one existing quotation; never a guess', () => {
    const ours = [
      { id: 'q20', name: 'QO202611-0020' },
      { id: 'q21', name: 'QO202611-0021' },
    ];
    expect(pickQuotation(['QO202611-0020'], ours)).toEqual({ id: 'q20', name: 'QO202611-0020' });
    expect(pickQuotation(['qo202611-0020', 'QO202611-0020'], ours)).toEqual({ id: 'q20', name: 'QO202611-0020' });
    expect(pickQuotation(['QO202611-0020', 'QO202611-0021'], ours)).toBeNull(); // two of ours: ambiguous
    expect(pickQuotation(['QO202611-0099'], ours)).toBeNull(); // not ours
    expect(pickQuotation(['QO202611-0020', 'QO202611-0099'], ours)).toEqual({ id: 'q20', name: 'QO202611-0020' });
    expect(pickQuotation([], ours)).toBeNull();
  });

  it("the order's Supplier invoices: newest first, total without voided ones", () => {
    const v = taggedSinsView(
      [
        { id: 'a', name: 'INV-1', status: 'confirmed', config: { supplierId: 's1', billDate: '2026-11-01', totalAmount: 100.1 } },
        { id: 'b', name: 'INV-2', status: 'confirmed', config: { supplier: { id: 's2', name: 'Cool Air' }, billDate: '2026-11-03', totalAmount: 50.25 } },
        { id: 'c', name: 'INV-3', status: 'cancelled', config: { supplierId: 's1', billDate: '2026-11-02', totalAmount: 999 } },
      ],
      new Map([['s1', 'Ducts Pte Ltd']]),
    );
    expect(v.rows.map((r) => r.billNumber)).toEqual(['INV-2', 'INV-3', 'INV-1']);
    expect(v.rows.find((r) => r.id === 'a')!.supplierName).toBe('Ducts Pte Ltd');
    expect(v.rows.find((r) => r.id === 'b')!.supplierName).toBe('Cool Air');
    expect(v.rows.find((r) => r.id === 'c')!.void).toBe(true);
    expect(v.total).toBe(150.35);
  });
});

// 2026-11-04: the quotation is per line (one SIN can cover several job sites).
describe('quotations per SIN line', () => {
  const lines = [
    { description: 'Site A fan', amount: 100, quotationId: 'q1', quotationNumber: 'QO202611-0001' },
    { description: 'Site B duct', amount: 40.5, quotationId: 'q2', quotationNumber: 'QO202611-0002' },
    { description: 'Site A labour', amount: 20, quotationId: 'q1', quotationNumber: 'QO202611-0001' },
    { description: 'Delivery', amount: 5 },
  ];
  it('the summary keeps the distinct quotations in line order; the list reads it (lines are stripped there)', () => {
    expect(quotationSummary(lines)).toEqual({ quotationIds: ['q1', 'q2'], quotationNumbers: ['QO202611-0001', 'QO202611-0002'] });
    expect(lineQuotationsOf({ quotationIds: ['q1', 'q2'], quotationNumbers: ['QO202611-0001', 'QO202611-0002'] })).toEqual([{ id: 'q1', number: 'QO202611-0001' }, { id: 'q2', number: 'QO202611-0002' }]);
    expect(lineQuotationsOf({ lines })).toEqual([{ id: 'q1', number: 'QO202611-0001' }, { id: 'q2', number: 'QO202611-0002' }]);
    // A SIN saved before: the old header tag counts for every line.
    expect(lineQuotationsOf({ quotationId: 'q9', quotationNumber: 'QO202611-0009', lines: [{ amount: 1 }] })).toEqual([{ id: 'q9', number: 'QO202611-0009' }]);
    expect(lineQuotationsOf({ lines: [{ amount: 1 }] })).toEqual([]);
  });
  it("the amount of one quotation's lines; the order page lists the SIN with that amount and its whole total", () => {
    expect(quotationLinesAmount({ lines }, 'q1')).toBe(120);
    expect(quotationLinesAmount({ lines }, 'q2')).toBe(40.5);
    expect(quotationLinesAmount({ quotationId: 'q9', lines: [{ amount: 3 }, { amount: 4 }] }, 'q9')).toBe(7);
    const v = taggedSinsView([{ id: 'a', name: 'INV-1', status: 'confirmed', config: { supplierId: 's1', billDate: '2026-11-01', totalAmount: 178.07, lines, ...quotationSummary(lines) } }], new Map([['s1', 'Kool']]), 'q2');
    expect(v.rows[0]).toMatchObject({ quotationAmount: 40.5, totalAmount: 178.07 });
    expect(v.total).toBe(40.5);
  });
});
