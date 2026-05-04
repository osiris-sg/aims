/**
 * Canonical project-name normalizer.
 *
 * KEEP IN SYNC with portal-production/helpers/normalizeProjectName.ts and
 * api-server-production/scripts/merge-duplicate-projects.ts. Any change to
 * these rules MUST be applied in all three places — the dedup merger, the
 * import-time matcher (both frontend and backend), and the backend
 * idempotency check in ImportService.createProject all rely on identical
 * output for the same input.
 *
 * Rules:
 *   - lowercase, trim
 *   - strip leading "HDB ", "The ", "Mr ", "Mrs "
 *   - replace separators (- _ / & ,) with single space, collapse whitespace
 *   - strip trailing sub-identifier tokens: CC[0-9]+, "Phase N", roman numerals
 *     (NOT pure standalone digits — verified: "Lane 3" vs "Lane 4" are
 *     legitimately different addresses)
 *   - if the final remaining last token has length >= 4 and ends in 's',
 *     drop the trailing 's' (peaks → peak)
 */

const LEAD_PREFIXES = ['hdb ', 'the ', 'mr ', 'mrs '];
const ROMAN = new Set(['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x']);
const PHASE_RE = /^phase$/i;

export function normalizeProjectName(raw: string | null | undefined): string {
  if (!raw) return '';
  let n = raw.toLowerCase().trim();
  for (const p of LEAD_PREFIXES) {
    while (n.startsWith(p)) n = n.slice(p.length).trimStart();
  }
  n = n.replace(/[-_/&,]+/g, ' ');
  n = n.replace(/\s+/g, ' ').trim();
  let tokens = n.split(' ');
  while (tokens.length > 1) {
    const last = tokens[tokens.length - 1];
    const isCcNum = /^cc\d+$/i.test(last);
    const isRoman = ROMAN.has(last);
    if (
      tokens.length >= 2 &&
      PHASE_RE.test(tokens[tokens.length - 2]) &&
      /^\d+$/.test(last)
    ) {
      tokens.pop();
      tokens.pop();
      continue;
    }
    if (isCcNum || isRoman) {
      tokens.pop();
      continue;
    }
    break;
  }
  if (tokens.length > 0) {
    const last = tokens[tokens.length - 1];
    if (last.length >= 4 && last.endsWith('s')) {
      tokens[tokens.length - 1] = last.slice(0, -1);
    }
  }
  return tokens.join(' ');
}
