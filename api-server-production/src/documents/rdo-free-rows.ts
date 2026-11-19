/**
 * RDO free-typed rows (Biofuel, 2026-11-19; flag enableRdoFreeTypedRows).
 *
 * The editor's save-time stock block requires a unit on every physical row. With
 * this flag on, a RETURN_DELIVERY_ORDER may also carry rows with no unit (paper
 * only: such a row moves no stock, adds no run line and off-hires nothing).
 * This also lets an auto-made RDO whose free-typed lines carry no unit
 * (e.g. RDO202611-006 "AF40") be re-saved. DOs and every other type are untouched,
 * and orgs without the flag keep the old rule.
 *
 * With the flag on, a SIGNED RDO is read-only: a signed DO_ACK on it (or on a
 * run that carries it), or a completed run, refuses any editor save.
 */
export const RDO_FREE_ROWS_FLAG = 'enableRdoFreeTypedRows';

export function isRdoType(type: string | null | undefined): boolean {
  const t = String(type || '').toUpperCase();
  return t === 'RDO' || t === 'RETURN_DELIVERY_ORDER';
}

/** True when the unit-on-every-row rule lets rows without a unit through. */
export function allowsRdoFreeRows(type: string | null | undefined, flagOn: boolean): boolean {
  return flagOn && isRdoType(type);
}

/** Row has a unit the save step can look up. */
export function hasUnit(item: any): boolean {
  return typeof item?.inventoryItemId === 'string' && item.inventoryItemId.trim() !== '';
}

type SignedCheckPrisma = {
  delivery: { findMany: (args: any) => Promise<Array<{ id: string; status: string }>> };
  maintenanceServiceReport: { count: (args: any) => Promise<number> };
};

/**
 * An RDO is signed once the customer signed for it (a DO_ACK with a signature,
 * tied to the RDO or to a run that carries it) or once its run is completed.
 */
export async function isRdoSigned(prisma: SignedCheckPrisma, organizationId: string, documentId: string): Promise<boolean> {
  const runs = await prisma.delivery.findMany({
    where: { organizationId, OR: [{ documentId }, { items: { some: { documentId } } }] },
    select: { id: true, status: true },
  });
  if (runs.some((r) => r.status === 'completed')) return true;
  const signed = await prisma.maintenanceServiceReport.count({
    where: {
      organizationId,
      kind: 'DO_ACK',
      signature: { not: null },
      OR: [{ documentId }, ...(runs.length ? [{ deliveryId: { in: runs.map((r) => r.id) } }] : [])],
    },
  });
  return signed > 0;
}
