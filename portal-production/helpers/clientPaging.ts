// Client-side paging for PageTable (WCT round 12, 2026-11-19).
//
// PageTable's paging footer drives the CALLER's page / limit state and expects
// the caller to hand over one page of rows (server paging, or its own slice).
// A few lists load every row and passed them all with pageCount={1}, so the
// "Showing" 10 / 20 / 50 / 100 picker changed nothing and the pager never moved.
// Those lists now set `clientPaging` and PageTable slices here instead.

export type ClientPage<T> = { rows: T[]; page: number; pageCount: number; total: number; from: number; to: number };

export function clientPage<T>(data: readonly T[] | null | undefined, page: number | null | undefined, limit: number | null | undefined): ClientPage<T> {
  const all = Array.isArray(data) ? data : [];
  const size = Number.isFinite(limit as number) && (limit as number) > 0 ? Math.floor(limit as number) : all.length || 1;
  const pageCount = Math.max(1, Math.ceil(all.length / size));
  const want = Number.isFinite(page as number) && (page as number) >= 1 ? Math.floor(page as number) : 1;
  const p = Math.min(want, pageCount);
  const start = (p - 1) * size;
  const rows = all.slice(start, start + size);
  return { rows, page: p, pageCount, total: all.length, from: all.length ? start + 1 : 0, to: start + rows.length };
}
