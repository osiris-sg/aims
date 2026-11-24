// Round 39 B4 (Workers & Teams, WCT (S), flag enableWorkersTeams): the jobs' "Team / crew" as a picker of the org's
// teams and workers (Settings > Workers & Teams), several at once, with free text still allowed (kept as typed).
// The API stores the picks (crew) and the free text (team); the calendar, its panel and the WhatsApp list show
// "Team A + Guru + <free text>". Pure helpers, tested by helpers/crewPicker.test.mjs.

export interface CrewPick {
  kind: "team" | "worker";
  id: string;
  name: string;
}
/** A chip: a picked team / worker, or a piece of free text. */
export type CrewChip = CrewPick | string;

export interface CrewOptions {
  teams: Array<{ id: string; name: string; workerIds?: string[] }>;
  workers: Array<{ id: string; name: string }>;
}

/** The free text in pieces ("Team B + Ah Seng" -> two chips); kept exactly when joined back. */
export const splitFree = (text: string | null | undefined): string[] =>
  String(text ?? "")
    .split(/\s+\+\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

/** A name compared without case or extra spaces ("team  a" = "Team A"). */
export const crewKey = (s: string | null | undefined): string => String(s ?? "").replace(/\s+/g, " ").trim().toLowerCase();

/**
 * Chips with no duplicates: a pick once (same id, or same kind and name); a piece of text once (any case) and never
 * when it is a pick's name. 2026-11-24: the calendar panel passes the job's WHOLE text ("Team A", picks included)
 * as the free text when the job has no free text of its own, so the picks came back as text chips (a duplicate,
 * and a chip that came back after it was deleted). Dropping text equal to a pick's name stops both.
 */
export function dedupeChips(chips: CrewChip[]): CrewChip[] {
  const picks: CrewPick[] = [];
  for (const c of chips) {
    if (typeof c === "string") continue;
    if (picks.some((x) => (x.kind === c.kind && x.id === c.id) || (x.kind === c.kind && crewKey(x.name) && crewKey(x.name) === crewKey(c.name)))) continue;
    picks.push({ kind: c.kind, id: c.id, name: c.name });
  }
  const seen = new Set(picks.map((p) => crewKey(p.name)).filter(Boolean));
  const out: CrewChip[] = [...picks];
  for (const c of chips) {
    if (typeof c !== "string") continue;
    const t = c.replace(/\s+/g, " ").trim();
    if (!t || seen.has(crewKey(t))) continue;
    seen.add(crewKey(t));
    out.push(t);
  }
  return out;
}

/** A job's value as chips: the picks first, then the free text (duplicates dropped, see dedupeChips). */
export const crewChips = (crew: CrewPick[] | null | undefined, team: string | null | undefined): CrewChip[] => dedupeChips([...(crew ?? []), ...splitFree(team)]);

/** Chips back to what the API takes: { crew, team } (team = the free text, "" when none). Text is kept as typed. */
export function chipsToValue(chips: CrewChip[]): { crew: CrewPick[]; team: string } {
  const clean = dedupeChips(chips);
  return { crew: clean.filter((c): c is CrewPick => typeof c !== "string"), team: clean.filter((c): c is string => typeof c === "string").join(" + ") };
}

/** The dropdown: teams first, then workers, each by name. */
export const crewOptionList = (o: CrewOptions | null | undefined): CrewPick[] => [
  ...(o?.teams ?? []).map((t) => ({ kind: "team" as const, id: t.id, name: t.name })),
  ...(o?.workers ?? []).map((w) => ({ kind: "worker" as const, id: w.id, name: w.name })),
];

export const crewLabel = (c: CrewChip): string => (typeof c === "string" ? c : c.name);
export const sameCrew = (a: CrewChip, b: CrewChip): boolean => (typeof a === "string" || typeof b === "string" ? a === b : a.kind === b.kind && a.id === b.id);
/** A team written out (2026-11-24): "D" -> "Team D"; a name already starting with "Team" is kept. Display only. */
export const teamName = (name: string): string => {
  const n = String(name ?? "").replace(/\s+/g, " ").trim();
  return !n || /^team\b/i.test(n) ? n : `Team ${n}`;
};
const freePiece = (p: string): string => (/^[a-z][0-9]?$/i.test(p) ? teamName(p.toUpperCase()) : p);

/** The text the job shows (same rule as the API's crewText): "Team D, Team E, Guru". */
export const crewDisplay = (crew: CrewPick[] | null | undefined, team: string | null | undefined): string => {
  const parts = [
    ...(crew ?? []).map((c) => (c.kind === "team" ? teamName(c.name) : c.name)),
    ...String(team ?? "")
      .split(/\s*,\s*|\s+\+\s+/)
      .map((x) => x.trim())
      .filter(Boolean)
      .map(freePiece),
  ].filter(Boolean);
  const out: string[] = [];
  for (const x of parts) if (!out.some((y) => y.toLowerCase() === x.toLowerCase())) out.push(x);
  return out.join(", ");
};

/** Two { crew, team } values hold the same chips (same picks in the same order, same text). */
export const sameValue = (a: { crew: CrewPick[]; team: string }, b: { crew: CrewPick[]; team: string }): boolean =>
  a.team === b.team && a.crew.length === b.crew.length && a.crew.every((c, i) => c.kind === b.crew[i].kind && c.id === b.crew[i].id);
