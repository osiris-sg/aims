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
/**
 * The page's data. 2026-11-26: the PTW "Stripe colour" section is gone; the server still sends `ptw`, `applicants`
 * and `palettes.ptw` (and keeps any stored status colours), the page no longer reads or sends them.
 */
export interface ColoursPage {
  people: ColourPerson[];
  palettes: { people: string[] };
}

/** What a person row holds in the editor: a picked colour, or null = automatic. */
export type PersonPick = string | null;

export const pickOf = (p: ColourPerson): PersonPick => (p.auto ? null : p.colour.toLowerCase());

/** The PUT body for what changed (people: picked colour or null = automatic), or null. Never sends `ptw`. */
export function colourChanges(saved: ColoursPage, people: Record<string, PersonPick>): { people: Array<{ id: string; colour: string | null }> } | null {
  const ppl = saved.people.filter((p) => p.id in people && (people[p.id] ?? null) !== pickOf(p)).map((p) => ({ id: p.id, colour: people[p.id] ?? null }));
  return ppl.length ? { people: ppl } : null;
}

/** The colour a person shows with: the pick; for "Automatic", their automatic colour when known (null = given on save). */
export const shownColour = (p: ColourPerson, pick: PersonPick | undefined): string | null => (pick === undefined ? p.colour : pick ?? (p.auto ? p.colour : null));

/** The palette a picker offers: the palette, with the current value first when it is not in it. */
export const pickerOptions = (palette: string[], current: string | null): string[] => {
  const list = palette.map((c) => c.toLowerCase());
  const c = current?.toLowerCase();
  return c && !list.includes(c) ? [c, ...list] : list;
};
