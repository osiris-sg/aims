import { crossOrgInvoiceRefsOf, hasAimsLinks, isCrossPlaceholder } from './imported-orders';

describe('cross-company invoices on a BC Air order (2026-11-23)', () => {
  const ld = { crossOrgInvoice: [{ id: 'i1', orgId: 'wct', orgName: 'WCT (S)', name: 'I-1' }, { bad: true }] };
  it('reads only well-formed refs and counts them as AIMS links', () => {
    expect(crossOrgInvoiceRefsOf({ linkedDocuments: ld }).map((r) => r.id)).toEqual(['i1']);
    expect(crossOrgInvoiceRefsOf({ linkedDocuments: {} })).toEqual([]);
    expect(hasAimsLinks({ linkedDocuments: ld })).toBe(true);
  });
  it('$1 or less is a placeholder (shown, not counted)', () => {
    expect(isCrossPlaceholder({ config: { totalWithTax: 1 } })).toBe(true);
    expect(isCrossPlaceholder({ config: { totalWithTax: 0 } })).toBe(true);
    expect(isCrossPlaceholder({ config: { totalWithTax: 1.01 } })).toBe(false);
    expect(isCrossPlaceholder({ config: { totalWithTax: 2250 } })).toBe(false);
  });
});
