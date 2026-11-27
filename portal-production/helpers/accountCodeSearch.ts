// Account codes are searched with their punctuation ignored (guru 2026-11-26): the WCT group's
// charts came from ABSS as "4-2000", and the office keys "42000". Every account code box, Locate
// Account dialog and account dropdown goes through these three functions, so "42000", "4-2000"
// and "4 2000" all find the same account. Charts with plain codes ("200", "CA101") are unchanged.

/** A code or typed text reduced to its letters and digits, lower-cased: "4-2000" → "42000". */
export const accountCodeKey = (v: unknown): string => String(v ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");

/**
 * The account a typed code names: the exact code first; otherwise the ONE account whose code
 * equals it once punctuation is ignored. Two candidates (a chart holding both "1-200" and
 * "1200") is no match: the user picks from the list.
 */
export function findAccountByTypedCode<T extends { code: string }>(accounts: T[], typed: string): T | undefined {
  const t = String(typed ?? "").trim().toLowerCase();
  if (!t) return undefined;
  const exact = accounts.find((a) => String(a.code).toLowerCase() === t);
  if (exact) return exact;
  const key = accountCodeKey(t);
  if (!key) return undefined;
  const loose = accounts.filter((a) => accountCodeKey(a.code) === key);
  return loose.length === 1 ? loose[0] : undefined;
}

/** Does an account match a search term: by code (punctuation ignored), name, or any extra text. */
export function accountMatchesSearch(a: { code?: unknown; name?: unknown }, term: string, extra: unknown[] = []): boolean {
  const t = String(term ?? "").trim().toLowerCase();
  if (!t) return true;
  if ([a.code, a.name, `${a.code ?? ""} ${a.name ?? ""}`, ...extra].some((v) => String(v ?? "").toLowerCase().includes(t))) return true;
  const key = accountCodeKey(t);
  // Only a term that carries a digit is tried as a dashless code ("42000"), never a plain word.
  return /\d/.test(key) && accountCodeKey(a.code).includes(key);
}

/** `filterOptions` for an MUI Autocomplete of accounts ({ code, name }). */
export function accountFilterOptions<T extends { code?: unknown; name?: unknown }>(options: T[], state: { inputValue: string }): T[] {
  return options.filter((o) => accountMatchesSearch(o, state.inputValue));
}
