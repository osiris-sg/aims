// PTW applicants list (Settings > Job fields, WCT group 2026-11-19): pure helpers for the editor (tested in
// helpers/ptwApplicants.test.mjs).

export interface ApplicantEntry {
  /** Client key: the saved id, or new-n for a row not saved yet. */
  key: string;
  /** Saved id (pta_…); absent on a new row. */
  id?: string;
  name: string;
  colour: string;
  userId: string | null;
  hidden: boolean;
}
export interface SavedList {
  entries: Array<{ id: string; name: string; colour: string; userId: string | null; hidden: boolean }>;
  defaultId: string | null;
}

/** The saved list as editor rows. */
export const rowsOf = (list: SavedList | null): ApplicantEntry[] => (list?.entries ?? []).map((e) => ({ ...e, key: e.id }));

let seq = 0;
/** A new row: the first palette colour no row uses yet (else the first). */
export function newEntry(rows: ApplicantEntry[], palette: string[]): ApplicantEntry {
  const used = new Set(rows.map((r) => r.colour));
  return { key: `new-${++seq}`, name: "", colour: palette.find((c) => !used.has(c)) ?? palette[0] ?? "#455a64", userId: null, hidden: false };
}

/** Move row i up (-1) or down (+1). */
export function moveEntry<T>(rows: T[], i: number, by: -1 | 1): T[] {
  const j = i + by;
  if (j < 0 || j >= rows.length) return rows;
  const next = rows.slice();
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

/** The PUT body: entries in order (ids kept), the default by id, or by name for a row not saved yet. */
export function toSaveBody(rows: ApplicantEntry[], defaultKey: string | null) {
  const d = rows.find((r) => r.key === defaultKey) ?? null;
  return {
    entries: rows.map((r) => ({ ...(r.id ? { id: r.id } : {}), name: r.name, colour: r.colour, userId: r.userId, hidden: r.hidden })),
    ...(d?.id ? { defaultId: d.id } : d ? { defaultName: d.name.trim() } : {}),
  };
}

/** True when the rows and the default are what is saved (Save stays off). */
export function sameList(saved: SavedList | null, rows: ApplicantEntry[], defaultKey: string | null): boolean {
  const a = (saved?.entries ?? []).map((e) => [e.id, e.name, e.colour, e.userId, e.hidden]);
  const b = rows.map((r) => [r.id ?? null, r.name, r.colour, r.userId, r.hidden]);
  return JSON.stringify(a) === JSON.stringify(b) && (saved?.defaultId ?? null) === defaultKey;
}
