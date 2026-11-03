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
