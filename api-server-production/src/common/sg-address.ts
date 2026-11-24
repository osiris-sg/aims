/**
 * Singapore in addresses (WCT group, 2026-11-24): an address that ends in a 6-digit postal code and names no country
 * reads "... Singapore 639273". "S 639273", "S(639273)" and "S'pore 639273" become the same. Addresses that already
 * say Singapore, or name another country, are kept as typed. Pure.
 */
const COUNTRY_RE = /\b(singapore|s'?pore|malaysia|johor|indonesia|batam|thailand|vietnam|china|japan|india|philippines|brunei|australia)\b/i;
const TAIL_RE = /(?:[,\s]+(?:S|Spore)\.?\s*\(?\s*|[,\s]+\(?\s*)(\d{6})\s*\)?\s*\.?\s*$/i;

export function withSingapore(address: string | null | undefined): string {
  const a = String(address ?? '');
  const t = a.replace(/\s+$/, '');
  if (!t || COUNTRY_RE.test(t)) return a;
  const m = TAIL_RE.exec(t);
  if (!m) return a;
  const head = t.slice(0, m.index).replace(/[,\s]+$/, '');
  if (!head) return a;
  const sep = /\n/.test(t.slice(m.index)) ? '\n' : ' ';
  return `${head}${sep}Singapore ${m[1]}`;
}
