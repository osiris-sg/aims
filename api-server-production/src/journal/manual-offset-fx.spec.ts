// Manual Offset — the realised-FX residual must land on the side that BALANCES
// the entry, on the AR side and on the AP twin (guru 2026-11-09).
//
// postFromManualOffset names its running totals for the AR orientation
// (`drTotal` from the credit notes, `crTotal` from the invoices). The AP twin
// posts both loops to the opposite column, so the residual has to be mirrored
// as well. It was not, which put the balancing figure on the same side as the
// imbalance and doubled it — and journal.create rejects an unbalanced entry
// only AFTER createOffset has already committed the offset document and its
// BillPayment rows, so the books would be left with settled bills and no
// journal. These tests fail on the unmirrored version.

import { JournalAutoPostService } from './journal-auto-post.service';

const R = (n: number) => Math.round(n * 100) / 100;

/** One USD credit note at 1.40 offset against one USD invoice at 1.35 → a 5.00 residual. */
const RATES: Record<string, number> = { cn1: 1.4, inv1: 1.35 };

function makeService() {
  const created: any[] = [];
  const prisma: any = {
    journalEntry: { findFirst: async () => null },
    accountingSetting: { findUnique: async () => ({ baseCurrency: 'SGD' }) },
  };
  const journal: any = {
    create: async (_org: string, dto: any) => {
      created.push(dto);
      const debit = R(dto.lines.reduce((s: number, l: any) => s + (l.debit || 0), 0));
      const credit = R(dto.lines.reduce((s: number, l: any) => s + (l.credit || 0), 0));
      // Mirrors journal.service validateLines, which throws on an imbalance.
      if (debit !== credit) throw new Error(`Journal does not balance: debit ${debit} ≠ credit ${credit}`);
      return { id: 'je1', journalNumber: 'JV-000001' };
    },
    void: async () => undefined,
  };
  const svc = new JournalAutoPostService(prisma, journal);
  const s = svc as any;
  s.getControlAccounts = async () => ({ debtorControl: 'CA001', creditorControl: 'CL001' });
  s.resolveAccountByCode = async (_org: string, code: string) => ({ id: `acct-${code}`, code, name: code });
  s.historicalRateForDocument = async (_org: string, documentId: string) => RATES[documentId] ?? 1;
  s.resolveFxGainLossAccount = async () => ({ id: 'acct-FX', code: 'FX', name: 'Exchange gain/loss' });
  return { svc, created };
}

const args = (party?: 'customer' | 'supplier') => ({
  organizationId: 'org1',
  offsetDocumentId: 'mo1',
  offsetNumber: 'MO-000001',
  entryDate: new Date('2026-11-09T00:00:00.000Z'),
  customerName: 'ACME',
  ...(party ? { party } : {}),
  debits: [{ documentId: 'inv1', amount: 100, currency: 'USD' }],
  credits: [{ documentId: 'cn1', amount: 100, currency: 'USD' }],
});

describe('postFromManualOffset — realised FX residual', () => {
  it('balances on the AR side, and the residual is a gain', async () => {
    const { svc, created } = makeService();
    await (svc as any).postFromManualOffset(args());
    const lines = created[0].lines;
    const debit = R(lines.reduce((s: number, l: any) => s + (l.debit || 0), 0));
    const credit = R(lines.reduce((s: number, l: any) => s + (l.credit || 0), 0));
    expect(debit).toBe(credit);
    const fx = lines.find((l: any) => l.accountId === 'acct-FX');
    expect(fx).toMatchObject({ debit: 0, credit: 5 });
    expect(fx.description).toContain('gain');
    // AR: the credit note DEBITS the debtor control, the invoice credits it.
    expect(lines.find((l: any) => /credit note/.test(l.description))).toMatchObject({ accountId: 'acct-CA001', debit: 140, credit: 0 });
    expect(lines.find((l: any) => /Offset invoice/.test(l.description))).toMatchObject({ accountId: 'acct-CA001', debit: 0, credit: 135 });
  });

  it('balances on the AP side, with both the control lines and the residual mirrored', async () => {
    const { svc, created } = makeService();
    await (svc as any).postFromManualOffset(args('supplier'));
    const lines = created[0].lines;
    const debit = R(lines.reduce((s: number, l: any) => s + (l.debit || 0), 0));
    const credit = R(lines.reduce((s: number, l: any) => s + (l.credit || 0), 0));
    expect(debit).toBe(credit);
    // Mirrored: the supplier credit note CREDITS the creditor control, the
    // supplier invoice debits it, and the residual therefore sits on the debit
    // side — a loss, not the gain the same figures mean on AR.
    expect(lines.find((l: any) => /credit note/.test(l.description))).toMatchObject({ accountId: 'acct-CL001', debit: 0, credit: 140 });
    expect(lines.find((l: any) => /supplier invoice/.test(l.description))).toMatchObject({ accountId: 'acct-CL001', debit: 135, credit: 0 });
    const fx = lines.find((l: any) => l.accountId === 'acct-FX');
    expect(fx).toMatchObject({ debit: 5, credit: 0 });
    expect(fx.description).toContain('loss');
  });

  it('posts nothing when every item is in the base currency', async () => {
    const { svc, created } = makeService();
    const entry = await (svc as any).postFromManualOffset({
      ...args('supplier'),
      debits: [{ documentId: 'inv1', amount: 100, currency: 'SGD' }],
      credits: [{ documentId: 'cn1', amount: 100, currency: 'SGD' }],
    });
    expect(entry).toBeNull();
    expect(created).toHaveLength(0);
  });
});
