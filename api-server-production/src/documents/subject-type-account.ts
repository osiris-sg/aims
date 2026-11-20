// Subject type decides the sales account (guru 2026-11-19/20, WCT only, flag
// subjectTypeSetsAccount). WCT's quotations and invoices start their Subject with the job
// type, as its old ERP wrote it ("CD - Degreasing of kitchen exhaust", "MV+CD - New system";
// the portal's Subject dropdown, helpers/subjectType.ts). Each type is one of WCT's four
// sales accounts:
//   MV → 4-1000 MV Revenue · CD → 4-2000 CD Revenue · AA, VO → 4-3000 AA/VO Revenue ·
//   TS → 4-3500 TS Revenue
// What an invoice posts, and what the Posting Queue shows for it, is NOT its line items:
//   one type (or types that share an account, AA+VO)
//       ONE line: the subject, for the invoice's whole net, on that type's account.
//   several types on different accounts (MV+CD)
//       the invoice's PRICED lines only (the $0 scope lines are left out), each on its own
//       account, for the accountant to check in the Posting Queue.
//   no type / an unknown type / an account missing from the chart
//       exactly as before (every line, its own account).
// The lines stored on the document are never changed.

export const SUBJECT_TYPE_ACCOUNT_FLAG = 'subjectTypeSetsAccount';

export const SUBJECT_TYPE_ACCOUNT: Record<string, string> = {
  MV: '4-1000',
  CD: '4-2000',
  AA: '4-3000',
  VO: '4-3000',
  TS: '4-3500',
};

const T = Object.keys(SUBJECT_TYPE_ACCOUNT).join('|');
const LEAD = new RegExp(`^((?:${T})(?:\\s*\\+\\s*(?:${T}))*)\\s*-\\s`);
const R2 = (n: any) => Math.round((Number(n) || 0) * 100) / 100;

const subjectOf = (config: any): string => String(config?.documentInfo?.subject ?? config?.subject ?? '').trim();

/** The job types a subject starts with ("MV+CD - …" → ["MV","CD"]); [] when it starts with none. */
export function subjectTypesOf(config: any): string[] {
  const m = `${subjectOf(config)} `.match(LEAD);
  return m ? [...new Set(m[1].split('+').map((x) => x.trim()))] : [];
}

export type SubjectAccounts = Map<string, { code: string; name: string | null }>;

/** The org's accounts per subject type, or null when the org does not use the rule (flag off). */
export async function loadSubjectAccounts(prisma: any, organizationId: string): Promise<SubjectAccounts | null> {
  const ui = await prisma.organizationUIConfig.findUnique({ where: { organizationId }, select: { features: true } });
  if (((ui?.features as any) || {})[SUBJECT_TYPE_ACCOUNT_FLAG] !== true) return null;
  const rows: Array<{ code: string; name: string | null }> = await prisma.chartOfAccount.findMany({
    where: { organizationId, isActive: true, code: { in: [...new Set(Object.values(SUBJECT_TYPE_ACCOUNT))] } },
    select: { code: true, name: true },
  });
  const byCode = new Map(rows.map((r) => [r.code, r]));
  const out: SubjectAccounts = new Map();
  for (const [type, code] of Object.entries(SUBJECT_TYPE_ACCOUNT)) if (byCode.has(code)) out.set(type, byCode.get(code)!);
  return out;
}

export interface SubjectPostingLine {
  /** Index into config.items; -1 for the one subject line. */
  lineIndex: number;
  description: string;
  amount: number;
  accountCode: string | null;
}

const isDisplayRow = (l: any): boolean => !l || !!l.isGroupHeader || !!l.isTagGroup;
const lineAmount = (l: any): number => R2(parseFloat(l?.amount) || parseFloat(l?.quantity) * parseFloat(l?.unitPrice) || 0);

/**
 * What the invoice posts under the rule, or null when the rule does not apply to it
 * (the caller then posts the invoice's own lines as before). `net` is the invoice's net
 * (before GST, after discounts).
 */
export function subjectPostingLines(config: any, accounts: SubjectAccounts | null, net: number): { mode: 'subject' | 'priced-lines'; lines: SubjectPostingLine[] } | null {
  if (!accounts) return null;
  const types = subjectTypesOf(config);
  if (!types.length || types.some((t) => !accounts.has(t))) return null;
  const codes = [...new Set(types.map((t) => accounts.get(t)!.code))];
  if (codes.length === 1) {
    return { mode: 'subject', lines: [{ lineIndex: -1, description: subjectOf(config).slice(0, 250), amount: R2(net), accountCode: codes[0] }] };
  }
  const items: any[] = Array.isArray(config?.items) ? config.items : [];
  const lines = items
    .map((l, i) => ({ l, i }))
    .filter(({ l }) => !isDisplayRow(l) && lineAmount(l) > 0)
    .map(({ l, i }) => ({ lineIndex: i, description: String(l.description ?? ''), amount: lineAmount(l), accountCode: l.accountCode || l.revenueAccountCode || null }));
  return { mode: 'priced-lines', lines };
}
