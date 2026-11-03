/**
 * WCT: tag a supplier invoice (SIN) with the quotation its cost belongs to
 * (enableWctOrders, 2026-11-03). 2026-11-04: PER LINE — one SIN can cover
 * several job sites. Each line of config.lines carries quotationId +
 * quotationNumber (lines live in the bill's config JSON; there is no line
 * table), and the bill keeps the distinct ones as config.quotationIds /
 * quotationNumbers (the list query strips lines, so it reads these). The old
 * header keys config.quotationId / quotationNumber stay where they are and
 * are read as "every line" for a bill saved before. Pure helpers:
 * which quotation numbers a supplier's invoice mentions, and the one exact
 * match among the org's quotations. Never a fuzzy guess.
 */

export const WCT_ORDERS_FLAG = 'enableWctOrders';
export const QUOTATION_TYPES = ['QUOTATION', 'QO', 'QO1', 'QO2', 'QT'];

/** Quotation-number-looking tokens: letters, 6 digits (YYYYMM), a dash, 3-4 digits ("QO202611-0020"). */
const QUOTE_TOKEN = /\b([A-Z]{1,5}\d{6}-\d{3,4})\b/gi;

/** Every quotation-number-looking token in the extracted invoice (the model's quotationRefs, reference, notes, line texts). */
export function quotationCandidates(parsed: any): string[] {
  const texts: string[] = [];
  const push = (v: unknown) => {
    if (typeof v === 'string' && v.trim()) texts.push(v);
  };
  for (const r of Array.isArray(parsed?.quotationRefs) ? parsed.quotationRefs : []) push(r);
  push(parsed?.reference);
  push(parsed?.description);
  for (const l of Array.isArray(parsed?.lines) ? parsed.lines : []) push(l?.description);
  const out = new Set<string>();
  for (const t of texts) for (const m of t.matchAll(QUOTE_TOKEN)) out.add(m[1].toUpperCase());
  // The model's quotationRefs as read (e.g. "Your ref: QO-E2E-12"): the whole entry and each word in it.
  // Still matched EXACTLY against the org's quotation numbers (pickQuotation), never guessed.
  for (const r of Array.isArray(parsed?.quotationRefs) ? parsed.quotationRefs : []) {
    if (typeof r !== 'string') continue;
    const whole = r.trim().toUpperCase();
    if (whole) out.add(whole);
    for (const w of whole.split(/[\s:;,()#]+/)) if (w.length >= 4) out.add(w);
  }
  return [...out];
}

/** The one quotation the invoice names: exactly one candidate that is an existing quotation number; else null. */
export function pickQuotation(candidates: string[], existing: Array<{ id: string; name: string | null }>): { id: string; name: string } | null {
  const byName = new Map(existing.filter((q) => q.name).map((q) => [q.name!.toUpperCase(), q]));
  const hits = [...new Set(candidates.map((c) => c.toUpperCase()))].map((c) => byName.get(c)).filter(Boolean) as Array<{ id: string; name: string }>;
  const unique = [...new Map(hits.map((h) => [h.id, h])).values()];
  return unique.length === 1 ? { id: unique[0].id, name: unique[0].name } : null;
}

/** The extra line WCT's extraction prompt gets (other orgs: none). */
export const QUOTATION_REFS_PROMPT = `  - "quotationRefs": array of strings — every quotation number printed on the document that refers to the CUSTOMER'S quotation (e.g. "Your ref: QO202611-0020", "Quotation No.: QO202611-0020"). Copy each verbatim. Empty array if none.`;

export interface TaggedSinRow {
  id: string;
  billNumber: string;
  /** The lines of this order's quotation only (2026-11-04: quotations are per line). */
  quotationAmount: number;
  supplierName: string | null;
  billDate: string | null;
  totalAmount: number;
  currency: string;
  void: boolean;
}

/**
 * The order page's "Supplier invoices" (read-only): the SINs with a line on the
 * order's quotation, newest first; each with the amount of that quotation's
 * lines (and its whole total), and the sum of those amounts. A voided SIN is
 * listed (marked) but not counted.
 */
export function taggedSinsView(docs: Array<{ id: string; name: string | null; status: string; config: any }>, supplierNames: Map<string, string>, quotationId?: string) {
  const rows: TaggedSinRow[] = docs.map((d) => {
    const c: any = d.config || {};
    const sid = c.supplierId || c.supplier?.id;
    const isVoid = c.billStatus === 'VOID' || c.xeroStatus === 'Voided' || c.xeroStatus === 'Deleted' || d.status === 'cancelled';
    return {
      id: d.id,
      billNumber: d.name || '',
      quotationAmount: quotationId ? quotationLinesAmount(c, quotationId) : Number(c.totalAmount ?? c.totalWithTax ?? 0) || 0,
      supplierName: (sid && supplierNames.get(sid)) || c.supplier?.name || null,
      billDate: c.billDate || c.date || null,
      totalAmount: Number(c.totalAmount ?? c.totalWithTax ?? 0) || 0,
      currency: c.currency || c.documentInfo?.currency || 'SGD',
      void: isVoid,
    };
  });
  rows.sort((a, b) => String(b.billDate || '').localeCompare(String(a.billDate || '')));
  const total = Math.round(rows.filter((r) => !r.void).reduce((n, r) => n + r.quotationAmount, 0) * 100) / 100;
  return { rows, total };
}

export type QuotationRef = { id: string; number: string };

/**
 * The distinct quotations a SIN's cost belongs to, in line order: the stored summary
 * (quotationIds / quotationNumbers), else its lines, else the old header tag.
 */
export function lineQuotationsOf(c: any): QuotationRef[] {
  const cfg = c || {};
  if (Array.isArray(cfg.quotationIds)) return cfg.quotationIds.map((id: string, i: number) => ({ id, number: (cfg.quotationNumbers || [])[i] || '' }));
  const out = new Map<string, string>();
  for (const l of (cfg.lines || cfg.items || []) as any[]) if (l?.quotationId && !out.has(l.quotationId)) out.set(l.quotationId, l.quotationNumber || '');
  if (!out.size && cfg.quotationId) out.set(cfg.quotationId, cfg.quotationNumber || '');
  return [...out].map(([id, number]) => ({ id, number }));
}

/** The summary keys a bill stores for its lines' quotations (distinct, in line order). */
export function quotationSummary(lines: any[]): { quotationIds: string[]; quotationNumbers: string[] } {
  const out = new Map<string, string>();
  for (const l of lines || []) if (l?.quotationId && !out.has(l.quotationId)) out.set(l.quotationId, l.quotationNumber || '');
  return { quotationIds: [...out.keys()], quotationNumbers: [...out.values()] };
}

/** A line's quotation: its own, else (a bill saved before 2026-11-04) the old header tag. */
export const lineQuotationId = (line: any, c: any): string | null => line?.quotationId || (Array.isArray(c?.quotationIds) ? null : c?.quotationId) || null;

/** The amount of a SIN's lines that belong to this quotation (lines as stored; 2 dp). */
export function quotationLinesAmount(c: any, quotationId: string): number {
  const lines = ((c?.lines || c?.items || []) as any[]).filter((l) => lineQuotationId(l, c) === quotationId);
  return Math.round(lines.reduce((n, l) => n + (Number(l?.amount) || 0), 0) * 100) / 100;
}
