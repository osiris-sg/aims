/**
 * Bank reconciliation candidate helpers (guru 2026-11-27: the accountant searched "UOBOR2610-002" on a 200,000 UOB
 * deposit and got "No candidate journals". The deposit IS in the books, as the two Xero-import journals
 * JV-XERO-30911 (99,095.76) + JV-XERO-30912 (100,904.24) on the same day, with no reference; the receipt's own
 * journal was voided as their duplicate. So: a search compares without hyphens / spaces, a search that names a
 * document also finds the journals that document points at, and lines of one day that add up to the statement
 * amount are offered together.)
 */

/** Lower-case letters and digits only: "UOBOR2610-002" and "UOBOR2610002" compare equal. */
export const compactText = (s: unknown): string => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** Journal numbers a document's config names (its own journalNumber, a repair note: "JV-XERO-30911 + JV-XERO-30912"). */
export function journalNumbersNamedBy(config: any): string[] {
  const text = [config?.journalNumber, config?.repairNote, config?.glNote, config?.notes].filter((v) => typeof v === 'string').join(' ');
  return [...new Set((text.match(/\bJV-[A-Z]*-?\d+\b/gi) || []).map((s) => s.toUpperCase()))];
}

/** Every money figure a receipt / voucher / invoice carries: its total and each allocation or line. */
export function amountsCarriedBy(config: any): number[] {
  const out = new Set<number>();
  const add = (v: any) => {
    const n = Math.round((Number(v) || 0) * 100) / 100;
    if (n > 0) out.add(n);
  };
  for (const k of ['receiptAmount', 'amount', 'voucherAmount', 'totalAmount', 'totalWithTax', 'nettTotal']) add(config?.[k]);
  for (const a of Array.isArray(config?.allocations) ? config.allocations : []) add(a?.amount);
  for (const l of Array.isArray(config?.lines) ? config.lines : []) add(l?.amount);
  return [...out];
}

export type GroupableLine = { id: string; date: string; amount: number };

/**
 * Lines of ONE day that add up to the target: one bank deposit that the books carry as several journals (a Xero
 * batch payment imported per invoice, a cheque paying two bills). Each line joins at most one group; groups of
 * 2 to 6 lines; the search per day is bounded so a busy day cannot stall the request.
 */
export function sameDayGroups(lines: GroupableLine[], target: number, opts: { maxGroups?: number; maxSize?: number } = {}): Map<string, { key: string; size: number; total: number }> {
  const maxGroups = opts.maxGroups ?? 5;
  const maxSize = opts.maxSize ?? 6;
  const want = Math.round(Math.abs(target) * 100);
  const result = new Map<string, { key: string; size: number; total: number }>();
  if (!(want > 0)) return result;
  const byDay = new Map<string, GroupableLine[]>();
  for (const l of lines) {
    const c = Math.round(Math.abs(l.amount) * 100);
    if (!(c > 0) || c >= want) continue; // a single exact line is already an amount match
    const day = String(l.date).slice(0, 10);
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day)!.push({ ...l, amount: c });
  }
  let n = 0;
  for (const [, dayLines] of byDay) {
    if (dayLines.length < 2) continue;
    const pool = dayLines.filter((l) => !result.has(l.id)).sort((a, b) => b.amount - a.amount);
    let budget = 20000;
    const found: GroupableLine[][] = [];
    const walk = (start: number, left: number, picked: GroupableLine[]) => {
      if (budget-- <= 0 || found.length + n >= maxGroups) return;
      for (let i = start; i < pool.length; i++) {
        const l = pool[i];
        if (found.some((g) => g.includes(l))) continue;
        if (l.amount > left) continue;
        const next = [...picked, l];
        if (l.amount === left) {
          if (next.length >= 2) found.push(next);
          continue;
        }
        if (next.length < maxSize) walk(i + 1, left - l.amount, next);
      }
    };
    walk(0, want, []);
    for (const g of found) {
      if (g.some((l) => result.has(l.id))) continue;
      n++;
      const key = `g${n}`;
      for (const l of g) result.set(l.id, { key, size: g.length, total: want / 100 });
      if (n >= maxGroups) return result;
    }
  }
  return result;
}

export type BehindLine = { id: string; debit: number; credit: number; journalEntry: { journalNumber: string | null; entryDate: Date; sourceDocumentId?: string | null } };

/**
 * The journal lines a document stands behind: the journal posted from it, the journals its config names (a
 * repaired receipt's note: "the GL entry for this deposit is JV-XERO-30911 + JV-XERO-30912"), and a Xero-import
 * journal of the document's day carrying one of its amounts (a batch payment Xero posted per invoice).
 */
export function journalsBehindDocument(doc: { id: string; config: any }, lines: BehindLine[]): BehindLine[] {
  const cfg: any = doc?.config || {};
  const numbers = new Set(journalNumbersNamedBy(cfg));
  const amounts = new Set(amountsCarriedBy(cfg));
  const day = typeof cfg.date === 'string' ? cfg.date.slice(0, 10) : null;
  return lines.filter((j) => {
    const je = j.journalEntry;
    const amt = Math.round(((j.debit > 0 ? j.debit : j.credit) || 0) * 100) / 100;
    const xeroSameDay = /^JV-XERO/i.test(je.journalNumber || '') && !!day && je.entryDate.toISOString().slice(0, 10) === day && amounts.has(amt);
    return je.sourceDocumentId === doc.id || numbers.has(String(je.journalNumber || '').toUpperCase()) || xeroSameDay;
  });
}

/** Document-number-like tokens in a statement line's reference and narrative ("UOBOR2610002", "INV202611-0004"). */
export function documentTokensOf(text: string): string[] {
  return [...new Set((String(text || '').split(/[^A-Za-z0-9-]+/)).map(compactText).filter((t) => t.length >= 6 && /\d/.test(t) && /[a-z]/.test(t)))];
}

/**
 * What a candidate row is CALLED (guru 2026-11-27: "it's supposed to match to an OR, not a JV — J/V is only for a
 * manual journal entry; any receipt or document shows its document prefix"): the prefixed document behind the
 * journal (REC UOBOR2610-002, P/V SCBPV2610-003, INV …) — the journal's own source document, or the receipt /
 * voucher a Xero-import journal stands behind; a manual journal reads J/V 000005; anything else keeps its number.
 */
export function candidateRef(
  je: { journalNumber: string | null; reference?: string | null; type?: string | null },
  doc: { type?: string | null; name?: string | null } | null | undefined,
  helpers: { docRef: (type: any, name: any) => string; isPrefixed: (ref: any) => boolean },
): string {
  const name = String(doc?.name || '').trim();
  if (doc && name) return helpers.docRef(doc.type, name);
  const raw = String(je.reference || '').trim();
  if (helpers.isPrefixed(raw)) return raw;
  const num = String(je.journalNumber || '').trim();
  if (String(je.type || '').toUpperCase() === 'MANUAL') return `J/V ${num.replace(/^JV-?/i, '')}`;
  return raw || num;
}

/**
 * The statement's closing balance (guru 2026-11-27: a UOB October PDF came back "Closing balance 4.00" against
 * books of 4,953,302.95 — the extractor's endingBalance was a stray digit while every line carried the bank's
 * running balance, whose last value was 4,658,048.80). The bank's printed running balance on the last dated line
 * is the closing balance whenever the lines carry one; a figure entered by hand on the import still wins; the
 * extracted figure is only a fallback for statements without a balance column.
 */
export function statementClosingBalance(
  stored: number | null | undefined,
  lines: Array<{ date: Date | string; runningBalance?: number | null }>,
  opts: { manual?: boolean } = {},
): { value: number | null; source: 'entered' | 'running-balance' | 'extracted' | null } {
  const has = stored !== null && stored !== undefined && Number.isFinite(Number(stored));
  if (has && opts.manual) return { value: Number(stored), source: 'entered' };
  const dated = lines
    .filter((l) => l.runningBalance !== null && l.runningBalance !== undefined && Number.isFinite(Number(l.runningBalance)))
    .sort((a, b) => String(new Date(a.date).toISOString()).localeCompare(String(new Date(b.date).toISOString())));
  const last = dated[dated.length - 1];
  if (last) return { value: Math.round(Number(last.runningBalance) * 100) / 100, source: 'running-balance' };
  return has ? { value: Number(stored), source: 'extracted' } : { value: null, source: null };
}
