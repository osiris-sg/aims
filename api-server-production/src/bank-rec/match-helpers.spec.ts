import { amountsCarriedBy, candidateRef, compactText, documentTokensOf, journalNumbersNamedBy, journalsBehindDocument, sameDayGroups, statementClosingBalance } from './match-helpers';

describe('bank reconciliation candidate helpers (UOBOR2610-002, 2026-11-27)', () => {
  it('compares without hyphens and spaces', () => {
    expect(compactText('UOBOR2610-002')).toBe(compactText('UOBOR2610002'));
    expect(compactText(' UOB OR 2610-002 ')).toBe('uobor2610002');
  });
  it('reads the journals a receipt names and the money it carries', () => {
    const cfg = {
      journalNumber: 'JV-000946',
      repairNote: 'Restored 2026-11-16 … The GL entry for this deposit is JV-XERO-30911 + JV-XERO-30912, imported from Xero — the native JV-000946 was voided as a duplicate.',
      receiptAmount: 200000,
      allocations: [{ documentId: 'a', amount: 99095.76 }, { documentId: 'b', amount: 100904.24 }],
    };
    expect(journalNumbersNamedBy(cfg)).toEqual(['JV-000946', 'JV-XERO-30911', 'JV-XERO-30912']);
    expect(amountsCarriedBy(cfg)).toEqual([200000, 99095.76, 100904.24]);
  });
  it('offers the two same-day Xero journals as one group for the 200,000 deposit', () => {
    const groups = sameDayGroups(
      [
        { id: 'x1', date: '2026-10-02', amount: 99095.76 },
        { id: 'x2', date: '2026-10-02', amount: 100904.24 },
        { id: 'x3', date: '2026-10-02', amount: 59950 },
        { id: 'y1', date: '2026-10-03', amount: 100000 },
        { id: 'y2', date: '2026-10-03', amount: 100000 },
      ],
      200000,
    );
    expect(groups.get('x1')).toEqual({ key: 'g1', size: 2, total: 200000 });
    expect(groups.get('x2')?.key).toBe('g1');
    expect(groups.has('x3')).toBe(false);
    expect(groups.get('y1')?.key).toBe('g2');
    expect(groups.get('y2')?.key).toBe('g2');
  });
  it('never groups across days, never a lone exact line, and survives a busy day', () => {
    expect(sameDayGroups([{ id: 'a', date: '2026-10-02', amount: 100 }, { id: 'b', date: '2026-10-03', amount: 100 }], 200).size).toBe(0);
    expect(sameDayGroups([{ id: 'a', date: '2026-10-02', amount: 200 }, { id: 'b', date: '2026-10-02', amount: 1 }], 200).size).toBe(0);
    const busy = Array.from({ length: 60 }, (_, i) => ({ id: `l${i}`, date: '2026-10-02', amount: 7 + (i % 13) }));
    const t = Date.now();
    sameDayGroups(busy, 999999);
    expect(Date.now() - t).toBeLessThan(500);
  });
});

describe('auto-match through the document a statement line names', () => {
  const d = new Date('2026-10-02T00:00:00.000Z');
  const lines = [
    { id: 'x1', debit: 99095.76, credit: 0, journalEntry: { journalNumber: 'JV-XERO-30911', entryDate: d, sourceDocumentId: null } },
    { id: 'x2', debit: 100904.24, credit: 0, journalEntry: { journalNumber: 'JV-XERO-30912', entryDate: d, sourceDocumentId: null } },
    { id: 'x3', debit: 59950, credit: 0, journalEntry: { journalNumber: 'JV-XERO-30919', entryDate: d, sourceDocumentId: null } },
    { id: 'n1', debit: 200000, credit: 0, journalEntry: { journalNumber: 'JV-000946', entryDate: d, sourceDocumentId: 'rec' } },
  ];
  it('UOBOR2610002 on the statement names receipt UOBOR2610-002 and finds its journals', () => {
    expect(documentTokensOf('UOBOR2610002 Inward Credit-FAST MSK STAR Soil Disposal Pay')).toEqual(['uobor2610002']);
    const receipt = { id: 'rec', config: { date: '2026-10-02', receiptAmount: 200000, allocations: [{ amount: 99095.76 }, { amount: 100904.24 }], repairNote: 'JV-XERO-30911 + JV-XERO-30912' } };
    expect(journalsBehindDocument(receipt, lines).map((l) => l.id)).toEqual(['x1', 'x2', 'n1']);
    const noNote = { id: 'other', config: { date: '2026-10-02', receiptAmount: 200000, allocations: [{ amount: 99095.76 }, { amount: 100904.24 }] } };
    expect(journalsBehindDocument(noNote, lines).map((l) => l.id)).toEqual(['x1', 'x2']);
  });
});

describe('what a candidate row is called', () => {
  const h = { docRef: (t: any, n: any) => (t === 'OFFICIAL_RECEIPT' ? `REC ${n}` : t === 'PAYMENT_VOUCHER' ? `P/V ${n}` : n), isPrefixed: (r: any) => /^(REC|P\/V|INV|J\/V) /.test(String(r || '')) };
  it('a Xero-import journal behind a minted receipt reads REC …, a manual journal J/V …', () => {
    expect(candidateRef({ journalNumber: 'JV-XERO-30911', reference: null, type: 'PAYMENT' }, { type: 'OFFICIAL_RECEIPT', name: 'UOBOR2610-002' }, h)).toBe('REC UOBOR2610-002');
    expect(candidateRef({ journalNumber: 'JV-000946', reference: 'REC UOBOR2610-002', type: 'PAYMENT' }, null, h)).toBe('REC UOBOR2610-002');
    expect(candidateRef({ journalNumber: 'JV-000005', reference: '', type: 'MANUAL' }, null, h)).toBe('J/V 000005');
    expect(candidateRef({ journalNumber: 'JV-XERO-30919', reference: null, type: 'PAYMENT' }, null, h)).toBe('JV-XERO-30919');
  });
});

describe('the statement closing balance', () => {
  const lines = [
    { date: '2026-10-02', runningBalance: 4188210.46 },
    { date: '2026-10-29', runningBalance: 4658048.8 },
    { date: '2026-10-15', runningBalance: 4500000 },
  ];
  it('UOB October: the last running balance beats the extractor\'s stray "4"', () => {
    expect(statementClosingBalance(4, lines)).toEqual({ value: 4658048.8, source: 'running-balance' });
  });
  it('a hand-entered figure wins; without a balance column the extracted figure stands; else nothing', () => {
    expect(statementClosingBalance(4658000, lines, { manual: true })).toEqual({ value: 4658000, source: 'entered' });
    expect(statementClosingBalance(1121380.69, [{ date: '2026-10-30', runningBalance: null }])).toEqual({ value: 1121380.69, source: 'extracted' });
    expect(statementClosingBalance(null, [{ date: '2026-10-30' }])).toEqual({ value: null, source: null });
  });
});
