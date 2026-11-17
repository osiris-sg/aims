// Customer UEN + old code (enableCustomerUen, 2026-11-02). Customer.uen is the
// registration number; Customer.externalRef the customer's code in the org's
// previous system (WCT: the DP Info debtor code, "228+229" for two merged
// debtors). The server search uses the same rules (customers.service.ts).
// UEN matching and hiding import tags are for enableCustomerUen orgs only:
// callers pass the flag as `uen` (default off = no UEN match, tags shown).

type CustomerIds = { uen?: string | null; externalRef?: string | null };
type UenOpts = { uen?: boolean };

/** An old code matches whole, or as one part of a merged "228+229". */
export function oldCodeMatches(externalRef: string | null | undefined, term: string): boolean {
  const t = term.trim();
  if (!externalRef || !t) return false;
  return externalRef.split("+").some((part) => part.trim() === t);
}

/** True when the term finds this customer by UEN (substring; flag orgs) or old code (whole). */
export function customerIdsMatch(c: CustomerIds, term: string, opts: UenOpts = {}): boolean {
  const t = term.trim().toLowerCase();
  if (!t) return false;
  return (!!opts.uen && !!c.uen && c.uen.toLowerCase().includes(t)) || oldCodeMatches(c.externalRef, t);
}

/**
 * The old code to show, or null. The WCT ERP / books imports used
 * Customer.externalRef as their batch marker ("erp-import:wct-erp-2026-11-05"):
 * not a code the customer had, so flag orgs (uen: true) never show it. Flag
 * off returns the stored value as before.
 */
export function oldCodeOf(externalRef: string | null | undefined, opts: UenOpts = {}): string | null {
  if (!opts.uen) return externalRef || null;
  const v = (externalRef ?? "").trim();
  if (!v || v.startsWith("erp-import:")) return null;
  return v;
}

/**
 * "UEN 201302496E · Old code 449", or "" when the customer has neither.
 * withUen=false leaves the UEN out (the picker shows it in its own column);
 * uen=true (flag orgs) hides import tags.
 */
export function customerIdsLine(c: CustomerIds, opts: { withUen?: boolean } & UenOpts = {}): string {
  const withUen = opts.withUen ?? true;
  const old = oldCodeOf(c.externalRef, opts);
  return [withUen && c.uen ? `UEN ${c.uen}` : "", old ? `Old code ${old}` : ""].filter(Boolean).join(" · ");
}

/** UEN as saved: trimmed, upper case; "" becomes null. */
export function normalizeUen(raw: string | null | undefined): string | null {
  const v = String(raw ?? "").trim().toUpperCase();
  return v || null;
}

// Singapore UEN shapes (ACRA): business 8 digits + letter, local company
// 9 digits + letter (201302496E), other entities T/S/R + yy + 2 letters +
// 4 digits + letter (T08LL1234A); GST-only registrations M + 9 (M90312345A,
// MR-8500016-3). Spaces and dashes are ignored for the check.
const UEN_RE = /^(\d{8}[A-Z]|\d{9}[A-Z]|[TSR]\d{2}[A-Z]{2}\d{4}[A-Z]|M[0-9A-Z]\d{7}[0-9A-Z])$/;

/** True for a blank UEN or one of the Singapore shapes (a warning, never a block). */
export function uenLooksValid(raw: string | null | undefined): boolean {
  const v = (normalizeUen(raw) ?? "").replace(/[\s-]/g, "");
  return !v || UEN_RE.test(v);
}

type Rankable = CustomerIds & { customerCode?: string | null; name?: string | null };

/**
 * Order server search results for a picker: an exact code / old code / UEN hit
 * first, then names starting with the term, then the rest (server order kept).
 */
export function rankCustomers<T extends Rankable>(list: T[], term: string, opts: UenOpts = {}): T[] {
  const t = term.trim().toLowerCase();
  if (!t) return list;
  const score = (c: T) => {
    if ((c.customerCode ?? "").toLowerCase() === t || oldCodeMatches(c.externalRef, t) || (!!opts.uen && (c.uen ?? "").toLowerCase() === t)) return 0;
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
