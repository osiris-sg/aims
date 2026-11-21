/**
 * "View full DO" on a Pending run card (field app).
 *
 * Default (every org): a delivery with exactly one DO whose FIRST line has a
 * catalog asset. The view page loads the DO by its id alone; the asset only
 * fills the route segment.
 *
 * enableFieldDoViewAnyLine (Biofuel, 2026-11-21): the first-line asset check is
 * dropped, so a run whose first line is typed text (run #110, #114) still shows
 * the button. The route segment then takes the first line that has an asset,
 * or "_" when none does (the view page never reads it).
 */
export interface ViewDoRun {
  direction?: string | null;
  document?: { id: string } | null;
  items: Array<{ assetId?: string | null }>;
}

export function scheduledViewDo(r: ViewDoRun, anyLine: boolean): { assetId: string; docId: string } | null {
  if (r.direction === "RETURN" || !r.document?.id) return null;
  const first = r.items[0]?.assetId;
  if (first) return { assetId: first, docId: r.document.id };
  if (!anyLine) return null;
  return { assetId: r.items.find((i) => i.assetId)?.assetId || "_", docId: r.document.id };
}
