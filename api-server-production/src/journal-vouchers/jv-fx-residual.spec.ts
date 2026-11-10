// Journal Voucher — the realised-FX residual, and the balance guard that would
// have caught it (guru 2026-11-09 J/V-as-a-document).
//
// An offset line on a J/V declares ONE amount on the control account and is
// expanded into one posting per allocated document at that document's
// historical rate. The difference between the declared amount and the expanded
// total is the realised FX, and it has to land on whichever side BALANCES the
// entry — which is the opposite side for a customer line (declared as a credit
// on debtors) from a supplier line (declared as a debit on creditors).
//
// This matters twice over: while the voucher's journal is still unconfirmed a
// re-save rewrites the entry and its lines directly, bypassing
// journalService.create's own balance check, so a wrong side would reach the
// GL with no error at all.

import { fxResidualSides, assertJournalBalances } from './journal-vouchers.service';

const R = (n: number) => Math.round(n * 100) / 100;

/** One foreign invoice settled at its historical rate, 0.14 adrift of the line. */
const DIFF = 0.14;

describe('fxResidualSides', () => {
  it('supplier line: a shortfall in the expansion is made up with a DEBIT (loss)', () => {
    expect(fxResidualSides(DIFF, false)).toEqual({ debit: 0.14, credit: 0 });
    expect(fxResidualSides(-DIFF, false)).toEqual({ debit: 0, credit: 0.14 });
  });

  it('customer line: the same figures mirror — a CREDIT (gain)', () => {
    expect(fxResidualSides(DIFF, true)).toEqual({ debit: 0, credit: 0.14 });
    expect(fxResidualSides(-DIFF, true)).toEqual({ debit: 0.14, credit: 0 });
  });
});

describe('the residual actually balances the voucher', () => {
  // A two-line voucher: the offset line on the control, one ordinary line.
  const build = (isCustomer: boolean) => {
    const declared = 135.14; // the control line as the clerk keyed it, in base
    const expanded = 135.0; // what the allocation posts at its historical rate
    const diff = R(declared - expanded);
    const control = isCustomer
      ? { debit: 0, credit: expanded } // settling a customer invoice credits debtors
      : { debit: expanded, credit: 0 }; // settling a supplier invoice debits creditors
    const other = isCustomer ? { debit: declared, credit: 0 } : { debit: 0, credit: declared };
    return [control, other, fxResidualSides(diff, isCustomer)];
  };

  it('balances on a supplier offset', () => {
    expect(() => assertJournalBalances(build(false), 'JV-000001')).not.toThrow();
  });

  it('balances on a customer offset', () => {
    expect(() => assertJournalBalances(build(true), 'JV-000002')).not.toThrow();
  });

  it('taking the supplier sides on a customer line doubles the gap, and the guard refuses it', () => {
    const [control, other] = build(true);
    const wrong = { debit: 0.14, credit: 0 }; // the supplier sides, as it was
    expect(() => assertJournalBalances([control, other, wrong], 'JV-000003')).toThrow(/does not balance: debit 135.28 vs credit 135.00/);
  });
});

describe('assertJournalBalances', () => {
  it('passes a balanced entry', () => {
    expect(() => assertJournalBalances([{ debit: 10, credit: 0 }, { debit: 0, credit: 10 }], 'JV-1')).not.toThrow();
  });

  it('refuses an entry that is out by a cent, and says nothing was posted', () => {
    expect(() => assertJournalBalances([{ debit: 10.01, credit: 0 }, { debit: 0, credit: 10 }], 'JV-1')).toThrow(/Nothing was posted/);
  });
});
