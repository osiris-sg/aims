import { linkedDocIdsForNumber, orderMemberIds, wantsLinkedSearch } from './linked-number-search';

describe('list search through the links (WCT group)', () => {
  it('only a number-like term (a digit, 3+ characters) searches the links', () => {
    expect(wantsLinkedSearch('ORD202611-018')).toBe(true);
    expect(wantsLinkedSearch('pizza')).toBe(false);
    expect(wantsLinkedSearch('12')).toBe(false);
  });

  it("an order's members: its quotation, order invoice and every linked list entry", () => {
    expect(orderMemberIds({ sourceQuotationId: 'q', invoiceDocumentId: 'i', linkedDocuments: { do: [{ id: 'd' }], invoice: [{ id: 'i2' }, null], quotation: [{ id: 'q2' }], imported: { x: 1 } } }).sort()).toEqual(['d', 'i', 'i2', 'q', 'q2']);
    expect(orderMemberIds({ linkedDocuments: null })).toEqual([]);
  });

  it('a name search runs no query at all', async () => {
    const prisma = { $queryRawUnsafe: jest.fn() };
    expect(await linkedDocIdsForNumber(prisma, 'org', 'pizza')).toEqual([]);
    expect(prisma.$queryRawUnsafe).not.toHaveBeenCalled();
  });
});
