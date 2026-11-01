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
export const WCT_ORDERS_FLAG = 'enableWctOrders';

export type WctOrderStatus = 'OPEN' | 'SCHEDULED' | 'IN_PROGRESS' | 'COMPLETED';

export const WCT_ORDER_STATUS_LABEL: Record<WctOrderStatus, string> = {
  OPEN: 'Open',
  SCHEDULED: 'Scheduled',
  IN_PROGRESS: 'In progress',
  COMPLETED: 'Completed',
};

/**
 * The order's status from its jobs. Cancelled jobs don't count; a draft job is
 * work not yet scheduled.
 *   no job scheduled yet (none, only drafts / cancelled) → OPEN
 *   every scheduled job done and no draft waiting        → COMPLETED
 *   any job started or done (others still to do)         → IN_PROGRESS
 *   otherwise (jobs scheduled, none started)             → SCHEDULED
 */
export function deriveOrderStatus(jobs: { status: string; isDraft: boolean }[]): WctOrderStatus {
  const live = jobs.filter((j) => j.status !== 'cancelled');
  const scheduled = live.filter((j) => !j.isDraft);
  const drafts = live.length - scheduled.length;
  if (!scheduled.length) return 'OPEN';
  if (!drafts && scheduled.every((j) => j.status === 'completed')) return 'COMPLETED';
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
      const order = await prisma.order.findFirst({ where: { id: orderId, organizationId }, select: { id: true, status: true } });
      if (!order) return null;
      const jobs = await prisma.delivery.findMany({ where: { organizationId, orderId }, select: { status: true, isDraft: true } });
      const status = deriveOrderStatus(jobs);
      if (order.status !== status) await prisma.order.update({ where: { id: orderId }, data: { status } });
      return status;
    });
  } catch {
    return null;
  }
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
