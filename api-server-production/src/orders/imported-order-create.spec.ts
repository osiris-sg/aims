import { ensureImportedQuotationOrder, REFERENCE_LINK_BATCH } from './imported-order-create';
import { remainderInvoiceIdsOf } from './wct-orders';

// Round 40 (Elroy 2026-11-20): an old ERP quotation picked in a Reference gets its imported order.
describe('ensureImportedQuotationOrder', () => {
  const quotation = { id: 'q1', name: 'Q-014000', config: { date: '2026-03-04', subject: 'Degreasing', location: 'Site 1', totalWithTax: 1090, erpImport: { source: 'wct-erp', status: 'Accepted' } } };
  function make(existing: any = null, clash: any = null) {
    const created: any[] = [];
    const tx: any = {
      $executeRawUnsafe: jest.fn(async () => 0),
      order: {
        findFirst: jest.fn(async ({ where }: any) => (where.sourceQuotationId ? existing : where.orderNumber ? clash : null)),
        create: jest.fn(async ({ data }: any) => (created.push(data), { id: 'o-new', orderNumber: data.orderNumber })),
      },
    };
    const prisma: any = { order: { findFirst: jest.fn(async () => existing) }, $transaction: jest.fn(async (fn: any) => fn(tx)) };
    return { prisma, tx, created };
  }

  it('makes ORD-<quotation no.> with the import marker, the customer and the quotation date, under the quotation lock', async () => {
    const { prisma, tx, created } = make();
    expect(await ensureImportedQuotationOrder(prisma, 'wct', quotation, 'c1')).toEqual({ orderId: 'o-new', orderNumber: 'ORD-Q-014000', created: true });
    expect(tx.$executeRawUnsafe).toHaveBeenCalledWith(expect.stringContaining('pg_advisory_xact_lock'), 'wct-order:q1');
    expect(created[0]).toMatchObject({ orderNumber: 'ORD-Q-014000', organizationId: 'wct', customerId: 'c1', sourceQuotationId: 'q1', status: 'PART_BILLED', createdAt: new Date('2026-03-04T01:00:00.000Z') });
    expect(created[0].linkedDocuments.imported).toMatchObject({ source: 'erp-import', batch: REFERENCE_LINK_BATCH, quotationNo: 'Q-014000', subject: 'Degreasing', site: 'Site 1', quoteTotal: 1090, partBilledRule: true });
    expect(created[0].linkedDocuments.invoice).toEqual([]);
  });

  it('an order already there (or made at the same moment) is returned, never a second one', async () => {
    const { prisma, created } = make({ id: 'o1', orderNumber: 'ORD-Q-014000' });
    expect(await ensureImportedQuotationOrder(prisma, 'wct', quotation, 'c1')).toEqual({ orderId: 'o1', orderNumber: 'ORD-Q-014000', created: false });
    expect(created).toEqual([]);
  });

  it('a clashing order number is refused', async () => {
    const { prisma } = make(null, { id: 'other' });
    await expect(ensureImportedQuotationOrder(prisma, 'wct', quotation, 'c1')).rejects.toThrow(/already exists/);
  });
});

describe('remainderInvoiceIdsOf (round 40)', () => {
  it("a non-manual WCT order reads its remainder invoices and its linked ones, not the import's own", () => {
    expect(remainderInvoiceIdsOf({ linkedDocuments: { invoice: [{ id: 'a', remainder: true }, { id: 'b', linked: { at: 'x' } }, { id: 'c' }] } })).toEqual(['a', 'b']);
    expect(remainderInvoiceIdsOf({ linkedDocuments: {} })).toEqual([]);
  });
});
