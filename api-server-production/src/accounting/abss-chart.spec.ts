import { BadRequestException } from '@nestjs/common';
import { JournalService } from '../journal/journal.service';
import { ChartOfAccountsService } from './chart-of-accounts.service';
import { HEADER_ACCOUNT_TYPE } from './default-chart-of-accounts';

// WCT's ABSS chart (2026-11-06): header (group) accounts never take a posting and stay out of
// the account pickers; scripts/wct-abss-gl.js builds the GL on it.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const gl = require('../../scripts/wct-abss-gl.js');

describe('header accounts', () => {
  const lines = [
    { accountId: 'a1', debit: 100, credit: 0 },
    { accountId: 'h1', debit: 0, credit: 100 },
  ];
  const journalWith = (accounts: any[]) => {
    const prisma: any = { chartOfAccount: { findMany: jest.fn().mockResolvedValue(accounts) } };
    return new JournalService(prisma, {} as any);
  };

  it('refuses a journal line on a header account', async () => {
    const svc = journalWith([
      { id: 'a1', code: '1-2101', accountType: 'CURRENT_ASSET' },
      { id: 'h1', code: '1-2100', accountType: HEADER_ACCOUNT_TYPE },
    ]);
    await expect(svc.create('org', { entryDate: '2026-11-05', type: 'MANUAL', lines } as any)).rejects.toThrow(
      new BadRequestException('1-2100 is a header account: post to a sub-account instead'),
    );
  });

  it('keeps headers out of the account list unless the chart editor asks', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const svc = new ChartOfAccountsService({ chartOfAccount: { findMany } } as any);
    await svc.findAll('org');
    expect(findMany.mock.calls[0][0].where).toEqual({ organizationId: 'org', accountType: { not: HEADER_ACCOUNT_TYPE }, isActive: true });
    await svc.findAll('org', { includeHeaders: true });
    expect(findMany.mock.calls[1][0].where).toEqual({ organizationId: 'org', isActive: true });
    await svc.findAll('org', { accountType: 'SALES' });
    expect(findMany.mock.calls[2][0].where).toEqual({ organizationId: 'org', accountType: 'SALES', isActive: true });
  });
});

describe('wct-abss-gl revenue buckets', () => {
  it.each([
    ['(NG) Maintenance Agreement - Chemical Degreasing of Kitchen Exhaust', '4-2000', 'keyword'],
    ['CD+AA - Chemical Degreasing & Supply of hood', '4-2000', 'leading code'],
    ['AA - Supply and installation of Wet Chemical', '4-3000', 'leading code'],
    ['(A&A) Replacement works', '4-3000', 'prefix tag only'],
    ['Variation order works', '4-3000', 'keyword'],
    ['1st Payment for New Mechanical Ventilation for Hey Yummy', '4-1000', 'keyword'],
    ['Installation of new system for ACMV', '4-1000', 'keyword'],
    ['Chemical degreasing for MV fan', '4-2000', 'keyword'],
    ['Aircon servicing', '4-3500', 'keyword'],
    ['Maintenance of Air Cleaner @ 55 Chai Chee', '4-2000', 'inferred (kitchen exhaust / hood / duct / air cleaner)'],
    ['Cleaning of Ozone Generator', '4-2000', 'unclear → 4-2000'],
  ])('%s → %s (%s)', (subject, code, rule) => {
    expect(gl.revenueBucket(subject)).toMatchObject({ code, rule });
  });
});

describe('wct-abss-gl bank mapping', () => {
  it.each([
    [{ method: 'Bank Transfer', bank_account: 'DBS 1079030866' }, '1-2101'],
    [{ method: 'Cheque', bank_account: 'DBS 0299029037' }, '1-2110'],
    [{ method: 'Cheque', bank_account: 'UOB 3923073157' }, '1-2111'],
    [{ method: 'Bank Transfer', bank_account: 'OCBC 604566752001' }, '1-2107'],
    [{ method: 'Contra', bank_account: 'DBS 1079030866' }, '1-2198'],
    [{ method: 'Cash', bank_account: 'DBS 1079030866' }, '1-2102'],
    [{ method: 'Cheque', bank_account: '' }, '1-2101'],
  ])('%o → %s', (p, code) => {
    expect(gl.bankFor(p).code).toBe(code);
  });
});

describe('wct-abss-gl trial balance + cutover', () => {
  const fy = { month: 12, day: 31 };
  const postings = [
    { code: '1-3100', category: 'BALANCE_SHEET', date: '2025-06-01T00:00:00.000Z', dr: 109, cr: 0 },
    { code: '4-2000', category: 'PNL', date: '2025-06-01T00:00:00.000Z', dr: 0, cr: 100 },
    { code: '2-2310', category: 'BALANCE_SHEET', date: '2025-06-01T00:00:00.000Z', dr: 0, cr: 9 },
    { code: '1-3100', category: 'BALANCE_SHEET', date: '2026-03-01T00:00:00.000Z', dr: 218, cr: 0 },
    { code: '4-2000', category: 'PNL', date: '2026-03-01T00:00:00.000Z', dr: 0, cr: 200 },
    { code: '2-2310', category: 'BALANCE_SHEET', date: '2026-03-01T00:00:00.000Z', dr: 0, cr: 18 },
    { code: '1-3100', category: 'BALANCE_SHEET', date: '2026-12-01T00:00:00.000Z', dr: 50, cr: 0 }, // after the cutover
  ];

  it('shows P&L for the current financial year and rolls earlier years into retained earnings', () => {
    const tb = gl.trialBalance(postings, '2026-11-05', fy, '3-8000');
    expect(Object.fromEntries(tb)).toEqual({ '1-3100': 327, '4-2000': -200, '2-2310': -27, '3-8000': -100 });
  });

  it('closes each earlier financial year into retained earnings', () => {
    const closes = gl.planCloses(postings, '2026-11-05', fy, '3-8000');
    expect(closes).toEqual([
      { date: '2025-12-31T00:00:00.000Z', year: '2025', lines: [{ code: '4-2000', dr: 100, cr: 0 }, { code: '3-8000', dr: 0, cr: 100 }], total: 100 },
    ]);
  });

  it('zeroes an account outside the ABSS chart into 3-9999', () => {
    const plan = gl.planCutover(
      [{ code: '3-9999', name: 'Historical Balancing', isHeader: false, debitBalance: 0 }],
      new Map([['CS001', -2000]]),
      new Map([['CS001', 'Purchases']]),
    );
    expect(plan.lines.map((l: any) => [l.code, l.dr, l.cr])).toEqual([
      ['CS001', 2000, 0],
      ['3-9999', 0, 2000],
    ]);
  });

  it('brings every ABSS detail account to its ABSS balance, offset to 3-9999', () => {
    const abss = [
      { code: '1-3100', name: 'Customer Payment', isHeader: false, debitBalance: 300 },
      { code: '2-2310', name: 'GST Collected', isHeader: false, debitBalance: -27 },
      { code: '3-8000', name: 'Retained Earnings', isHeader: false, debitBalance: -100 },
      { code: '3-9000', name: 'Current Year Earnings', isHeader: false, debitBalance: 0 },
      { code: '3-9999', name: 'Historical Balancing', isHeader: false, debitBalance: 27 },
      { code: '4-2000', name: 'CD Revenue', isHeader: false, debitBalance: -200 },
    ];
    const plan = gl.planCutover(abss, gl.trialBalance(postings, '2026-11-05', fy, '3-8000'));
    expect(plan.lines.map((l: any) => [l.code, l.dr, l.cr])).toEqual([
      ['1-3100', 0, 27],
      ['3-9999', 27, 0],
    ]);
    expect(plan.hbAfter).toBe(plan.hbAbss);
  });
});
