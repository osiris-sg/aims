import { isOrgFeatureEnabled } from '../common/org-features';
import { runAsOrg } from '../common/tenancy/tenant-context';
import {
  DEFAULT_ORDER_PATTERN,
  DocumentNumberingService,
  ORDER_DOC_CODE,
  ORDER_NUMBER_TYPE,
} from '../document-numbering/document-numbering.service';

/**
 * WCT orders (flag enableWctOrders, 2026-11-01, Phase 1).
 *
 *   accepted quotation → ONE Order (number from the ORDER format, default
 *   ORD{YYYY}{MM}-{###}) → its jobs (Delivery runs with orderId), the first one
 *   a draft made with the order, more from "Add job" on the order page.
 *
 * Pure helpers on the caller's Prisma, same pattern as
 * deliveries/quotation-to-delivery.ts: the quotation→delivery hook (called by
 * DocumentsService and PublicSignService), DeliveriesService and OrdersService
 * all use them without a module dependency on each other.
 *
 * The order's status follows its jobs (deriveOrderStatus) and is stored on
 * Order.status so lists can filter on it; every job write that can move it
 * calls refreshOrderStatus, and the order pages refresh on read as well.
 */
import { deriveManualOrderStatus, isManualOrderFlow, withStatusDate, type ManualOrderStatus } from './manual-order-flow';

export const WCT_ORDERS_FLAG = 'enableWctOrders';

/** WCT invoice per order (Phase 4): the order is billed on its own invoice(s), not one per DO. */
export const WCT_ORDER_INVOICE_FLAG = 'enableWctOrderInvoice';

export type WctOrderStatus = 'OPEN' | 'SCHEDULED' | 'IN_PROGRESS' | 'AWAITING_VERIFICATION' | 'COMPLETED' | 'INVOICED' | 'PAID' | 'CLOSED';

export const WCT_ORDER_STATUS_LABEL: Record<WctOrderStatus, string> = {
  OPEN: 'Open',
  SCHEDULED: 'Scheduled',
  IN_PROGRESS: 'In progress',
  AWAITING_VERIFICATION: 'Awaiting verification',
  COMPLETED: 'Completed',
  INVOICED: 'Invoiced',
  PAID: 'Paid',
  CLOSED: 'Closed',
};

/** What billing adds to the job picture (Phases 4–5). */
export interface OrderBilling {
  /** Status of each of the order's invoices. */
  invoiceStatuses?: string[];
  /** A service report is on the order (a file or a linked AIMS report). */
  hasServiceReport?: boolean;
}

/**
 * The order's status from its jobs. Cancelled jobs don't count; a draft job is
 * work not yet scheduled.
 *   no job scheduled yet (none, only drafts / cancelled) → OPEN
 *   every scheduled job done and checked, no draft        → COMPLETED
 *   every scheduled job done, some still to be checked
 *     (stamped-DO / paper finish pending or rejected)     → AWAITING_VERIFICATION
 *   any job started or done (others still to do)         → IN_PROGRESS
 *   otherwise (jobs scheduled, none started)             → SCHEDULED
 * A job finished before verification existed (verificationState null) counts
 * as checked. Once every job is done and checked, billing takes over:
 *   some jobs not on an invoice yet                       → COMPLETED (to invoice)
 *   every job invoiced, an invoice not fully paid         → INVOICED
 *   every invoice paid, no service report on the order    → PAID
 *   paid and the service report attached                  → CLOSED
 */
export function deriveOrderStatus(
  jobs: { status: string; isDraft: boolean; verificationState?: string | null; orderInvoiceId?: string | null }[],
  billing: OrderBilling = {},
): WctOrderStatus {
  const live = jobs.filter((j) => j.status !== 'cancelled');
  const scheduled = live.filter((j) => !j.isDraft);
  const drafts = live.length - scheduled.length;
  if (!scheduled.length) return 'OPEN';
  if (!drafts && scheduled.every((j) => j.status === 'completed')) {
    if (!scheduled.every((j) => j.verificationState == null || j.verificationState === 'verified')) return 'AWAITING_VERIFICATION';
    const invoiced = scheduled.every((j) => !!j.orderInvoiceId && !j.orderInvoiceId.startsWith('claim:'));
    const invoices = billing.invoiceStatuses ?? [];
    if (!invoiced || !invoices.length) return 'COMPLETED';
    if (!invoices.every((st) => st === 'paid')) return 'INVOICED';
    return billing.hasServiceReport ? 'CLOSED' : 'PAID';
  }
  if (scheduled.some((j) => j.status !== 'scheduled')) return 'IN_PROGRESS';
  return 'SCHEDULED';
}

export async function isWctOrdersEnabled(prisma: any, organizationId: string): Promise<boolean> {
  return isOrgFeatureEnabled(prisma, organizationId, WCT_ORDERS_FLAG);
}

/**
 * The org's active ORDER number format; created with the default pattern the
 * first time an order is made (visible and editable in Document Numbering
 * afterwards). Only ever called for enableWctOrders orgs.
 */
export async function ensureOrderNumberFormat(prisma: any, organizationId: string): Promise<{ id: string }> {
  const existing = await prisma.documentNumberFormat.findFirst({
    where: { organizationId, documentType: ORDER_NUMBER_TYPE, isActive: true },
    orderBy: { sortOrder: 'asc' },
    select: { id: true },
  });
  if (existing) return existing;
  return prisma.documentNumberFormat.create({
    data: { organizationId, documentType: ORDER_NUMBER_TYPE, label: 'Default', pattern: DEFAULT_ORDER_PATTERN, resetPolicy: 'never', nextSerial: 1, isActive: true },
    select: { id: true },
  });
}

/** Preview of the default pattern, for messages and tests: ORD202611-001. */
export const formatOrderNumber = (serial: number, when: Date) => DocumentNumberingService.format(DEFAULT_ORDER_PATTERN, serial, when, ORDER_DOC_CODE);

/**
 * Inside an open interactive transaction: the ORDER number, claimed with the
 * format row locked (same lock as the DO issuer), committed with the Order row.
 */
export async function issueOrderNumberInTx(prisma: any, tx: any, organizationId: string, formatId: string, when = new Date()): Promise<string> {
  const numbering = new DocumentNumberingService(prisma);
  const n = await numbering.issueNumberLocked(organizationId, ORDER_NUMBER_TYPE, formatId, when, tx);
  if (!n) throw new Error('No ORDER number format');
  return n;
}

/**
 * Serialise everything keyed on one quotation (staff Confirm and the client's
 * e-sign can land at the same moment). Transaction-scoped advisory lock.
 */
export async function lockQuotation(tx: any, quotationId: string) {
  await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', `wct-order:${quotationId}`);
}

/** Re-derive and store an order's status from its jobs. Best-effort: never throws. Returns the status, or null. */
export async function refreshOrderStatus(prisma: any, organizationId: string, orderId: string | null | undefined): Promise<WctOrderStatus | null> {
  if (!orderId) return null;
  try {
    return await runAsOrg(organizationId, async () => {
      // Manual (dashboard-only) flow: its own status list + the date each was
      // reached. Every other org takes the unchanged path below.
      if (await isManualOrderFlow(prisma, organizationId)) return (await refreshManualOrderStatus(prisma, organizationId, orderId)) as any;
      const order = await prisma.order.findFirst({ where: { id: orderId, organizationId }, select: { id: true, status: true, attachments: true } });
      if (!order) return null;
      const jobs = await prisma.delivery.findMany({ where: { organizationId, orderId }, select: { status: true, isDraft: true, verificationState: true, orderInvoiceId: true } });
      const invoiceIds = [...new Set(jobs.map((j: any) => j.orderInvoiceId).filter((v: any) => v && !String(v).startsWith('claim:')))] as string[];
      const invoices = invoiceIds.length ? await prisma.document.findMany({ where: { id: { in: invoiceIds }, organizationId }, select: { status: true } }) : [];
      const status = deriveOrderStatus(jobs, {
        invoiceStatuses: invoices.map((d: any) => String(d.status)),
        hasServiceReport: hasServiceReportAttachment(order.attachments),
      });
      if (order.status !== status) await prisma.order.update({ where: { id: orderId }, data: { status } });
      return status;
    });
  } catch {
    return null;
  }
}

/** Manual flow: derive, store the status and stamp its first date. Caller is inside runAsOrg. */
async function refreshManualOrderStatus(prisma: any, organizationId: string, orderId: string): Promise<ManualOrderStatus | null> {
  const order = await prisma.order.findFirst({ where: { id: orderId, organizationId }, select: { id: true, status: true, statusDates: true, createdAt: true } });
  if (!order) return null;
  // A cancelled order (set by the office / a cleanup) stays cancelled.
  if (order.status === 'CANCELLED') return null;
  const jobs = await prisma.delivery.findMany({ where: { organizationId, orderId }, select: { status: true, isDraft: true, verificationState: true, orderInvoiceId: true } });
  const invoiceIds = [...new Set(jobs.map((j: any) => j.orderInvoiceId).filter((v: any) => v && !String(v).startsWith('claim:')))] as string[];
  const invoices = invoiceIds.length ? await prisma.document.findMany({ where: { id: { in: invoiceIds }, organizationId }, select: { status: true } }) : [];
  const dates = (order.statusDates as Record<string, string> | null) ?? {};
  const status = deriveManualOrderStatus(jobs, { invoiceStatuses: invoices.map((d: any) => String(d.status)), serviceReportSent: !!dates.serviceReportSentAt });
  // The order exists because the quotation was signed / accepted: that first
  // step is dated by the order itself, even when the first refresh already
  // sees its draft job.
  const nextDates = withStatusDate(withStatusDate(dates, 'QUOTATION_SIGNED', new Date(order.createdAt)), status);
  if (order.status !== status || JSON.stringify(nextDates) !== JSON.stringify(dates)) {
    await prisma.order.update({ where: { id: orderId }, data: { status, statusDates: nextDates } });
  }
  return status;
}

/** The order of a run, for callers that only hold the run id. Best-effort. */
export async function refreshOrderStatusForRun(prisma: any, organizationId: string, deliveryId: string): Promise<void> {
  try {
    const run = await runAsOrg(organizationId, () => prisma.delivery.findFirst({ where: { id: deliveryId, organizationId }, select: { orderId: true } }));
    if (run?.orderId) await refreshOrderStatus(prisma, organizationId, run.orderId);
  } catch {
    /* best-effort */
  }
}

/**
 * Stamp the order onto a DO config fragment (mint and every regen): orderId
 * plus orderNo, which the WCT DO layout prints as "Order No". Never throws.
 */
export async function applyOrderToDoConfig(prisma: any, organizationId: string, orderId: string, cfg: Record<string, any>): Promise<Record<string, any>> {
  try {
    const order = await prisma.order.findFirst({ where: { id: orderId, organizationId }, select: { id: true, orderNumber: true } });
    if (order) {
      cfg.orderId = order.id;
      cfg.orderNo = order.orderNumber;
    }
  } catch {
    /* best-effort: the DO is still made without the order line */
  }
  return cfg;
}

/** Phase 5: the order carries a service report (an uploaded file or a linked AIMS report). */
export function hasServiceReportAttachment(attachments: unknown): boolean {
  return Array.isArray(attachments) && attachments.some((a: any) => a && (a.kind === 'report' || a.kind === 'file'));
}
