/**
 * Subject column on the Quotations, Delivery Orders and Invoices lists (WCT group: enableWctDocNav; 2026-11-24).
 * It replaces the Remarks column there. Subject = config.subject, else config.documentInfo.subject (the same rule as
 * quotationSubjectOf). A DO or invoice with no Subject of its own shows its quotation's, marked `inherited` (the list
 * shows it muted). The quotation is found through the document's own pointers, so a list page costs one small query:
 *   1. config.sourceDocumentId -> a quotation (a DO / invoice made from it);
 *   2. config.sourceDocumentId -> a DO whose config.sourceDocumentId is a quotation (an invoice made from a DO);
 *   3. config.orderId -> the order's quotation (Order.sourceQuotationId).
 * Sort and search use the same SQL expression, in the database, over the list's own document types only.
 * Every other org and every other list: the Remarks column and the old sort / search, unchanged.
 */
import { Prisma } from '@prisma/client';

export const SUBJECT_LIST_FLAG = 'enableWctDocNav';

export const SUBJECT_QUOTATION_TYPES = ['QUOTATION', 'QO', 'QO1', 'QO2', 'QT'];
export const SUBJECT_DO_TYPES = ['DELIVERY_ORDER', 'DO'];
export const SUBJECT_INVOICE_TYPES = ['INVOICE', 'TI', 'TI2', 'TAX_INVOICE', 'INV'];
const ALL = new Set([...SUBJECT_QUOTATION_TYPES, ...SUBJECT_DO_TYPES, ...SUBJECT_INVOICE_TYPES]);

/** The list shows Subject when the org has the flag and every listed type is a quotation, DO or invoice type. */
export function subjectListOn(flagOn: boolean, documentTypes: string[] | null | undefined): boolean {
  return !!flagOn && !!documentTypes?.length && documentTypes.every((t) => ALL.has(String(t ?? '').toUpperCase()));
}

/** The document's own Subject (pure twin of the SQL below). */
export function ownSubjectOf(cfg: any): string | null {
  const s = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  return s(cfg?.subject) || s(cfg?.documentInfo?.subject) || null;
}

/** What the list cell shows: the own Subject, else the quotation's (inherited; never on a quotation). */
export function listSubjectOf(type: string | null | undefined, own: string | null | undefined, linked: string | null | undefined): { text: string; inherited: boolean } | null {
  if (own && own.trim()) return { text: own.trim(), inherited: false };
  if (SUBJECT_QUOTATION_TYPES.includes(String(type ?? '').toUpperCase())) return null;
  if (linked && linked.trim()) return { text: linked.trim(), inherited: true };
  return null;
}

// Constant SQL only (aliases and type lists are ours, never user input).
const list = (xs: string[]) => xs.map((x) => `'${x}'`).join(', ');
const QO = list(SUBJECT_QUOTATION_TYPES);
const DOS = list(SUBJECT_DO_TYPES);
/** A config value as a uuid, NULL when it is not one (a bad pointer never fails the list). */
const asUuid = (expr: string) => `(CASE WHEN (${expr}) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN (${expr})::uuid END)`;
const own = (a: string) => `COALESCE(NULLIF(btrim(${a}.config ->> 'subject'), ''), NULLIF(btrim(${a}.config #>> '{documentInfo,subject}'), ''))`;

/** SQL: the document's own Subject. */
export const ownSubjectSql = (a: string): string => own(a);

/** SQL: the Subject of the quotation behind a DO / invoice (NULL for a quotation or none found). */
export function linkedSubjectSql(a: string): string {
  return `(CASE WHEN ${a}.type::text IN (${QO}) THEN NULL ELSE COALESCE(
    (SELECT ${own('ls1')} FROM "Document" ls1
      WHERE ls1.id = ${asUuid(`${a}.config ->> 'sourceDocumentId'`)} AND ls1."organizationId" = ${a}."organizationId" AND ls1.type::text IN (${QO})),
    (SELECT ${own('ls3')} FROM "Document" ls2 JOIN "Document" ls3
        ON ls3.id = ${asUuid(`ls2.config ->> 'sourceDocumentId'`)} AND ls3."organizationId" = ls2."organizationId" AND ls3.type::text IN (${QO})
      WHERE ls2.id = ${asUuid(`${a}.config ->> 'sourceDocumentId'`)} AND ls2."organizationId" = ${a}."organizationId" AND ls2.type::text IN (${DOS})),
    (SELECT ${own('lq')} FROM "Order" lo JOIN "Document" lq ON lq.id = lo."sourceQuotationId"
      WHERE lo.id = ${asUuid(`${a}.config ->> 'orderId'`)} AND lo."organizationId" = ${a}."organizationId")
  ) END)`;
}

/** SQL: what the cell shows (own, else the quotation's), for sort and search. */
export const shownSubjectSql = (a: string): string => `COALESCE(${own(a)}, ${linkedSubjectSql(a)})`;

/** One query: own + linked Subject for a page of documents. */
export function pageSubjectsQuery(organizationId: string, ids: string[]): Prisma.Sql {
  return Prisma.sql`SELECT d.id::text AS id, d.type::text AS type, ${Prisma.raw(own('d'))} AS own, ${Prisma.raw(linkedSubjectSql('d'))} AS linked
    FROM "Document" d WHERE d."organizationId" = ${organizationId} AND d.id = ANY(${ids}::uuid[])`;
}

/** The matching ids sorted by the shown Subject (blank last), then created date, one page. */
export function subjectSortQuery(organizationId: string, ids: string[], dir: 'asc' | 'desc', limit: number, offset: number): Prisma.Sql {
  const d = Prisma.raw(dir === 'asc' ? 'ASC' : 'DESC');
  return Prisma.sql`SELECT d.id::text AS id FROM "Document" d
    WHERE d."organizationId" = ${organizationId} AND d.id = ANY(${ids}::uuid[])
    ORDER BY lower(${Prisma.raw(shownSubjectSql('d'))}) ${d} NULLS LAST, d."createdAt" ${d}, d.id ${d}
    LIMIT ${limit} OFFSET ${offset}`;
}

/** Ids of the list's documents whose shown Subject matches the search (like = an escaped ILIKE pattern). */
export function subjectSearchQuery(organizationId: string, documentTypes: string[], like: string): Prisma.Sql {
  return Prisma.sql`SELECT d.id::text AS id FROM "Document" d
    WHERE d."organizationId" = ${organizationId} AND d.type::text = ANY(${documentTypes})
      AND ${Prisma.raw(shownSubjectSql('d'))} ILIKE ${like} ESCAPE '\\'
    LIMIT 5000`;
}

/** The invoice types whose lists search the PO Number (WCT group, 2026-11-24). */
const PO_SEARCH_TYPES = ['INVOICE', 'TI', 'TI2', 'TAX_INVOICE'];
export const poSearchOn = (subjectOn: boolean, documentTypes: string[] | undefined): boolean =>
  subjectOn && Array.isArray(documentTypes) && documentTypes.length > 0 && documentTypes.some((t) => PO_SEARCH_TYPES.includes(String(t).toUpperCase()));

/**
 * The invoices whose PO Number (config.poNumber) matches: read straight from the config, so no
 * data migration is needed (WCT group Invoices list search; enableWctDocNav).
 */
export function poNumberSearchQuery(organizationId: string, documentTypes: string[], like: string): Prisma.Sql {
  return Prisma.sql`SELECT d.id::text AS id FROM "Document" d
    WHERE d."organizationId" = ${organizationId} AND d.type::text = ANY(${documentTypes})
      AND d.config ->> 'poNumber' ILIKE ${like} ESCAPE '\\'
    LIMIT 5000`;
}
