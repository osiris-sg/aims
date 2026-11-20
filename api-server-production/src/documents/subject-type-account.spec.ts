import { subjectPostingLines, subjectTypesOf, SUBJECT_TYPE_ACCOUNT, type SubjectAccounts } from './subject-type-account';

const ACCOUNTS: SubjectAccounts = new Map(
  Object.entries(SUBJECT_TYPE_ACCOUNT).map(([t, code]) => [t, { code, name: `${code} name` }]),
);
const items = [
  { isGroupHeader: true, description: 'Works' },
  { description: 'S- Chemical degreasing', amount: 0, quantity: 1, unitPrice: 0 },
  { description: 'Degreasing package', amount: 800, accountCode: '4-2000' },
  { description: 'New MV fan', quantity: 2, unitPrice: 600, accountCode: '4-1000' },
  { description: 'Wiring', amount: 300 },
];
const cfg = (subject: string) => ({ documentInfo: { subject }, items });

describe('subject type → what the invoice posts', () => {
  it('reads the types the subject starts with', () => {
    expect(subjectTypesOf(cfg('CD - Degreasing of kitchen exhaust'))).toEqual(['CD']);
    expect(subjectTypesOf(cfg('MV+CD - New system'))).toEqual(['MV', 'CD']);
    expect(subjectTypesOf(cfg('AA + VO -'))).toEqual(['AA', 'VO']);
    expect(subjectTypesOf({ subject: 'TS - Aircon' })).toEqual(['TS']);
    expect(subjectTypesOf(cfg('New MV System @ 39A'))).toEqual([]);
    expect(subjectTypesOf(cfg('MACD - x'))).toEqual([]);
    expect(subjectTypesOf({})).toEqual([]);
  });

  it('one type: one line, the subject, for the whole net on that account', () => {
    expect(subjectPostingLines(cfg('CD - Degreasing of kitchen exhaust'), ACCOUNTS, 2300)).toEqual({
      mode: 'subject',
      lines: [{ lineIndex: -1, description: 'CD - Degreasing of kitchen exhaust', amount: 2300, accountCode: '4-2000' }],
    });
    // AA and VO share 4-3000: still one line.
    expect(subjectPostingLines(cfg('AA+VO - Extra works'), ACCOUNTS, 500)!.lines).toEqual([{ lineIndex: -1, description: 'AA+VO - Extra works', amount: 500, accountCode: '4-3000' }]);
  });

  it('several types on different accounts: only the priced lines, each on its own account', () => {
    const r = subjectPostingLines(cfg('MV+CD - New system'), ACCOUNTS, 2300)!;
    expect(r.mode).toBe('priced-lines');
    expect(r.lines).toEqual([
      { lineIndex: 2, description: 'Degreasing package', amount: 800, accountCode: '4-2000' },
      { lineIndex: 3, description: 'New MV fan', amount: 1200, accountCode: '4-1000' },
      { lineIndex: 4, description: 'Wiring', amount: 300, accountCode: null },
    ]);
  });

  it('does not apply without the flag, without a type, or when an account is missing from the chart', () => {
    expect(subjectPostingLines(cfg('CD - x'), null, 100)).toBeNull();
    expect(subjectPostingLines(cfg('Plain subject'), ACCOUNTS, 100)).toBeNull();
    const partial: SubjectAccounts = new Map([['CD', { code: '4-2000', name: 'CD Revenue' }]]);
    expect(subjectPostingLines(cfg('MV - x'), partial, 100)).toBeNull();
    expect(subjectPostingLines(cfg('MV+CD - x'), partial, 100)).toBeNull();
  });
});
