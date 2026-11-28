// ledger_activity: one look across the WHOLE ledger for a topic and a period (guru 2026-11-28).
//
// Why: asked "how much salary did we pay in November 2025", AIMEE opened the salary COST
// accounts one by one, found almost nothing, and explained the gap with a guess. The payments
// were on the salary PAYABLE accounts, which it never thought to open. Every client books
// differently (cost straight to the bank, cost to a payable then a payment, a voucher…), so no
// per-client rule can fix that. This tool answers from the entries themselves:
//   - every posted line in the period on an account whose NAME matches a word, or whose own
//     description / journal description matches it (so "salary" finds the cost accounts, the
//     payable, and a journal described "WCT Salary for October 2025" on any account);
//   - totals per account, per month;
//   - the OTHER SIDE of those journals, with bank / cash accounts flagged: that is the money
//     that actually left or came in, whichever way this client books.
// Pure function over a Prisma-like client so it is unit-testable without Nest.

const R = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
const ISO = /^\d{4}-\d{2}-\d{2}$/;

export interface LedgerActivityArgs {
  words?: string;
  accountCodes?: string[];
  from?: string;
  to?: string;
  maxLines?: number;
}

/** A bank or cash account, the way the voucher screens decide it (FOREIGN_BANK, or a current asset named bank / cash). */
export function isBankAccount(a: { accountType?: string | null; name?: string | null }): boolean {
  if (a.accountType === 'FOREIGN_BANK' || a.accountType === 'BANK') return true;
  const n = String(a.name || '').toLowerCase();
  return a.accountType === 'CURRENT_ASSET' && (/\bbank\b/.test(n) || /\bcash\b/.test(n));
}

/** Words to search by: split on spaces / commas, 3+ characters, lower-cased, at most 8. */
export function searchTokens(words: unknown): string[] {
  return Array.from(new Set(String(words ?? '').toLowerCase().split(/[\s,;/]+/).map((w) => w.trim()).filter((w) => w.length >= 3))).slice(0, 8);
}

const MAX_MATCHED = 6000;
const MAX_JOURNALS = 2000;

export async function ledgerActivity(prisma: any, organizationId: string, args: LedgerActivityArgs) {
  const from = String(args?.from || '');
  const to = String(args?.to || '');
  if (!ISO.test(from) || !ISO.test(to)) return { error: 'Give from and to as YYYY-MM-DD (the period to look at).' };
  if (from > to) return { error: 'from is after to.' };
  const tokens = searchTokens(args?.words);
  const codeKey = (v: unknown) => String(v ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  const wantCodes = new Set((Array.isArray(args?.accountCodes) ? args.accountCodes : []).map(codeKey).filter(Boolean));
  if (!tokens.length && !wantCodes.size) return { error: 'Give words to look for (e.g. "salary wages payroll") and / or accountCodes.' };

  const accounts: any[] = await prisma.chartOfAccount.findMany({
    where: { organizationId },
    select: { id: true, code: true, name: true, accountType: true, category: true },
  });
  const byId = new Map<string, any>(accounts.map((a) => [a.id, a]));
  const named = accounts.filter((a) => a.accountType !== 'HEADER' && (wantCodes.has(codeKey(a.code)) || tokens.some((t) => String(a.name).toLowerCase().includes(t))));
  // Entry dates are stored at the start of the org's day (Singapore) or at UTC midnight (imports):
  // Singapore day bounds catch both.
  const gte = new Date(`${from}T00:00:00+08:00`);
  const lt = new Date(new Date(`${to}T00:00:00+08:00`).getTime() + 86400_000);
  const inPeriod = { organizationId, status: 'POSTED', entryDate: { gte, lt } };
  const textOr = tokens.flatMap((t) => [
    { description: { contains: t, mode: 'insensitive' } },
    { journalEntry: { is: { description: { contains: t, mode: 'insensitive' } } } },
  ]);
  const matched: any[] = await prisma.journalEntryLine.findMany({
    where: { journalEntry: { is: inPeriod }, OR: [...(named.length ? [{ accountId: { in: named.map((a) => a.id) } }] : []), ...textOr] },
    select: { id: true, accountId: true, debit: true, credit: true, description: true, journalEntryId: true, journalEntry: { select: { journalNumber: true, entryDate: true, description: true, type: true } } },
    take: MAX_MATCHED + 1,
  });
  const truncated = matched.length > MAX_MATCHED;
  if (truncated) matched.length = MAX_MATCHED;
  if (!matched.length) {
    return {
      period: { from, to },
      searched: { words: tokens, accountsByName: named.map((a) => `${a.code} ${a.name}`).slice(0, 40) },
      entries: 0,
      note: 'No posted entry in this period matches. That is a fact about THIS search only: say what was searched, and widen (other words for the same thing, a longer period) before telling the user nothing exists.',
    };
  }

  const dayOf = (d: any) => new Date(new Date(d).getTime() + 8 * 3600_000).toISOString().slice(0, 10);
  const matchedIds = new Set(matched.map((l) => l.id));
  const journalIds = Array.from(new Set(matched.map((l) => l.journalEntryId)));
  const journalsCut = journalIds.length > MAX_JOURNALS;
  const others: any[] = await prisma.journalEntryLine.findMany({
    where: { journalEntryId: { in: journalIds.slice(0, MAX_JOURNALS) } },
    select: { id: true, accountId: true, debit: true, credit: true, journalEntryId: true },
  });

  // ── the matched side, per account and per month ──
  const per = new Map<string, { debit: number; credit: number; lines: number; months: Map<string, { debit: number; credit: number }> }>();
  for (const l of matched) {
    const p = per.get(l.accountId) || { debit: 0, credit: 0, lines: 0, months: new Map() };
    p.debit += l.debit || 0; p.credit += l.credit || 0; p.lines++;
    const m = dayOf(l.journalEntry.entryDate).slice(0, 7);
    const mm = p.months.get(m) || { debit: 0, credit: 0 };
    mm.debit += l.debit || 0; mm.credit += l.credit || 0;
    p.months.set(m, mm);
    per.set(l.accountId, p);
  }
  const manyMonths = from.slice(0, 7) !== to.slice(0, 7);
  const accountsOut = Array.from(per.entries())
    .map(([id, p]) => {
      const a = byId.get(id) || {};
      return {
        code: a.code, name: a.name, type: a.accountType, statement: a.category === 'PNL' ? 'profit and loss' : 'balance sheet',
        debit: R(p.debit), credit: R(p.credit), net: R(p.debit - p.credit), lines: p.lines,
        ...(manyMonths ? { byMonth: Array.from(p.months.entries()).sort().map(([month, v]) => ({ month, debit: R(v.debit), credit: R(v.credit) })) } : {}),
      };
    })
    .sort((x, y) => (y.debit + y.credit) - (x.debit + x.credit));

  // ── the other side of the same journals: where the money came from / went ──
  const otherPer = new Map<string, { debit: number; credit: number }>();
  const otherCodes = new Map<string, Set<string>>();
  for (const l of others) {
    if (matchedIds.has(l.id)) continue;
    const p = otherPer.get(l.accountId) || { debit: 0, credit: 0 };
    p.debit += l.debit || 0; p.credit += l.credit || 0;
    otherPer.set(l.accountId, p);
    const s = otherCodes.get(l.journalEntryId) || new Set<string>();
    s.add(String(byId.get(l.accountId)?.code ?? '?'));
    otherCodes.set(l.journalEntryId, s);
  }
  const otherSide = Array.from(otherPer.entries())
    .map(([id, p]) => { const a = byId.get(id) || {}; return { code: a.code, name: a.name, type: a.accountType, bankOrCash: isBankAccount(a), debit: R(p.debit), credit: R(p.credit) }; })
    .sort((x, y) => (y.debit + y.credit) - (x.debit + x.credit))
    .slice(0, 25);
  // Bank / cash movement in these journals, counting bank lines on EITHER side of the match
  // (a search for "bank" itself would otherwise report nothing paid).
  let paidOut = 0; let received = 0;
  // Per entry too, so each listed line says which WAY its money moved: a credit on a cost
  // account beside money RECEIVED is a refund or a recharge, not a payment (the first live answer
  // added S$7,620 of such credits to "salary paid").
  const bankOf = new Map<string, { out: number; in: number }>();
  for (const l of others) {
    if (!isBankAccount(byId.get(l.accountId) || {})) continue;
    paidOut += l.credit || 0; received += l.debit || 0;
    const b = bankOf.get(l.journalEntryId) || { out: 0, in: 0 };
    b.out += l.credit || 0; b.in += l.debit || 0;
    bankOf.set(l.journalEntryId, b);
  }

  const maxLines = Math.min(Math.max(Number(args?.maxLines) || 40, 5), 120);
  const lines = matched
    .slice()
    .sort((a, b) => Math.max(b.debit || 0, b.credit || 0) - Math.max(a.debit || 0, a.credit || 0))
    .slice(0, maxLines)
    .map((l) => ({
      date: dayOf(l.journalEntry.entryDate),
      journal: l.journalEntry.journalNumber,
      account: byId.get(l.accountId)?.code,
      debit: R(l.debit), credit: R(l.credit),
      memo: String(l.description || l.journalEntry.description || '').slice(0, 140),
      otherSide: Array.from(otherCodes.get(l.journalEntryId) || []).slice(0, 6),
      ...(bankOf.get(l.journalEntryId)?.out ? { bankPaidOutInThisEntry: R(bankOf.get(l.journalEntryId)!.out) } : {}),
      ...(bankOf.get(l.journalEntryId)?.in ? { bankReceivedInThisEntry: R(bankOf.get(l.journalEntryId)!.in) } : {}),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return {
    period: { from, to },
    searched: { words: tokens, accountsByName: named.map((a) => `${a.code} ${a.name}`).slice(0, 40) },
    entries: journalIds.length,
    accounts: accountsOut.slice(0, 40),
    otherSide,
    bankAndCash: { paidOut: R(paidOut), received: R(received) },
    lines,
    linesShown: lines.length,
    linesMatched: matched.length,
    ...(truncated || journalsCut ? { truncated: 'More entries match than were read: narrow the period or the words and call again before giving a total.' } : {}),
    howToRead:
      'A DEBIT on a liability (payable) account is that liability being paid off; a debit on a cost account is cost booked, not necessarily paid. "bankAndCash.paidOut" is what left bank / cash in these entries and "received" is what came IN. A CREDIT on a cost account is a REDUCTION of that cost (a refund, a recharge, a reversal); when its entry shows bankReceivedInThisEntry, money came in: never add such credits to what was paid, and never call them a payment. Each line says which way the bank moved in its own entry. Cost booked and money paid are different questions: answer the one that was asked, and say which accounts the figure comes from.',
  };
}
