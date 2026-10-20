/**
 * Test orders (round N): orders flagged isTest (click-through data — #27 / #28 / #29 on prod) are hidden from the
 * Orders / Shipments / Documents lists, Home, counts and alerts unless "Show test orders" is on. Nothing is deleted.
 */
import { Db } from './trade-config.service';

export interface TestIds {
  orderIds: Set<string>;
  shipmentIds: Set<string>;
}

/** The org's test orders and their shipments. */
export async function testRecordIds(db: Db, organizationId: string): Promise<TestIds> {
  if (!db.tradeOrder?.findMany) return { orderIds: new Set(), shipmentIds: new Set() };
  const orders: Array<{ id: string; shipments: Array<{ id: string }> }> = await db.tradeOrder.findMany({
    where: { organizationId, isTest: true },
    select: { id: true, shipments: { select: { id: true } } },
  });
  return { orderIds: new Set(orders.map((o) => o.id)), shipmentIds: new Set(orders.flatMap((o) => o.shipments.map((s) => s.id))) };
}

/** An alert / step / document link that belongs to a test order or one of its shipments. */
export const isTestRecord = (ids: TestIds, r: { orderId?: string | null; shipmentId?: string | null }) =>
  (!!r.orderId && ids.orderIds.has(r.orderId)) || (!!r.shipmentId && ids.shipmentIds.has(r.shipmentId));

/** A hub row is hidden when it has order / shipment links and ALL of them are test records. */
export function onlyTestLinks(ids: TestIds, links: Array<{ orderId?: string | null; shipmentId?: string | null; orderOfShipment?: string | null }>): boolean {
  const recs = links.filter((l) => l.orderId || l.shipmentId);
  return recs.length > 0 && recs.every((l) => isTestRecord(ids, l) || (!!l.orderOfShipment && ids.orderIds.has(l.orderOfShipment)));
}
