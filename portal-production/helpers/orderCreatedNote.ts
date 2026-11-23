// "Order ORD… created" on the quotation page (WCT, 2026-11-23): shown once, right after the confirm in this tab
// made the order, not every time a quotation with an order is opened. The quotation confirm stamps the time in
// sessionStorage; the page shows the message only when its order was created at or after that confirm (2 minutes
// of leeway for the browser clock), then forgets the stamp.

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const LEEWAY_MS = 2 * 60 * 1000;
export const confirmKey = (quotationId: string) => `aims-qo-confirmed:${quotationId}`;

export function markQuotationConfirmed(store: Store | null | undefined, quotationId: string, now: Date = new Date()): void {
  if (!store || !quotationId) return;
  try {
    store.setItem(confirmKey(quotationId), now.toISOString());
  } catch {
    // Storage blocked: the message just doesn't show.
  }
}

/** True once when this tab's confirm made the quotation's order; the stamp is removed either way. */
export function takeOrderCreated(store: Store | null | undefined, quotationId: string, order: { createdAt?: string | null } | null | undefined): boolean {
  if (!store || !quotationId) return false;
  let stamp: string | null = null;
  try {
    stamp = store.getItem(confirmKey(quotationId));
    if (stamp) store.removeItem(confirmKey(quotationId));
  } catch {
    return false;
  }
  if (!stamp || !order?.createdAt) return false;
  const confirmedAt = Date.parse(stamp);
  const createdAt = Date.parse(order.createdAt);
  if (!Number.isFinite(confirmedAt) || !Number.isFinite(createdAt)) return false;
  return createdAt >= confirmedAt - LEEWAY_MS;
}
