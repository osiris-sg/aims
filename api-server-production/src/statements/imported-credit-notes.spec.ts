import { StatementsService } from './statements.service';
import { confirmPostsToGl } from '../common/erp-import';

// BC Air 2026-11-12: the tracker credit notes are imported as CREDIT_NOTE documents. Their credit is
// already inside the invoice's "Paid in previous system" line, and they never post to the GL.
const erp = (extra: any = {}) => ({ source: 'bcair-tracker', batch: 'b', erpId: 'x', ...extra });
const invoice = { id: 'inv', name: 'SIBA-23-00009', type: 'INVOICE', documentTemplateId: 't', createdAt: new Date('2023-12-01'), config: { date: '2023-12-01', customerId: 'c1', totalWithTax: 650, outstandingBalance: 0, erpImport: erp({ balanceAtImport: 0 }) } };
const cn = (imported: boolean) => ({ id: 'cn', name: 'CNBA-23-0002', type: 'CREDIT_NOTE', documentTemplateId: 't', createdAt: new Date('2023-12-27'), config: { date: '2023-12-27', customerId: 'c1', totalWithTax: 650, outstandingBalance: 0, ...(imported ? { erpImport: erp({ source: 'bcair-cn-tracker', balanceAtImport: 0 }) } : {}) } });

const soa = async (docs: any[]) => {
  const prisma: any = {
    customer: { findFirst: jest.fn().mockResolvedValue({ id: 'c1', name: 'Five & Two' }) },
    document: { findMany: jest.fn().mockResolvedValue(docs) },
    payment: { findMany: jest.fn().mockResolvedValue([]) },
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
