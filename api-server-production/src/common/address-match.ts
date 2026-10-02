// Shared site-address → project matcher (extracted from the WhatsApp operator
// so the portal's mass invoice upload scores identically, guru 2026-10-02).
export interface MatchableProject {
  id: string;
  name: string;
  address: string | null;
  customer?: string | null;
}

const norm = (s: any) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export function scoreProjectMatch(siteAddress: string | null | undefined, p: MatchableProject): number {
  if (!siteAddress) return 0;
  const invTokens = new Set(norm(siteAddress).split(' ').filter((t) => t.length >= 2));
  if (!invTokens.size) return 0;
  const ptoks = new Set(norm(`${p.name} ${p.address || ''}`).split(' ').filter(Boolean));
  let score = 0;
  for (const t of ptoks) if (invTokens.has(t)) score += /[0-9]/.test(t) ? 2 : 1;
  return score;
}

/** Confident single match: clears a threshold AND clearly beats the runner-up. */
export function matchProjectByAddress<T extends MatchableProject>(siteAddress: string | null | undefined, projects: T[]): T | null {
  const scored = projects.map((p) => ({ p, s: scoreProjectMatch(siteAddress, p) })).sort((a, b) => b.s - a.s);
  const [best, second] = scored;
  if (best && best.s >= 4 && (!second || best.s >= second.s + 3)) return best.p;
  return null;
}

/** Top-N candidates with non-zero scores (for the ambiguous picker). */
export function rankProjectsByAddress<T extends MatchableProject>(siteAddress: string | null | undefined, projects: T[], n = 5): Array<T & { score: number }> {
  return projects
    .map((p) => ({ ...p, score: scoreProjectMatch(siteAddress, p) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, n);
}
