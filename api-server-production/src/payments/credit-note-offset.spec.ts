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
  it('an imported note with nothing applied here keeps its import-time balance', () => {
    expect(creditNoteMoneyAfterApplied({ ...cn, xeroImported: true }, 0)).toBeNull();
    expect(creditNoteMoneyAfterApplied({ ...cn, erpImport: { source: 'x' } }, 0)).toBeNull();
  });

  // VCE's CN202608005: a Manual Offset consumed it, the invoices went to paid,
  // and the note alone kept its 10,680.24 on the statement (guru 2026-11-28).
  it('an imported note applied HERE moves with the offset', () => {
    const imported = { ...cn, xeroImported: true, xeroRemainingCredit: 1635 };
    expect(creditNoteMoneyAfterApplied(imported, 1635)).toMatchObject({ outstandingBalance: 0, paidToDate: 1635 });
    expect(creditNoteMoneyAfterApplied(imported, 600)).toMatchObject({ outstandingBalance: 1035, paidToDate: 600 });
  });

  it('a note already part-used in Xero gives only what was left', () => {
    // 13,736.00 note, 10,094.07 applied in Xero, 3,641.93 still open (Min Dong).
    const partly = { nettTotal: 13736, totalWithTax: 13736, xeroImported: true, xeroRemainingCredit: 3641.93 };
    expect(creditNoteMoneyAfterApplied(partly, 1000)).toMatchObject({ outstandingBalance: 2641.93, paidToDate: 11094.07 });
    // It can never hand back more than Xero left open.
    expect(creditNoteMoneyAfterApplied(partly, 3641.93)).toMatchObject({ outstandingBalance: 0 });
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
