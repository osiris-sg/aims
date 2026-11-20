import { isImportedOrder, refreshImportedOrderStatus } from './imported-orders';
import { isOrgFeatureEnabled } from '../common/org-features';
import { runAsOrg } from '../common/tenancy/tenant-context';
import {
  DEFAULT_ORDER_PATTERN,
  DocumentNumberingService,
  ORDER_DOC_CODE,
  ORDER_NUMBER_TYPE,
  orderNumberPrefixOf,
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
import { withSplitPartIds } from '../documents/invoice-split';
import { deriveManualOrderStatus, isManualOrderFlow, withStatusDate, type ManualOrderStatus, deriveManualOrderStatusFromUnits, unitStateOfJobs, type OrderUnit } from './manual-order-flow';

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

/**
 * Mark complete on an AIMS (native) WCT order (round 29, 2026-11-19; imported orders keep linkedDocuments.imported.completed).
 * Stored on the order as linkedDocuments.completed (no schema change): who, when, the reason, and `underlying` = the
 * status the order's documents give (kept current by refreshOrderStatus, so the page can still show the steps).
 * While it is there the order reads MARKED_COMPLETE ("Complete"), whatever the DOs / invoices / jobs do; Reopen
 * removes it and the status is derived again. A cancelled order stays cancelled (never marked).
 */
export const MARKED_COMPLETE = 'MARKED_COMPLETE';
export interface NativeCompletion {
  at: string;
  by: string | null;
  byName: string | null;
  reason: string;
  underlying?: string | null;
}
export function nativeCompletionOf(order: { linkedDocuments?: unknown } | null | undefined): NativeCompletion | null {
  if (!order || isImportedOrder(order)) return null;
  const c = (order.linkedDocuments as any)?.completed;
  return c && typeof c === 'object' && !Array.isArray(c) && typeof c.reason === 'string' && c.reason ? (c as NativeCompletion) : null;
}
/** The stored status: the Complete mark wins over what the documents give; linkedDocuments keeps `underlying` current. */
function withCompletionMark(order: { linkedDocuments?: unknown }, derived: string): { status: string; linkedDocuments?: any } {
  const mark = nativeCompletionOf(order);
  if (!mark) return { status: derived };
  if (mark.underlying === derived) return { status: MARKED_COMPLETE };
  return { status: MARKED_COMPLETE, linkedDocuments: { ...(order.linkedDocuments as any), completed: { ...mark, underlying: derived } } };
}

/** An AIMS order's DOs linked by "Link existing document" (round 29): ids on linkedDocuments.do (not imported ERP entries made by the import). */
export function linkedDoIdsOf(order: { linkedDocuments?: unknown } | null | undefined): string[] {
  const list = (order?.linkedDocuments as any)?.do;
  return Array.isArray(list) ? list.map((x: any) => x?.id).filter((v: any): v is string => typeof v === 'string' && !!v) : [];
}

/**
 * A linked DO's billing (round 33, 2026-11-19): Create invoice bills a completed linked DO, and the DO itself is never
 * written, so its "billed on" marker lives on the order's link entry (linkedDocuments.do[i].orderInvoiceId, a
 * `claim:` while an invoice run holds it). It only counts while that invoice is live: a voided or soft-deleted
 * invoice frees the DO again.
 */
export interface LinkedDoEntry {
  id: string;
  name?: string | null;
  imported?: boolean;
  orderInvoiceId?: string | null;
}
export function linkedDoEntriesOf(order: { linkedDocuments?: unknown } | null | undefined): LinkedDoEntry[] {
  const list = (order?.linkedDocuments as any)?.do;
  return Array.isArray(list) ? list.filter((x: any) => x && typeof x.id === 'string' && x.id) : [];
}
/** The ids among these that are live invoices (an INVOICE, not voided, not void, not soft-deleted). */
export async function liveInvoiceIds(prisma: any, organizationId: string, ids: Array<string | null | undefined>): Promise<Set<string>> {
  const want = [...new Set(ids.filter((v): v is string => typeof v === 'string' && !!v && !v.startsWith('claim:')))];
  if (!want.length) return new Set();
  const rows: any[] = await prisma.document.findMany({ where: { organizationId, id: { in: want }, type: { in: ['INVOICE', 'TI', 'TI2'] } }, select: { id: true, status: true, config: true } });
  return new Set(rows.filter((d) => d.config?.voided !== true && String(d.status) !== 'void').map((d) => d.id));
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
 * Round 36: an org with a company order prefix (orderNumberPrefix, e.g. ORDW)
 * gets it in place of ORD, as its own series (ORDW202611-001 first); every other
 * org unchanged (ORD…).
 */
export async function issueOrderNumberInTx(prisma: any, tx: any, organizationId: string, formatId: string, when = new Date()): Promise<string> {
  const numbering = new DocumentNumberingService(prisma);
  const prefix = await orderNumberPrefixOf(prisma, organizationId);
  const n = prefix
    ? await numbering.issueNumberLocked(organizationId, ORDER_NUMBER_TYPE, formatId, when, tx, { docCode: prefix, series: prefix })
    : await numbering.issueNumberLocked(organizationId, ORDER_NUMBER_TYPE, formatId, when, tx);
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
      // Imported orders (2026-11-19): their own money-based status (an AIMS invoice made for the order can be
      // confirmed or paid); never the native job / DO rules.
      const imported = await refreshImportedOrderStatus(prisma, organizationId, orderId);
      if (imported) return imported.status as any;
      // Manual (dashboard-only) flow: its own status list + the date each was
      // reached. Every other org takes the unchanged path below.
      if (await isManualOrderFlow(prisma, organizationId)) return (await refreshManualOrderStatus(prisma, organizationId, orderId)) as any;
      const order = await prisma.order.findFirst({ where: { id: orderId, organizationId }, select: { id: true, status: true, attachments: true, linkedDocuments: true } });
      if (!order) return null;
      // A cancelled order (Cancel order, 2026-11-13) stays cancelled.
      if (order.status === 'CANCELLED') return null;
      const jobs = await prisma.delivery.findMany({ where: { organizationId, orderId }, select: { status: true, isDraft: true, verificationState: true, orderInvoiceId: true } });
      const invoiceIds = [...new Set(jobs.map((j: any) => j.orderInvoiceId).filter((v: any) => v && !String(v).startsWith('claim:')))] as string[];
      const invoices = await invoiceRowsWithSplitParts(prisma, organizationId, invoiceIds);
      const derived = deriveOrderStatus(jobs, {
        invoiceStatuses: invoices.map((d: any) => String(d.status)),
        hasServiceReport: hasServiceReportAttachment(order.attachments),
      });
      // Round 29: an order marked complete stays Complete until Reopen.
      const { status, linkedDocuments } = withCompletionMark(order, derived);
      if (order.status !== status || linkedDocuments) await prisma.order.update({ where: { id: orderId }, data: { status, ...(linkedDocuments ? { linkedDocuments } : {}) } });
      return status as WctOrderStatus;
    });
  } catch {
    return null;
  }
}

/** Manual flow: derive, store the status and stamp its first date. Caller is inside runAsOrg. */
async function refreshManualOrderStatus(prisma: any, organizationId: string, orderId: string): Promise<ManualOrderStatus | null> {
  const order = await prisma.order.findFirst({ where: { id: orderId, organizationId }, select: { id: true, status: true, statusDates: true, createdAt: true, linkedDocuments: true, invoiceDocumentId: true } });
  if (!order) return null;
  // A cancelled order (set by the office / a cleanup) stays cancelled.
  if (order.status === 'CANCELLED') return null;
  // DO first (2026-11-13): the status follows the order's DOs; a job counts through its DO, a job with no DO on its own.
  const jobs = await prisma.delivery.findMany({
    where: { organizationId, orderId, status: { not: 'cancelled' } },
    select: { id: true, status: true, isDraft: true, verificationState: true, orderInvoiceId: true, items: { select: { documentId: true } } },
  });
  const jobDoIds = [...new Set(jobs.flatMap((j: any) => j.items.map((i: any) => i.documentId)).filter(Boolean))] as string[];
  // Round 29: a DO linked to the order (Link existing document) is one of its DOs too; the DO itself is never written.
  const linkedDoIds = linkedDoIdsOf(order);
  const dos = (
    await prisma.document.findMany({
      where: { organizationId, type: { in: ['DELIVERY_ORDER', 'DO'] }, OR: [{ config: { path: ['orderId'], equals: orderId } }, { id: { in: [...jobDoIds, ...linkedDoIds] } }] },
      select: { id: true, status: true, config: true },
    })
  ).filter((d: any) => d.config?.cancelled !== true);
  const realInvoice = (v: any) => (v && !String(v).startsWith('claim:') ? String(v) : null);
  // Round 33: a linked DO is billed through its link entry (never the DO itself), while that invoice is live.
  const linkedEntries = new Map(linkedDoEntriesOf(order).map((e) => [e.id, e]));
  const liveLinked = await liveInvoiceIds(prisma, organizationId, [...linkedEntries.values()].map((e) => e.orderInvoiceId));
  const linkedInvoiceOf = (d: any): string | null | undefined => {
    const e = linkedEntries.get(d.id);
    if (!e || d.config?.orderId === orderId) return undefined;
    return e.orderInvoiceId && liveLinked.has(e.orderInvoiceId) ? e.orderInvoiceId : null;
  };
  const units: OrderUnit[] = [];
  for (const d of dos as any[]) {
    const on = jobs.filter((j: any) => j.items.some((i: any) => i.documentId === d.id));
    if (on.length) {
      const ids = on.map((j: any) => realInvoice(j.orderInvoiceId));
      units.push({ state: unitStateOfJobs(on), invoiceId: ids.every(Boolean) ? ids[0] : null });
    } else {
      const done = String(d.status).startsWith('delivered');
      const viaLink = linkedInvoiceOf(d);
      units.push({ state: done ? 'done' : d.config?.awaitingSignature ? 'awaiting' : 'draft', invoiceId: viaLink !== undefined ? viaLink : realInvoice(d.config?.orderInvoiceId) });
    }
  }
  for (const j of jobs.filter((j: any) => !j.items.some((i: any) => i.documentId)) as any[]) {
    units.push({ state: unitStateOfJobs([j]), invoiceId: realInvoice(j.orderInvoiceId) });
  }
  // Every invoice of the order: those billing a DO / job, plus one made from the quotation before any DO was done (invoice first).
  const invoiceIds = [...new Set([...units.map((u) => u.invoiceId), ...orderInvoiceIdsOf(order)].filter(Boolean))] as string[];
  // Split payment (2026-11-17): every part of a split invoice counts ("all parts" sent / paid).
  const invoices = await invoiceRowsWithSplitParts(prisma, organizationId, invoiceIds, { type: 'INVOICE' });
  const dates = (order.statusDates as Record<string, string> | null) ?? {};
  const derived = deriveManualOrderStatusFromUnits(units, { invoiceStatuses: invoices.map((d: any) => String(d.status)), serviceReportSent: !!dates.serviceReportSentAt });
  // The order exists because the quotation was signed / accepted: that first
  // step is dated by the order itself, even when the first refresh already
  // sees its draft job.
  const nextDates = withStatusDate(withStatusDate(dates, 'QUOTATION_SIGNED', new Date(order.createdAt)), derived);
  // Round 29: an order marked complete stays Complete until Reopen (the steps keep their dates).
  const { status, linkedDocuments } = withCompletionMark(order, derived);
  if (order.status !== status || JSON.stringify(nextDates) !== JSON.stringify(dates) || linkedDocuments) {
    await prisma.order.update({ where: { id: orderId }, data: { status, statusDates: nextDates, ...(linkedDocuments ? { linkedDocuments } : {}) } });
  }
  return status as ManualOrderStatus;
}

/**
 * The invoice rows for these ids plus the other parts of any Split payment
 * among them (invoice-split.ts). No split = the same rows as before, one query.
 */
export async function invoiceRowsWithSplitParts(prisma: any, organizationId: string, ids: string[], where: Record<string, unknown> = {}): Promise<Array<{ id: string; name?: string | null; status: string; config: any }>> {
  if (!ids.length) return [];
  const sel = { id: true, name: true, status: true, config: true };
  const rows = await prisma.document.findMany({ where: { id: { in: ids }, organizationId, ...where }, select: sel });
  const more = withSplitPartIds(ids, rows).filter((id) => !ids.includes(id));
  if (!more.length) return rows;
  return [...rows, ...(await prisma.document.findMany({ where: { id: { in: more }, organizationId, ...where }, select: sel }))];
}

/**
 * WCT orders: fill the EMPTY customer of the quotation's order (never
 * overwrites) with a customer of the same org. Returns the number of orders
 * filled. No-op without enableWctOrders.
 */
export async function fillEmptyOrderCustomer(prisma: any, organizationId: string, quotationId: string, customerId: string): Promise<number> {
  if (!(await isWctOrdersEnabled(prisma, organizationId))) return 0;
  const customer = await prisma.customer.findFirst({ where: { id: customerId, organizationId }, select: { id: true } });
  if (!customer) return 0;
  const r = await prisma.order.updateMany({ where: { organizationId, sourceQuotationId: quotationId, customerId: null }, data: { customerId: customer.id } });
  return r?.count ?? 0;
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

/**
 * The invoices recorded on the order itself (linkedDocuments.invoice, and
 * invoiceDocumentId): every order invoice is, including one made from the
 * quotation before any DO is done (invoice first, 2026-11-16), which no DO or
 * job points at yet. Ids only; callers read the live rows (a deleted one is gone).
 */
export function orderInvoiceIdsOf(order: { linkedDocuments?: unknown; invoiceDocumentId?: string | null } | null | undefined): string[] {
  const ld: any = order?.linkedDocuments;
  const fromLinks = Array.isArray(ld?.invoice) ? ld.invoice.map((x: any) => x?.id).filter((v: any) => typeof v === 'string' && v) : [];
  return [...new Set([...fromLinks, ...(order?.invoiceDocumentId ? [order.invoiceDocumentId] : [])])] as string[];
}

/**
 * Round 36: the invoices made with Create invoice for what is left on an AIMS order (linkedDocuments.invoice entries
 * with remainder: true). On the manual flow orderInvoiceIdsOf lists them already; another WCT order lists them too.
 * Round 40 (Elroy 2026-11-20): and the invoices linked to it (Link existing document or an invoice's Reference;
 * entries with a `linked` stamp), so Racking's orders show and count them.
 */
export function remainderInvoiceIdsOf(order: { linkedDocuments?: unknown } | null | undefined): string[] {
  const ld: any = order?.linkedDocuments;
  return Array.isArray(ld?.invoice) ? [...new Set<string>(ld.invoice.filter((x: any) => (x?.remainder === true || !!x?.linked) && typeof x.id === 'string' && x.id).map((x: any) => x.id as string))] : [];
}

/** Phase 5: the order carries a service report (an uploaded file or a linked AIMS report). */
export function hasServiceReportAttachment(attachments: unknown): boolean {
  return Array.isArray(attachments) && attachments.some((a: any) => a && (a.kind === 'report' || a.kind === 'file'));
}
