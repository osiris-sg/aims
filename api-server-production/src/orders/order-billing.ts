/**
 * WCT invoice per order: what an order invoice bills (guru 2026-11-02, after
 * the ORD202611-001 test billed a $109 quote twice as $218).
 *
 * The quotation is the contract value. It is billed ONCE per order, however
 * many jobs the order has. Every job still carries the quote's items as its
 * scope (the DO, the field app and the service report show them), but those
 * lines are not billable again. Only what a job carries ON TOP of the quote
 * (a free-typed or product line added to that job) is billed, as an extra.
 *
 * How a job line is told apart: it is matched against the quotation at
 * invoice time, not marked when the job is made. A line is the quote's scope
 * when it names a quoted item (the same catalog product, or for a free-typed
 * line the same description) and the job has not used up the quoted quantity
 * of it yet; anything else, or the quantity above the quote, is an extra.
 * Matching at invoice time means every way a job's lines are written (the
 * auto draft, Add job, Edit job, the DO editor) is covered without each path
 * having to carry a marker, jobs made before this rule are handled the same
 * way, and the quotation stays the one source of what was agreed.
 */

import { normDesc } from '../deliveries/quotation-to-delivery';

/** A line's identity against the quotation: `a:<assetId>` for a catalog product, `d:<description>` for a free-typed line. */
export type ScopeKey = string;

/** Key of a free-typed line: its first line of text, normalised (the same text quotation-to-delivery copies onto a job). */
export const descKey = (description: unknown): ScopeKey | null => {
  const d = normDesc(description);
  return d ? `d:${d}` : null;
};

export const assetKey = (assetId: string | null | undefined): ScopeKey | null => (assetId ? `a:${assetId}` : null);

const qty = (l: any): number => {
  const n = Number(l?.quantity);
  return isFinite(n) && n > 0 ? n : 1;
};

/** A display row, not a line of work (group headers, tag groups). */
export const isDisplayRow = (l: any): boolean => !l || !!l.isGroupHeader || !!l.isTagGroup;

/** How much of each quoted item one job may carry as scope. */
export function quoteAllowance(quoteLines: Array<{ key: ScopeKey | null; quantity?: any }>): Map<ScopeKey, number> {
  const out = new Map<ScopeKey, number>();
  for (const l of quoteLines) if (l.key) out.set(l.key, (out.get(l.key) || 0) + qty(l));
  return out;
}

/**
 * One job's lines split into the quote's scope and the extras. The allowance
 * is per job (each visit carries the full quoted scope); a line above the
 * quoted quantity is split, the part above the quote being the extra.
 * Display rows and empty lines are neither.
 */
export function splitJobLines<T extends Record<string, any>>(lines: T[], keyOf: (l: T) => ScopeKey | null, allowance: Map<ScopeKey, number>): { scope: T[]; extras: T[] } {
  const left = new Map(allowance);
  const scope: T[] = [];
  const extras: T[] = [];
  for (const l of lines) {
    if (isDisplayRow(l)) continue;
    const key = keyOf(l);
    if (!key && !String(l.description ?? '').trim()) continue; // an empty row
    const q = qty(l);
    const r = key ? left.get(key) || 0 : 0;
    if (r >= q) {
      left.set(key!, r - q);
      scope.push(l);
    } else if (r > 0) {
      left.set(key!, 0);
      scope.push(withQuantity(l, r));
      extras.push(withQuantity(l, q - r));
    } else {
      extras.push(l);
    }
  }
  return { scope, extras };
}

/** The line with a new quantity; a stored amount is re-derived from the unit price. */
function withQuantity<T extends Record<string, any>>(l: T, quantity: number): T {
  const u = Number(l.unitPrice);
  return { ...l, quantity, ...(isFinite(u) ? { amount: Math.round(u * quantity * 100) / 100 } : {}) };
}

/**
 * What the next order invoice bills: the quotation's lines when the quote has
 * not been billed on this order yet, plus the extras of the jobs it takes.
 * `nothing` = the quote is already billed and these jobs add nothing on top,
 * so no invoice is made (the jobs are covered by the invoice that billed the quote).
 */
export function planOrderInvoice<T extends Record<string, any>>(input: {
  quoteBilled: boolean;
  quoteLines: Array<Record<string, any>>;
  jobs: Array<{ jobId: string; lines: T[] }>;
  keyOfQuoteLine: (l: Record<string, any>) => ScopeKey | null;
  keyOfJobLine: (l: T) => ScopeKey | null;
}): { billQuote: boolean; extras: Array<T & { jobId: string }>; nothing: boolean } {
  const allowance = quoteAllowance(input.quoteLines.filter((l) => !isDisplayRow(l)).map((l) => ({ key: input.keyOfQuoteLine(l), quantity: l.quantity })));
  const extras: Array<T & { jobId: string }> = [];
  for (const j of input.jobs) for (const e of splitJobLines(j.lines, input.keyOfJobLine, allowance).extras) extras.push({ ...e, jobId: j.jobId });
  const billQuote = !input.quoteBilled && input.quoteLines.some((l) => !isDisplayRow(l));
  return { billQuote, extras, nothing: !billQuote && !extras.length };
}

/**
 * The order invoice's Reference: "ORD202611-001 · DO202611008, DO202611009",
 * unless the DO already carried a reference of its own (kept as it is). The
 * invoice prints the order and its DOs on their own lines either way; the
 * Reference (config.referenceNo, the canonical free-text key) makes the
 * invoice findable by order number in the lists and survives editor saves.
 */
export function orderInvoiceReference(orderNumber: string, doNumbers: string[], existing?: unknown): string {
  const prev = String(existing ?? '').trim();
  if (prev) return prev;
  return [orderNumber, doNumbers.filter(Boolean).join(', ')].filter(Boolean).join(' · ');
}
