import { pickQuotation, quotationCandidates, taggedSinsView } from './bill-quotation';

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
