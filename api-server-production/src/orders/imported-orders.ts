import { HttpException, HttpStatus } from '@nestjs/common';
import { isOrgFeatureEnabled } from '../common/org-features';
import { erpImportOf } from '../common/erp-import';
import { amountPaidOf, grossOf, owedOf } from '../common/document-money';

/**
 * IMPORTED ORDERS (WCT group, 2026-11-18; per-org setting features.enableImportedOrders, default off).
 *
 * The old ERP's quotations and invoices were imported as history documents
 * (config.erpImport). This links them into orders using ONLY the old ERP's own
 * links, never a guess (no customer / subject / amount matching):
 *   1. explicit ERP field: the invoice's contract_no starts with the quotation
 *      number (WCT ERP, "-014162 - 09 Jul 2026 to ..."), or the tracker's own
 *      quotation number column (BC Air "WCT Cleaning" tracker, "-7966");
 *   2. ERP line text: a line of the invoice reads "Refer to Quotation (-0xxxxx)".
 * One order per imported quotation with at least one such invoice, in the
 * quotation's org (a reference to a quotation of another org is listed, never
 * linked across orgs). Quotations without an invoice get no order; invoices
 * without a link stay as they are.
 *
 * What is written: Order rows only. The imported documents are never written
 * (not even a link field): the order holds the links (sourceQuotationId +
 * linkedDocuments). Nothing posts to the GL; the posting queue, Xero and the
 * statements read documents, which do not change.
 *
 * The marker is linkedDocuments.imported (no schema change):
 *   { source: 'erp-import', batch, quotationNo, linkSources: { [invoiceId]: 'contract_no' | ... },
 *     erpDoNumbers: ['DO010975'], at }
 * An imported order is read-only everywhere: no DO, no job, no invoice from
 * the order, no cancel, no edit (assertNotImportedOrder at every entry point).
 */
export const IMPORTED_ORDERS_FLAG = 'enableImportedOrders';
export const IMPORTED_ORDER_SOURCE = 'erp-import';

export type ImportedLinkSource = 'erp_quotation_link' | 'contract_no' | 'tracker_quotation_no' | 'line_text';
export const IMPORTED_LINK_SOURCE_LABEL: Record<ImportedLinkSource, string> = {
  erp_quotation_link: 'ERP quotation link',
  contract_no: 'ERP contract no.',
  tracker_quotation_no: 'Tracker quotation no.',
  line_text: 'ERP line text',
};

export interface ImportedMarker {
  source: typeof IMPORTED_ORDER_SOURCE;
  batch: string;
  quotationNo: string;
  linkSources: Record<string, ImportedLinkSource>;
  erpDoNumbers: string[];
  at: string;
}

export async function isImportedOrdersEnabled(prisma: any, organizationId: string): Promise<boolean> {
  try {
    return await isOrgFeatureEnabled(prisma, organizationId, IMPORTED_ORDERS_FLAG);
  } catch {
    return false;
  }
}

export function importedMarkerOf(order: { linkedDocuments?: unknown } | null | undefined): ImportedMarker | null {
  const m: any = (order?.linkedDocuments as any)?.imported;
  return m && typeof m === 'object' && m.source === IMPORTED_ORDER_SOURCE ? (m as ImportedMarker) : null;
}

export const isImportedOrder = (order: { linkedDocuments?: unknown } | null | undefined): boolean => importedMarkerOf(order) !== null;

export const IMPORTED_ORDER_READ_ONLY = 'This order was imported from the old ERP. It is read-only: it has no DO, jobs or service report, and it cannot be cancelled or edited.';

/** Refuse any change to an imported order. A missing order is left to the caller's own not-found handling. */
export async function assertNotImportedOrder(prisma: any, organizationId: string, orderId: string | null | undefined): Promise<void> {
  if (!orderId || String(orderId).startsWith('claim:')) return;
  let order: any = null;
  try {
    order = await prisma.order.findFirst({ where: { id: orderId, organizationId }, select: { linkedDocuments: true } });
  } catch {
    return;
  }
  if (isImportedOrder(order)) throw new HttpException(IMPORTED_ORDER_READ_ONLY, HttpStatus.BAD_REQUEST);
}

/**
 * Imported order number: "ORD-" + the quotation's own number (ORD-Q-004533).
 * Native numbers come from the ORDER format ({DOC}{YYYY}{MM}-{###} = ORD202611-017,
 * WR-ORD202611-001 for Racking) or nextOrderNumber (ORD202611-001): a digit always
 * follows "ORD", so "ORD-Q-" can never be one of them, and the native counter is
 * never read or advanced. (orderNumber, organizationId) is unique: a clash would
 * fail the insert, never overwrite.
 */
export const importedOrderNumber = (quotationName: string): string => `ORD-${String(quotationName).trim()}`;
export const isImportedOrderNumber = (n: string | null | undefined): boolean => /^ORD-Q-/.test(String(n || ''));

// ── ERP link signals (pure) ─────────────────────────────────────────────────

/** The ERP quotation number as an integer: "Q-004533", "-004533", "-004533-R0", "-7966". Anything else (SQBA-24-00057, Q26-048) is null. */
export function erpQuoteKey(s: unknown): number | null {
  const m = String(s ?? '').match(/^\s*Q?-0*(\d{1,6})(?:-R\d+)?(?=$|\s|[^0-9A-Za-z])/i);
  return m ? Number(m[1]) : null;
}

/** "Refer to Quotation (-011825)", "Refer to Quotation -013042", "Refer to the Quotation#Q12345": the distinct numbers. */
export function quotationRefsInText(text: unknown): number[] {
  const out = new Set<number>();
  for (const m of String(text ?? '').matchAll(/refer\w*\s+to\s+(?:the\s+)?quotation\W{0,12}(?:no\.?\s*)?(?:#\s*)?\(?\s*(?:Q\s*-?\s*)?-?\s*0*(\d{3,6})/gi)) out.add(Number(m[1]));
  return [...out];
}

export interface InvoiceQuoteRef {
  key: number;
  source: ImportedLinkSource;
}

/**
 * The old ERP's own link from an imported invoice to its quotation, or null.
 * Order: the invoice's "Quotation No." link read from the ERP itself (erpLink, pulled read-only
 * into _imports/wct/links/), the explicit export field, then line text (one number only).
 */
export function invoiceQuoteRef(config: any, erpLink?: string | null): InvoiceQuoteRef | null {
  const e: any = erpImportOf(config);
  if (!e) return null;
  if (erpLink) {
    const k = erpQuoteKey(erpLink);
    if (k != null) return { key: k, source: 'erp_quotation_link' };
  }
  if (e.source === 'wct-erp' && e.contractNo) {
    const k = erpQuoteKey(e.contractNo);
    if (k != null) return { key: k, source: 'contract_no' };
  }
  if (e.quotationNo) {
    const k = erpQuoteKey(e.quotationNo);
    if (k != null) return { key: k, source: 'tracker_quotation_no' };
  }
  const items: any[] = Array.isArray(config?.items) ? config.items : [];
  const refs = quotationRefsInText(items.map((it) => (it && typeof it.description === 'string' ? it.description : '')).join('\n'));
  if (refs.length === 1) return { key: refs[0], source: 'line_text' };
  return null;
}

/** The old ERP's DO number on an imported invoice (WCT ERP our_do_no; BC Air tracker doNo), or null. */
export function erpDoNumberOf(config: any): string | null {
  const e: any = erpImportOf(config);
  const v = e?.ourDoNo ?? e?.doNo;
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

// ── Plan (pure; the dry-run script and the tests use it) ────────────────────

export interface PlanDoc {
  id: string;
  organizationId: string;
  type: string;
  name: string | null;
  status: string;
  createdAt?: Date | string;
  config: any;
}

export interface PlannedOrder {
  organizationId: string;
  orderNumber: string;
  quotation: PlanDoc;
  invoices: Array<{ doc: PlanDoc; source: ImportedLinkSource }>;
  creditNotes: PlanDoc[];
  customerId: string | null;
  customerMismatch: string[];
  date: string | null;
  status: ImportedOrderStatus;
  total: number;
  erpDoNumbers: string[];
}

export interface ImportedPlan {
  orders: PlannedOrder[];
  skipped: Array<{ invoice: string; organizationId: string; why: string; key?: number; otherOrg?: string }>;
  quotesWithoutInvoice: number;
  alreadyOrdered: number;
}

/**
 * One order per imported quotation with at least one ERP-linked imported invoice of the same org.
 * Skipped (listed, never linked): a reference to a quotation of another org; to a number no imported
 * quotation has; to a number two quotations share; an invoice the ERP marked Cancelled. A quotation
 * that already has an order (native or imported) is never given another one (idempotent).
 */
export function planImportedOrders(docs: PlanDoc[], opts: { quotationIdsWithOrder?: Set<string>; exclude?: Set<string>; erpLinks?: Map<string, string> } = {}): ImportedPlan {
  const exclude = opts.exclude ?? new Set<string>();
  const live = docs.filter((d) => !exclude.has(d.organizationId) && erpImportOf(d.config) && d.config?.voided !== true);
  const quotes = live.filter((d) => d.type === 'QUOTATION' && d.name);
  const byKey = new Map<number, PlanDoc[]>();
  for (const q of quotes) {
    const k = erpQuoteKey(q.name);
    if (k != null) byKey.set(k, [...(byKey.get(k) ?? []), q]);
  }
  const skipped: ImportedPlan['skipped'] = [];
  const perQuote = new Map<string, Array<{ doc: PlanDoc; source: ImportedLinkSource }>>();
  for (const inv of live.filter((d) => d.type === 'INVOICE')) {
    // ERP-pulled links are keyed "<orgId>|<invoice no.>" (WCT ERP invoice numbers).
    const ref = invoiceQuoteRef(inv.config, opts.erpLinks?.get(`${inv.organizationId}|${inv.name}`) ?? null);
    if (!ref) continue;
    const base = { invoice: String(inv.name), organizationId: inv.organizationId, key: ref.key };
    if (String(erpImportOf(inv.config)?.status || '') === 'Cancelled') {
      skipped.push({ ...base, why: 'invoice cancelled in the ERP' });
      continue;
    }
    const all = byKey.get(ref.key) ?? [];
    const same = all.filter((q) => q.organizationId === inv.organizationId);
    if (!same.length) {
      skipped.push(all.length ? { ...base, why: 'quotation is in another org', otherOrg: all[0].organizationId } : { ...base, why: 'quotation not in AIMS' });
      continue;
    }
    if (same.length > 1) {
      skipped.push({ ...base, why: 'several quotations with that number' });
      continue;
    }
    const q = same[0];
    perQuote.set(q.id, [...(perQuote.get(q.id) ?? []), { doc: inv, source: ref.source }]);
  }
  const cnByInvoice = new Map<string, PlanDoc[]>();
  for (const cn of live.filter((d) => d.type === 'CREDIT_NOTE')) {
    const to = cn.config?.sourceDocumentId;
    if (typeof to === 'string' && to) cnByInvoice.set(to, [...(cnByInvoice.get(to) ?? []), cn]);
  }
  const orders: PlannedOrder[] = [];
  let alreadyOrdered = 0;
  for (const q of quotes) {
    const invoices = perQuote.get(q.id);
    if (!invoices?.length) continue;
    if (opts.quotationIdsWithOrder?.has(q.id)) {
      alreadyOrdered++;
      continue;
    }
    invoices.sort((a, b) => String(a.doc.config?.date ?? '').localeCompare(String(b.doc.config?.date ?? '')) || String(a.doc.name).localeCompare(String(b.doc.name)));
    const customerId = (q.config?.customerId as string) || null;
    const st = importedOrderStatus(invoices.map((i) => i.doc));
    orders.push({
      organizationId: q.organizationId,
      orderNumber: importedOrderNumber(String(q.name)),
      quotation: q,
      invoices,
      creditNotes: invoices.flatMap((i) => cnByInvoice.get(i.doc.id) ?? []),
      customerId,
      customerMismatch: invoices.filter((i) => (i.doc.config?.customerId || null) !== customerId).map((i) => String(i.doc.name)),
      date: typeof q.config?.date === 'string' ? q.config.date.slice(0, 10) : null,
      status: st,
      total: st.total,
      erpDoNumbers: [...new Set(invoices.map((i) => erpDoNumberOf(i.doc.config)).filter(Boolean) as string[])],
    });
  }
  return { orders, skipped, quotesWithoutInvoice: quotes.length - perQuote.size, alreadyOrdered };
}

// ── Status ──────────────────────────────────────────────────────────────────

export interface ImportedOrderStatus {
  status: 'INVOICED' | 'PAID';
  /** Invoiced and some money already received on an invoice not settled. */
  partPaid: boolean;
  total: number;
  owed: number;
}

/**
 * From the order's invoices' money (document-money.ts, the one read path):
 * every invoice owes nothing → PAID, else INVOICED (partPaid when an unsettled one has a payment).
 * Credit notes count through the invoice: the imported balance already has the credit applied
 * (BC Air: each imported CN's invoice is stamped outstanding 0), so a CN is never subtracted again.
 * Voided invoices are left out.
 */
export function importedOrderStatus(invoices: Array<{ status?: string; config: any }>): ImportedOrderStatus {
  const live = invoices.filter((d) => d?.config?.voided !== true && d?.status !== 'void');
  const R = (n: number) => Math.round(n * 100) / 100;
  const total = R(live.reduce((t, d) => t + (grossOf(d.config) ?? 0), 0));
  const owedEach = live.map((d) => owedOf(d.config));
  const owed = R(owedEach.reduce((t, n) => t + n, 0));
  const open = live.filter((_, i) => owedEach[i] >= 0.005);
  if (!live.length || !open.length) return { status: 'PAID', partPaid: false, total, owed };
  const partPaid = open.some((d) => (amountPaidOf(d.config) ?? 0) > 0 || (owedOf(d.config) < (grossOf(d.config) ?? 0) - 0.005));
  return { status: 'INVOICED', partPaid, total, owed };
}

export const IMPORTED_STATUS_LABEL = (s: Pick<ImportedOrderStatus, 'status' | 'partPaid'>): string => (s.status === 'PAID' ? 'Paid' : s.partPaid ? 'Invoiced, part paid' : 'Invoiced');

/**
 * The order page's tracker for an imported order: Quotation and Invoice done,
 * DO and Service report not applicable (the old ERP's DO numbers shown as text).
 */
export function importedTracker(order: { erpDoNumbers?: string[] }, st: Pick<ImportedOrderStatus, 'status' | 'partPaid'>) {
  return [
    { key: 'quotation', label: 'Quotation', state: 'done' as const },
    { key: 'invoice', label: 'Invoice', state: 'done' as const, note: IMPORTED_STATUS_LABEL(st) },
    { key: 'do', label: 'DO', state: 'na' as const, note: order.erpDoNumbers?.length ? `ERP DO ${order.erpDoNumbers.join(', ')}` : null },
    { key: 'serviceReport', label: 'Service report', state: 'na' as const, note: null },
  ];
}
