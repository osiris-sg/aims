/**
 * New job Quotation search index (WCT group, 2026-11-23): what is matched, and that only changed quotations are
 * read again after the first full read.
 */
import { QuotationSearchIndex, entryOf, isOpenQuotation, matchIds } from './quotation-search-index';

const row = (id: string, extra: Record<string, unknown> = {}) => ({
  id, name: `QO202611-${id}`, listSearch: 'acme pte ltd', listCustomerId: 'c1', subject: 'Aircon servicing', dsubject: null, cancelled: null, voided: null,
  createdAt: new Date('2026-11-01T00:00:00Z'), updatedAt: new Date('2026-11-01T00:00:00Z'), ...extra,
});

describe('quotation search index', () => {
  it('matches number, customer text, Subject (either key), a customer found by name; never cancelled or voided', () => {
    const entries = [
      entryOf(row('0001')),
      entryOf(row('0002', { subject: null, dsubject: 'Duct cleaning', listCustomerId: 'c2', listSearch: 'beta' })),
      entryOf(row('0003', { cancelled: 'true' })),
      entryOf(row('0004', { voided: 'true' })),
    ];
    expect(matchIds(entries, { term: '0001' })).toEqual(['0001']);
    expect(matchIds(entries, { term: 'ACME' })).toEqual(['0001']);
    expect(matchIds(entries, { term: 'aircon' })).toEqual(['0001']);
    expect(matchIds(entries, { term: 'duct' })).toEqual(['0002']);
    expect(matchIds(entries, { term: 'zeta', customerIds: new Set(['c2']) })).toEqual(['0002']);
    expect(matchIds(entries, { customerId: 'c2' })).toEqual(['0002']);
    expect(matchIds(entries, {})).toEqual(['0001', '0002']);
  });

  it('first search reads the company once; later ones read only what changed since; newest first', async () => {
    let t = 1_000_000;
    const idx = new QuotationSearchIndex(() => t);
    const calls: any[][] = [];
    const prisma = {
      $queryRawUnsafe: jest.fn(async (...a: any[]) => {
        calls.push(a);
        return a.length === 2
          ? [row('0001'), row('0002', { createdAt: new Date('2026-11-02T00:00:00Z') })]
          : [row('0003', { createdAt: new Date('2026-11-03T00:00:00Z'), updatedAt: new Date('2026-11-03T00:00:00Z') })];
      }),
    };
    expect((await idx.entries(prisma, 'org')).map((e) => e.id)).toEqual(['0002', '0001']);
    await idx.entries(prisma, 'org'); // within 3 s: no read
    expect(calls).toHaveLength(1);
    t += 5_000;
    expect((await idx.entries(prisma, 'org')).map((e) => e.id)).toEqual(['0003', '0002', '0001']);
    expect(calls[1][0]).toMatch(/"updatedAt" >= \$2/);
    expect(calls[1][2]).toEqual(new Date('2026-11-01T00:00:00Z'));
    // Other companies have their own index.
    await idx.entries(prisma, 'other');
    expect(calls[2]).toHaveLength(2);
    expect(calls[2][1]).toBe('other');
  });

  it('open = no order, or an order not paid / closed / complete / cancelled', () => {
    expect(isOpenQuotation(null)).toBe(true);
    expect(isOpenQuotation('OPEN')).toBe(true);
    expect(isOpenQuotation('INVOICED')).toBe(true);
    for (const s of ['PAID', 'CLOSED', 'COMPLETED', 'CANCELLED']) expect(isOpenQuotation(s)).toBe(false);
  });
});
