// Org Settings > Calendar colours (WCT group, 2026-11-25, enableCalendarStyle). Pure helpers for the page; the API is
// GET / PUT /dashboard/calendar-style/colours (api-server-production/src/dashboard/calendar-style.service.ts).

export interface ColourPerson {
  id: string;
  name: string;
  /** Today's colour: the picked one, else the automatic one. */
  colour: string;
  /** true = automatic (nothing picked yet). */
  auto: boolean;
}
export interface PtwStatusRow {
  status: "REQUIRED" | "SUBMITTED" | "APPROVED" | "REJECTED";
  label: string;
  /** null = the applicant's colour (the default). */
  colour: string | null;
}
export interface ColoursPage {
  people: ColourPerson[];
  ptw: PtwStatusRow[];
  applicants: Array<{ name: string; colour: string }>;
  palettes: { people: string[]; ptw: string[] };
}

/** What a person row holds in the editor: a picked colour, or null = automatic. */
export type PersonPick = string | null;

export const pickOf = (p: ColourPerson): PersonPick => (p.auto ? null : p.colour.toLowerCase());

/** The PUT body for what changed (people: picked colour or null = automatic; ptw: colour or null = applicant), or null. */
export function colourChanges(
  saved: ColoursPage,
  people: Record<string, PersonPick>,
  ptw: Record<string, string | null>,
): { people?: Array<{ id: string; colour: string | null }>; ptw?: Record<string, string | null> } | null {
  const ppl = saved.people.filter((p) => p.id in people && (people[p.id] ?? null) !== pickOf(p)).map((p) => ({ id: p.id, colour: people[p.id] ?? null }));
  const st = saved.ptw.filter((r) => r.status in ptw && (ptw[r.status] ?? null) !== (r.colour ?? null));
  if (!ppl.length && !st.length) return null;
  return {
    ...(ppl.length ? { people: ppl } : {}),
    ...(st.length ? { ptw: Object.fromEntries(st.map((r) => [r.status, ptw[r.status] ?? null])) } : {}),
  };
}

/** The colour a person shows with: the pick; for "Automatic", their automatic colour when known (null = given on save). */
export const shownColour = (p: ColourPerson, pick: PersonPick | undefined): string | null => (pick === undefined ? p.colour : pick ?? (p.auto ? p.colour : null));

/** The palette a picker offers: the palette, with the current value first when it is not in it. */
export const pickerOptions = (palette: string[], current: string | null): string[] => {
  const list = palette.map((c) => c.toLowerCase());
  const c = current?.toLowerCase();
  return c && !list.includes(c) ? [c, ...list] : list;
};
