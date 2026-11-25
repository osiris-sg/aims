// ERP-imported documents (WCT 2026-11), split payment parts and documents whose GST Xero worked out
// (holdsXeroTotals): they show and print their stored subtotal / GST / total
// (some carry a GST that is not rate × subtotal). The editor recalculates only when the lines'
// money changes. Mirrors api-server-production/src/common/erp-import.ts; tested by
// helpers/erpImport.test.mjs.

/** The lines' money only (count + qty / unit price / amount per line). */
export function moneySignature(items: any): string {
  const list: any[] = Array.isArray(items) ? items : [];
  const n = (v: any) => {
    const x = Number(String(v ?? "").replace(/,/g, ""));
    return Number.isFinite(x) ? x.toFixed(2) : "0.00";
  };
  return list
    .filter((it) => it && !it.isGroupHeader && !it.isTagGroup)
    .map((it) => `${n(it.quantity)}x${n(it.unitPrice)}=${n(it.amount)}`)
    .join("|");
}

export interface ErpStoredTotals {
  grossTotal: number;
  discountAmount: number;
  subTotal: number;
  gstAmount: number;
  nettTotal: number;
  gstPercent: number;
  sig: string;
}

// A document whose GST Xero worked out: a Xero-origin import, or an AIMS invoice confirmed from Xero (xero-sync.service
// writes Xero's subTotal / gstAmount / nettTotal). Xero rounds GST per line, AIMS once on the subtotal, so the stored
// totals stand like an ERP import's (BIPL-JPSG-20260928-0007, 2026-11-26: Xero 592.71 / 7,178.31, the editor's formula
// 592.70 / 7,178.30, and a receipt was keyed at the editor's figure leaving 0.01 owed).
export const holdsXeroTotals = (config: any): boolean => typeof config?.xeroInvoiceId === "string" && config.xeroInvoiceId.length > 0;

/** An imported document's stored totals from its saved config (null for any other document). */
export function erpStoredTotalsOf(config: any): ErpStoredTotals | null {
  // Also a Split payment part (config.invoiceSplit): the last part keeps the original's leftover GST cent.
  const splitPart = !!config?.invoiceSplit && typeof config.invoiceSplit === "object" && typeof config.invoiceSplit.groupId === "string";
  if (!config?.erpImport?.source && !splitPart && !holdsXeroTotals(config)) return null;
  const pick = (k: string) => {
    const v = config?.[k] ?? config?.documentInfo?.[k];
    const x = Number(v);
    return v === undefined || v === null || v === "" || !Number.isFinite(x) ? null : x;
  };
  const nettTotal = pick("nettTotal");
  const gstAmount = pick("gstAmount");
  const subTotal = pick("subTotal");
  if (nettTotal === null || gstAmount === null || subTotal === null) return null;
  return {
    grossTotal: pick("grossTotal") ?? subTotal,
    discountAmount: pick("discountAmount") ?? 0,
    subTotal,
    gstAmount,
    nettTotal,
    gstPercent: pick("gstPercent") ?? 0,
    sig: moneySignature(config?.items),
  };
}

/** The editor's right-column totals: the stored ones while the lines' money is unchanged. */
export function storedTotalsFor(stored: ErpStoredTotals | null | undefined, items: any): Omit<ErpStoredTotals, "sig" | "gstPercent"> | null {
  if (!stored || moneySignature(items) !== stored.sig) return null;
  const { grossTotal, discountAmount, subTotal, gstAmount, nettTotal } = stored;
  return { grossTotal, discountAmount, subTotal, gstAmount, nettTotal };
}
