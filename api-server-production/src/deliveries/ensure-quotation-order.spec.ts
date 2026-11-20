import { ensureQuotationOrder } from './quotation-to-delivery';

// Round 39 (WCT group): a Reference link to a quotation that already has its order never makes a second one.
describe('ensureQuotationOrder', () => {
  it('returns the existing order without opening a transaction', async () => {
    const prisma: any = {
      order: { findFirst: jest.fn(async () => ({ id: 'o1', orderNumber: 'ORDW202611-004' })) },
      $transaction: jest.fn(),
    };
    await expect(ensureQuotationOrder(prisma, 'org', { id: 'q1', name: 'QO1', config: {} })).resolves.toEqual({ orderId: 'o1', orderNumber: 'ORDW202611-004', created: false });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
