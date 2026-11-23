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
 * Link text: what the old order link wrote into a Reference ("ORD202611-001 · QO202611-0041",
 * "ORDW202611-001 · DO202611008, DO202611009", "ORD-Q-014922 · Q-014922"): an order number, then document numbers.
 */
export const isLinkText = (v: unknown): boolean => /^ORD[A-Z0-9-]*\d(\s·\s[A-Za-z0-9()-]+(,\s*[A-Za-z0-9()-]+)*)?$/.test(String(v ?? '').trim());

/**
 * The order invoice's Reference (2026-11-22, Elroy: links live only in the Link Document pills, never in a text box):
 * the DO's / quotation's own reference when it has one, never link text (an old "ORD... · DO..." label is dropped),
 * else empty. The invoice names its order and DOs on its own lines (orderNo, deliveryOrderNos) either way.
 */
export function orderInvoiceReference(_orderNumber: string, _doNumbers: string[], existing?: unknown): string {
  const prev = String(existing ?? '').trim();
  return prev && !isLinkText(prev) ? prev : '';
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return isFinite(n) ? n : null;
};

/**
 * The quotation's document discount, as an amount (the quotation is billed
 * exactly as quoted, discount included). The stored amount wins (it is what
 * the quote printed); else the percentage of the quote's line total. The
 * editor reads both from the flat key or documentInfo. 0 when none.
 */
export function quoteDiscountAmount(quoteConfig: any, quoteGross: number): number {
  const qc = quoteConfig || {};
  const di = qc.documentInfo || {};
  const amount = num(qc.discountAmount) ?? num(di.discountAmount);
  if (amount !== null && amount > 0) return Math.round(Math.min(amount, Math.max(0, quoteGross)) * 100) / 100;
  const pct = num(qc.discountPercent) ?? num(di.discountPercent);
  if (pct !== null && pct > 0) return Math.round(quoteGross * pct) / 100;
  return 0;
}

/**
 * The Discount % the order invoice stores beside that amount. The editor
 * re-derives the discount from the % over ALL the invoice's lines when it is
 * opened, so the % must reproduce the quote's amount over the invoice's gross:
 * the quote's own % when the invoice is the quote alone, else the amount's
 * share of the gross (so extras on top are not discounted).
 */
export function invoiceDiscountPercent(quoteConfig: any, discountAmount: number, invoiceGross: number, quoteOnly: boolean): number | null {
  if (!(discountAmount > 0) || !(invoiceGross > 0)) return null;
  const qc = quoteConfig || {};
  const pct = num(qc.discountPercent) ?? num(qc.documentInfo?.discountPercent);
  if (quoteOnly && pct !== null && pct > 0 && Math.abs(Math.round(invoiceGross * pct) / 100 - discountAmount) < 0.005) return pct;
  return Math.round((discountAmount / invoiceGross) * 100 * 1e6) / 1e6;
}

// ── Remaining quantities (DO first, 2026-11-13) ─────────────────────────────
// What a new DO / job of an order is prefilled with: the quoted quantity minus
// what the order's other DOs (and jobs with no DO) already carry, per line key
// (product, else description: the same keys as billing).

/** The quote's allowance left after the lines already on the order's DOs (shared across them). */
export function remainingAllowance(
  quote: Array<{ key: ScopeKey | null; quantity?: any }>,
  used: Array<{ key: ScopeKey | null; quantity?: any }>,
): Map<ScopeKey, number> {
  const left = quoteAllowance(quote);
  for (const u of used) {
    if (!u.key || !left.has(u.key)) continue;
    left.set(u.key, Math.max(0, (left.get(u.key) || 0) - qty(u)));
  }
  return left;
}

/** Internal remarks on a balance DO when earlier DO lines did not match the quotation (2026-11-23); the unmatched quotation lines follow. */
export const SUMMARY_DO_REMARK = "Check qty: earlier DOs didn't match these lines";

/** The remark text: SUMMARY_DO_REMARK + ": " + the quotation lines nothing was taken off (empty list: the bare remark). */
export function unmatchedDoRemark(labels: string[]): string {
  return labels.length ? `${SUMMARY_DO_REMARK}: ${labels.join('; ')}` : SUMMARY_DO_REMARK;
}

/** Earlier DO lines exist and none of them matched a quotation line (the old "summary lines" case). */
export function earlierDosSummaryOnly(quote: TextLine[], used: TextLine[]): boolean {
  const r = remainingByLine(quote.map((q) => ({ ...q, line: null })), used);
  return r.usedLines > 0 && r.unmatchedUsed === r.usedLines;
}

// ── DO-side matching of earlier DO lines (2026-11-23, ORD-Q-014151; owner's rule) ──
// The key is the FIRST line of a description, so the quotation's long
// multi-line lines either share one key ("Maintenance agreement of 1 year 4
// times package (Quarterly)" x3) or miss the earlier DOs' wording (imported ERP
// DOs flatten the lines, drop the "- $400+GST per service" note and name one
// outlet per visit). Each earlier DO line is matched to ONE quotation line:
//   1. a product line only to its own product (exact asset key);
//   2. by ITEM CODE, when both lines have one;
//   3. by exact description key (as before);
//   4. else by the CLOSEST description, only when the score is >= MATCH_THRESHOLD
//      and beats the runner-up by MATCH_MARGIN (else unmatched).
// Where step 2 or 3 finds several quotation lines (a shared code / first line),
// the score narrows them to one when it is clear, else they stay one group.

/** A line with its full description (`text`) and item code beside its key (`text` / `itemCode` optional). */
export interface TextLine {
  key: ScopeKey | null;
  quantity?: any;
  text?: unknown;
  itemCode?: unknown;
}

/** Full text of a description: html stripped, line breaks kept. */
const rawLines = (v: unknown): string =>
  String(v ?? '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li)>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');

/** A price note inside a description ("- $400+GST per service", "– $1,200.50 + GST"): wording, not identity. */
const PRICE_NOTE = /\s*[-–—]?\s*\$\s*[\d,]+(?:\.\d+)?\s*(?:\+\s*gst)?(?:\s*(?:per|\/)\s*[a-z]+)?/gi;

/** Case, punctuation, spacing and price notes ignored. */
export const matchText = (v: unknown): string =>
  rawLines(v).replace(PRICE_NOTE, ' ').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const words = (v: unknown): string[] => matchText(v).split(' ').filter(Boolean);
const code = (v: unknown): string => String(v ?? '').trim().toLowerCase();

/**
 * Minimum score for a description match. The score is the share of the
 * earlier DO line's words found in the quotation line, each word weighted by
 * how rare it is among the quotation's lines (idf: "maintenance agreement ...
 * quarterly" boilerplate counts little, an outlet name or "uv light" a lot; a
 * word on no quotation line counts most). A DO line that is a visit of one
 * quotation line (same words, fewer outlets) scores 1.00; ORD-Q-014151's
 * quotation lines score at most 0.83 against each other, and a near miss with
 * one foreign word (another outlet, "and fans") scores 0.76-0.83, so 0.90
 * keeps those out with room to spare.
 */
export const MATCH_THRESHOLD = 0.9;
/** The best line must beat the runner-up by this much (sibling lines differ by a word or two: ORD-Q-014151's worst real gap is 0.17). */
export const MATCH_MARGIN = 0.15;
/** A description match needs at least this many words (a bare "Hood & Duct" never matches by score). */
const MIN_SCORE_WORDS = 3;

/** The matching score of a used line's words against a quotation line's words (0..1), with idf weights `w`. */
export function matchScore(used: string[], quote: string[], w: (t: string) => number): number {
  const q = new Map<string, number>();
  for (const t of quote) q.set(t, (q.get(t) || 0) + 1);
  let hit = 0;
  let all = 0;
  for (const t of used) {
    all += w(t);
    const n = q.get(t) || 0;
    if (n > 0) {
      hit += w(t);
      q.set(t, n - 1);
    }
  }
  return all > 0 ? hit / all : 0;
}

/** How one earlier DO line was matched (for reports and tests). */
export interface UsedMatch {
  lines: number[];
  how: 'asset' | 'itemCode' | 'key' | 'score' | 'none';
  score?: number;
}

/** The idf weight over the quotation's lines. */
function idfOf(quote: TextLine[]): (t: string) => number {
  const df = new Map<string, number>();
  for (const l of quote) for (const t of new Set(words(l.text))) df.set(t, (df.get(t) || 0) + 1);
  const n = Math.max(1, quote.length);
  return (t) => Math.log(1 + n / (df.get(t) || 0.5));
}

/** The quotation lines (indices) one earlier DO line counts against, and how it was matched. */
export function matchUsedLine(quote: TextLine[], u: TextLine, w: (t: string) => number = idfOf(quote)): UsedMatch {
  const keyed = quote.map((_, i) => i).filter((i) => !!quote[i].key);
  const uw = words(u.text);
  const best = (cands: number[]): { i: number; score: number } | null => {
    if (uw.length < MIN_SCORE_WORDS || !cands.length) return null;
    const s = cands.map((i) => ({ i, score: matchScore(uw, words(quote[i].text), w) })).sort((a, b) => b.score - a.score);
    if (s[0].score < MATCH_THRESHOLD) return null;
    if (s.length > 1 && s[0].score - s[1].score < MATCH_MARGIN) return null;
    return s[0];
  };
  // Several lines share the code / key: narrow by score when that is clear, else the group.
  const group = (cands: number[], how: UsedMatch['how']): UsedMatch => {
    if (cands.length > 1 && !cands.every((i) => matchText(quote[i].text) === matchText(quote[cands[0]].text))) {
      const b = best(cands);
      if (b) return { lines: [b.i], how, score: b.score };
    }
    return { lines: cands, how };
  };
  if (u.key && !u.key.startsWith('d:')) {
    const own = keyed.filter((i) => quote[i].key === u.key);
    return own.length ? group(own, 'asset') : { lines: [], how: 'none' };
  }
  const c = code(u.itemCode);
  if (c) {
    const byCode = keyed.filter((i) => code(quote[i].itemCode) === c);
    if (byCode.length) return group(byCode, 'itemCode');
  }
  const exact = u.key ? keyed.filter((i) => quote[i].key === u.key) : [];
  if (exact.length) return group(exact, 'key');
  const b = best(keyed.filter((i) => quote[i].key!.startsWith('d:') && quote[i].text != null));
  return b ? { lines: [b.i], how: 'score', score: b.score } : { lines: [], how: 'none' };
}

/**
 * What is still to deliver per quotation line: quoted qty minus what the
 * earlier DO lines (the order's other DOs, its jobs with no DO, linked ERP DOs)
 * carry, each counted against the quotation line(s) `matchUsedLine` finds. A
 * group is used up from its LAST line backwards (the same result as the old
 * per-key pool). Lines with nothing left are dropped; lines with no key skipped.
 * `unmatchedUsed` = earlier DO lines that matched no quotation line;
 * `untouched` = quotation lines nothing was taken off (listed at full qty),
 * named in the DO's internal remarks when `unmatchedUsed` > 0.
 */
export function remainingByLine<T>(
  lines: Array<{ line: T } & TextLine>,
  used: TextLine[],
): { remaining: Array<{ line: T; quantity: number }>; usedLines: number; unmatchedUsed: number; untouched: T[]; matches: UsedMatch[] } {
  const left = lines.map((l) => (l.key ? qty(l) : 0));
  const w = idfOf(lines);
  let usedLines = 0;
  let unmatchedUsed = 0;
  const matches: UsedMatch[] = [];
  for (const u of used) {
    if (!u.key && !matchText(u.text)) continue;
    usedLines++;
    const m = matchUsedLine(lines, u, w);
    matches.push(m);
    if (!m.lines.length) {
      unmatchedUsed++;
      continue;
    }
    let q = qty(u);
    for (let j = m.lines.length - 1; j >= 0 && q > 0; j--) {
      const take = Math.min(left[m.lines[j]], q);
      left[m.lines[j]] -= take;
      q -= take;
    }
  }
  const remaining = lines.map((l, i) => ({ line: l.line, quantity: left[i] })).filter((r, i) => !!lines[i].key && r.quantity > 0);
  const untouched = lines.filter((l, i) => !!l.key && left[i] === qty(l)).map((l) => l.line);
  return { remaining, usedLines, unmatchedUsed, untouched, matches };
}

/**
 * A short name for a quotation line in the remark: its first line, or, when
 * other quotation lines share that first line, its own first distinct line
 * ("*For Hood & Duct - $400+GST per service*" -> "For Hood & Duct").
 */
export function quoteLineLabel(text: unknown, all: unknown[]): string {
  const clean = (s: string) => s.replace(PRICE_NOTE, ' ').replace(/[*_]+/g, '').replace(/\s+/g, ' ').trim();
  const mine = rawLines(text).split('\n').map(clean).filter(Boolean);
  const first = mine[0] ?? '';
  const siblings = all.filter((o) => o !== text).map((o) => rawLines(o).split('\n').map(clean).filter(Boolean)).filter((o) => o[0] === first);
  const own = siblings.length ? mine.slice(1).find((l) => siblings.every((o) => !o.includes(l))) : undefined;
  const label = own ?? first;
  return label.length > 60 ? `${label.slice(0, 57)}...` : label;
}

/** The quote's lines with the quantity still to deliver (lines with none left are dropped). */
export function remainingQuoteLines<T>(lines: Array<{ line: T; key: ScopeKey | null; quantity?: any }>, left: Map<ScopeKey, number>): Array<{ line: T; quantity: number }> {
  const pool = new Map(left);
  const out: Array<{ line: T; quantity: number }> = [];
  for (const l of lines) {
    if (!l.key) continue;
    const take = Math.min(qty(l), pool.get(l.key) || 0);
    if (take <= 0) continue;
    pool.set(l.key, (pool.get(l.key) || 0) - take);
    out.push({ line: l.line, quantity: take });
  }
  return out;
}

/**
 * The warnings before a DO of an order is saved: a line above what the quote
 * covers on THIS DO is billed as an extra (billing gives each DO the full
 * quoted scope); a line within the quote but above what is left after the
 * order's other DOs repeats work already on another DO (not billed again).
 */
export function doLineWarnings(
  quote: Array<{ key: ScopeKey | null; quantity?: any }>,
  usedElsewhere: Array<{ key: ScopeKey | null; quantity?: any }>,
  doLines: Array<{ key: ScopeKey | null; quantity?: any; description?: string | null }>,
): { billedExtra: Array<{ description: string; quantity: number }>; repeated: Array<{ description: string; quantity: number }> } {
  const full = quoteAllowance(quote);
  const left = remainingAllowance(quote, usedElsewhere);
  const totals = new Map<string, { description: string; q: number; key: ScopeKey | null }>();
  for (const l of doLines) {
    const d = String(l.description ?? '').trim();
    if (!l.key && !d) continue;
    const k = l.key ?? `new:${d.toLowerCase()}`;
    const t = totals.get(k) ?? { description: d, q: 0, key: l.key };
    t.q += qty(l);
    totals.set(k, t);
  }
  const billedExtra: Array<{ description: string; quantity: number }> = [];
  const repeated: Array<{ description: string; quantity: number }> = [];
  for (const t of totals.values()) {
    const quoted = t.key ? full.get(t.key) || 0 : 0;
    if (t.q > quoted) billedExtra.push({ description: t.description, quantity: t.q - quoted });
    const within = Math.min(t.q, quoted);
    const rest = t.key ? left.get(t.key) || 0 : 0;
    if (within > rest) repeated.push({ description: t.description, quantity: within - rest });
  }
  return { billedExtra, repeated };
}
