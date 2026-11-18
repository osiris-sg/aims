import { JournalAutoPostService } from './journal-auto-post.service';
import { documentGlPostingOn, DOCUMENT_GL_POSTING_FLAG } from '../common/org-features';

// Round BW — "post journals from documents" (enableDocumentGlPosting): ON when the key is missing (every org today),
// OFF only for an explicit false (ADH). With it off no document resolves its control accounts, so nothing posts.
const prismaWith = (features: Record<string, unknown> | null) => ({
  organizationUIConfig: { findUnique: jest.fn().mockResolvedValue(features === null ? null : { features }) },
  accountingSetting: { findUnique: jest.fn().mockResolvedValue({ controlAccounts: { debtorControl: 'CA001' } }) },
});

describe('document GL posting switch', () => {
  it('defaults ON: no config row, no key, or any value but false', async () => {
    for (const f of [null, {}, { [DOCUMENT_GL_POSTING_FLAG]: true }, { [DOCUMENT_GL_POSTING_FLAG]: null }]) {
      expect(await documentGlPostingOn(prismaWith(f) as any, 'org')).toBe(true);
    }
  });
  it('is OFF only for an explicit false', async () => {
    expect(await documentGlPostingOn(prismaWith({ [DOCUMENT_GL_POSTING_FLAG]: false }) as any, 'org')).toBe(false);
  });
  it('an org without the key still gets its control accounts (unchanged behaviour)', async () => {
    const auto = new JournalAutoPostService(prismaWith({ enableAimsChat: true }) as any, {} as any);
    expect(await auto.getControlAccounts('org')).toEqual({ debtorControl: 'CA001' });
  });
  it('with the switch off there are no control accounts, so postFromInvoice posts nothing', async () => {
    const journal = { create: jest.fn() };
    const prisma: any = { ...prismaWith({ [DOCUMENT_GL_POSTING_FLAG]: false }), document: { findFirst: jest.fn().mockResolvedValue({ config: {} }) } };
    const auto: any = new JournalAutoPostService(prisma, journal as any);
    auto.resolveFx = jest.fn().mockResolvedValue({ rate: 1, isForeign: false, currency: 'SGD' });
    expect(await auto.getControlAccounts('org')).toBeNull();
    const r = await auto.postFromInvoice({ organizationId: 'org', documentId: 'd', invoiceNumber: 'INV-1', entryDate: new Date(), customerName: 'X', netAmount: 100, taxAmount: 9, grossAmount: 109 } as any);
    expect(r).toBeNull();
    expect(journal.create).not.toHaveBeenCalled();
  });
});
