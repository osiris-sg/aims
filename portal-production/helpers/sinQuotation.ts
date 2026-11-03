/**
 * WCT: a supplier invoice's Quotation No. (enableWctOrders, 2026-11-03).
 * Stored on the bill as quotationId + quotationNumber.
 */
export type QuotationTag = { id: string; number: string };

/** A quotation's total from its config (same keys the server's grossOf reads). */
export function quotationTotal(config: any): number | null {
  const c = config || {};
  for (const v of [c.totalWithTax, c.nettTotal, c.totalAmount, c.documentInfo?.nettTotal]) {
    const n = typeof v === "string" ? parseFloat(v) : v;
    if (typeof n === "number" && Number.isFinite(n)) return n;
  }
  return null;
}

const money = (n: number) => `S$${n.toLocaleString("en-SG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** "QO202611-0020 · Customer · S$1,234.00" (missing parts left out). */
export function quotationOptionLabel(number: string, customer: string | null | undefined, total: number | null): string {
  return [number, customer && customer !== "N/A" ? customer : null, total != null ? money(total) : null].filter(Boolean).join(" · ");
}

/** The tag a bill (or an extraction) carries, or null. */
export function tagOf(b: { quotationId?: string | null; quotationNumber?: string | null } | null | undefined): QuotationTag | null {
  return b?.quotationId ? { id: b.quotationId, number: b.quotationNumber || "" } : null;
}

/**
 * 2026-11-04: the quotation is per LINE (one SIN can cover several job sites). The bill's distinct quotations, in
 * line order: the API's `quotations`, else (an older response) the header tag.
 */
export function billQuotations(b: { quotations?: QuotationTag[] | null; quotationId?: string | null; quotationNumber?: string | null } | null | undefined): QuotationTag[] {
  if (Array.isArray(b?.quotations)) return b!.quotations!;
  const t = tagOf(b);
  return t ? [t] : [];
}

/** The Purchase Journal cell: one or two numbers comma-separated; more → the first plus "+N". */
export function quotationsCell(numbers: string[]): { shown: string[]; more: number } {
  const ns = numbers.filter(Boolean);
  return ns.length > 2 ? { shown: [ns[0]], more: ns.length - 1 } : { shown: ns, more: 0 };
}

/** A line's quotation as the API returns it (an old header-only bill already has it on every line). */
export function lineTagOf(line: { quotationId?: string | null; quotationNumber?: string | null } | null | undefined): QuotationTag | null {
  return line?.quotationId ? { id: line.quotationId, number: line.quotationNumber || "" } : null;
}
