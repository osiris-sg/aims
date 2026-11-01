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
