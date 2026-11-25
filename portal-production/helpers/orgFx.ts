// The org's base currency and the accountant's standing rates (Accounting
// Setup → Financial Settings → Currency rates: 1 unit of the foreign currency
// = rate in base). Loaded once per org by OrgTimeZoneLoader in the portal
// layout, refreshed when the rates are saved, so every editor can price a
// document in the customer's currency synchronously (guru 2026-11-25: "when i
// select this customer the rate supposed to change, when i select the item it
// should auto become idr currency").

let base = "SGD";
let rates: Record<string, number> = {};

export function setOrgFx(settings: { baseCurrency?: string | null; currencyRates?: Record<string, unknown> | null } | null | undefined) {
  base = String(settings?.baseCurrency || "SGD").toUpperCase();
  rates = {};
  for (const [code, v] of Object.entries(settings?.currencyRates || {})) {
    const n = Number(v);
    if (code && Number.isFinite(n) && n > 0) rates[code.toUpperCase()] = n;
  }
}

export const orgBaseCurrency = () => base;

/** The standing rate for a currency: 1 for the base, the locked rate, or null when none is locked in. */
export function standingRateFor(currency: string | null | undefined): number | null {
  const code = String(currency || "").toUpperCase();
  if (!code || code === base) return 1;
  return rates[code] ?? null;
}

/**
 * A master-file price (kept in the base currency) expressed in the document's
 * currency at the document's rate: 550 SGD at 1 IDR = 0.00007 SGD is
 * 7,857,142.86 IDR. Base-currency documents, a missing rate and a rate at par
 * all leave the price alone.
 */
export function priceInDocCurrency(basePrice: number, docCurrency: string | null | undefined, docRate: unknown): number {
  const n = Number(basePrice) || 0;
  const code = String(docCurrency || "").toUpperCase();
  const rate = Number(docRate);
  if (!code || code === base || !Number.isFinite(rate) || rate <= 0 || rate === 1) return n;
  return Math.round((n / rate) * 100) / 100;
}
