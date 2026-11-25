import { classifyNgInvoice, hasNgMark, isNgPlaceholderTotal, mapAccount, ngActionOf, ngImportPlacement, ngSubjectOf, CoaRow } from './wct-ng';

// "(NG)" documents to BC Air (WCT group, owner + finance 2026-11-25).
describe('wct-ng: the "(NG)" mark and the subject', () => {
  it('finds the mark anywhere, any case', () => {
    expect(hasNgMark('(NG) Chemical Degreasing')).toBe(true);
    expect(hasNgMark('Chemical Degreasing (NG) @ 510 Macpherson')).toBe(true);
    expect(hasNgMark('(ng) troubleshooting')).toBe(true);
    expect(hasNgMark('NG Chemical Degreasing', 'ANG MO KIO')).toBe(false);
    expect(hasNgMark(null, undefined, '')).toBe(false);
    expect(hasNgMark('', '(NG) in the reference')).toBe(true);
  });
  it('reads the subject, else documentInfo.subject', () => {
    expect(ngSubjectOf({ subject: ' (NG) A ' })).toBe('(NG) A');
    expect(ngSubjectOf({ subject: '', documentInfo: { subject: '(NG) B' } })).toBe('(NG) B');
    expect(ngSubjectOf({})).toBe('');
    expect(ngSubjectOf(null)).toBe('');
  });
});

describe('wct-ng: the $1 placeholder rule', () => {
  it('is $1.00 or $1 plus the old GST ($1.07 / $1.08)', () => {
    for (const t of [1, '1.00', 1.07, 1.08, '$1.08']) expect(isNgPlaceholderTotal(t)).toBe(true);
    for (const t of [0, 2, 1.09, 0.99, 1.5, null, undefined, '', 'x']) expect(isNgPlaceholderTotal(t)).toBe(false);
  });
  it('classifies: placeholder needs ERP-imported + the mark + a placeholder total', () => {
    expect(classifyNgInvoice({ subject: '(NG) A', total: 1, erpImported: true })).toBe('placeholder');
    // The 4 with "(NG)" not at the start, and the old-GST totals.
    expect(classifyNgInvoice({ subject: 'AA - Fan (NG) @ Blk 1', total: 1, erpImported: true })).toBe('placeholder');
    expect(classifyNgInvoice({ subject: '(NG) A', total: 1.08, erpImported: true })).toBe('placeholder');
    expect(classifyNgInvoice({ subject: '(NG) A', total: 1.07, erpImported: true })).toBe('placeholder');
    // A native (not imported) $1 "(NG)" invoice is never a placeholder.
    expect(classifyNgInvoice({ subject: '(NG) A', total: 1, erpImported: false })).toBe('real');
    expect(classifyNgInvoice({ subject: '(NG) A', total: 0, erpImported: true })).toBe('zero');
    expect(classifyNgInvoice({ subject: '(NG) A', total: 2, erpImported: true })).toBe('real');
    expect(classifyNgInvoice({ subject: '(NG) A', total: 163.5, erpImported: true })).toBe('real');
    // No mark: linked to a BC Air quotation, or not NG at all.
    expect(classifyNgInvoice({ subject: 'Degreasing', total: 1, erpImported: true, linkedToNgQuotation: true })).toBe('linked');
    expect(classifyNgInvoice({ subject: 'Degreasing', total: 1, erpImported: true })).toBe('none');
  });
  it('acts: remove placeholders, move zero (or remove) and real, keep linked unless asked', () => {
    expect(ngActionOf('placeholder')).toBe('remove');
    expect(ngActionOf('placeholder', { placeholders: 'move', zero: 'remove' })).toBe('move');
    expect(ngActionOf('zero', { placeholders: 'move', zero: 'remove' })).toBe('remove');
    expect(ngActionOf('zero')).toBe('move');
    expect(ngActionOf('zero', { zero: 'remove' })).toBe('remove');
    expect(ngActionOf('real')).toBe('move');
    expect(ngActionOf('real', { zero: 'remove' })).toBe('move');
    expect(ngActionOf('linked')).toBe('keep');
    expect(ngActionOf('linked', { includeLinked: true })).toBe('move');
    expect(ngActionOf('none', { includeLinked: true, zero: 'remove' })).toBe('keep');
  });
});

describe('wct-ng: where a new ERP document lands (weekly catch-up)', () => {
  it('never imports a $1 "(NG)" placeholder invoice', () => {
    expect(ngImportPlacement({ kind: 'INVOICE', subject: '(NG) A', total: '1.00' })).toBe('skip');
    expect(ngImportPlacement({ kind: 'INVOICE', subject: 'A', reference: '(NG) A', total: '1.07' })).toBe('skip');
  });
  it('puts other "(NG)" documents in the non-GST company', () => {
    expect(ngImportPlacement({ kind: 'INVOICE', subject: '(NG) A', total: '0.00' })).toBe('ng');
    expect(ngImportPlacement({ kind: 'INVOICE', subject: '(NG) A', total: '1,350.00' })).toBe('ng');
    // A quotation is never skipped, whatever its total.
    expect(ngImportPlacement({ kind: 'QUOTATION', subject: '(NG) A', total: '1.00' })).toBe('ng');
    expect(ngImportPlacement({ kind: 'DELIVERY_ORDER', subject: '(NG) A' })).toBe('ng');
  });
  it('leaves everything without the mark where it was (WCT (S), and any other org)', () => {
    expect(ngImportPlacement({ kind: 'INVOICE', subject: 'Degreasing', total: '1.00' })).toBe('main');
    expect(ngImportPlacement({ kind: 'QUOTATION', subject: 'NG Kitchen', reference: '' })).toBe('main');
    expect(ngImportPlacement({ kind: 'INVOICE', subject: undefined, total: undefined })).toBe('main');
  });
});

describe('wct-ng: WCT (S) account -> BC Air account', () => {
  const wctControls = { debtorControl: '1-3100', taxLiabilities: '2-2310', bankAccount: '1-2101', cashAccount: '1-2102', salesAccount: '4-2000', retainedProfits: '3-8000' };
  const bcControls = { debtorControl: '1-9999', taxLiabilities: '2-2100', bankAccount: '1-2100', cashAccount: '1-2200', salesAccount: '4-1002', retainedProfits: '3-8000' };
  const bc: CoaRow[] = [
    { code: '1-2100', name: 'UOB', accountType: 'CURRENT_ASSET' },
    { code: '1-3100', name: 'Account Receivables', accountType: 'CURRENT_ASSET' },
    { code: '1-9999', name: 'Trade Debtors', accountType: 'CURRENT_ASSET' },
    { code: '1-9400', name: "Less Prov'n for Doubtful Debts", accountType: 'CURRENT_ASSET' },
    { code: '2-2100', name: 'GST Collected', accountType: 'TAX_LIABILITY' },
    { code: '3-8000', name: 'Retained Earnings', accountType: 'EQUITY' },
    { code: '4-1000', name: 'Revenue (Nat)', accountType: 'HEADER' },
    { code: '4-1001', name: 'Revenue (Nat) - MV', accountType: 'SALES' },
    { code: '4-1002', name: 'Revenue (Nat) - AA', accountType: 'SALES' },
    { code: '4-1003', name: 'Revenue (Nat) - CD', accountType: 'SALES' },
    { code: '4-1004', name: 'Revenue (Nat) - TS', accountType: 'SALES' },
    { code: '4-2003', name: 'Revenue (WCT) - CD', accountType: 'SALES' },
    { code: '4-2002', name: 'Revenue (WCT) - AA', accountType: 'SALES' },
  ];
  const usage = new Map([['4-1001', 586], ['4-1002', 1736], ['4-1003', 1321], ['4-1004', 39]]);
  const ctx = { srcControls: wctControls, dstControls: bcControls, dst: bc, dstUsage: usage };
  const m = (code: string, name: string, accountType = 'SALES') => mapAccount({ code, name, accountType }, ctx);

  it('maps control accounts role to role, not by code', () => {
    // WCT (S) 1-3100 "Customer Payment" is its debtors control; BC Air's 1-3100 is a different account.
    expect(m('1-3100', 'Customer Payment', 'CURRENT_ASSET')).toEqual({ code: '1-9999', how: 'control debtorControl' });
    expect(m('2-2310', 'GST Collected', 'TAX_LIABILITY')).toEqual({ code: '2-2100', how: 'control taxLiabilities' });
    expect(m('3-8000', 'Retained Earnings', 'EQUITY')).toEqual({ code: '3-8000', how: 'control retainedProfits' });
  });
  it('never maps a bank or cash account (the bank side is a decision)', () => {
    expect(m('1-2101', 'DBS Bank (New)', 'CURRENT_ASSET')).toMatchObject({ code: null, bank: true });
    expect(m('1-2110', 'DBS Bank (Old)', 'CURRENT_ASSET')).toMatchObject({ code: null, bank: true });
    expect(m('1-2120', 'Petty Cash - Henry', 'CURRENT_ASSET')).toMatchObject({ code: null, bank: true });
  });
  it('maps revenue by stream, the most used target first', () => {
    expect(m('4-1000', 'MV Revenue')).toEqual({ code: '4-1001', how: 'revenue MV' });
    expect(m('4-2000', 'CD Revenue')).toEqual({ code: '4-1003', how: 'revenue CD' });
    expect(m('4-3000', 'AA/VO Revenue')).toEqual({ code: '4-1002', how: 'revenue AA' });
    expect(m('4-3500', 'TS Revenue')).toEqual({ code: '4-1004', how: 'revenue TS' });
    // Two candidates and no usage to choose by: not mapped.
    expect(mapAccount({ code: '4-2000', name: 'CD Revenue', accountType: 'SALES' }, { ...ctx, dstUsage: new Map() })).toMatchObject({ code: null });
  });
  it('maps doubtful debts by name and leaves anything else unmapped', () => {
    expect(m('1-3150', 'Bad Or Doubtful Debts', 'CURRENT_ASSET')).toEqual({ code: '1-9400', how: 'doubtful debts' });
    expect(m('6-9999', 'Sundry Expense', 'EXPENSE')).toMatchObject({ code: null, why: 'no matching account' });
    // Same code but another name is not the same account.
    expect(m('1-3100x', 'x', 'CURRENT_ASSET')).toMatchObject({ code: null });
  });
});
