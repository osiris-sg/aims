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

/** A job's value as chips: the picks first, then the free text. */
export const crewChips = (crew: CrewPick[] | null | undefined, team: string | null | undefined): CrewChip[] => [...(crew ?? []), ...splitFree(team)];

/** Chips back to what the API takes: { crew, team } (team = the free text, "" when none). */
export function chipsToValue(chips: CrewChip[]): { crew: CrewPick[]; team: string } {
  const crew: CrewPick[] = [];
  const free: string[] = [];
  for (const c of chips) {
    if (typeof c === "string") {
      const t = c.replace(/\s+/g, " ").trim();
      if (t && !free.includes(t)) free.push(t);
    } else if (!crew.some((x) => x.kind === c.kind && x.id === c.id)) crew.push({ kind: c.kind, id: c.id, name: c.name });
  }
  return { crew, team: free.join(" + ") };
}

/** The dropdown: teams first, then workers, each by name. */
export const crewOptionList = (o: CrewOptions | null | undefined): CrewPick[] => [
  ...(o?.teams ?? []).map((t) => ({ kind: "team" as const, id: t.id, name: t.name })),
  ...(o?.workers ?? []).map((w) => ({ kind: "worker" as const, id: w.id, name: w.name })),
];

export const crewLabel = (c: CrewChip): string => (typeof c === "string" ? c : c.name);
export const sameCrew = (a: CrewChip, b: CrewChip): boolean => (typeof a === "string" || typeof b === "string" ? a === b : a.kind === b.kind && a.id === b.id);
/** The text the job shows (same rule as the API's crewText). */
export const crewDisplay = (crew: CrewPick[] | null | undefined, team: string | null | undefined): string => [...(crew ?? []).map((c) => c.name), team ?? ""].filter(Boolean).join(" + ");
