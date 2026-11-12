import { DocumentsService } from './documents.service';
import { invoicePostingHeld } from '../common/org-features';

// postInvoicesOnConfirm (WCT group): a draft invoice does not post to the GL;
// it posts when it leaves draft (confirm / status change / emailed).
function makeService(opts: { flag: boolean; status: string; existing?: { id: string; journalNumber: string } | null }) {
  const doc = {
    id: 'inv-1',
    type: 'INVOICE',
    status: opts.status,
    name: 'INV202611-0099',
    config: { date: '2026-11-12', customerName: 'Acme', items: [{ description: 'Service', quantity: 1, unitPrice: 100, amount: 100 }], subTotal: 100, gstAmount: 9, nettTotal: 109 },
  };
  const prisma: any = {
    organizationUIConfig: { findUnique: jest.fn(async () => ({ features: opts.flag ? { postInvoicesOnConfirm: true } : {} })) },
    document: { findFirst: jest.fn(async () => doc) },
    organization: { findUnique: jest.fn(async () => ({ taxRate: 9 })) },
  };
  const journalAutoPost: any = {
    alreadyPostedForDocument: jest.fn(async () => opts.existing ?? null),
    postFromInvoice: jest.fn(async () => ({ id: 'je-new', journalNumber: 'JE-2' })),
  };
  const journalService: any = { void: jest.fn(async () => undefined) };
  const svc: any = Object.create(DocumentsService.prototype);
  Object.assign(svc, { prisma, journalAutoPost, journalService, logDocumentEvent: jest.fn(async () => undefined) });
  return { svc: svc as DocumentsService, doc, journalAutoPost, journalService };
}

describe('invoicePostingHeld', () => {
  it('holds draft and unconfirmed invoices only when the flag is on', () => {
    expect(invoicePostingHeld(true, 'draft')).toBe(true);
    expect(invoicePostingHeld(true, 'unconfirmed')).toBe(true);
    expect(invoicePostingHeld(true, 'confirmed')).toBe(false);
    expect(invoicePostingHeld(true, 'pending_payment')).toBe(false);
    expect(invoicePostingHeld(false, 'unconfirmed')).toBe(false);
  });
});

describe('repostGlForDocument with postInvoicesOnConfirm', () => {
  it('does not post a draft invoice (order flow / DO flow / editor save)', async () => {
    const { svc, doc, journalAutoPost } = makeService({ flag: true, status: 'unconfirmed' });
    await svc.repostGlForDocument('org', doc.id, 'INVOICE', doc.config, doc.name);
    expect(journalAutoPost.postFromInvoice).not.toHaveBeenCalled();
  });

  it('voids an entry left by an earlier draft save', async () => {
    const { svc, doc, journalAutoPost, journalService } = makeService({ flag: true, status: 'draft', existing: { id: 'je-old', journalNumber: 'JE-1' } });
    await svc.repostGlForDocument('org', doc.id, 'INVOICE', doc.config, doc.name);
    expect(journalService.void).toHaveBeenCalledWith('org', 'je-old', undefined);
    expect(journalAutoPost.postFromInvoice).not.toHaveBeenCalled();
  });

  it('posts a confirmed invoice as before', async () => {
    const { svc, doc, journalAutoPost } = makeService({ flag: true, status: 'confirmed' });
    await svc.repostGlForDocument('org', doc.id, 'INVOICE', doc.config, doc.name);
    expect(journalAutoPost.postFromInvoice).toHaveBeenCalledTimes(1);
  });

  it('without the flag a draft still posts on save (every other org)', async () => {
    const { svc, doc, journalAutoPost } = makeService({ flag: false, status: 'unconfirmed' });
    await svc.repostGlForDocument('org', doc.id, 'INVOICE', doc.config, doc.name);
    expect(journalAutoPost.postFromInvoice).toHaveBeenCalledTimes(1);
  });
});

describe('postInvoiceLeavingDraft (status change / emailed)', () => {
  it('posts once the invoice is out of draft and has no entry', async () => {
    const { svc, doc, journalAutoPost } = makeService({ flag: true, status: 'pending_payment' });
    await svc.postInvoiceLeavingDraft('org', doc.id);
    expect(journalAutoPost.postFromInvoice).toHaveBeenCalledTimes(1);
  });

  it('does not repost when an entry already exists', async () => {
    const { svc, doc, journalAutoPost, journalService } = makeService({ flag: true, status: 'pending_payment', existing: { id: 'je-1', journalNumber: 'JE-1' } });
    await svc.postInvoiceLeavingDraft('org', doc.id);
    expect(journalAutoPost.postFromInvoice).not.toHaveBeenCalled();
    expect(journalService.void).not.toHaveBeenCalled();
  });

  it('does nothing while still a draft, or without the flag', async () => {
    const a = makeService({ flag: true, status: 'unconfirmed' });
    await a.svc.postInvoiceLeavingDraft('org', a.doc.id);
    expect(a.journalAutoPost.postFromInvoice).not.toHaveBeenCalled();
    const b = makeService({ flag: false, status: 'pending_payment' });
    await b.svc.postInvoiceLeavingDraft('org', b.doc.id);
    expect(b.journalAutoPost.postFromInvoice).not.toHaveBeenCalled();
  });
});
