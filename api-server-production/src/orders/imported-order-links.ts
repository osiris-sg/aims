import { HttpException, HttpStatus } from '@nestjs/common';
import { isErpImported } from '../common/erp-import';
import { grossOf } from '../common/document-money';

/**
 * "Link existing document" on an imported order (WCT group, round 19, 2026-11-19; setting enableImportedOrders).
 *
 * The office attaches an existing QUOTATION (a revised or additional one), INVOICE, DELIVERY_ORDER (an AIMS DO or
 * an imported ERP DO) or SERVICE_REPORT of the order's own customer, found by its number, and can Unlink it again.
 * The link lives on the ORDER only (linkedDocuments.quotation / invoice / do, attachments for a service report):
 * the linked document is never written, so imported history stays as imported and finalized documents never change.
 *
 * One order per document: a document already on another order (its source quotation, a link list, the order
 * invoice, an AIMS document made on that order, a job of that order, a service report written for it) is refused,
 * naming that order. Unlink: any linked row except the order's own quotation and the documents made on the order
 * (Create invoice, Add DO, their split parts: void / cancel those instead). An unlinked imported invoice or DO is
 * remembered on the marker (imported.unlinked) so a re-run of the import never links it back.
 */

export type ImportedLinkType = 'QUOTATION' | 'INVOICE' | 'DELIVERY_ORDER' | 'SERVICE_REPORT';
export const IMPORTED_LINK_TYPES: ImportedLinkType[] = ['QUOTATION', 'INVOICE', 'DELIVERY_ORDER', 'SERVICE_REPORT'];
export const LINK_TYPE_LABEL: Record<ImportedLinkType, string> = { QUOTATION: 'Quotation', INVOICE: 'Invoice', DELIVERY_ORDER: 'DO', SERVICE_REPORT: 'Service report' };

/** The Document types each link type covers. */
export const DOC_TYPES_FOR: Record<Exclude<ImportedLinkType, 'SERVICE_REPORT'>, string[]> = {
  QUOTATION: ['QUOTATION', 'QO', 'QO1', 'QO2', 'QT'],
  INVOICE: ['INVOICE', 'TAX_INVOICE', 'INV'],
  DELIVERY_ORDER: ['DELIVERY_ORDER', 'DO'],
};

/** Which linkedDocuments list holds a link type. */
const LIST_FOR: Record<Exclude<ImportedLinkType, 'SERVICE_REPORT'>, 'quotation' | 'invoice' | 'do'> = { QUOTATION: 'quotation', INVOICE: 'invoice', DELIVERY_ORDER: 'do' };
const LINK_LISTS = ['quotation', 'invoice', 'do', 'creditNote', 'po', 'salesOrder'] as const;

export function parseLinkType(v: unknown): ImportedLinkType {
  const t = String(v ?? '').trim().toUpperCase().replace(/[\s-]+/g, '_');
  const alias: Record<string, ImportedLinkType> = { DO: 'DELIVERY_ORDER', REPORT: 'SERVICE_REPORT', SR: 'SERVICE_REPORT' };
  const out = (alias[t] ?? t) as ImportedLinkType;
  if (!IMPORTED_LINK_TYPES.includes(out)) throw new HttpException('Pick a quotation, invoice, DO or service report', HttpStatus.BAD_REQUEST);
  return out;
}

/** A document's customer (config.customerId, else config.customer.id). */
export const docCustomerIdOf = (config: any): string | null => {
  const c = config || {};
  const v = c.customerId ?? c.customer?.id ?? null;
  return typeof v === 'string' && v ? v : null;
};

/** A linked row the order does not hold any more. */
export const isDeadDoc = (d: { config?: any } | null | undefined) => d?.config?.voided === true || d?.config?.cancelled === true;

/** What the office types: "I-014521", "014521", "#12" (a report number: digits only). */
export const searchTerm = (q: unknown): string => String(q ?? '').trim().slice(0, 40);
export const reportNumberOf = (q: unknown): number | null => {
  const digits = String(q ?? '').replace(/\D/g, '');
  return digits && digits.length <= 9 ? parseInt(digits, 10) : null;
};

export interface OrderHolder {
  id: string;
  orderNumber: string;
}

interface HolderOrderRow {
  id: string;
  orderNumber: string;
  sourceQuotationId?: string | null;
  invoiceDocumentId?: string | null;
  linkedDocuments?: unknown;
  attachments?: unknown;
}

/** Does this order hold the document through its own fields (source quotation, order invoice, link lists, attachments)? Pure. */
export function orderHoldsDoc(o: HolderOrderRow, type: ImportedLinkType, docId: string): boolean {
  if (type === 'SERVICE_REPORT') return Array.isArray(o.attachments) && (o.attachments as any[]).some((a) => a?.kind === 'report' && a.reportId === docId);
  if (type === 'QUOTATION' && o.sourceQuotationId === docId) return true;
  if (type === 'INVOICE' && o.invoiceDocumentId === docId) return true;
  const ld: any = o.linkedDocuments || {};
  return LINK_LISTS.some((k) => Array.isArray(ld[k]) && ld[k].some((x: any) => x?.id === docId));
}

/**
 * Every order that holds each document (one query on Order, plus the jobs). docs carry what points at an order on
 * the document side: an AIMS document's config.orderId (never an imported one's: the order holds those links), a
 * report's serviceData.orderId and its job.
 */
export async function orderHoldersOf(
  prisma: any,
  organizationId: string,
  type: ImportedLinkType,
  docs: Array<{ id: string; config?: any; serviceData?: any; deliveryId?: string | null }>,
): Promise<Map<string, OrderHolder[]>> {
  const out = new Map<string, OrderHolder[]>(docs.map((d) => [d.id, []]));
  if (!docs.length) return out;
  const ids = docs.map((d) => d.id);
  const docSideOrder = (d: (typeof docs)[number]): string | null => {
    const v = type === 'SERVICE_REPORT' ? d.serviceData?.orderId : !isErpImported(d.config) ? d.config?.orderId : null;
    return typeof v === 'string' && v ? v : null;
  };
  // Jobs: a DO on a job of an order, an invoice billing a job of an order, a report written on a job.
  const jobOrder = new Map<string, string[]>();
  const addJob = (docId: string, orderId: string | null | undefined) => orderId && jobOrder.set(docId, [...(jobOrder.get(docId) ?? []), orderId]);
  if (type === 'DELIVERY_ORDER') {
    const items = await prisma.deliveryItem.findMany({ where: { documentId: { in: ids }, delivery: { organizationId, orderId: { not: null }, status: { not: 'cancelled' } } }, select: { documentId: true, delivery: { select: { orderId: true } } } });
    for (const i of items as any[]) addJob(i.documentId, i.delivery?.orderId);
  } else if (type === 'INVOICE') {
    const runs = await prisma.delivery.findMany({ where: { organizationId, orderInvoiceId: { in: ids }, orderId: { not: null } }, select: { orderInvoiceId: true, orderId: true } });
    for (const r of runs as any[]) addJob(r.orderInvoiceId, r.orderId);
  } else if (type === 'SERVICE_REPORT') {
    const runIds = docs.map((d) => d.deliveryId).filter((v): v is string => typeof v === 'string' && !!v);
    const runs = runIds.length ? await prisma.delivery.findMany({ where: { organizationId, id: { in: runIds }, orderId: { not: null } }, select: { id: true, orderId: true } }) : [];
    const runOrder = new Map((runs as any[]).map((r) => [r.id, r.orderId]));
    for (const d of docs) addJob(d.id, d.deliveryId ? runOrder.get(d.deliveryId) : null);
  }
  const pointed = [...new Set([...docs.map(docSideOrder), ...[...jobOrder.values()].flat()].filter((v): v is string => !!v))];
  const OR: any[] = [];
  if (pointed.length) OR.push({ id: { in: pointed } });
  if (type === 'QUOTATION') OR.push({ sourceQuotationId: { in: ids } });
  if (type === 'INVOICE') OR.push({ invoiceDocumentId: { in: ids } });
  if (type === 'SERVICE_REPORT') for (const id of ids) OR.push({ attachments: { array_contains: [{ reportId: id }] } });
  else for (const id of ids) for (const k of LINK_LISTS) OR.push({ linkedDocuments: { path: [k], array_contains: [{ id }] } });
  const orders: HolderOrderRow[] = await prisma.order.findMany({
    where: { organizationId, OR },
    select: { id: true, orderNumber: true, sourceQuotationId: true, invoiceDocumentId: true, linkedDocuments: true, attachments: true },
  });
  for (const d of docs) {
    const via = new Set([docSideOrder(d), ...(jobOrder.get(d.id) ?? [])].filter(Boolean) as string[]);
    const holders = orders.filter((o) => via.has(o.id) || orderHoldsDoc(o, type, d.id));
    out.set(d.id, holders.map((o) => ({ id: o.id, orderNumber: o.orderNumber })));
  }
  return out;
}

/** The refusal when a document sits on an order already (this one or another). Null = free to link. */
export function holderRefusal(name: string, orderId: string, holders: OrderHolder[]): string | null {
  const other = holders.find((h) => h.id !== orderId);
  if (other) return `${name} is already on order ${other.orderNumber}. A document can be on one order only.`;
  if (holders.length) return `${name} is already on this order.`;
  return null;
}

/** Who linked it and when (stored on the link entry). */
export interface LinkStamp {
  at: string;
  by: string | null;
  byName: string | null;
}

/** linkedDocuments after linking a document (QUOTATION / INVOICE / DELIVERY_ORDER). Pure: never mutates `ld`. */
export function withLinkedDocument(ld: any, type: Exclude<ImportedLinkType, 'SERVICE_REPORT'>, doc: { id: string; name: string | null; status?: string | null; documentTemplateId?: string | null; config?: any }, stamp: LinkStamp): any {
  const cur: any = ld && typeof ld === 'object' ? ld : {};
  const key = LIST_FOR[type];
  const list: any[] = Array.isArray(cur[key]) ? cur[key] : [];
  if (list.some((x) => x?.id === doc.id)) return cur;
  const cfg: any = doc.config || {};
  const base = { id: doc.id, name: doc.name ?? null, templateId: doc.documentTemplateId ?? null, linked: stamp };
  let entry: any = base;
  if (type === 'QUOTATION' || type === 'INVOICE') entry = { ...base, total: grossOf(cfg) ?? 0 };
  else if (isErpImported(cfg)) {
    // An imported ERP DO: same shape as the import's own DO entries (scripts/wct-erp-dos.js), so the status reads its done flag.
    const e: any = cfg.erpImport || {};
    entry = { ...base, imported: true, erpStatus: e.status ?? 'Issued', done: typeof e.done === 'boolean' ? e.done : String(doc.status ?? '').startsWith('delivered'), date: cfg.date ?? null };
  }
  const imported = cur.imported && typeof cur.imported === 'object' && Array.isArray(cur.imported.unlinked)
    ? { ...cur.imported, unlinked: cur.imported.unlinked.filter((x: any) => (typeof x === 'string' ? x : x?.id) !== doc.id) }
    : cur.imported;
  return { ...cur, ...(imported !== undefined ? { imported } : {}), [key]: [...list, entry] };
}

/**
 * linkedDocuments after unlinking (QUOTATION / INVOICE / DELIVERY_ORDER). An invoice takes its credit notes with it
 * (creditNoteIds); an imported document is remembered on the marker so the import never links it back. Pure.
 */
export function withoutLinkedDocument(ld: any, type: Exclude<ImportedLinkType, 'SERVICE_REPORT'>, docId: string, opts: { erp: boolean; creditNoteIds?: string[]; stamp: LinkStamp }): any {
  const cur: any = ld && typeof ld === 'object' ? ld : {};
  const key = LIST_FOR[type];
  const next: any = { ...cur, [key]: (Array.isArray(cur[key]) ? cur[key] : []).filter((x: any) => x?.id !== docId) };
  if (opts.creditNoteIds?.length && Array.isArray(cur.creditNote)) next.creditNote = cur.creditNote.filter((x: any) => !opts.creditNoteIds!.includes(x?.id));
  if (opts.erp && cur.imported && typeof cur.imported === 'object') {
    const list: any[] = Array.isArray(cur.imported.unlinked) ? cur.imported.unlinked : [];
    if (!list.some((x) => (typeof x === 'string' ? x : x?.id) === docId)) next.imported = { ...cur.imported, unlinked: [...list, { id: docId, type, ...opts.stamp }] };
  }
  return next;
}

/** The entry of a document in the order's link list, or null. */
export function linkEntryOf(ld: any, type: Exclude<ImportedLinkType, 'SERVICE_REPORT'>, docId: string): any | null {
  const list = (ld as any)?.[LIST_FOR[type]];
  return Array.isArray(list) ? list.find((x: any) => x?.id === docId) ?? null : null;
}

/** A document made on this order in AIMS (Create invoice, Add DO, a split part): void / cancel it, never unlink. */
export const madeOnOrder = (doc: { config?: any } | null | undefined, orderId: string): boolean => !!doc && !isErpImported(doc.config) && doc.config?.orderId === orderId;
