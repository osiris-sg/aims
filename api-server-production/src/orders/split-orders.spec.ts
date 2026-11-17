import { fillEmptyOrderCustomer, refreshOrderStatus } from './wct-orders';

/**
 * Split payment on orders (enableInvoiceSplit, 2026-11-17): the order's status
 * reads ALL parts of a split invoice; nothing changes for an order without one.
 * Plus the ORD202611-013 fix (fill an order's EMPTY customer from its quotation).
 */
const ORG = 'org';
const split = (groupId: string, part: number, of: number, partIds?: string[]) => ({ invoiceSplit: { groupId, part, of, ...(partIds ? { partIds } : {}) } });

/** A manual-flow order: one completed DO billed on invoice i1 (split into i1, i2 when `parts` given). */
function world(statuses: Record<string, string>, parts: boolean) {
  const updates: any[] = [];
  const docs: Record<string, any> = {
    do1: { id: 'do1', type: 'DELIVERY_ORDER', status: 'delivered_installed', config: { orderId: 'o1', orderInvoiceId: 'i1' } },
    i1: { id: 'i1', type: 'INVOICE', status: statuses.i1, config: parts ? split('i1', 1, 2, ['i1', 'i2']) : {} },
    ...(parts ? { i2: { id: 'i2', type: 'INVOICE', status: statuses.i2, config: split('i1', 2, 2) } } : {}),
  };
  const prisma: any = {
    organizationUIConfig: { findUnique: async () => ({ features: { enableWctOrders: true, enableManualOrderFlow: true } }) },
    order: {
      findFirst: async () => ({ id: 'o1', status: 'DO_COMPLETED', statusDates: {}, createdAt: new Date(), linkedDocuments: { invoice: [{ id: 'i1' }] }, invoiceDocumentId: null }),
      update: async (a: any) => updates.push(a),
    },
    delivery: { findMany: async () => [] },
    document: {
      findMany: async ({ where }: any) => {
        if (where.type?.in) return [docs.do1];
        return Object.values(docs).filter((d) => where.id?.in?.includes(d.id) && (!where.type || d.type === where.type));
      },
    },
  };
  return { prisma, updates };
}

describe('order status with split invoices', () => {
  it('no split: unchanged reading', async () => {
    expect(await refreshOrderStatus(world({ i1: 'pending_payment' }, false).prisma, ORG, 'o1')).toBe('READY_FOR_SERVICE_REPORT');
    expect(await refreshOrderStatus(world({ i1: 'paid' }, false).prisma, ORG, 'o1')).toBe('PAID');
  });
  it('a part still a draft keeps the order at Invoice draft (the step ticks only when all parts are sent)', async () => {
    expect(await refreshOrderStatus(world({ i1: 'pending_payment', i2: 'unconfirmed' }, true).prisma, ORG, 'o1')).toBe('INVOICE_DRAFT');
  });
  it('Paid only when every part is paid', async () => {
    expect(await refreshOrderStatus(world({ i1: 'paid', i2: 'pending_payment' }, true).prisma, ORG, 'o1')).toBe('READY_FOR_SERVICE_REPORT');
    expect(await refreshOrderStatus(world({ i1: 'paid', i2: 'paid' }, true).prisma, ORG, 'o1')).toBe('PAID');
  });
});

describe('fillEmptyOrderCustomer (ORD202611-013)', () => {
  const make = (features: any, customer: any) => {
    const calls: any[] = [];
    return {
      calls,
      prisma: {
        organizationUIConfig: { findUnique: async () => ({ features }) },
        customer: { findFirst: async () => customer },
        order: { updateMany: async (a: any) => (calls.push(a), { count: 1 }) },
      },
    };
  };
  it('fills only an EMPTY customer, with a customer of the same org', async () => {
    const w = make({ enableWctOrders: true }, { id: 'c1' });
    expect(await fillEmptyOrderCustomer(w.prisma, ORG, 'q1', 'c1')).toBe(1);
    expect(w.calls).toEqual([{ where: { organizationId: ORG, sourceQuotationId: 'q1', customerId: null }, data: { customerId: 'c1' } }]);
  });
  it('no WCT orders (every other org) or an unknown customer: nothing written', async () => {
    const off = make({}, { id: 'c1' });
    expect(await fillEmptyOrderCustomer(off.prisma, ORG, 'q1', 'c1')).toBe(0);
    expect(off.calls).toEqual([]);
    const none = make({ enableWctOrders: true }, null);
    expect(await fillEmptyOrderCustomer(none.prisma, ORG, 'q1', 'zz')).toBe(0);
    expect(none.calls).toEqual([]);
  });
});
