import { JournalAutoPostService } from './journal-auto-post.service';

// postFromInvoice with per-line revenue accounts: a header discount is spread
// over the line accounts; invoices without one post exactly as before.
function makePoster() {
  const accounts: Record<string, { id: string; code: string }> = {
    CA001: { id: 'acct-ar', code: 'CA001' },
    S100: { id: 'acct-sales', code: 'S100' },
    S200: { id: 'acct-svc', code: 'S200' },
    S300: { id: 'acct-parts', code: 'S300' },
    GST: { id: 'acct-gst', code: 'GST' },
  };
  const prisma: any = { document: { findFirst: jest.fn().mockResolvedValue({ config: {} }) } };
  const journal: any = { create: jest.fn(async (_org: string, dto: any) => ({ id: 'je', journalNumber: 'JV-1', lines: dto.lines })) };
  const auto: any = new JournalAutoPostService(prisma, journal);
  auto.resolveFx = jest.fn().mockResolvedValue({ rate: 1, isForeign: false, currency: 'SGD' });
  auto.getControlAccounts = jest.fn().mockResolvedValue({ debtorControl: 'CA001', salesAccount: 'S100', taxLiabilities: 'GST' });
  auto.resolveAccountByCode = jest.fn(async (_org: string, code: string) => accounts[code] ?? null);
  auto.resolvePerpetualAccounts = jest.fn().mockResolvedValue(null);
  return { auto: auto as JournalAutoPostService, journal };
}
const posted = (journal: any) => journal.create.mock.calls[0][1].lines as Array<{ accountId: string; debit: number; credit: number; description: string }>;
const by = (lines: any[], id: string) => lines.filter((l) => l.accountId === id);
const sum = (lines: any[], k: 'debit' | 'credit') => Math.round(lines.reduce((s, l) => s + l[k], 0) * 100) / 100;

describe('postFromInvoice: header discount', () => {
  it('spreads the discount over the line accounts (no debit plug, total = invoice gross)', async () => {
    const { auto, journal } = makePoster();
    // Lines 60 (S200) + 40 (S300) = 100, header discount 10 -> net 90, GST 8.10, gross 98.10.
    await auto.postFromInvoice({
      organizationId: 'org', documentId: 'd1', invoiceNumber: 'INV-1', entryDate: new Date('2026-11-12'),
      netAmount: 90, taxAmount: 8.1, grossAmount: 98.1,
      revenueLines: [{ accountCode: 'S200', amount: 60 }, { accountCode: 'S300', amount: 40 }],
    });
    const lines = posted(journal);
    expect(by(lines, 'acct-ar')).toEqual([expect.objectContaining({ debit: 98.1, credit: 0 })]);
    expect(by(lines, 'acct-svc')[0].credit).toBe(54);
    expect(by(lines, 'acct-parts')[0].credit).toBe(36);
    expect(by(lines, 'acct-gst')[0].credit).toBe(8.1);
    expect(lines.some((l) => l.description.startsWith('Sales (unmapped)'))).toBe(false);
    expect(sum(lines, 'debit')).toBe(98.1);
    expect(sum(lines, 'credit')).toBe(98.1);
  });

  it('rounding of an uneven split still lands exactly on the gross', async () => {
    const { auto, journal } = makePoster();
    // 3 x 33.33 = 99.99, discount 5% -> net 94.99, GST 8.55, gross 103.54.
    await auto.postFromInvoice({
      organizationId: 'org', documentId: 'd1', invoiceNumber: 'INV-2', entryDate: new Date('2026-11-12'),
      netAmount: 94.99, taxAmount: 8.55, grossAmount: 103.54,
      revenueLines: [{ accountCode: 'S200', amount: 33.33 }, { accountCode: 'S300', amount: 33.33 }, { accountCode: 'S100', amount: 33.33 }],
    });
    const lines = posted(journal);
    expect(sum(lines, 'debit')).toBe(103.54);
    expect(sum(lines, 'credit')).toBe(103.54);
    expect(lines.every((l) => l.accountId === 'acct-ar' || l.debit === 0)).toBe(true);
  });
});

describe('postFromInvoice: no header discount posts exactly as before', () => {
  it('mapped lines that match the net', async () => {
    const { auto, journal } = makePoster();
    await auto.postFromInvoice({
      organizationId: 'org', documentId: 'd1', invoiceNumber: 'INV-3', entryDate: new Date('2026-11-12'),
      netAmount: 100, taxAmount: 9, grossAmount: 109,
      revenueLines: [{ accountCode: 'S200', amount: 60 }, { accountCode: 'S300', amount: 40 }],
    });
    expect(posted(journal).map((l) => [l.accountId, l.debit, l.credit])).toEqual([
      ['acct-ar', 109, 0],
      ['acct-svc', 0, 60],
      ['acct-parts', 0, 40],
      ['acct-gst', 0, 9],
    ]);
  });

  it('an unmapped remainder still goes to Sales as a credit', async () => {
    const { auto, journal } = makePoster();
    await auto.postFromInvoice({
      organizationId: 'org', documentId: 'd1', invoiceNumber: 'INV-4', entryDate: new Date('2026-11-12'),
      netAmount: 100, taxAmount: 9, grossAmount: 109,
      revenueLines: [{ accountCode: 'S200', amount: 60 }],
    });
    expect(posted(journal).map((l) => [l.accountId, l.debit, l.credit])).toEqual([
      ['acct-ar', 109, 0],
      ['acct-svc', 0, 60],
      ['acct-sales', 0, 40],
      ['acct-gst', 0, 9],
    ]);
  });

  it('no line accounts: one Sales credit for the net (discount or not)', async () => {
    const { auto, journal } = makePoster();
    await auto.postFromInvoice({
      organizationId: 'org', documentId: 'd1', invoiceNumber: 'INV-5', entryDate: new Date('2026-11-12'),
      netAmount: 90, taxAmount: 8.1, grossAmount: 98.1,
    });
    expect(posted(journal).map((l) => [l.accountId, l.debit, l.credit])).toEqual([
      ['acct-ar', 98.1, 0],
      ['acct-sales', 0, 90],
      ['acct-gst', 0, 8.1],
    ]);
  });

  it('cent drift between lines and net is still rolled into the largest line', async () => {
    const { auto, journal } = makePoster();
    await auto.postFromInvoice({
      organizationId: 'org', documentId: 'd1', invoiceNumber: 'INV-6', entryDate: new Date('2026-11-12'),
      netAmount: 99.99, taxAmount: 9, grossAmount: 108.99,
      revenueLines: [{ accountCode: 'S200', amount: 60 }, { accountCode: 'S300', amount: 40 }],
    });
    expect(posted(journal).map((l) => [l.accountId, l.debit, l.credit])).toEqual([
      ['acct-ar', 108.99, 0],
      ['acct-svc', 0, 59.99],
      ['acct-parts', 0, 40],
      ['acct-gst', 0, 9],
    ]);
  });
});
