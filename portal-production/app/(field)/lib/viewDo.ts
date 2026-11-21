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

/**
 * "View DO" on an open run (in-progress screen, beside End Delivery and the
 * Ready to finish card). enableFieldDoViewAnyLine only: off returns null, so
 * every org without the switch keeps today's screen. A delivery (not a return)
 * whose linked lines name exactly one DO; the run's own DO counts when no line
 * names one.
 */
export interface OpenRunForDo {
  direction?: string | null;
  document?: { id: string } | null;
  items: Array<{ assetId?: string | null; document?: { id: string } | null }>;
}

export function openRunViewDoHref(r: OpenRunForDo, anyLine: boolean): string | null {
  if (!anyLine || r.direction === "RETURN") return null;
  const ids = new Set(r.items.map((i) => i.document?.id).filter((v): v is string => !!v));
  if (ids.size === 0 && r.document?.id) ids.add(r.document.id);
  if (ids.size !== 1) return null;
  const docId = [...ids][0];
  const assetId = r.items.find((i) => i.assetId)?.assetId || "_";
  return `/scan/asset/${assetId}/do/${docId}/view`;
}
