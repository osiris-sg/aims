import { journalPrefixWhere, journalReferenceHasPrefix } from './journal.service';

// Audit Trail "Document prefix" (guru 2026-11-26: Biofuel's trail was empty for OR — the prefix was applied in
// the browser after the server's 500-journal cap, and "starts with" never matched bank-first receipt numbers).
describe('journal report document prefix', () => {
  it('OR finds bank-first receipt numbers and the ORX series, not invoices', () => {
    expect(journalReferenceHasPrefix('UOBOR2610-004', 'OR')).toBe(true);
    expect(journalReferenceHasPrefix('SCBOR2610-042', 'or')).toBe(true);
    expect(journalReferenceHasPrefix('ORX-0001', 'OR')).toBe(true);
    expect(journalReferenceHasPrefix('INV202611-0004', 'OR')).toBe(false);
    expect(journalReferenceHasPrefix('FORD-001', 'OR')).toBe(false);
  });
  it('INV / PV match their own series; J/V means the manual journals', () => {
    expect(journalReferenceHasPrefix('INV202611-0004', 'INV')).toBe(true);
    expect(journalReferenceHasPrefix('PVX-0002', 'PV')).toBe(true);
    expect(journalReferenceHasPrefix('', 'J/V')).toBe(true);
    expect(journalReferenceHasPrefix('INV202611-0004', 'JV')).toBe(false);
    expect(journalReferenceHasPrefix('anything', '')).toBe(true);
  });
  it('narrows in the query before the cap', () => {
    expect(journalPrefixWhere('OR')).toEqual({ reference: { contains: 'OR', mode: 'insensitive' } });
    expect(journalPrefixWhere('J/V')).toEqual({ OR: [{ reference: null }, { reference: '' }] });
    expect(journalPrefixWhere('  ')).toEqual({});
  });
});
