// Order page focus (round R): which shipment to show and which step to land on
// when the page opens or the shipment changes; the trimmed header lines. Pure,
// tested in helpers/orderFocus.test.mjs.

export interface StepLike {
  id: string;
  status: string;
  sortOrder: number;
  isOngoing?: boolean;
  notApplicable?: boolean | null;
}
export interface ShipmentLike {
  id: string;
  status: string;
  progress?: { done: number; total: number } | null;
}

/** The first open (not done, not N/A, not ongoing) step in sort order. */
export const firstOpenStep = <T extends StepLike>(steps: T[]): T | null => [...steps].sort((a, b) => a.sortOrder - b.sortOrder).find((s) => s.status !== "DONE" && !s.notApplicable && !s.isOngoing) ?? null;

/**
 * Without a ?shipment= in the URL: the OPEN shipment that is furthest behind (fewest steps done), so the page
 * lands on the work that is due; else the first shipment.
 */
export function defaultShipmentId(shipments: ShipmentLike[]): string | undefined {
  const open = shipments.filter((s) => s.status === "OPEN");
  if (!open.length) return shipments[0]?.id;
  return [...open].sort((a, b) => (a.progress?.done ?? 0) - (b.progress?.done ?? 0))[0].id;
}

/** The step card to open and scroll to: the order's early open step, else the shipment's, else the order's late one. */
export function focusStepId(early: StepLike[], ship: StepLike[], late: StepLike[]): string | null {
  return (firstOpenStep(early) ?? firstOpenStep(ship) ?? firstOpenStep(late))?.id ?? null;
}

/** Header line 2: "Vedanta → SUS · Contract 454003422 · Sep → Nov · Invoice #1 + #2" — nothing else. */
export function headerLine2(o: { supplierShort: string | null; customerShort: string | null; contractNo: string | null; monthsLabel: string | null; single: boolean }): string {
  return [`${o.supplierShort ?? "—"} → ${o.customerShort ?? "—"}`, o.contractNo ? `Contract ${o.contractNo}` : null, o.monthsLabel || null, o.single ? "Single invoice" : "Invoice #1 + #2"].filter(Boolean).join(" · ");
}

/** "Step 4 · Customer docs" from the list bar / current step; "Completed" when every step is done. */
export function headerStepText(step: { displayNo?: string | null; position?: number; title: string } | null | undefined, total: number): string {
  if (!step) return total ? "Completed" : "";
  const no = step.displayNo ?? (step.position != null ? String(step.position) : null);
  return no ? `Step ${no} · ${step.title}` : step.title;
}

/** The ✓ tooltip on a done step: who, when, and "imported from the task list" for steps completed before AIMS. */
export function doneTooltip(s: { updatedByName?: string | null; completedAt?: string | null; updatedAt?: string | null; skipReason?: string | null }, fmt: (iso: string) => string): string {
  const imported = /completed before AIMS/i.test(s.skipReason ?? "");
  const who = imported ? "Imported from the task list" : s.updatedByName ? `Done by ${s.updatedByName}` : "Done";
  const when = s.completedAt ?? s.updatedAt;
  return [who, when ? fmt(when) : null, s.skipReason && !imported ? s.skipReason : null].filter(Boolean).join(" · ");
}
