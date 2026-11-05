// Round BF (Sayaka, 2026-11-04): a PI read for "New order" says WHICH order already has it — "PI 9331… is already
// on #30 (created by …, 5 Nov) · [Open #30]" or "[Reopen #30]" when that order is cancelled — and points at an order
// of the same contract, grade and ship month that has no PI yet (her cancelled #30 was exactly that order, so creating
// it again could only collide with its number).

export type PiOrderRow = { id: string; orderNo: number; year: number; status: string; isTest?: boolean; piNo: string | null; grade: string | null; qtyMt: unknown; shipMonth: string | null; createdAt: Date | string; createdById?: string | null };

export type PiOrderHint = { id: string; label: string; year: number; status: string; grade: string | null; qtyMt: number | null; shipMonth: string | null; createdAt: string; createdByName: string | null };

const grades = (lines: Array<{ grade?: string | null }>) => new Set(lines.map((l) => (l.grade ?? '').trim().toUpperCase()).filter(Boolean));

export function toHint(o: PiOrderRow, names: Map<string, string>): PiOrderHint {
  return {
    id: o.id,
    label: `#${o.orderNo}`,
    year: o.year,
    status: o.status,
    grade: o.grade,
    qtyMt: o.qtyMt === null || o.qtyMt === undefined ? null : Number(o.qtyMt),
    shipMonth: o.shipMonth,
    createdAt: new Date(o.createdAt).toISOString(),
    createdByName: (o.createdById && names.get(o.createdById)) || null,
  };
}

/**
 * Orders of the PI's contract that look like this PI's lines but carry no PI no.: same grade as a PI line and the PI's
 * shipment month (or none set). Test orders never count. Open first, then cancelled / completed; newest number first.
 */
export function likeOrders(rows: PiOrderRow[], pi: { shipmentMonth?: string | null; lines: Array<{ grade?: string | null }> }): PiOrderRow[] {
  const g = grades(pi.lines);
  const rank = (s: string) => (s === 'OPEN' ? 0 : s === 'CANCELLED' ? 1 : 2);
  return rows
    .filter((o) => !o.isTest && !o.piNo && g.has((o.grade ?? '').trim().toUpperCase()) && (!o.shipMonth || !pi.shipmentMonth || o.shipMonth === pi.shipmentMonth))
    .sort((a, b) => rank(a.status) - rank(b.status) || b.orderNo - a.orderNo);
}
