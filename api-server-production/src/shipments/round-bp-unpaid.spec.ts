/** Round BP — Dashboard "Unpaid": rows, due state, sorting / totals, Mark paid. */
import { sortAndTotal, TradeUnpaidService, unpaidState } from './trade-unpaid.service';

const base = { side: 'pay' as const, kind: 'DEPOSIT' as const, orderId: 'o', shipmentId: null, shipmentIds: [], counterparty: 'Vedanta', documentNo: null, paid: 0, note: null, reason: 'step 1 not done', stepId: 's', recordOn: 'step' as const, generatedDocId: null, fileId: null, proofDocType: 'DEPOSIT_PROOF', daysLeft: null, status: 'due' as const };

describe('round BP — Unpaid helpers', () => {
  it('days left / overdue / partly paid / no date', () => {
    expect(unpaidState('2026-11-16', '2026-11-10', 0)).toEqual({ daysLeft: 6, status: 'due' });
    expect(unpaidState('2026-11-06', '2026-11-10', 0)).toEqual({ daysLeft: -4, status: 'overdue' });
    expect(unpaidState('2026-11-16', '2026-11-10', 100)).toEqual({ daysLeft: 6, status: 'partly paid' });
    expect(unpaidState(null, '2026-11-10', 0)).toEqual({ daysLeft: null, status: 'no date' });
  });
  it('sorted by due date (no date last), totals per currency (unknown amounts left out)', () => {
    const r = sortAndTotal([
      { ...base, key: 'a', ref: '#31', dueDate: null, amount: 71100, currency: 'USD' },
      { ...base, key: 'b', ref: '#30', dueDate: '2026-11-06', amount: 35900, currency: 'USD' },
      { ...base, key: 'c', ref: '#18-1', dueDate: '2026-11-20', amount: 11257300, currency: 'JPY' },
      { ...base, key: 'd', ref: '#19-1', dueDate: '2026-11-01', amount: null, currency: 'USD' },
    ]);
    expect(r.rows.map((x) => x.key)).toEqual(['d', 'b', 'c', 'a']);
    expect(r.totals).toEqual({ USD: 107000, JPY: 11257300 });
  });
});

describe('round BP — Unpaid list + Mark paid', () => {
  const setup = () => {
    const prisma: any = {
      tradeStep: {
        findMany: jest.fn(async ({ where }: any) =>
          where.code?.in?.includes('PI_PAYMENT')
            ? [
                { id: 'st1', code: 'PI_PAYMENT', payment: null, order: { id: 'o30', orderNo: 30, piNo: '9331004393', piDate: new Date('2026-11-03'), piAmount: 359000, depositPct: 10, depositAmount: 35900, depositDueDate: new Date('2026-11-06'), depositPaidAt: null, currency: 'USD', supplier: { name: 'Vedanta' } }, shipment: null },
                { id: 'st2', code: 'PI_PAYMENT', payment: { amount: 1, paidAt: '2026-11-05', account: 'DBS' }, order: { id: 'o29', orderNo: 29, piNo: 'x', depositAmount: 1, currency: 'USD', supplier: { name: 'Vedanta' } }, shipment: null },
              ]
            : [{ id: 'rc', orderId: 'o13', code: 'INVOICE_1', status: 'IN_PROGRESS', payment: null, skipReason: null, notApplicable: false, requiredDocTypes: ['INVOICE_SINGLE'] }],
        ),
      },
      tradePaymentAllocation: { findMany: jest.fn(async () => []) },
      tradeGeneratedDoc: {
        findMany: jest.fn(async () => [
          { id: 'g1', docType: 'INVOICE_SINGLE', number: '202611_02', header: { style: 2, taxRate: 10, fxRate: 157.63, dueDate: '2026-11-16', currency: 'USD' }, rows: [{ kind: 'usd', quantity: 1, unitPrice: 1000, taxable: true }], orderId: 'o13', shipmentId: null, order: { id: 'o13', orderNo: 27, status: 'OPEN', isTest: false, customer: { name: 'Kato' } }, shipment: null },
        ]),
      },
      tradeFile: { findFirst: jest.fn(), findMany: jest.fn(async () => []) },
      tradeExtraction: { findMany: jest.fn(async () => []) },
      tradePayment: { create: jest.fn(async () => ({ id: 'p1' })) },
    };
    const due: any = { openItems: jest.fn(async () => [{ stepId: 'st1', due: '2026-11-06' }]) };
    const steps: any = { setPayment: jest.fn(async () => ({})) };
    return { svc: new TradeUnpaidService(prisma, due, steps), steps, prisma };
  };

  it('to pay: the unpaid PI deposit with its PI due date; a recorded payment drops off. To receive: the Kato invoice on its step 2', async () => {
    const { svc } = setup();
    const r = await svc.list('org', '2026-11-10');
    expect(r.pay).toHaveLength(1);
    expect(r.pay[0]).toMatchObject({ ref: '#30', kind: 'DEPOSIT', documentNo: 'PI 9331004393', amount: 35900, dueDate: '2026-11-06', daysLeft: -4, status: 'overdue', stepId: 'st1' });
    expect(r.receive[0]).toMatchObject({ ref: '#27', counterparty: 'Kato', documentNo: 'Invoice 202611_02', amount: 1100, dueDate: '2026-11-16', stepId: 'rc', recordOn: 'step', reason: 'step 2 not done (no receipt recorded)' });
    expect(r.payTotals).toEqual({ USD: 35900 });
  });

  it('Mark paid saves the step payment (date, amount, account, proof)', async () => {
    const { svc, steps } = setup();
    const out = await svc.markPaid('org', { key: 'step:st1', paidAt: '2026-11-06', account: 'DBS' }, { id: 'u', name: 'Sayaka' } as any);
    expect(steps.setPayment).toHaveBeenCalledWith('org', 'st1', { payment: { amount: 35900, currency: 'USD', paidAt: '2026-11-06', account: 'DBS', proofFileId: null } });
    expect(out).toMatchObject({ recorded: 'step', amount: 35900 });
    await expect(svc.markPaid('org', { key: 'step:nope', paidAt: '2026-11-06' }, {} as any)).rejects.toThrow(/no longer unpaid/);
    await expect(svc.markPaid('org', { key: 'step:st1', paidAt: '6/11' }, {} as any)).rejects.toThrow(/date/);
  });
});
