import { BadRequestException } from '@nestjs/common';
import { erpImportOf, erpPaidAtImport, erpStoredTotalsOf, isErpImported, moneySignature } from './erp-import';
import { JournalService } from '../journal/journal.service';
import { JournalAutoPostService } from '../journal/journal-auto-post.service';
import { PaymentsService } from '../payments/payments.service';

// ERP-imported history (WCT 2026-11): never posts to the GL; payments on an open one keep what
// the ERP had paid.
const imported = (extra: any = {}) => ({ erpImport: { source: 'wct-erp', batch: 'b1', erpId: '15267', originalNumber: 'I-015128', status: 'Partial', ...extra } });

describe('erp-import helpers', () => {
  it('reads the marker', () => {
    expect(isErpImported(imported())).toBe(true);
    expect(isErpImported({})).toBe(false);
    expect(isErpImported(null)).toBe(false);
    expect(isErpImported({ erpImport: { source: '' } })).toBe(false);
    expect(erpImportOf(imported())?.erpId).toBe('15267');
  });

  it('works out what was paid in the ERP from the import-time balance', () => {
    expect(erpPaidAtImport(imported({ balanceAtImport: 545 }), 1199)).toBe(654);
    expect(erpPaidAtImport(imported({ balanceAtImport: 0 }), 1199)).toBe(1199);
    // An overpaid invoice (negative ERP balance) counts as fully paid, never more.
    expect(erpPaidAtImport(imported({ balanceAtImport: -150 }), 395)).toBe(395);
    expect(erpPaidAtImport(imported(), 1199)).toBe(0); // no balance stamped
    expect(erpPaidAtImport({}, 1199)).toBe(0); // not imported
  });
});

describe('GL guard for imported documents', () => {
  const lines = [
    { accountId: 'a1', debit: 100, credit: 0 },
    { accountId: 'a2', debit: 0, credit: 100 },
  ];
  const journalWith = (config: any) => {
    const prisma: any = {
      chartOfAccount: { findMany: jest.fn().mockResolvedValue([{ id: 'a1' }, { id: 'a2' }]) },
      document: { findFirst: jest.fn().mockResolvedValue({ type: 'INVOICE', status: 'paid', config }) },
    };
    return new JournalService(prisma, {} as any);
  };

  it('refuses an INVOICE journal sourced from an imported document', async () => {
    const svc = journalWith(imported());
    await expect(
      svc.create('org', { entryDate: '2026-11-05', type: 'INVOICE', reference: 'I-015128', sourceDocumentId: 'd1', lines } as any),
    ).rejects.toThrow(BadRequestException);
  });

  it('postFromInvoice skips an imported document', async () => {
    const prisma: any = { document: { findFirst: jest.fn().mockResolvedValue({ config: imported() }) } };
    const journal: any = { create: jest.fn() };
    const auto = new JournalAutoPostService(prisma, journal);
    const res = await auto.postFromInvoice({ organizationId: 'org', documentId: 'd1', entryDate: new Date(), netAmount: 100, taxAmount: 9, grossAmount: 109 });
    expect(res).toBeNull();
    expect(journal.create).not.toHaveBeenCalled();
  });
});

describe('payments on an open imported invoice', () => {
  const run = async (config: any, payments: number[]) => {
    const update = jest.fn().mockResolvedValue({});
    const prisma: any = {
      document: { findFirst: jest.fn().mockResolvedValue({ id: 'd1', name: 'I-015032', type: 'INVOICE', status: 'pending_payment', config }), update },
      payment: { findMany: jest.fn().mockResolvedValue(payments.map((a) => ({ amount: a }))) },
    };
    await new PaymentsService(prisma, {} as any).updateInvoiceStatusAfterPayment('d1', 'org');
    return update.mock.calls[0][0].data;
  };
  const partial = { ...imported({ balanceAtImport: 545 }), totalWithTax: 1199, nettTotal: 1199, outstandingBalance: 545, paidToDate: 654 };

  it('a new payment reduces the ERP balance instead of replacing what the ERP had paid', async () => {
    const data = await run(partial, [200]);
    expect(data.config.outstandingBalance).toBe(345);
    expect(data.config.paidToDate).toBe(854);
    expect(data.status).toBe('pending_payment');
  });

  it('paying the rest marks it paid', async () => {
    const data = await run(partial, [545]);
    expect(data.config.outstandingBalance).toBe(0);
    expect(data.status).toBe('paid');
  });
});

describe('held payment journals (holdErpImportPaymentGl)', () => {
  const mk = (flag: boolean) => {
    const update = jest.fn().mockResolvedValue({});
    const prisma: any = {
      organizationUIConfig: { findUnique: jest.fn().mockResolvedValue({ features: { holdErpImportPaymentGl: flag } }) },
      document: {
        findMany: jest.fn().mockResolvedValue([{ config: imported() }]),
        findFirst: jest.fn().mockResolvedValue({ config: imported() }),
        update,
      },
      accountingSetting: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    const journal: any = { create: jest.fn() };
    return { auto: new JournalAutoPostService(prisma, journal), update, journal };
  };
  const args = { organizationId: 'org', paymentId: 'p1', documentId: 'd1', paymentDate: new Date('2026-11-06'), amount: 200, cashAccountCode: 'CA001' };

  it('holds the journal and records it on the invoice when the flag is on', async () => {
    const { auto, update, journal } = mk(true);
    expect(await auto.postFromPayment(args)).toBeNull();
    expect(journal.create).not.toHaveBeenCalled();
    const held = update.mock.calls[0][0].data.config.erpImport.heldPayments;
    expect(held).toEqual([expect.objectContaining({ paymentId: 'p1', amount: 200, cashAccountCode: 'CA001' })]);
  });

  it('does not hold when the flag is off (posting goes on as before)', async () => {
    const { auto, update } = mk(false);
    await auto.postFromPayment(args); // no accounting setup in the mock, so nothing posts either way
    expect(update).not.toHaveBeenCalled();
  });
});

describe('stored totals of imported documents', () => {
  const cfg = {
    ...imported(),
    items: [{ description: 'a', quantity: 1, unitPrice: 850, amount: 850 }],
    grossTotal: 850,
    subTotal: 850,
    gstAmount: 198,
    nettTotal: 1048,
    gstPercent: 9,
  };
  it('reads the ERP totals as stored (no recalculation)', () => {
    expect(erpStoredTotalsOf(cfg)).toMatchObject({ subTotal: 850, gstAmount: 198, nettTotal: 1048, gstPercent: 9, sig: '1.00x850.00=850.00' });
    expect(erpStoredTotalsOf({ ...cfg, erpImport: undefined })).toBeNull();
  });
  it('the signature ignores descriptions and number formatting, not money', () => {
    expect(moneySignature([{ description: '<p>a</p>', quantity: '1', unitPrice: '850.00', amount: '850' }])).toBe(moneySignature(cfg.items));
    expect(moneySignature([{ quantity: 2, unitPrice: 850, amount: 1700 }])).not.toBe(moneySignature(cfg.items));
  });
});
