
/**
 * MANUAL (DASHBOARD-ONLY) ORDER FLOW (enableManualOrderFlow, 2026-11-12, WCT
 * group only, default off).
 *
 * The office runs an order end to end in the AIMS dashboard: no SiteClock job
 * sync and no field-app steps. Accepting a quotation makes the order (as
 * today) plus, at once, a DRAFT DO with its real number and a DRAFT service
 * report; the office then schedules and finishes each job itself ("Complete
 * job": on-screen signature, an uploaded signed / stamped DO, or the
 * customer's sign link), uploads the service report, and sends it to the
 * customer once the invoice goes out.
 *
 * It only takes effect where WCT orders are on (the order flow it extends);
 * every check below needs BOTH flags, so an org without WCT orders behaves
 * exactly as before even if the flag were set by mistake.
 */
export const MANUAL_ORDER_FLOW_FLAG = 'enableManualOrderFlow';
// Same key as wct-orders.ts WCT_ORDERS_FLAG (not imported: wct-orders imports this file).
const WCT_ORDERS_FLAG = 'enableWctOrders';

export async function isManualOrderFlow(prisma: any, organizationId: string): Promise<boolean> {
  try {
    const ui = await prisma.organizationUIConfig.findUnique({ where: { organizationId }, select: { features: true } });
    const f = ((ui?.features as any) || {}) as Record<string, unknown>;
    return f[MANUAL_ORDER_FLOW_FLAG] === true && f[WCT_ORDERS_FLAG] === true;
  } catch {
    return false;
  }
}

/**
 * The order's one status in the manual flow, in the order the steps happen.
 * Stored on Order.status (so a future Orders page can show it) with the date
 * each was first reached in Order.statusDates.
 */
export type ManualOrderStatus =
  | 'QUOTATION_SIGNED'
  | 'DO_DRAFT'
  | 'DO_SCHEDULED'
  | 'AWAITING_VERIFICATION'
  | 'DO_COMPLETED'
  | 'INVOICE_DRAFT'
  | 'INVOICED'
  | 'PAID'
  | 'SERVICE_REPORT_SENT';

export const MANUAL_ORDER_STATUSES: ManualOrderStatus[] = [
  'QUOTATION_SIGNED',
  'DO_DRAFT',
  'DO_SCHEDULED',
  'AWAITING_VERIFICATION',
  'DO_COMPLETED',
  'INVOICE_DRAFT',
  'INVOICED',
  'PAID',
  'SERVICE_REPORT_SENT',
];

export const MANUAL_ORDER_STATUS_LABEL: Record<ManualOrderStatus, string> = {
  QUOTATION_SIGNED: 'Quotation signed',
  DO_DRAFT: 'DO draft',
  DO_SCHEDULED: 'DO scheduled',
  AWAITING_VERIFICATION: 'Awaiting customer signature',
  DO_COMPLETED: 'DO completed',
  INVOICE_DRAFT: 'Invoice draft',
  INVOICED: 'Invoiced',
  PAID: 'Paid',
  SERVICE_REPORT_SENT: 'Service report sent',
};

/** Invoice statuses that mean the invoice has not gone out yet. */
const DRAFT_INVOICE = new Set(['draft', 'unconfirmed']);

/**
 * The manual-flow status from the order's jobs, its invoices and whether the
 * service report was sent. Cancelled jobs don't count.
 *   no job                                            → QUOTATION_SIGNED
 *   every job still a draft                           → DO_DRAFT
 *   a job scheduled and not finished                  → DO_SCHEDULED
 *   every job finished, one waiting for its signature
 *     (sign link) or for a check                      → AWAITING_VERIFICATION
 *   every job finished and checked, no invoice yet    → DO_COMPLETED
 *   an invoice not sent yet                           → INVOICE_DRAFT
 *   invoices sent, not all paid                       → INVOICED
 *   every invoice paid                                → PAID
 *   invoices sent (paid or not) and the report sent   → SERVICE_REPORT_SENT (final)
 * The service report comes AFTER the invoice (2026-11-13): a report sent while
 * the order is not invoiced yet does not jump the order; it counts once the
 * invoice is out.
 */
export function deriveManualOrderStatus(
  jobs: { status: string; isDraft: boolean; verificationState?: string | null; orderInvoiceId?: string | null }[],
  billing: { invoiceStatuses?: string[]; serviceReportSent?: boolean } = {},
): ManualOrderStatus {
  const live = jobs.filter((j) => j.status !== 'cancelled');
  if (!live.length) return 'QUOTATION_SIGNED';
  const scheduled = live.filter((j) => !j.isDraft);
  if (!scheduled.length) return 'DO_DRAFT';
  if (scheduled.length < live.length || scheduled.some((j) => j.status !== 'completed')) return 'DO_SCHEDULED';
  if (!scheduled.every((j) => j.verificationState == null || j.verificationState === 'verified')) return 'AWAITING_VERIFICATION';
  const invoices = billing.invoiceStatuses ?? [];
  const invoiced = scheduled.every((j) => !!j.orderInvoiceId && !String(j.orderInvoiceId).startsWith('claim:'));
  if (!invoiced || !invoices.length) return 'DO_COMPLETED';
  if (invoices.some((s) => DRAFT_INVOICE.has(s))) return 'INVOICE_DRAFT';
  if (billing.serviceReportSent) return 'SERVICE_REPORT_SENT';
  return invoices.every((s) => s === 'paid') ? 'PAID' : 'INVOICED';
}

/**
 * statusDates after a move to `status`: the first time each status is reached
 * is kept (a later move back and forth never rewrites it).
 */
export function withStatusDate(statusDates: unknown, status: string, now = new Date()): Record<string, string> {
  const cur = statusDates && typeof statusDates === 'object' && !Array.isArray(statusDates) ? { ...(statusDates as Record<string, string>) } : {};
  if (!cur[status]) cur[status] = now.toISOString();
  return cur;
}
