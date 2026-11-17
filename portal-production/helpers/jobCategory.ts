// Job category (WCT group, 2026-11-17): one required pick per job, the org's list in Settings > Job fields.
// Pure helpers, tested by helpers/jobCategory.test.mjs. Mirrors api-server-production/src/deliveries/job-category.ts.
// An org without the job_category field gets null from the API and sees nothing new.

export interface JobCategoryDef {
  id: string;
  options: string[];
  defaultValue: string;
}

/** What a job shows: its pick, else the default (blank = "Service order"). */
export function categoryShown(def: Pick<JobCategoryDef, "defaultValue">, raw: string | null | undefined): string {
  const s = typeof raw === "string" ? raw.trim() : "";
  return s || def.defaultValue;
}

/** The settings list cleaned like the server does: trimmed, no blanks, no repeats (any case). */
export function cleanCategoryList(list: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of list) {
    const s = String(v ?? "").replace(/\s+/g, " ").trim();
    if (!s || seen.has(s.toLowerCase())) continue;
    seen.add(s.toLowerCase());
    out.push(s);
  }
  return out;
}

/** Move one entry up (-1) or down (+1); the first entry is the default. */
export function moveCategory(list: string[], index: number, by: -1 | 1): string[] {
  const to = index + by;
  if (index < 0 || index >= list.length || to < 0 || to >= list.length) return list;
  const next = [...list];
  [next[index], next[to]] = [next[to], next[index]];
  return next;
}

/** A calendar chip's tooltip: "<title>\nCategory: <name>", or null (no category: no tooltip, as before). */
export function categoryChipTitle(e: { category?: string | null } | null | undefined, title: string): string | null {
  const c = e?.category?.trim();
  return c ? `${title}\nCategory: ${c}` : null;
}
