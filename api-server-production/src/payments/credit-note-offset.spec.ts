import { creditNoteMoneyAfterApplied, owedOf } from '../common/document-money';
import { PaymentsService } from './payments.service';

/** A credit note consumed by a Manual Offset shows 0 owed (2026-11-24; CN202611-0001 kept 1,635.00 owed). */
describe('credit note money after offsets', () => {
  const cn = { nettTotal: 1635, totalWithTax: 1635, outstandingBalance: 1635, xeroBalance: 1635 };
  it('fully used: 0 owed, applied = gross', () => {
    const out = creditNoteMoneyAfterApplied(cn, 1635);
    expect([out.outstandingBalance, out.xeroBalance, out.paidToDate, out.totalWithTax]).toEqual([0, 0, 1635, 1635]);
    expect(owedOf(out)).toBe(0);
  });
  it('part used, then the offset removed: back to the full amount', () => {
    expect(creditNoteMoneyAfterApplied(cn, 600).outstandingBalance).toBe(1035);
    expect(creditNoteMoneyAfterApplied(cn, 0).outstandingBalance).toBe(1635);
  });
  it('imported credit notes keep their import-time balance', () => {
    expect(creditNoteMoneyAfterApplied({ ...cn, xeroImported: true }, 1635)).toBeNull();
    expect(creditNoteMoneyAfterApplied({ ...cn, erpImport: { source: 'x' } }, 1635)).toBeNull();
  });

  it('the offset path re-stamps a credit note (status unchanged)', async () => {
    const doc = { id: 'cn1', name: 'CN1', type: 'CREDIT_NOTE', status: 'confirmed', config: { ...cn } };
    const update = jest.fn(async () => ({}));
    const prisma: any = { document: { findFirst: async () => doc, update }, payment: { findMany: async () => [{ amount: 1000 }, { amount: 635 }] } };
    const svc = new (PaymentsService as any)(prisma, {} as any);
    await svc.updateInvoiceStatusAfterPayment('cn1', 'org');
    const call: any = update.mock.calls[0];
    expect(call[0].data.status).toBeUndefined();
    expect(call[0].data.config).toMatchObject({ outstandingBalance: 0, paidToDate: 1635 });
  });
});
