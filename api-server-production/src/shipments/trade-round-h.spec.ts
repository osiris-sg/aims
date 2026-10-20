/**
 * Round H (2026-10, owner feedback): one order process — steps in one order on
 * the order, the Shipments list, "+ New monthly order", the PI fields back on
 * the order, payments as step fields, the intake's subject check and PI table.
 * The pure parts; the service paths run in scripts/smoke-shipments.ts.
 */
import { AWAITING_SHIPMENT, freeTimeLeft, orderCurrentStep, shipmentTab, typesOnEveryShipment } from './shipments.rules';
import { cleanStepPayment, oneToOne, STEP_PAYMENT, stepCash, stepPaymentOf } from './trade-payments';
import { piFieldsToCopy } from './trade-one-process';
import { monthHeader, paidOnSteps } from './orders.service';
import { planDepositAlert } from './trade-alerts';
import { naStepCodes, profileFor, stepOverride } from './trade-profile';
import { piTableMatch, subjectMismatch } from '../ingestion-email/email-triage.rules';

const fail = (m: string): never => {
  throw new Error(m);
};
const st = (displayNo: string, status: string, sortOrder: number, extra: Record<string, unknown> = {}) => ({ code: `S${displayNo}`, title: `Step ${displayNo}`, displayNo, status, sortOrder, isOngoing: false, notApplicable: false, ...extra });

describe('one order process: the steps, in order', () => {
  // Order steps 0, 1, 2, 11, 13 (sortOrder 5, 10, 20, 110, 130); shipment steps 3a–10, 12, 14.
  const order = (s0: string, s1: string, s2: string, s11: string, s13: string) => [st('0', s0, 5), st('1', s1, 10), st('2', s2, 20), st('11', s11, 110), st('13', s13, 130)];
  const ship = (statuses: Record<string, string>) => ['3a', '3b', '4', '5', '6', '7', '8', '9', '10', '12'].map((n, i) => st(n, statuses[n] ?? 'DONE', (i + 1) * 10)).concat([st('14', 'NOT_STARTED', 130, { isOngoing: true })]);

  it('PI not paid yet → "1. …"; no shipment, early steps done → Awaiting shipment (never blank)', () => {
    expect(orderCurrentStep(null, order('DONE', 'IN_PROGRESS', 'NOT_STARTED', 'NOT_STARTED', 'NOT_STARTED'), [])?.label).toBe('1. Step 1');
    // Kato #25 / #26: 0 and 1 done, 2 N/A.
    const kato = order('DONE', 'DONE', 'NOT_STARTED', 'NOT_STARTED', 'NOT_STARTED').map((s) => (s.displayNo === '2' ? { ...s, notApplicable: true } : s));
    expect(orderCurrentStep(null, kato, [])).toEqual(AWAITING_SHIPMENT);
  });
  it('shipment steps 3–10 come before the order\'s 11 and 13', () => {
    const o = order('DONE', 'DONE', 'DONE', 'NOT_STARTED', 'NOT_STARTED');
    expect(orderCurrentStep(null, o, [{ status: 'OPEN', steps: ship({ '7': 'IN_PROGRESS', '8': 'NOT_STARTED', '9': 'NOT_STARTED', '10': 'NOT_STARTED', '12': 'NOT_STARTED' }) }])?.displayNo).toBe('7');
    // Shipment cleared (only 12 left): the order's 11 is next.
    expect(orderCurrentStep(null, o, [{ status: 'OPEN', steps: ship({ '12': 'NOT_STARTED' }) }])?.displayNo).toBe('11');
  });
  it('step 11 counts once EVERY live shipment has its invoice', () => {
    expect(typesOnEveryShipment(['a', 'b'], [{ shipmentId: 'a', docType: 'INVOICE_2' }])).toEqual([]);
    expect(typesOnEveryShipment(['a', 'b'], [{ shipmentId: 'a', docType: 'INVOICE_2' }, { shipmentId: 'b', docType: 'INVOICE_2' }])).toEqual(['INVOICE_2']);
    expect(typesOnEveryShipment(['k'], [{ shipmentId: 'k', docType: 'INVOICE_SINGLE' }])).toEqual(['INVOICE_SINGLE']);
    expect(typesOnEveryShipment([], [])).toEqual([]);
  });
  it('profiles: no PI → order step 1 N/A; SINGLE → step 2 N/A and step 11 is the single invoice', () => {
    const kato = { ...profileFor(null, null), billingMode: 'SINGLE' as const };
    expect(naStepCodes(kato, 'ORDER', { supplierId: 'x', key: 'X', label: 'X', hasPI: false, shippingDocs: null, emailDomains: [] } as any)).toEqual(['PI_PAYMENT', 'INVOICE_1']);
    expect(stepOverride(kato, 'INVOICE_2')).toEqual({ title: 'Issue invoice (single)', requiredDocTypes: ['INVOICE_SINGLE'] });
  });
});

describe('Shipments list', () => {
  const steps = (upTo10Done: boolean) => [st('9', 'DONE', 80), st('10', upTo10Done ? 'DONE' : 'IN_PROGRESS', 90), st('12', 'NOT_STARTED', 110), st('14', 'NOT_STARTED', 130, { isOngoing: true })];
  it('tabs: in transit / arrived / delivered / completed', () => {
    expect(shipmentTab({ status: 'OPEN', eta: '2026-11-01', steps: steps(false) }, '2026-10-20')).toBe('in_transit');
    expect(shipmentTab({ status: 'OPEN', eta: '2026-10-19', steps: steps(false) }, '2026-10-20')).toBe('arrived');
    expect(shipmentTab({ status: 'OPEN', eta: '2026-11-01', dischargeDate: '2026-10-18', steps: steps(false) }, '2026-10-20')).toBe('arrived');
    expect(shipmentTab({ status: 'OPEN', eta: '2026-10-01', steps: steps(true) }, '2026-10-20')).toBe('delivered');
    expect(shipmentTab({ status: 'COMPLETED', steps: [] }, '2026-10-20')).toBe('completed');
  });
  it('free time: DET 4 / DEM 10 from discharge (else ETA), days left', () => {
    const f = freeTimeLeft({ dischargeDate: new Date('2026-10-18'), eta: new Date('2026-10-16') }, { detFreeDays: 4, demFreeDays: 10 }, '2026-10-20')!;
    expect(f).toEqual({ from: 'discharge', det: { ends: '2026-10-22', daysLeft: 2 }, dem: { ends: '2026-10-28', daysLeft: 8 } });
    expect(freeTimeLeft({ eta: '2026-10-10', detFreeDays: 7 }, { detFreeDays: 4, demFreeDays: 10 }, '2026-10-20')!.det.daysLeft).toBe(-3);
    expect(freeTimeLeft({}, { detFreeDays: 4, demFreeDays: 10 }, '2026-10-20')).toBeNull();
  });
});

describe('monthly order (replaces the declaration)', () => {
  it('month header: "Sep 2026 — 4 orders, 600 MT"', () => {
    expect(monthHeader('2026-09', 4, 600)).toBe('Sep 2026 — 4 orders, 600 MT');
    expect(monthHeader('2026-10', 1, 40)).toBe('Oct 2026 — 1 order, 40 MT');
    expect(monthHeader(null, 2, null)).toBe('No ship month — 2 orders');
  });
});

describe('PI fields back on the order', () => {
  it('the supplier order\'s non-blank PI fields win; equal values are left alone', () => {
    const so = { piNo: '9331004128', piDate: new Date('2026-06-30'), piAmount: '1209585', depositPct: '10', depositAmount: '120958.5', depositPaidAt: null, supplierPremium: null };
    const o = { piNo: null, piDate: null, piAmount: 1209585, depositPct: 10, depositAmount: null, depositPaidAt: new Date('2026-07-02'), supplierPremium: 205 };
    expect(piFieldsToCopy(so, o)).toEqual({ piNo: '9331004128', piDate: so.piDate, depositAmount: '120958.5' });
    expect(piFieldsToCopy(so, { ...o, ...piFieldsToCopy(so, o) })).toEqual({});
  });
});

describe('payments as step fields', () => {
  it('amount, date, account, proof; currency by step; null clears', () => {
    expect(cleanStepPayment('PI_PAYMENT', { amount: '44358.724', paidAt: '2026-08-05', account: 'WISE' }, fail)).toEqual({ amount: 44358.72, currency: 'USD', paidAt: '2026-08-05', account: 'WISE', proofFileId: null });
    expect(cleanStepPayment('TAX_FUNDS', { amount: 18386700, paidAt: '2026-08-10', account: 'SMBC_JPY' }, fail)!.currency).toBe('JPY');
    expect(cleanStepPayment('CI_PAYMENT', null, fail)).toBeNull();
    expect(() => cleanStepPayment('BL_DRAFT_APPROVAL', { amount: 1 }, fail)).toThrow('no payment');
    expect(() => cleanStepPayment('PI_PAYMENT', { amount: 1, paidAt: '72026-08-05', account: 'WISE' }, fail)).toThrow('YYYY-MM-DD');
    expect(() => cleanStepPayment('PI_PAYMENT', { amount: 0, paidAt: '2026-08-05', account: 'WISE' }, fail)).toThrow('positive');
    expect(Object.keys(STEP_PAYMENT).sort()).toEqual(['CI_PAYMENT', 'INVOICE_1', 'INVOICE_2', 'LOGISTICS_PAYMENT', 'PI_PAYMENT', 'TAX_FUNDS']);
  });
  it('cash in / out from the steps; a cleared payment ({}) counts nothing', () => {
    const rows = stepCash([
      { code: 'PI_PAYMENT', payment: { amount: 100, currency: 'USD', paidAt: '2026-08-05', account: 'WISE' } },
      { code: 'INVOICE_2', payment: { amount: 250, currency: 'USD', paidAt: '2026-09-01', account: 'CFSB' } },
      { code: 'CI_PAYMENT', payment: {} },
    ]);
    expect(rows.map((r) => `${r.direction} ${r.amount} ${r.paidAt.toISOString().slice(0, 7)}`)).toEqual(['OUT 100 2026-08', 'IN 250 2026-09']);
    expect(stepPaymentOf({})).toBeNull();
  });
  it('reconciliation reads the steps: deposit, CI per shipment, logistics JPY, received', () => {
    const p = (amount: number, currency = 'USD') => ({ amount, currency, paidAt: '2026-08-05', account: 'WISE' });
    const r = paidOnSteps(
      [{ code: 'PI_PAYMENT', payment: p(120958.5) }, { code: 'INVOICE_1', payment: p(50000) }],
      [{ steps: [{ code: 'CI_PAYMENT', payment: p(944256.79) }, { code: 'LOGISTICS_PAYMENT', payment: p(500000, 'JPY') }] }, { steps: [{ code: 'CI_PAYMENT', payment: p(146868.33) }] }],
    );
    expect(r).toEqual({ depositUsd: 120958.5, ciUsd: 1091125.12, importTaxFundedJpy: null, logisticsJpy: 500000, receivedUsd: 50000 });
  });
  it('old Payment rows: only a single allocation for the whole amount is copied', () => {
    expect(oneToOne({ amount: '44358.72', allocations: [{ targetType: 'PI', amount: 44358.72 }] })).toBe(true);
    expect(oneToOne({ amount: 1247670.64, allocations: [{ targetType: 'CI', amount: 944256.79 }, { targetType: 'PI', amount: 303413.85 }] })).toBe(false);
    expect(oneToOne({ amount: 100, allocations: [{ targetType: 'PI', amount: 60 }] })).toBe(false);
  });
  it('the deposit reminder is on the order', () => {
    const a = planDepositAlert({ orderId: 'o1', label: '#19 PI 9331004128', dueDate: new Date('2026-07-03'), paid: false })!;
    expect(a).toMatchObject({ key: 'PAYMENT_DUE:PI:o1', orderId: 'o1', linkUrl: '/portal/shipments/orders/o1', resolved: false });
  });
});

describe('intake', () => {
  it('Mitsui "6005C-8インチ 40T" against a 6063 order → check; against the 6005 order → fine', () => {
    expect(subjectMismatch('【三井倉庫】6005C-8インチ 40T 入庫のご案内', { grade: '6063 HSB', size: '203 MM X 5800 MM', qtyMt: 40 })).toEqual(['grade 6005 ≠ 6063']);
    expect(subjectMismatch('6005C-8インチ 40T', { grade: '6005', size: '203 MM X 5800 MM', qtyMt: 40, netMt: 39.8 })).toEqual([]);
    expect(subjectMismatch('６００５Ｃ－７インチ　２０Ｔ', { grade: '6005', size: '8 inch', qtyMt: 40, netMt: 40.1 })).toEqual(['size 7 inch ≠ 8 inch', 'qty 20 MT ≠ 40 / 40.1 MT']);
    expect(subjectMismatch('Re: B/L 198GX04630', { grade: '6063', qtyMt: 300 })).toEqual([]);
  });
  it('Vedanta PI table → the month\'s order on the contract and grade (PI no. and amount, blanks only)', () => {
    const orders = [
      { id: 'a', orderNo: 18, contractId: 'c', shipMonth: '2026-08', grade: '6063', qtyMt: 300, piNo: null, piAmount: null, status: 'OPEN' },
      { id: 'b', orderNo: 19, contractId: 'c', shipMonth: '2026-08', grade: '6063', qtyMt: 40, piNo: null, piAmount: null, status: 'OPEN' },
      { id: 'x', orderNo: 11, contractId: 'c', shipMonth: '2026-07', grade: '6063', qtyMt: 300, piNo: '9331004128', piAmount: 1209585, status: 'OPEN' },
    ];
    const row = { grade: '6063', contractNo: '454003422', customer: 'SUS', destination: 'Yokohama', qtyMt: 40, qpBasis: "Average LME of MOSS (Aug'26)", pricePerMt: 3980.5, piNo: '9331004210' };
    expect(piTableMatch(row, 'c', '2026-08', orders)).toEqual({ order: orders[1], fields: { piNo: '9331004210', piAmount: 159220 } });
    expect(piTableMatch({ ...row, piNo: '9331004128' }, 'c', '2026-08', orders).fields).toEqual({});
    expect(piTableMatch(row, 'c', '2026-09', orders).order).toBeNull();
  });
});
