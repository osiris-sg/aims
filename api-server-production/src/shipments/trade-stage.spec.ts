/** Round AM — plain-word Order / Supplier statuses from the steps. */
import { orderStage, supplierStage, StageOrder, StageShipment } from './trade-stage';

const st = (code: string, status = 'DONE', notApplicable = false) => ({ code, status, notApplicable });
const ship = (o: Partial<StageShipment> = {}): StageShipment => ({ status: 'OPEN', blNumber: '198GX06523', etd: '2026-10-06', eta: '2026-11-01', steps: [], ...o });
const order = (o: Partial<StageOrder> = {}): StageOrder => ({ status: 'OPEN', piNo: null, piDate: null, supplierDone: false, steps: [], shipments: [], ...o });
const T = '2026-10-26';

describe('order stage', () => {
  it('runs Waiting → Invoice #1 → In transit → Docs sent → Arrived → Delivered → Final invoice → Completed', () => {
    expect(orderStage(order(), null, T)).toBe('WAITING_SHIPMENT');
    expect(orderStage(order(), ship({ blNumber: null }), T)).toBe('WAITING_SHIPMENT');
    expect(orderStage(order(), ship({ etd: '2026-11-05' }), T)).toBe('WAITING_SHIPMENT'); // B/L no. known, not on board yet
    expect(orderStage(order({ steps: [st('INVOICE_1', 'NOT_STARTED')] }), ship(), T)).toBe('INVOICE_1_TO_SEND');
    expect(orderStage(order({ steps: [st('INVOICE_1', 'NOT_STARTED', true)] }), ship(), T)).toBe('IN_TRANSIT'); // Kato: N/A
    expect(orderStage(order(), ship(), T)).toBe('IN_TRANSIT');
    expect(orderStage(order(), ship({ steps: [st('SEND_DOCS_SCHEDULE')] }), T)).toBe('DOCS_SENT');
    expect(orderStage(order(), ship({ eta: '2026-10-20' }), T)).toBe('ARRIVED');
    expect(orderStage(order(), ship({ actualArrivalDate: '2026-11-01', eta: '2026-11-01' }), T)).toBe('ARRIVED');
    const a = ship({ status: 'COMPLETED' });
    const b = ship({ blNumber: '198GX06522' });
    expect(orderStage(order({ shipments: [a, b] }), a, T)).toBe('DELIVERED');
    expect(orderStage(order({ shipments: [a], steps: [st('INVOICE_2', 'NOT_STARTED')] }), a, T)).toBe('FINAL_INVOICE');
    expect(orderStage(order({ shipments: [a], steps: [st('INVOICE_2'), st('XERO_HANDOFF')] }), a, T)).toBe('COMPLETED');
    expect(orderStage(order({ status: 'COMPLETED' }), null, T)).toBe('COMPLETED');
    expect(orderStage(order({ steps: [st('INVOICE_2', 'NOT_STARTED')] }), ship({ steps: [st('LOGISTICS_PAYMENT')] }), T)).toBe('FINAL_INVOICE');
  });
});

describe('supplier stage', () => {
  it('runs — → PI received → Deposit paid → Shipped → CI received → Balance paid → Done', () => {
    expect(supplierStage(order(), null, T)).toBe('NONE');
    expect(supplierStage(order({ piNo: '9331004321' }), null, T)).toBe('PI_RECEIVED');
    expect(supplierStage(order({ piNo: '9331004321', steps: [st('PI_PAYMENT')] }), null, T)).toBe('DEPOSIT_PAID');
    expect(supplierStage(order({ steps: [st('PI_PAYMENT')] }), ship(), T)).toBe('SHIPPED');
    expect(supplierStage(order(), ship({ ciNumber: 'XP2652101584' }), T)).toBe('CI_RECEIVED');
    expect(supplierStage(order(), ship({ steps: [st('CI_PAYMENT')] }), T)).toBe('BALANCE_PAID');
    expect(supplierStage(order({ supplierDone: true }), ship(), T)).toBe('DONE');
    // No-PI supplier (step 1 N/A): nothing before shipping.
    expect(supplierStage(order({ steps: [st('PI_PAYMENT', 'NOT_STARTED', true)] }), null, T)).toBe('NONE');
  });
});
