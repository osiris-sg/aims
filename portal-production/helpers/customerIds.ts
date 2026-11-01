// Customer UEN + old code (enableCustomerUen, 2026-11-02). Customer.uen is the
// registration number; Customer.externalRef the customer's code in the org's
// previous system (WCT: the DP Info debtor code, "228+229" for two merged
// debtors). The server search uses the same rules (customers.service.ts).

type CustomerIds = { uen?: string | null; externalRef?: string | null };

/** An old code matches whole, or as one part of a merged "228+229". */
export function oldCodeMatches(externalRef: string | null | undefined, term: string): boolean {
  const t = term.trim();
  if (!externalRef || !t) return false;
  return externalRef.split("+").some((part) => part.trim() === t);
}

/** True when the term finds this customer by UEN (substring) or old code (whole). */
export function customerIdsMatch(c: CustomerIds, term: string): boolean {
  const t = term.trim().toLowerCase();
  if (!t) return false;
  return (!!c.uen && c.uen.toLowerCase().includes(t)) || oldCodeMatches(c.externalRef, t);
}

/** "UEN 201302496E · Old code 449", or "" when the customer has neither. */
export function customerIdsLine(c: CustomerIds): string {
  return [c.uen ? `UEN ${c.uen}` : "", c.externalRef ? `Old code ${c.externalRef}` : ""].filter(Boolean).join(" · ");
}

type Rankable = CustomerIds & { customerCode?: string | null; name?: string | null };

/**
 * Order server search results for a picker: an exact code / old code / UEN hit
 * first, then names starting with the term, then the rest (server order kept).
 */
export function rankCustomers<T extends Rankable>(list: T[], term: string): T[] {
  const t = term.trim().toLowerCase();
  if (!t) return list;
  const score = (c: T) => {
    if ((c.customerCode ?? "").toLowerCase() === t || oldCodeMatches(c.externalRef, t) || (c.uen ?? "").toLowerCase() === t) return 0;
    if ((c.name ?? "").toLowerCase().startsWith(t) || (c.customerCode ?? "").toLowerCase().startsWith(t)) return 1;
    return 2;
  };
  return list
    .map((c, i) => ({ c, i, s: score(c) }))
    .sort((a, b) => a.s - b.s || a.i - b.i)
    .map((x) => x.c);
}

/** "CA001 · Acme Pte Ltd" (or just the name without a code). */
export function customerLabel(c: { customerCode?: string | null; name?: string | null } | null | undefined): string {
  if (!c) return "";
  return [c.customerCode, c.name].filter((v) => v && String(v).trim()).join(" · ");
}
