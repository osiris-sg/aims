/**
 * WCT jobs calendar "New job" with a Quotation (2026-11-17, same gate as the
 * calendar add: enableWctOrders + enableJobsCalendar, see quick-jobs.ts).
 *
 * The quick-job form may name a quotation. On save:
 *  - the quotation has an order: the job goes under that order. Manual order
 *    flow (DOs first): with exactly one open DO the job is linked to it, with
 *    several the form must name one, with none the job is on the order only.
 *  - no order yet (not signed): the job keeps the quotation
 *    (Delivery.sourceQuotationId, orderId null, no lines) and stays a Misc job
 *    until the quotation is accepted; quotation-to-delivery.ts then moves it
 *    onto the new order (and prepareManualOrderDo onto the first DO).
 * Never a second job, never a new DO, no stock moves.
 *
 * Pure helpers; the service wiring is in DeliveriesService (createQuickJob,
 * searchQuickJobQuotations, quickJobQuotation).
 */
import { BadRequestException } from '@nestjs/common';

export const QUOTATION_DOC_TYPES = ['QUOTATION', 'QO', 'QO1', 'QO2', 'QT'];

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** The quotation's customer id (config.customer.id, else config.customerId). */
export function quotationCustomerIdOf(cfg: any): string | null {
  return str(cfg?.customer?.id) || str(cfg?.customerId) || null;
}

/** The customer name the quotation shows. */
export function quotationCustomerNameOf(cfg: any): string | null {
  return str(cfg?.customer?.name) || str(cfg?.customerName) || null;
}

/** The quotation's Subject (WCT keeps it on config.subject). */
export function quotationSubjectOf(cfg: any): string | null {
  return str(cfg?.subject) || str(cfg?.documentInfo?.subject) || null;
}

/**
 * Where the work happens: the quotation's job location only (the same keys the
 * order's first DO reads, minus the billing-address fallbacks). Null when the
 * quotation has none, so the form falls back to the customer's address.
 */
export function quotationSiteOf(cfg: any): string | null {
  const di = cfg?.documentInfo || {};
  return str(di.location) || str(di.jobLocation) || str(cfg?.location) || str(cfg?.deliveryTo) || null;
}

/** Search box text → an ILIKE pattern (wildcards escaped), or null for an empty box. */
export function likePattern(q: unknown): string | null {
  const t = str(q).slice(0, 100);
  return t ? `%${t.replace(/[\\%_]/g, (ch) => '\\' + ch)}%` : null;
}

export function searchLimit(v: unknown): number {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n > 0 ? Math.min(n, 50) : 20;
}

const DOC_STATUS_LABEL: Record<string, string> = { draft: 'Draft', unconfirmed: 'Not signed', confirmed: 'Confirmed' };

/** The status a quotation row shows: its order when it has one, else the document status. */
export function quotationStatusLabel(status: string | null | undefined, orderNumber: string | null | undefined): string {
  if (orderNumber) return `Order ${orderNumber}`;
  const s = String(status ?? '');
  return DOC_STATUS_LABEL[s] ?? (s ? s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' ') : '');
}

/** Is this DO still open for a job: not cancelled, not completed, not waiting on the customer's sign link. */
export function isOpenDo(d: { status: string | null; config: any }): boolean {
  const c = d.config || {};
  if (c.cancelled === true) return false;
  if (String(d.status ?? '').startsWith('delivered')) return false;
  if (c.awaitingSignature === true) return false;
  return true;
}

/**
 * Which DO the new job goes on: the only open one, the one the form picked
 * among several (required), or none. Throws a 400 the form shows.
 */
export function pickDoForJob(openDoIds: string[], picked: unknown): string | null {
  if (!openDoIds.length) return null;
  if (openDoIds.length === 1) return openDoIds[0];
  const id = str(picked);
  if (!id) throw new BadRequestException('This order has more than one open DO: pick the DO for this job');
  if (!openDoIds.includes(id)) throw new BadRequestException('That DO is not an open DO of this order');
  return id;
}

/**
 * A job's lines mirroring ONE DO's lines, each pointing at it (the same rows
 * "Add job" on a DO makes): product lines one row per unit, service lines one
 * row with the quantity. Nothing is reserved or moved.
 */
export function jobRowsFromDo(doId: string, doConfig: any) {
  const items: any[] = Array.isArray(doConfig?.items) ? doConfig.items : [];
  const groupIdx = new Map<string, number>();
  return items.map((it: any, i: number) => {
    if (it?.assetId) {
      const g = String(it.deliveryGroup ?? it.assetId);
      const n = groupIdx.get(g) ?? 0;
      groupIdx.set(g, n + 1);
      return { assetId: it.assetId, inventoryId: null, description: it.description ?? null, assetClass: null, quantity: 1, sortOrder: i * 100 + n, documentId: doId };
    }
    return {
      assetId: null,
      inventoryId: null,
      description: String(it?.description ?? '').trim() || 'Item',
      assetClass: 'SERVICE' as const,
      quantity: Math.max(1, Math.round(Number(it?.quantity)) || 1),
      sortOrder: i * 100,
      documentId: doId,
    };
  });
}

/**
 * The jobs waiting for a quotation's order: made from the calendar with the
 * quotation picked before it was signed. They carry the quotation, have no
 * order and NO lines (a quotation's own auto-created run always has lines, so
 * it never matches), and are not cancelled.
 */
export function pendingQuotationJobsWhere(organizationId: string, quotationId: string) {
  return { organizationId, sourceQuotationId: quotationId, orderId: null, status: { not: 'cancelled' }, items: { none: {} } };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A uuid (Document / Customer ids); anything else is "not found", never a database error. */
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v);
