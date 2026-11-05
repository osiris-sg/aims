// Round BF (Sayaka) — senders resend revised files under the same name ("198GX07112 BLCopyView (1).pdf" ×3).
// The API marks each attachment's version (same name or same bytes): Latest / Older version / Identical to …;
// these helpers turn that into the badge and the file rows' facts line. Pure (node --test); text comes from the
// caller's translations.

export type FileVersion = {
  versions: number;
  latest: boolean;
  olderAt: string | null;
  identicalTo: { emailId: string; index: number; name: string; date: string | null } | null;
};

/** "5/11 14:02" — day/month and time in Japan (where ADH works); Japanese reads month/day ("11/5 14:02"), as the rest of the JA screens. */
export function dmHm(iso: string | null | undefined, lang: "en" | "ja" = "en"): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Tokyo", day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(d).map((x) => [x.type, x.value]));
  return lang === "ja" ? `${Number(p.month)}/${Number(p.day)} ${p.hour}:${p.minute}` : `${Number(p.day)}/${Number(p.month)} ${p.hour}:${p.minute}`;
}

export type VersionBadge = { kind: "latest" | "older" | "identical"; at: string };

/** The badges of one file: "Latest" on the newest of ≥2 versions; "Older version (5/11 14:02)" on the others, plus "Identical to …" when its bytes match a newer one. */
export function versionBadges(v: FileVersion | null | undefined, lang: "en" | "ja" = "en"): VersionBadge[] {
  if (!v || v.versions < 2) return [];
  if (v.latest) return [{ kind: "latest", at: "" }];
  const out: VersionBadge[] = [{ kind: "older", at: dmHm(v.olderAt, lang) }];
  if (v.identicalTo) out.push({ kind: "identical", at: dmHm(v.identicalTo.date, lang) });
  return out;
}

/** The Answer flow's default: an older version of a file in the same answer is not filed (switchable). */
export const olderVersion = (v: FileVersion | null | undefined): boolean => !!v && v.versions > 1 && !v.latest;

/** "214 KB · 2 pages" — size and page count, whichever is known. */
export function factsLine(size: number | null | undefined, pages: number | null | undefined, fmtSize: (n: number) => string, pagesText: (n: number) => string): string {
  return [size ? fmtSize(size) : null, pages ? pagesText(pages) : null].filter(Boolean).join(" · ");
}

/** The other file to compare a row with: the latest of its group (or, on the latest, the next newest same-name file). */
export function compareWith<T extends { emailId: string; index: number; date?: string | null; version?: FileVersion | null }>(f: T, all: T[], sameGroup: (a: T, b: T) => boolean): T | null {
  if (!f.version || f.version.versions < 2) return null;
  const group = all.filter((x) => x !== f && sameGroup(x, f)).sort((a, b) => new Date(b.date ?? 0).getTime() - new Date(a.date ?? 0).getTime());
  return group[0] ?? null;
}

/** Same name as the API counts it: case, spaces and a trailing " (n)" copy mark ignored. */
export function versionKey(name: string | null | undefined): string {
  const n = String(name ?? "").normalize("NFKC").trim().toLowerCase();
  const m = /^(.*?)(\.[a-z0-9]{1,6})?$/.exec(n);
  const base = (m?.[1] ?? n).replace(/\s*\(\d{1,3}\)$/, "").replace(/[\s_]+/g, " ").trim();
  return `${base}${m?.[2] ?? ""}`;
}
