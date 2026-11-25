/**
 * WCT group "(NG)" rules (owner + finance, 2026-11-25: "ALL NG DOCUMENTS > BC AIR"). Pure; used by
 * scripts/wct-ng-bcair.ts (the one-off move / removal) and scripts/wct-erp-catchup.js (the weekly ERP import).
 *
 * "(NG)" ("non-GST") is the old ERP's mark for BC Air work keyed in WCT (S)'s ERP. The ERP also issued a $1
 * "(NG)" PLACEHOLDER invoice in WCT (S) for each such job (the real bill was BC Air's): those are never wanted.
 *  - placeholder: ERP-imported, "(NG)" anywhere in the subject, total $1.00, or $1 + old GST ($1.07 / $1.08);
 *  - zero: "(NG)" in the subject, total $0.00;
 *  - real: "(NG)" in the subject, any other total;
 *  - linked: no "(NG)" in the subject but the ERP links it to a BC Air ("(NG)") quotation (listed, kept by default:
 *    WCT (S) issued them, owner 23 Nov);
 *  - none: not NG.
 * Nothing here names an org id: the callers pass the group's companies.
 */

export const NG_MARK = /\(NG\)/i;
/** $1 placeholder totals: $1.00 and $1 plus the old 7% / 8% GST. */
export const NG_PLACEHOLDER_TOTALS = [1.0, 1.07, 1.08] as const;

/** Any of the texts carries the "(NG)" mark. */
export const hasNgMark = (...texts: unknown[]): boolean => texts.some((t) => NG_MARK.test(String(t ?? '')));

/** A document's own subject (config.subject, else documentInfo.subject), trimmed; '' when none. */
export function ngSubjectOf(config: any): string {
  const s = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  return s(config?.subject) || s(config?.documentInfo?.subject) || '';
}

const money = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(/[$,\s]/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
};

export const isNgPlaceholderTotal = (total: unknown): boolean => {
  const t = money(total);
  return t !== null && NG_PLACEHOLDER_TOTALS.some((x) => Math.abs(t - x) < 0.005);
};

export type NgClass = 'placeholder' | 'zero' | 'real' | 'linked' | 'none';

export function classifyNgInvoice(d: { subject?: unknown; total?: unknown; erpImported: boolean; linkedToNgQuotation?: boolean }): NgClass {
  if (!hasNgMark(d.subject)) return d.linkedToNgQuotation ? 'linked' : 'none';
  if (d.erpImported && isNgPlaceholderTotal(d.total)) return 'placeholder';
  const t = money(d.total) ?? 0;
  if (Math.abs(t) < 0.005) return 'zero';
  return 'real';
}

export type NgAction = 'remove' | 'move' | 'keep';
export interface NgActionOpts {
  /** $0.00 "(NG)" invoices: move to BC Air (default) or remove like the placeholders. */
  zero?: 'move' | 'remove';
  /** Also move the 'linked' ones (no "(NG)" mark, on a BC Air quotation). Default: keep in WCT (S). */
  includeLinked?: boolean;
}
export function ngActionOf(cls: NgClass, opts: NgActionOpts = {}): NgAction {
  if (cls === 'placeholder') return 'remove';
  if (cls === 'zero') return opts.zero === 'remove' ? 'remove' : 'move';
  if (cls === 'real') return 'move';
  if (cls === 'linked') return opts.includeLinked ? 'move' : 'keep';
  return 'keep';
}

/**
 * Where a NEW old-ERP document lands (weekly catch-up): 'skip' = a $1 "(NG)" placeholder invoice, never imported;
 * 'ng' = the non-GST company (BC Air); 'main' = the importing company (WCT (S)). The mark is read from the subject
 * and the reference (the ERP repeats the subject there), like the quotation rule.
 */
export function ngImportPlacement(row: { kind: 'QUOTATION' | 'INVOICE' | 'DELIVERY_ORDER' | string; subject?: unknown; reference?: unknown; total?: unknown }): 'skip' | 'ng' | 'main' {
  const marked = hasNgMark(row.subject, row.reference);
  if (!marked) return 'main';
  if (String(row.kind).toUpperCase() === 'INVOICE' && isNgPlaceholderTotal(row.total)) return 'skip';
  return 'ng';
}

// ── Chart of accounts: WCT (S) account -> BC Air account ─────────────────────
export interface CoaRow {
  code: string;
  name: string;
  accountType?: string | null;
  category?: string | null;
  isActive?: boolean | null;
}
/** AccountingSetting.controlAccounts roles that map role-to-role. Bank / cash never map (bank-side decision). */
const ROLE_MAP = ['debtorControl', 'taxLiabilities', 'taxInput', 'creditorControl', 'retainedProfits', 'historicalBalancing', 'currentYearEarnings', 'shareCapitals'] as const;
const BANK_ROLES = ['bankAccount', 'cashAccount'] as const;
/** Revenue stream keywords (WCT: "MV Revenue", BC Air: "Revenue (Nat) - MV"). */
const STREAMS: Array<[RegExp, string]> = [
  [/\bMV\b/i, 'MV'],
  [/\bCD\b/i, 'CD'],
  [/\bAA\b|\bVO\b/i, 'AA'],
  [/\bTS\b/i, 'TS'],
];
const streamOf = (name: string): string | null => STREAMS.find(([re]) => re.test(name))?.[1] ?? null;
const isRevenue = (a: CoaRow) => /^(SALES|REVENUE|INCOME)$/i.test(String(a.accountType ?? '')) || /revenue/i.test(a.name);
const isBankLike = (a: CoaRow) => /\b(bank|petty cash|cash|undeposited)\b/i.test(a.name) && /^1-2/.test(a.code);

export interface AccountMapCtx {
  srcControls: Record<string, string>;
  dstControls: Record<string, string>;
  dst: CoaRow[];
  /** How often each target code is used on the target's own invoice journals (picks among equal candidates). */
  dstUsage?: Map<string, number>;
}
export type AccountMapping = { code: string; how: string } | { code: null; why: string; bank?: boolean };

/** The target account for a source account: control role, bank (never), revenue stream, doubtful debts, same code + name. */
export function mapAccount(src: CoaRow, ctx: AccountMapCtx): AccountMapping {
  const live = ctx.dst.filter((a) => a.isActive !== false && String(a.accountType ?? '').toUpperCase() !== 'HEADER');
  const byCode = new Map(live.map((a) => [a.code, a]));
  for (const role of BANK_ROLES) if (ctx.srcControls[role] === src.code) return { code: null, why: `bank / cash account (${role})`, bank: true };
  if (isBankLike(src)) return { code: null, why: 'bank / cash account', bank: true };
  for (const role of ROLE_MAP) {
    if (ctx.srcControls[role] === src.code) {
      const t = ctx.dstControls[role];
      if (t && byCode.has(t)) return { code: t, how: `control ${role}` };
      return { code: null, why: `no ${role} account in the target` };
    }
  }
  if (isRevenue(src)) {
    const s = streamOf(src.name);
    if (s) {
      const cands = live.filter((a) => isRevenue(a) && streamOf(a.name) === s);
      if (cands.length) {
        const use = (a: CoaRow) => ctx.dstUsage?.get(a.code) ?? 0;
        const pick = [...cands].sort((a, b) => use(b) - use(a) || a.code.localeCompare(b.code))[0];
        if (cands.length === 1 || use(pick) > 0) return { code: pick.code, how: `revenue ${s}` };
        return { code: null, why: `several ${s} revenue accounts, none used: ${cands.map((a) => a.code).join(', ')}` };
      }
    }
  }
  if (/doubtful/i.test(src.name)) {
    const d = live.filter((a) => /doubtful/i.test(a.name));
    if (d.length === 1) return { code: d[0].code, how: 'doubtful debts' };
  }
  const same = byCode.get(src.code);
  if (same && same.name.trim().toLowerCase() === src.name.trim().toLowerCase()) return { code: same.code, how: 'same code and name' };
  return { code: null, why: 'no matching account' };
}

/** Round to cents. */
export const ngR2 = (n: number): number => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
