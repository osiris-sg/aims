/**
 * "Delivery" vs "Job" in server-written text (2026-11-03). A run that belongs
 * to a WCT order (orderId / order set; only enableWctOrders orgs have orders
 * with jobs) is a "Job" wherever a person reads it: WhatsApp captions, bell
 * notices, SiteClock texts, the calendar. Every other run stays a "Delivery".
 * Wording only: routes, API fields and DB names stay "delivery".
 */
export function runNoun(run: { orderId?: string | null; order?: { orderNumber?: string | null } | null; orderNumber?: string | null } | null | undefined): 'Job' | 'Delivery' {
  return run && (run.orderId || run.order || run.orderNumber) ? 'Job' : 'Delivery';
}

/** A finished run's status as read: "Done" for an order job, "Delivered" otherwise. */
export function deliveredLabel(isJob: boolean): string {
  return isJob ? 'Done' : 'Delivered';
}
