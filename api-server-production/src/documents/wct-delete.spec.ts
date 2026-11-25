import { joinNames, PAID_TIP, wctDeleteVerdict } from './wct-delete';
import { DocumentsService } from './documents.service';

// ⋮ menu Delete (WCT group, owner 2026-11-25): the rule and the bulk delete (journals voided first, refusals kept).
describe('wctDeleteVerdict', () => {
  const base = { name: 'X', paid: false, children: [] as string[] };

  it('a draft quotation / DO / invoice: allowed', () => {
    for (const type of ['QUOTATION', 'DELIVERY_ORDER', 'INVOICE']) expect(wctDeleteVerdict({ ...base, type }).ok).toBe(true);
  });

  it('a confirmed unpaid invoice: allowed (journals are voided by the delete)', () => {
    expect(wctDeleteVerdict({ ...base, type: 'INVOICE' })).toEqual({ ok: true, reason: null });
  });

  it('a paid or part-paid invoice: blocked with the tooltip', () => {
    expect(wctDeleteVerdict({ ...base, type: 'INVOICE', paid: true })).toEqual({ ok: false, reason: PAID_TIP });
  });

  it('a quotation with a DO / invoice made from it: blocked, naming them', () => {
    expect(wctDeleteVerdict({ ...base, type: 'QUOTATION', children: ['DO202611056', 'INV202611-0042'] })).toEqual({ ok: false, reason: 'Delete DO202611056 and INV202611-0042 first' });
  });

  it('a DO with an invoice: blocked; a DO that took stock out: blocked', () => {
    expect(wctDeleteVerdict({ ...base, type: 'DELIVERY_ORDER', children: ['INV202611-0042'] }).reason).toBe('Delete INV202611-0042 first');
    expect(wctDeleteVerdict({ ...base, type: 'DELIVERY_ORDER', stockDeducted: true }).ok).toBe(false);
  });

  it('other types and already-deleted documents: blocked', () => {
    expect(wctDeleteVerdict({ ...base, type: 'BILL' }).ok).toBe(false);
    expect(wctDeleteVerdict({ ...base, type: 'INVOICE', missing: true }).ok).toBe(false);
  });

  it('joinNames', () => {
    expect(joinNames(['A'])).toBe('A');
    expect(joinNames(['A', 'B', 'C', 'A'])).toBe('A, B and C');
  });
});

describe('DocumentsService.wctDelete (bulk mix)', () => {
  it('voids a confirmed invoice’s journals then deletes; leaves the paid invoice and the QO with a DO as they were', async () => {
    const docs: Record<string, any> = {
      draft: { id: 'draft', name: 'QO202611-0071', type: 'QUOTATION', config: {} },
      inv: { id: 'inv', name: 'INV202611-0044', type: 'INVOICE', config: {} },
      paid: { id: 'paid', name: 'INV202611-0045', type: 'INVOICE', config: {} },
      qo: { id: 'qo', name: 'QO202611-0072', type: 'QUOTATION', config: {} },
    };
    const voided: string[] = [];
    const deleted: string[] = [];
    const stub: any = {
      wctDeleteCheck: async () => ({
        draft: { ok: true, reason: null },
        inv: { ok: true, reason: null },
        paid: { ok: false, reason: PAID_TIP },
        qo: { ok: false, reason: 'Delete DO202611058 first' },
      }),
      prisma: {
        document: { findFirst: async ({ where }: any) => docs[where.id] ?? null },
        journalEntry: { findMany: async ({ where }: any) => (where.sourceDocumentId === 'inv' ? [{ id: 'je1' }, { id: 'je2' }] : []) },
      },
      journalService: { void: async (_org: string, id: string) => voided.push(id) },
      softDeleteDraft: async (id: string, _org: string, _actor: any, opts: any) => {
        expect(opts).toEqual({ menuDelete: true });
        deleted.push(id);
      },
      logDocumentEvent: async () => undefined,
    };
    const res = await (DocumentsService.prototype as any).wctDelete.call(stub, ['draft', 'inv', 'paid', 'qo'], 'org');
    expect(deleted).toEqual(['draft', 'inv']);
    expect(voided).toEqual(['je1', 'je2']);
    expect(res).toEqual([
      { id: 'draft', name: 'QO202611-0071', deleted: true, reason: null, journalsVoided: 0 },
      { id: 'inv', name: 'INV202611-0044', deleted: true, reason: null, journalsVoided: 2 },
      { id: 'paid', name: 'INV202611-0045', deleted: false, reason: PAID_TIP, journalsVoided: 0 },
      { id: 'qo', name: 'QO202611-0072', deleted: false, reason: 'Delete DO202611058 first', journalsVoided: 0 },
    ]);
  });
});
