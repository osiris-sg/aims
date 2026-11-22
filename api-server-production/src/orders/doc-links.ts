/**
 * Link Document (WCT group, 2026-11-22; enableWctOrders). The QO / DO / Invoice editor's "Link Document" row opens a
 * picker with tabs Order, QO, DO, Invoice (minus the page's own type). Picking:
 *  - an Order: this document goes on that order;
 *  - a QO / DO / Invoice that is on an order: this document goes on that same order;
 *  - a QO from an invoice / DO: today's rule (the quotation's order, made when missing; doc-order-ref.service.ts);
 *  - a DO / Invoice on no order: the two documents are linked to each other directly (config.linkedDocs on both).
 * The doc chain panel on the left lists the order's QO, DO(s) and Invoice(s). Pure rules here, I/O in the service.
 */

export type PageKind = 'QUOTATION' | 'DELIVERY_ORDER' | 'INVOICE';
export type PickKind = 'ORDER' | PageKind;

export const PICK_KINDS: PickKind[] = ['ORDER', 'QUOTATION', 'DELIVERY_ORDER', 'INVOICE'];

/** The Document types of each page kind. */
export const TYPES_OF: Record<PageKind, string[]> = {
  QUOTATION: ['QUOTATION', 'QO', 'QO1', 'QO2', 'QT'],
  DELIVERY_ORDER: ['DELIVERY_ORDER', 'DO'],
  INVOICE: ['INVOICE', 'TAX_INVOICE', 'INV'],
};

/** A document type to its page kind (null = not a QO / DO / Invoice). */
export function pageKindOf(type: unknown): PageKind | null {
  const t = String(type ?? '').toUpperCase();
  for (const k of Object.keys(TYPES_OF) as PageKind[]) if (TYPES_OF[k].includes(t)) return k;
  return null;
}

/** The picker's tabs on a page: every kind but the page's own. */
export const pickerKindsFor = (page: PageKind): PickKind[] => PICK_KINDS.filter((k) => k !== page);

export function parsePickKind(v: unknown): PickKind | null {
  const t = String(v ?? '').trim().toUpperCase().replace(/[\s-]+/g, '_');
  const alias: Record<string, PickKind> = { QO: 'QUOTATION', DO: 'DELIVERY_ORDER', INV: 'INVOICE', ORD: 'ORDER' };
  const out = (alias[t] ?? t) as PickKind;
  return PICK_KINDS.includes(out) ? out : null;
}

/** One direct link (a document on no order, linked to another): stored on both documents. */
export interface DirectLink {
  id: string;
  type: string;
  name: string | null;
  templateId: string | null;
}

/** The direct links a config carries (config.linkedDocs). */
export function directLinksOf(config: any): DirectLink[] {
  const list = config?.linkedDocs;
  return Array.isArray(list) ? list.filter((x: any) => x && typeof x.id === 'string' && x.id) : [];
}

/** The config with this direct link added (same id = replaced, never twice). */
export function withDirectLink(config: any, link: DirectLink): any {
  const c = config || {};
  return { ...c, linkedDocs: [...directLinksOf(c).filter((l) => l.id !== link.id), link] };
}

/** The config without the direct link to this id. */
export function withoutDirectLink(config: any, id: string): any {
  const c = config || {};
  return { ...c, linkedDocs: directLinksOf(c).filter((l) => l.id !== id) };
}

/** The editor path of a document (null without its template). */
export function docHref(type: string, templateId: string | null | undefined, id: string): string | null {
  if (!templateId) return null;
  const kind = pageKindOf(type);
  const seg = kind === 'QUOTATION' ? 'QUOTATION' : kind === 'DELIVERY_ORDER' ? 'DELIVERY_ORDER' : kind === 'INVOICE' ? 'INVOICE' : String(type).toUpperCase();
  return `/portal/documents/${seg}/${templateId}/${id}`;
}

/** The customer's rows first, then the rest; each group keeps its own order (newest first). */
export function sameCustomerFirst<T extends { customerId?: string | null }>(rows: T[], customerId: string | null | undefined): T[] {
  if (!customerId) return rows;
  return [...rows.filter((r) => r.customerId === customerId), ...rows.filter((r) => r.customerId !== customerId)];
}

/** A search term for ILIKE (escaped), or null for none. */
export function likeTerm(q: unknown): string | null {
  const t = String(q ?? '').trim().slice(0, 60);
  return t ? `%${t.replace(/[\\%_]/g, (ch) => '\\' + ch)}%` : null;
}

/** A dead document (voided / cancelled) never shows in the picker or the chain. */
export const isDeadConfig = (config: any): boolean => config?.voided === true || config?.cancelled === true;
