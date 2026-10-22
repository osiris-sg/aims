// Round AB (owner): an unconfirmed order ("status" in checkFields — the INALM sample #9) gets no reminders until confirmed.
import { TradeAlertsService } from './trade-alerts.service';
import { ALERTABLE_ORDER, isUnconfirmed, mutedRecordIds, UNCONFIRMED_FLAG } from './trade-test-orders';

const NOW = new Date('2026-10-23T03:00:00Z');

describe('unconfirmed orders are muted for reminders', () => {
  it('isUnconfirmed reads the "status" flag', () => {
    expect(UNCONFIRMED_FLAG).toBe('status');
    expect(isUnconfirmed({ checkFields: ['status'] })).toBe(true);
    expect(isUnconfirmed({ checkFields: ['clientPremium'] })).toBe(false);
    expect(isUnconfirmed({ checkFields: [] })).toBe(false);
    expect(isUnconfirmed(null)).toBe(false);
    expect(ALERTABLE_ORDER).toEqual({ isTest: false, NOT: { checkFields: { has: 'status' } } });
  });

  it('mutedRecordIds covers test orders and unconfirmed orders with their shipments', async () => {
    const findMany = jest.fn().mockResolvedValue([
      { id: 'o28', shipments: [{ id: 's28' }] },
      { id: 'o9', shipments: [] },
    ]);
    const ids = await mutedRecordIds({ tradeOrder: { findMany } } as any, 'org');
    expect(findMany.mock.calls[0][0].where).toEqual({ organizationId: 'org', OR: [{ isTest: true }, { checkFields: { has: 'status' } }] });
    expect([...ids.orderIds]).toEqual(['o28', 'o9']);
    expect([...ids.shipmentIds]).toEqual(['s28']);
  });

  it('plan: the shipment and deposit queries leave unconfirmed orders out; an invoice of one is not chased', async () => {
    const rows = [{ description: '6063', quantity: 20, unit: 'トン', unitPrice: 2500 }];
    const prisma: any = {
      tradeSetting: { findUnique: jest.fn().mockResolvedValue({ alertRules: {} }) },
      shipment: { findMany: jest.fn().mockResolvedValue([]) },
      tradeOrder: { findMany: jest.fn().mockResolvedValue([]) },
      tradeStep: { findMany: jest.fn().mockResolvedValue([]) },
      tradeGeneratedDoc: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'g9', docType: 'INVOICE_1', number: 'ADH-INV-2026-0090', header: { dueDate: '2026-10-30', taxRate: 10 }, rows, orderId: 'o9', shipmentId: null, order: { status: 'OPEN', isTest: false, checkFields: ['status'], customer: { name: 'SUS Co., Ltd.' } }, shipment: null },
          { id: 'g14', docType: 'INVOICE_1', number: 'ADH-INV-2026-0014', header: { dueDate: '2026-10-30', taxRate: 10 }, rows, orderId: 'o14', shipmentId: null, order: { status: 'OPEN', isTest: false, checkFields: [], customer: { name: 'Kato' } }, shipment: null },
        ]),
      },
    };
    const svc = new TradeAlertsService(prisma, {} as any, {} as any, {} as any);
    const planned = await svc.plan('org', NOW);
    expect(planned.map((p) => p.key)).toEqual(['INVOICE_DUE:g14']);
    expect(prisma.shipment.findMany.mock.calls[0][0].where.order).toEqual(ALERTABLE_ORDER);
    expect(prisma.tradeOrder.findMany.mock.calls[0][0].where).toMatchObject({ status: 'OPEN', isTest: false, NOT: { checkFields: { has: 'status' } } });
  });
});
