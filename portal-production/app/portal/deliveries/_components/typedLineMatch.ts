// Stepped schedule (enableScheduleWizard, Biofuel 2026-11-25, #122): a typed
// line that IS a catalog product is linked to it before save; a near or double
// match asks the office to pick. The backend applies the exact rule as well
// (api deliveries/typed-line-product.ts).

export interface MatchProduct {
  id: string;
  name: string;
  skuKey: string;
}

export type TypedLineMatch =
  | { kind: "exact"; product: MatchProduct }
  | { kind: "pick"; candidates: MatchProduct[] }
  | { kind: "none" };

const norm = (s: unknown) => String(s ?? "").trim().toLowerCase();
const compact = (s: unknown) => norm(s).replace(/[^a-z0-9]/g, "");

/** Search words worth querying for near matches ("LION375 BESS" -> "LION375 BESS", "LION375", "BESS"). */
export function typedLineQueries(text: string): string[] {
  const t = String(text ?? "").trim();
  if (!t) return [];
  const words = t.split(/\s+/).filter((w) => compact(w).length >= 4);
  return Array.from(new Set([t, ...words])).slice(0, 4);
}

export function matchTypedLine(text: string, products: MatchProduct[]): TypedLineMatch {
  const t = norm(text);
  if (!t) return { kind: "none" };
  const uniq = Array.from(new Map(products.map((p) => [p.id, p])).values());
  const exact = uniq.filter((p) => norm(p.name) === t || norm(p.skuKey) === t);
  if (exact.length === 1) return { kind: "exact", product: exact[0] };
  if (exact.length > 1) return { kind: "pick", candidates: exact };
  const ct = compact(t);
  const near = uniq.filter((p) =>
    [p.name, p.skuKey].some((v) => {
      const cv = compact(v);
      if (!cv) return false;
      return cv === ct || (ct.length >= 4 && cv.includes(ct)) || (cv.length >= 4 && ct.includes(cv));
    }),
  );
  return near.length ? { kind: "pick", candidates: near.slice(0, 6) } : { kind: "none" };
}
