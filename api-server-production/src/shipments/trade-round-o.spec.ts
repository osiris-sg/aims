/**
 * Round O (2026-10-21): no Shipments Home page — reminders live in the bell and
 * the Orders "Tasks" panel; an imported invoice (receipt never tracked) raises
 * no "outstanding" reminder; a live shipment keeps its free-time reminders.
 */
import { NOT_TRACKED_NOTE, planInvoiceAlert, planShipmentAlerts, receiptNotTracked, reconcileAlert, DEFAULT_ALERT_RULES, ShipmentFacts } from './trade-alerts';
import { IMPORT_NOTE } from './trade-open-orders';
import { TradeAlertsService } from './trade-alerts.service';
import { DEFAULT_ORG_FEATURES } from '../organizations/default-features';

const NOW = new Date('2026-10-21T03:00:00Z');

describe('imported invoices: payment not tracked, no reminder', () => {
  it('receiptNotTracked: closed order or imported receipt step, nothing received', () => {
    // ADH-INV-2026-0001 / 0002 on prod: order #11 COMPLETED, steps 2 / 11 DONE, payment null.
    expect(receiptNotTracked({ orderStatus: 'COMPLETED', stepSkipReason: null, paid: 0 })).toBe(true);
    expect(receiptNotTracked({ orderStatus: 'CANCELLED', stepSkipReason: null, paid: 0 })).toBe(true);
    // Step 2 imported "completed before AIMS" on an open order.
    expect(receiptNotTracked({ orderStatus: 'OPEN', stepSkipReason: IMPORT_NOTE, paid: 0 })).toBe(true);
    // A live order: tracked, the due-date reminder applies.
    expect(receiptNotTracked({ orderStatus: 'OPEN', stepSkipReason: null, paid: 0 })).toBe(false);
    expect(receiptNotTracked({ orderStatus: null, stepSkipReason: null, paid: 0 })).toBe(false);
    // A receipt recorded: tracked, whatever the order's state.
    expect(receiptNotTracked({ orderStatus: 'COMPLETED', stepSkipReason: null, paid: 1 })).toBe(false);
    expect(receiptNotTracked({ orderStatus: 'OPEN', stepSkipReason: IMPORT_NOTE, paid: 1333246.2 })).toBe(false);
  });

  it('planInvoiceAlert: an imported invoice is resolved (never raised), its detail says so; a live one is due until paid', () => {
    const base = { id: 'g1', number: 'ADH-INV-2026-0001', customerName: 'SUS Co., Ltd.', dueDate: new Date('2026-07-22'), total: 1333246.2, paid: 0, currency: 'USD', orderId: 'o11', shipmentId: null };
    const imported = planInvoiceAlert({ ...base, imported: true })!;
    expect(imported.resolved).toBe(true);
    expect(imported.detail).toBe(NOT_TRACKED_NOTE);
    expect(imported.key).toBe('INVOICE_DUE:g1');
    const live = planInvoiceAlert(base)!;
    expect(live.resolved).toBe(false);
    expect(live.detail).toBe('USD 1,333,246.20 outstanding.');
  });

  it('reconcile: the existing DUE row of an imported invoice is closed (DONE); nothing is created for a new one', () => {
    const planned = planInvoiceAlert({ id: 'g1', number: 'ADH-INV-2026-0001', customerName: 'SUS', dueDate: new Date('2026-07-22'), total: 1333246.2, paid: 0, currency: 'USD', orderId: 'o11', shipmentId: null, imported: true })!;
    expect(reconcileAlert({ dueAt: planned.dueAt, status: 'DUE', title: planned.title }, planned, NOW)).toEqual({ action: 'update', status: 'DONE', resetNotified: false });
    expect(reconcileAlert(null, planned, NOW)).toEqual({ action: 'none', status: 'DONE', resetNotified: false });
  });

  it('TradeAlertsService.plan: the completed order #11 invoices come out resolved, an open order invoice stays due', async () => {
    const rows = [{ description: '6063', quantity: 100, unit: 'トン', unitPrice: 2500 }];
    const prisma: any = {
      tradeSetting: { findUnique: jest.fn().mockResolvedValue({ alertRules: {} }) },
      shipment: { findMany: jest.fn().mockResolvedValue([]) },
      tradeOrder: { findMany: jest.fn().mockResolvedValue([]) },
      tradeStep: {
        findMany: jest.fn().mockImplementation(({ where }: any) =>
          Promise.resolve(
            where.code
              ? [
                  { orderId: 'o11', code: 'INVOICE_1', payment: null, skipReason: null },
                  { orderId: 'o11', code: 'INVOICE_2', payment: null, skipReason: null },
                  { orderId: 'o14', code: 'INVOICE_1', payment: null, skipReason: null },
                ]
              : [],
          ),
        ),
      },
      tradeGeneratedDoc: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'g1', docType: 'INVOICE_1', number: 'ADH-INV-2026-0001', header: { dueDate: '2026-07-22', taxRate: 10 }, rows, orderId: 'o11', shipmentId: null, order: { status: 'COMPLETED', customer: { name: 'SUS Co., Ltd.' } }, shipment: null },
          // Invoice #2 hangs off the shipment: the order comes through shipment.order.
          { id: 'g2', docType: 'INVOICE_2', number: 'ADH-INV-2026-0002', header: { dueDate: '2026-10-14', taxRate: 10, variant: 'final' }, rows, orderId: null, shipmentId: 's11', order: null, shipment: { orderId: 'o11', order: { status: 'COMPLETED', customer: { name: 'SUS Co., Ltd.' } } } },
          { id: 'g3', docType: 'INVOICE_1', number: 'ADH-INV-2026-0009', header: { dueDate: '2026-10-30', taxRate: 10 }, rows, orderId: 'o14', shipmentId: null, order: { status: 'OPEN', customer: { name: 'Kato' } }, shipment: null },
        ]),
      },
    };
    const svc = new TradeAlertsService(prisma, {} as any, {} as any, {} as any);
    const planned = await svc.plan('org', NOW);
    const byKey = Object.fromEntries(planned.map((p) => [p.key, p]));
    expect(byKey['INVOICE_DUE:g1'].resolved).toBe(true);
    expect(byKey['INVOICE_DUE:g1'].detail).toBe(NOT_TRACKED_NOTE);
    expect(byKey['INVOICE_DUE:g2'].resolved).toBe(true);
    expect(byKey['INVOICE_DUE:g3'].resolved).toBe(false);
    expect(byKey['INVOICE_DUE:g3'].detail).toMatch(/outstanding/);
    // The receipt is read from the ORDER's step (shipment steps are N/A "moved to the order").
    expect(prisma.tradeStep.findMany.mock.calls[0][0].where).toMatchObject({ shipmentId: null, code: { in: ['INVOICE_1', 'INVOICE_2'] } });
  });
});

describe('free-time reminders follow the round I #20 rule', () => {
  const s14: ShipmentFacts = { id: 's14', ref: '#14-1', orderId: 'o14', status: 'OPEN', eta: new Date('2026-10-16T00:00:00Z'), dischargeDate: null, detFreeDays: null, demFreeDays: null, hasCi: false, hasAn: false, taxFunded: false, cleared: false };
  it('#14-1: open, step 3a in progress — genuinely live, the detention reminder stays', () => {
    const out = planShipmentAlerts(s14, DEFAULT_ALERT_RULES);
    const det = out.find((a) => a.key === 'FREE_TIME:DET:s14')!;
    expect(det.title).toBe('#14-1: detention free time ends 2026-10-20');
    expect(det.resolved).toBe(false);
    expect(reconcileAlert({ dueAt: det.dueAt, status: 'DUE', title: det.title }, det, NOW)).toEqual({ action: 'none', status: 'DUE', resetNotified: false });
  });
  it('delivered / past step 9 (or imported past it), or closed: auto-closed', () => {
    expect(planShipmentAlerts({ ...s14, cleared: true }, DEFAULT_ALERT_RULES).every((a) => a.resolved)).toBe(true);
    expect(planShipmentAlerts({ ...s14, status: 'COMPLETED' }, DEFAULT_ALERT_RULES).every((a) => a.resolved)).toBe(true);
  });
});

describe('enableShipmentsHome', () => {
  it('is a known org flag, off by default (no Home page — Orders is the landing)', () => {
    expect(DEFAULT_ORG_FEATURES.enableShipmentsHome).toBe(false);
  });
});
