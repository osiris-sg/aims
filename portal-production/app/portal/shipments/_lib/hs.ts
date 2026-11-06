/** Round BJ — HS codes compared at 6 digits ("7601.20" = "76012000" = "7601.20.00"). Plain module (node --test). */
export function normHs(v: string | null | undefined): string | null {
  const t = (v ?? "").trim();
  if (!t) return null;
  const d = t.replace(/\D/g, "");
  return d.length >= 6 ? `${d.slice(0, 4)}.${d.slice(4, 6)}` : t;
}

/** Both known and different. */
export const hsDiffers = (a: string | null | undefined, b: string | null | undefined): boolean => {
  const x = normHs(a);
  const y = normHs(b);
  return !!x && !!y && x !== y;
};

/** Same value for a "B/L says" hint: case, spacing and punctuation ignored; numbers compared as numbers. */
export function sameFieldValue(a: string, b: string): boolean {
  const na = Number(a);
  const nb = Number(b);
  if (a.trim() !== "" && b.trim() !== "" && Number.isFinite(na) && Number.isFinite(nb)) return Math.abs(na - nb) < 1e-6;
  const k = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/PORT/g, "");
  return k(a) === k(b);
}
