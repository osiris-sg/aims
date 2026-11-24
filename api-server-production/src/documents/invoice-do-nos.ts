/**
 * The DO numbers an invoice covers, for the WCT invoice print's "DO No" line (2026-11-24; replaces "Order No").
 * An invoice knows its DOs in four ways, all read here (first seen order, no repeats):
 *  - config.deliveryOrderNos: an order invoice's DOs (createOrderInvoice);
 *  - config.sourceDocumentType DELIVERY_ORDER + sourceDocumentNumber: an invoice made from a DO;
 *  - config.linkedDocs: DOs linked directly to it (Link Document, orders/doc-links.ts);
 *  - its order's linked DOs billed by it (Order.linkedDocuments.do[].orderInvoiceId = the invoice, or the ids in
 *    config.orderLinkedDoIds).
 * No DO: an empty list, and the print leaves the line out.
 */
const DO_TYPES = ['DELIVERY_ORDER', 'DO'];
const isDoType = (t: unknown) => DO_TYPES.includes(String(t ?? '').toUpperCase());

function pushUnique(out: string[], v: unknown) {
  const s = String(v ?? '').trim();
  if (s && !out.includes(s)) out.push(s);
}

/** The DO numbers the invoice's own config names (no database). */
export function doNumbersFromConfig(config: any): string[] {
  const c = config || {};
  const out: string[] = [];
  for (const n of Array.isArray(c.deliveryOrderNos) ? c.deliveryOrderNos : []) pushUnique(out, n);
  if (isDoType(c.sourceDocumentType)) pushUnique(out, c.sourceDocumentNumber);
  for (const l of Array.isArray(c.linkedDocs) ? c.linkedDocs : []) if (l && isDoType(l.type)) pushUnique(out, l.name);
  return out;
}

/** The DO numbers of an order's linked DOs billed by this invoice. */
export function doNumbersFromOrderLinks(linkedDocuments: any, invoiceId: string | null | undefined, linkedDoIds: string[] = []): string[] {
  const list: any[] = Array.isArray(linkedDocuments?.do) ? linkedDocuments.do : [];
  const out: string[] = [];
  for (const e of list) {
    if (!e) continue;
    if ((invoiceId && e.orderInvoiceId === invoiceId) || linkedDoIds.includes(e.id)) pushUnique(out, e.name);
  }
  return out;
}

/** Every DO number the invoice covers (config first, then its order's linked DOs billed by it). */
export async function invoiceDoNumbers(prisma: any, organizationId: string, invoiceId: string | null | undefined, config: any): Promise<string[]> {
  const out = doNumbersFromConfig(config);
  const orderId = config?.orderId;
  if (orderId && typeof orderId === 'string') {
    const order = await prisma.order.findFirst({ where: { id: orderId, organizationId }, select: { linkedDocuments: true } }).catch(() => null);
    const ids = Array.isArray(config?.orderLinkedDoIds) ? config.orderLinkedDoIds.filter((x: any) => typeof x === 'string') : [];
    for (const n of doNumbersFromOrderLinks(order?.linkedDocuments, invoiceId, ids)) pushUnique(out, n);
  }
  return out;
}

export const INVOICE_DOC_TYPES = ['INVOICE', 'TI', 'TI2', 'TAX_INVOICE'];
export const isInvoiceDocType = (t: unknown) => INVOICE_DOC_TYPES.includes(String(t ?? '').toUpperCase());
