/**
 * Where a scan was started from (2026-10-23). The Ad-hoc chooser's "Scan or
 * tag a unit" opens /scan/new with ?from=adhoc; the scanner, the serial
 * entry, the tag binding and the asset page carry the marker along, so every
 * exit from that trip returns to the chooser instead of the Deliveries home.
 * Without the marker nothing changes: the old paths still lead to /scan.
 */
export const ADHOC_ORIGIN = "adhoc";
export const ADHOC_CHOOSER = "/scan/adhoc";

export function isAdhocOrigin(search: { get(name: string): string | null } | null | undefined): boolean {
  return search?.get("from") === ADHOC_ORIGIN;
}

/** Appends ?from=adhoc (or &from=adhoc) when the trip began at the chooser. */
export function withOrigin(href: string, adhoc: boolean): string {
  if (!adhoc) return href;
  return `${href}${href.includes("?") ? "&" : "?"}from=${ADHOC_ORIGIN}`;
}

/** The screen a plain "exit" lands on: the chooser for an ad-hoc trip, the Deliveries home otherwise. */
export function exitFor(adhoc: boolean): string {
  return adhoc ? ADHOC_CHOOSER : "/scan";
}
