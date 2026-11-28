/**
 * ledger_activity + the voucher tool checks (guru 2026-11-28). The case that started it: salary
 * for a month is booked to a PAYABLE and paid from the bank the month after; a search by topic
 * must show the payment even though the cost accounts are empty that month.
 */
import { isBankAccount, ledgerActivity, searchTokens } from './ledger-activity';
import { prepareOfficialReceipt, preparePaymentVoucher, resolveAccount, resolveBank } from './voucher-tools';

const ACCOUNTS = [
  { id: 'a1', code: '6-2100', name: 'Wages & Salaries', accountType: 'EXPENSE', category: 'PNL', isActive: true },
  { id: 'a2', code: '2-2450', name: 'Wages & Salaries Payable (New)', accountType: 'CURRENT_LIABILITY', category: 'BALANCE_SHEET', isActive: true },
  { id: 'a3', code: '1-2107', name: 'OCBC Bank', accountType: 'CURRENT_ASSET', category: 'BALANCE_SHEET', isActive: true },
  { id: 'a4', code: '6-3000', name: 'Rent', accountType: 'EXPENSE', category: 'PNL', isActive: true },
  { id: 'a5', code: '1-2000', name: 'Bank Accounts', accountType: 'HEADER', category: 'BALANCE_SHEET', isActive: true },
];
const J = (id: string, date: string, description: string) => ({ id, journalNumber: id, entryDate: new Date(`${date}T00:00:00+08:00`), description, type: 'MANUAL' });
const journals = [J('GJ1', '2025-11-12', 'WCT Salary for October 2025'), J('GJ2', '2025-11-20', 'Office rent'), J('GJ3', '2025-10-31', 'Summary Salary for October 2025')];
const LINES = [
  { id: 'l1', journalEntryId: 'GJ1', accountId: 'a2', debit: 53656.04, credit: 0, description: null },
  { id: 'l2', journalEntryId: 'GJ1', accountId: 'a3', debit: 0, credit: 53656.04, description: null },
  { id: 'l3', journalEntryId: 'GJ2', accountId: 'a4', debit: 4000, credit: 0, description: null },
  { id: 'l4', journalEntryId: 'GJ2', accountId: 'a3', debit: 0, credit: 4000, description: null },
  { id: 'l5', journalEntryId: 'GJ3', accountId: 'a1', debit: 60000, credit: 0, description: null },
  { id: 'l6', journalEntryId: 'GJ3', accountId: 'a2', debit: 0, credit: 60000, description: null },
];

/** A just-enough Prisma: evaluates the two where shapes ledgerActivity sends. */
function fakePrisma(extra: any = {}) {
  const jOf = (l: any) => journals.find((j) => j.id === l.journalEntryId)!;
  const has = (text: any, c: any) => String(text ?? '').toLowerCase().includes(String(c.contains).toLowerCase());
  return {
    chartOfAccount: { findMany: async ({ where }: any) => ACCOUNTS.filter((a) => (where?.isActive === undefined ? true : a.isActive === where.isActive)) },
    journalEntryLine: {
      findMany: async ({ where }: any) => {
        if (where.journalEntryId) return LINES.filter((l) => where.journalEntryId.in.includes(l.journalEntryId));
        const p = where.journalEntry.is.entryDate;
        return LINES.filter((l) => jOf(l).entryDate >= p.gte && jOf(l).entryDate < p.lt)
          .filter((l) => where.OR.some((o: any) => (o.accountId ? o.accountId.in.includes(l.accountId) : o.description ? has(l.description, o.description) : has(jOf(l).description, o.journalEntry.is.description))))
          .map((l) => ({ ...l, journalEntry: jOf(l) }));
      },
    },
    ...extra,
  };
}

describe('ledger_activity', () => {
  it('finds the salary PAYMENT in a month with no salary cost booked', async () => {
    const r: any = await ledgerActivity(fakePrisma(), 'org', { words: 'salary wages', from: '2025-11-01', to: '2025-11-30' });
    expect(r.accounts.map((a: any) => a.code)).toEqual(['2-2450', '1-2107']); // the payable by name, the bank line by the journal's description
    expect(r.accounts[0]).toMatchObject({ debit: 53656.04, credit: 0, statement: 'balance sheet' });
    expect(r.bankAndCash).toEqual({ paidOut: 53656.04, received: 0 });
    expect(r.lines[0]).toMatchObject({ date: '2025-11-12', journal: 'GJ1', memo: 'WCT Salary for October 2025' });
    expect(JSON.stringify(r)).not.toContain('6-3000'); // the rent is not salary
    expect(r.lines[0]).toMatchObject({ bankPaidOutInThisEntry: 53656.04 });
    expect(r.lines[0].bankReceivedInThisEntry).toBeUndefined();
  });

  it('shows cost booked and the other side in the month it was accrued', async () => {
    const r: any = await ledgerActivity(fakePrisma(), 'org', { words: 'salary', from: '2025-10-01', to: '2025-10-31' });
    expect(r.accounts.find((a: any) => a.code === '6-2100')).toMatchObject({ debit: 60000, statement: 'profit and loss' });
    expect(r.bankAndCash).toEqual({ paidOut: 0, received: 0 });
  });

  it('an empty result says what was searched, and never claims nothing exists', async () => {
    const r: any = await ledgerActivity(fakePrisma(), 'org', { words: 'insurance', from: '2025-11-01', to: '2025-11-30' });
    expect(r.entries).toBe(0);
    expect(r.note).toMatch(/widen/);
  });

  it('needs a period and something to look for; account codes work without the dash', async () => {
    expect((await ledgerActivity(fakePrisma(), 'org', { words: 'salary' }) as any).error).toMatch(/YYYY-MM-DD/);
    expect((await ledgerActivity(fakePrisma(), 'org', { from: '2025-11-01', to: '2025-11-30' }) as any).error).toMatch(/words/);
    const r: any = await ledgerActivity(fakePrisma(), 'org', { accountCodes: ['63000'], from: '2025-11-01', to: '2025-11-30' });
    expect(r.accounts[0].code).toBe('6-3000');
  });

  it('search words and bank detection', () => {
    expect(searchTokens('Salary, wages  CPF of')).toEqual(['salary', 'wages', 'cpf']);
    expect(isBankAccount(ACCOUNTS[2])).toBe(true);
    expect(isBankAccount(ACCOUNTS[1])).toBe(false);
  });
});

describe('create_payment_voucher / create_official_receipt checks', () => {
  const active = ACCOUNTS.filter((a) => a.accountType !== 'HEADER');
  it('never picks a bank for the user', () => {
    expect(resolveBank(active, '', '').error).toMatch(/Which bank/);
    expect(resolveBank(active, '12107', '').account?.code).toBe('1-2107');
    expect(resolveBank(active, '', 'ocbc').account?.code).toBe('1-2107');
  });
  it('an account name that fits two accounts is asked about', () => {
    expect(resolveAccount(active, '', 'wages', 'Line 1').matches).toHaveLength(2);
    expect(resolveAccount(active, '2-2450', '', 'Line 1').account?.name).toMatch(/Payable/);
  });
  it('a salary payment: payable line, named payee, bank from the user', async () => {
    const plan: any = await preparePaymentVoucher({ prisma: fakePrisma(), openBills: async () => [] }, 'org', { bankAccountCode: '1-2107', payee: 'Kumar', date: '2026-03-24', lines: [{ accountCode: '22450', amount: 1551.39, remarks: 'Overtime Feb, salary March' }] });
    expect(plan.ok).toBe(true);
    expect(plan.args).toMatchObject({ bankAccountCode: '1-2107', payee: 'Kumar', total: 1551.39, lines: [{ accountCode: '2-2450', amount: 1551.39 }] });
    expect(plan.summary).toContain('pay Kumar 1,551.39 from 1-2107 OCBC Bank');
  });
  it('no payee, no bank, or nothing to pay is refused', async () => {
    const deps = { prisma: fakePrisma(), openBills: async () => [] };
    expect((await preparePaymentVoucher(deps, 'org', { lines: [{ accountCode: '2-2450', amount: 10 }] }) as any).error).toMatch(/Which bank/);
    expect((await preparePaymentVoucher(deps, 'org', { bankAccountCode: '1-2107', lines: [{ accountCode: '2-2450', amount: 10 }] }) as any).error).toMatch(/payee/);
    expect((await preparePaymentVoucher(deps, 'org', { bankAccountCode: '1-2107', payee: 'X' }) as any).error).toMatch(/what is being paid/);
  });
  it('supplier invoices: owing by default, never more than owing, unknown number refused', async () => {
    const prisma = fakePrisma({ supplier: { findMany: async () => [{ id: 's1', name: '2CCME PTE LTD', supplierCode: 'S2001' }] } });
    const deps = { prisma, openBills: async () => [{ documentId: 'b1', reference: 'ABSS-PJ-00008797', remarks: 'INV/2026/2192', outstanding: 450 }] };
    const ok: any = await preparePaymentVoucher(deps, 'org', { bank: 'ocbc', supplier: '2ccme', supplierInvoices: [{ number: 'INV/2026/2192' }] });
    expect(ok.args).toMatchObject({ supplierId: 's1', payee: '2CCME PTE LTD', picks: [{ documentId: 'b1', amount: 450 }], total: 450 });
    expect((await preparePaymentVoucher(deps, 'org', { bank: 'ocbc', supplier: '2ccme', supplierInvoices: [{ number: 'INV/2026/2192', amount: 500 }] }) as any).error).toMatch(/more than/);
    expect((await preparePaymentVoucher(deps, 'org', { bank: 'ocbc', supplier: '2ccme', supplierInvoices: [{ number: 'NOPE' }] }) as any).error).toMatch(/not an open/);
  });
  it('a receipt must add up to its invoices', async () => {
    const prisma = fakePrisma({ customer: { findMany: async () => [{ id: 'c1', name: 'HG Legends Pte Ltd' }] } });
    const deps = { prisma, openInvoices: async () => [{ documentId: 'i1', reference: 'INV-001', outstanding: 300 }, { documentId: 'i2', reference: 'INV-002', outstanding: 200 }] };
    const ok: any = await prepareOfficialReceipt(deps, 'org', { customer: 'hg legends', bank: 'ocbc', invoices: [{ number: 'INV-001' }, { number: 'inv002' }] });
    expect(ok.args).toMatchObject({ customerId: 'c1', debitAccountCode: '1-2107', receiptAmount: 500, allocations: [{ documentId: 'i1', amount: 300 }, { documentId: 'i2', amount: 200 }] });
    expect((await prepareOfficialReceipt(deps, 'org', { customer: 'hg legends', bank: 'ocbc', amount: 450, invoices: [{ number: 'INV-001' }, { number: 'INV-002' }] }) as any).error).toMatch(/add up/);
  });
});
