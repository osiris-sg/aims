import { StatementsService } from './statements.service';
import { confirmPostsToGl } from '../common/erp-import';

// BC Air 2026-11-12: the tracker credit notes are imported as CREDIT_NOTE documents. Their credit is
// already inside the invoice's "Paid in previous system" line, and they never post to the GL.
const erp = (extra: any = {}) => ({ source: 'bcair-tracker', batch: 'b', erpId: 'x', ...extra });
const invoice = { id: 'inv', name: 'SIBA-23-00009', type: 'INVOICE', documentTemplateId: 't', createdAt: new Date('2023-12-01'), config: { date: '2023-12-01', customerId: 'c1', totalWithTax: 650, outstandingBalance: 0, erpImport: erp({ balanceAtImport: 0 }) } };
const cn = (imported: boolean) => ({ id: 'cn', name: 'CNBA-23-0002', type: 'CREDIT_NOTE', documentTemplateId: 't', createdAt: new Date('2023-12-27'), config: { date: '2023-12-27', customerId: 'c1', totalWithTax: 650, outstandingBalance: 0, ...(imported ? { erpImport: erp({ source: 'bcair-cn-tracker', balanceAtImport: 0 }) } : {}) } });

const soa = async (docs: any[], payments: any[] = []) => {
  const prisma: any = {
    customer: { findFirst: jest.fn().mockResolvedValue({ id: 'c1', name: 'Five & Two' }) },
    document: { findMany: jest.fn().mockResolvedValue(docs) },
    payment: { findMany: jest.fn().mockResolvedValue(payments) },
  };
  const res: any = await new StatementsService(prisma).generateSOA({ customerId: 'c1', includeAging: false } as any, 'org');
  return res.data;
};

describe('statement of account: imported credit notes', () => {
  it('skips an imported credit note (its credit is already in "Paid in previous system")', async () => {
    const d = await soa([invoice, cn(true)]);
    expect(d.statement.currentBalance).toBe(0);
    expect(d.transactions.filter((t: any) => t.transactionType === 'CREDIT_NOTE')).toHaveLength(0);
  });

  it('still credits a credit note made in AIMS', async () => {
    const d = await soa([{ ...invoice, config: { ...invoice.config, erpImport: undefined, outstandingBalance: 650 } }, cn(false)]);
    expect(d.statement.currentBalance).toBe(0);
    expect(d.transactions.filter((t: any) => t.transactionType === 'CREDIT_NOTE')).toHaveLength(1);
  });
});

// Biofuel 2026-11-16: an account whose history came from Xero. Xero folds a
// credit note into its invoice's AmountDue, so an IMPORTED credit note is
// already inside the "Payment / credits applied" line — but a credit note keyed
// in AIMS afterwards is not, and it used to be hidden too.
const xeroInvoice = { id: 'xinv', name: 'BI202610053', type: 'INVOICE', documentTemplateId: 't', createdAt: new Date('2026-10-01'), config: { date: '2026-10-01', customerId: 'c1', totalWithTax: 1471.5, outstandingBalance: 1471.5, xeroImported: true } };
const nativeCn = { id: 'ncn', name: 'CN202611004', type: 'CREDIT_NOTE', documentTemplateId: 't', createdAt: new Date('2026-11-01'), config: { date: '2026-11-01', customerId: 'c1', totalWithTax: 671.8 } };
const importedCn = { id: 'xcn', name: 'CN-XERO-1', type: 'CREDIT_NOTE', documentTemplateId: 't', createdAt: new Date('2026-09-01'), config: { date: '2026-09-01', customerId: 'c1', totalWithTax: 100, xeroImported: true } };

describe('statement of account: credit notes in a Xero-imported account', () => {
  it('credits a credit note keyed in AIMS even though the account came from Xero', async () => {
    const d = await soa([xeroInvoice, nativeCn]);
    expect(d.transactions.filter((t: any) => t.transactionType === 'CREDIT_NOTE')).toHaveLength(1);
    expect(d.statement.currentBalance).toBe(799.7);
  });

  it('still hides a Xero-imported credit note (it is inside the invoice settlement line)', async () => {
    const d = await soa([xeroInvoice, importedCn]);
    expect(d.transactions.filter((t: any) => t.transactionType === 'CREDIT_NOTE')).toHaveLength(0);
  });

  it('nets off the two legs a Manual Offset writes, so applying a credit moves nothing', async () => {
    const legs = [
      { id: 'p1', documentId: 'xinv', amount: 671.8, paymentDate: new Date('2026-11-05'), paymentMethod: 'offset', reference: 'MO-0001' },
      { id: 'p2', documentId: 'ncn', amount: 671.8, paymentDate: new Date('2026-11-05'), paymentMethod: 'offset', reference: 'MO-0001' },
    ];
    const d = await soa([xeroInvoice, nativeCn], legs);
    // 1471.50 − 671.80 (credit note) − 671.80 (invoice leg) + 671.80 (credit-note leg)
    expect(d.statement.currentBalance).toBe(799.7);
    expect(d.transactions.filter((t: any) => t.transactionType === 'CREDIT_APPLIED')).toHaveLength(1);
  });

  it('drops the application leg of a credit note it does not show', async () => {
    const legs = [{ id: 'p3', documentId: 'xcn', amount: 100, paymentDate: new Date('2026-11-05'), paymentMethod: 'offset', reference: 'MO-0002' }];
    const d = await soa([xeroInvoice, importedCn], legs);
    expect(d.transactions).toHaveLength(1);
    expect(d.statement.currentBalance).toBe(1471.5);
  });
});

// The settlement line ("Payment / credits applied") stands in for money Xero
// had already collected at migration, which has no payment row in AIMS. Since
// October the office keys real receipts, so it must be netted against them per
// INVOICE — asking the account-level "did anything here come from Xero?"
// credited 20 Biofuel customers twice (guru 2026-11-17).
const nativeInvoice = { id: 'ninv', name: 'BI202609020', type: 'INVOICE', documentTemplateId: 't', createdAt: new Date('2026-09-01'), config: { date: '2026-09-01', customerId: 'c1', totalWithTax: 6104, outstandingBalance: 0 } };

describe('statement of account: the Xero settlement line', () => {
  it('does not credit an invoice that was settled by a receipt keyed in AIMS', async () => {
    const receipt = [{ id: 'p9', documentId: 'ninv', amount: 6104, paymentDate: new Date('2026-10-26'), paymentMethod: 'cheque', reference: 'SCBOR2610-048' }];
    const d = await soa([xeroInvoice, nativeInvoice], receipt);
    expect(d.transactions.filter((t: any) => String(t.description).startsWith('Payment / credits applied'))).toHaveLength(0);
    expect(d.statement.currentBalance).toBe(1471.5);
  });

  it('still credits what the import settled, and only the part no receipt covers', async () => {
    const part = { ...nativeInvoice, id: 'pinv', config: { ...nativeInvoice.config, xeroImported: true, outstandingBalance: 0 } };
    const receipt = [{ id: 'p10', documentId: 'pinv', amount: 4000, paymentDate: new Date('2026-10-26'), paymentMethod: 'cheque', reference: 'REC-1' }];
    const d = await soa([part], receipt);
    const line = d.transactions.find((t: any) => String(t.description).startsWith('Payment / credits applied'));
    expect(line.credit).toBe(2104);
    expect(d.statement.currentBalance).toBe(0);
  });
});

describe('confirming a document posts to the GL', () => {
  it('never for an imported credit note', () => {
    expect(confirmPostsToGl(true, 'CREDIT_NOTE', cn(true).config)).toBe(false);
  });
  it('for a credit note made in AIMS, only when it becomes confirmed', () => {
    expect(confirmPostsToGl(true, 'CREDIT_NOTE', cn(false).config)).toBe(true);
    expect(confirmPostsToGl(false, 'CREDIT_NOTE', cn(false).config)).toBe(false);
    expect(confirmPostsToGl(true, undefined, cn(false).config)).toBe(false);
  });
});
