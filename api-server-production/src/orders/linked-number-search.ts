/**
 * List search through the links (WCT group, 2026-11-23; enableWctOrders). Order invoices and DOs no longer carry
 * "ORD... · DO..." in their Reference (links live only in the Link Document pills), so a search for an order /
 * quotation / DO / invoice number also finds the documents LINKED to it:
 *  1. the orders it names: order number, the order's quotation number, or any QO / DO / invoice number the order
 *     holds (its source quotation, linkedDocuments lists, order invoice, documents made on it, its jobs' DOs and
 *     invoices);
 *  2. every document on those orders, plus the direct links (config.linkedDocs) of the documents it names.
 * The list's own type filter keeps only its type (invoices on the invoice list, DOs on the DO list).
 * Only for a term with a digit (document numbers have one), so a customer-name search costs nothing extra.
 */

const DOC_TYPES = ['QUOTATION', 'QO', 'QO1', 'QO2', 'QT', 'DELIVERY_ORDER', 'DO', 'INVOICE', 'TAX_INVOICE', 'INV'];
const LISTS = ['quotation', 'invoice', 'do', 'creditNote'];
const MAX_ORDERS = 200;

export const wantsLinkedSearch = (term: string): boolean => /\d/.test(term) && term.trim().length >= 3;

/** The ids a document holds through an order row (pure). */
export function orderMemberIds(o: { sourceQuotationId?: string | null; invoiceDocumentId?: string | null; linkedDocuments?: any }): string[] {
  const ld: any = o.linkedDocuments || {};
  const out: string[] = [];
  if (o.sourceQuotationId) out.push(o.sourceQuotationId);
  if (o.invoiceDocumentId) out.push(o.invoiceDocumentId);
  for (const k of LISTS) if (Array.isArray(ld[k])) for (const x of ld[k]) if (x && typeof x.id === 'string') out.push(x.id);
  return out;
}

export async function linkedDocIdsForNumber(prisma: any, organizationId: string, term: string): Promise<string[]> {
  if (!wantsLinkedSearch(term)) return [];
  const like = `%${term.trim().replace(/[\\%_]/g, (ch) => '\\' + ch)}%`;
  // Documents whose number matches (trigram index on name).
  const hits: Array<{ id: string; orderId: string | null; linkedDocs: any }> = await prisma.$queryRawUnsafe(
    `SELECT d.id::text AS id, d.config->>'orderId' AS "orderId", d.config->'linkedDocs' AS "linkedDocs" FROM "Document" d
      WHERE d."organizationId" = $1 AND d.type = ANY($2::text[]) AND d.name ILIKE $3 LIMIT 200`,
    organizationId,
    DOC_TYPES,
    like,
  );
  const hitIds = hits.map((h) => h.id);
  const direct = hits.flatMap((h) => (Array.isArray(h.linkedDocs) ? h.linkedDocs.map((x: any) => x?.id).filter((v: any) => typeof v === 'string') : []));
  const docOrders = hits.map((h) => h.orderId).filter((v): v is string => typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v));
  // Jobs of an order carry its DOs and invoices too.
  const jobOrders: Array<{ orderId: string }> = hitIds.length
    ? await prisma.$queryRawUnsafe(
        `SELECT DISTINCT r."orderId"::text AS "orderId" FROM "Delivery" r
          WHERE r."organizationId" = $1 AND r."orderId" IS NOT NULL
            AND (r."orderInvoiceId" = ANY($2::text[]) OR EXISTS (SELECT 1 FROM "DeliveryItem" i WHERE i."deliveryId" = r.id AND i."documentId"::text = ANY($2::text[])))`,
        organizationId,
        hitIds,
      )
    : [];
  const orders: Array<{ id: string; sourceQuotationId: string | null; invoiceDocumentId: string | null; linkedDocuments: any }> = await prisma.$queryRawUnsafe(
    `SELECT o.id::text AS id, o."sourceQuotationId"::text AS "sourceQuotationId", o."invoiceDocumentId"::text AS "invoiceDocumentId", o."linkedDocuments"
       FROM "Order" o LEFT JOIN "Document" q ON q.id = o."sourceQuotationId"
      WHERE o."organizationId" = $1
        AND (o."orderNumber" ILIKE $2 OR q.name ILIKE $2 OR o.id::text = ANY($3::text[])
             OR o."sourceQuotationId"::text = ANY($4::text[]) OR o."invoiceDocumentId"::text = ANY($4::text[])
             OR (cardinality($4::text[]) > 0 AND EXISTS (
                  SELECT 1 FROM jsonb_each(CASE WHEN jsonb_typeof(o."linkedDocuments") = 'object' THEN o."linkedDocuments" ELSE '{}'::jsonb END) e,
                       jsonb_array_elements(CASE WHEN jsonb_typeof(e.value) = 'array' THEN e.value ELSE '[]'::jsonb END) x
                  WHERE e.key = ANY($5::text[]) AND x->>'id' = ANY($4::text[]))))
      LIMIT ${MAX_ORDERS}`,
    organizationId,
    like,
    [...new Set([...docOrders, ...jobOrders.map((j) => j.orderId)])],
    hitIds,
    LISTS,
  );
  if (!orders.length) return [...new Set(direct)];
  const orderIds = orders.map((o) => o.id);
  // Documents made on those orders (config.orderId), and their jobs' DOs / invoices.
  const made: Array<{ id: string }> = await prisma.$queryRawUnsafe(
    `SELECT d.id::text AS id FROM "Document" d WHERE d."organizationId" = $1 AND d.type = ANY($2::text[]) AND d.config->>'orderId' = ANY($3::text[])`,
    organizationId,
    DOC_TYPES,
    orderIds,
  );
  const jobs: Array<{ invoiceId: string | null; docId: string | null }> = await prisma.$queryRawUnsafe(
    `SELECT r."orderInvoiceId" AS "invoiceId", i."documentId"::text AS "docId" FROM "Delivery" r LEFT JOIN "DeliveryItem" i ON i."deliveryId" = r.id
      WHERE r."organizationId" = $1 AND r."orderId"::text = ANY($2::text[])`,
    organizationId,
    orderIds,
  );
  const ids = new Set<string>(direct);
  for (const o of orders) for (const id of orderMemberIds(o)) ids.add(id);
  for (const m of made) ids.add(m.id);
  for (const j of jobs) {
    if (j.invoiceId && !String(j.invoiceId).startsWith('claim:')) ids.add(j.invoiceId);
    if (j.docId) ids.add(j.docId);
  }
  return [...ids].filter((id) => /^[0-9a-f-]{36}$/i.test(id));
}
