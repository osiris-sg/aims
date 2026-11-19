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
  /**
   * Marked complete (2026-11-19): by a person ("Mark complete" with a reason, auto false) or by
   * scripts/wct-imported-part-billed.ts (auto true: a part-billed order whose last invoice is over 12 months
   * old, "imported, assumed closed"). "Reopen" removes it. Wins over the money-based status.
   */
  completed?: ImportedCompletion | null;
  /**
   * The 2026-11-19 billing rule applies to this order (Part billed below the quotation total). Set per order by
   * Elroy's go: ORD-Q-014154 first, the rest by scripts/wct-imported-part-billed.ts. Without it the 18 Nov rule.
   */
  partBilledRule?: boolean;
}

/** The order uses the 2026-11-19 rule (Part billed). */
export const usesPartBilledRule = (order: { linkedDocuments?: unknown } | null | undefined): boolean => importedMarkerOf(order)?.partBilledRule === true;

export interface ImportedCompletion {
  at: string;
  by: string | null;
  byName: string | null;
  reason: string;
  auto: boolean;
}

export const IMPORTED_AUTO_COMPLETE_REASON = 'Imported, assumed closed';

/** The order's completion mark, or null. */
export function importedCompletionOf(order: { linkedDocuments?: unknown } | null | undefined): ImportedCompletion | null {
  const c: any = importedMarkerOf(order)?.completed;
  return c && typeof c === 'object' && typeof c.at === 'string' ? (c as ImportedCompletion) : null;
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

/** Every ERP link an imported invoice carries (for listing disagreements between sources). */
export function allInvoiceQuoteRefs(config: any, erpLink?: string | null): InvoiceQuoteRef[] {
  const e: any = erpImportOf(config);
  if (!e) return [];
  const out: InvoiceQuoteRef[] = [];
  const push = (k: number | null, source: ImportedLinkSource) => k != null && out.push({ key: k, source });
  if (erpLink) push(erpQuoteKey(erpLink), 'erp_quotation_link');
  if (e.source === 'wct-erp' && e.contractNo) push(erpQuoteKey(e.contractNo), 'contract_no');
  if (e.quotationNo) push(erpQuoteKey(e.quotationNo), 'tracker_quotation_no');
  const items: any[] = Array.isArray(config?.items) ? config.items : [];
  const refs = quotationRefsInText(items.map((it) => (it && typeof it.description === 'string' ? it.description : '')).join('\n'));
  if (refs.length === 1) push(refs[0], 'line_text');
  return out;
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
  /** Quotation total, tax inclusive (grossOf), the billing yardstick. */
  quoteTotal: number | null;
  /** Credit applied per invoice id (only invoices with a credit). */
  credits: Record<string, number>;
}

export interface ImportedPlan {
  orders: PlannedOrder[];
  skipped: Array<{ invoice: string; organizationId: string; why: string; key?: number; otherOrg?: string }>;
  quotesWithoutInvoice: number;
  alreadyOrdered: number;
  /** Invoices whose ERP links name different quotations (the first source in order wins). */
  disagreements: Array<{ invoice: string; organizationId: string; used: InvoiceQuoteRef; others: InvoiceQuoteRef[] }>;
  /** Top-up: existing imported orders that gain invoices or whose status / Billed % / credits change. */
  updates: PlannedUpdate[];
}

/** An imported order already on the database (top-up runs). */
export interface ExistingImportedOrder {
  id: string;
  orderNumber: string;
  organizationId: string;
  status: string;
  sourceQuotationId: string | null;
  linkedDocuments: any;
}

export interface PlannedUpdate {
  order: ExistingImportedOrder;
  quotation: PlanDoc | null;
  /** Invoices newly linked to this order (never removed: an invoice already on the order stays). */
  addInvoices: Array<{ doc: PlanDoc; source: ImportedLinkSource }>;
  addCreditNotes: PlanDoc[];
  oldStatus: string;
  status: ImportedOrderStatus;
  credits: Record<string, number>;
  quoteTotal: number | null;
  erpDoNumbers: string[];
  customerMismatch: string[];
  /** What changed, for the log: 'invoices' | 'status' | 'billed' | 'credits'. */
  changes: string[];
}

/**
 * One order per imported quotation with at least one ERP-linked imported invoice of the same org.
 * Skipped (listed, never linked): a reference to a quotation of another org; to a number no imported
 * quotation has; to a number two quotations share; an invoice the ERP marked Cancelled. A quotation
 * that already has an order (native or imported) is never given another one (idempotent).
 */
export function planImportedOrders(
  docs: PlanDoc[],
  opts: {
    quotationIdsWithOrder?: Set<string>;
    exclude?: Set<string>;
    erpLinks?: Map<string, string>;
    creditsByInvoiceNo?: Map<string, number>;
    /** Imported orders already made (by quotation id): top-up instead of a new order. */
    existingImported?: Map<string, ExistingImportedOrder>;
  } = {},
): ImportedPlan {
  const exclude = opts.exclude ?? new Set<string>();
  const live = docs.filter((d) => !exclude.has(d.organizationId) && erpImportOf(d.config) && d.config?.voided !== true);
  const quotes = live.filter((d) => d.type === 'QUOTATION' && d.name);
  const byKey = new Map<number, PlanDoc[]>();
  for (const q of quotes) {
    const k = erpQuoteKey(q.name);
    if (k != null) byKey.set(k, [...(byKey.get(k) ?? []), q]);
  }
  const skipped: ImportedPlan['skipped'] = [];
  const disagreements: ImportedPlan['disagreements'] = [];
  const perQuote = new Map<string, Array<{ doc: PlanDoc; source: ImportedLinkSource }>>();
  for (const inv of live.filter((d) => d.type === 'INVOICE')) {
    // ERP-pulled links are keyed "<orgId>|<invoice no.>" (WCT ERP invoice numbers).
    const erpLink = opts.erpLinks?.get(`${inv.organizationId}|${inv.name}`) ?? null;
    const ref = invoiceQuoteRef(inv.config, erpLink);
    if (!ref) continue;
    const others = allInvoiceQuoteRefs(inv.config, erpLink).filter((r) => r.key !== ref.key);
    if (others.length) disagreements.push({ invoice: String(inv.name), organizationId: inv.organizationId, used: ref, others });
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
  const creditsFor = (invoices: Array<{ doc: PlanDoc }>) => {
    const credits: Record<string, number> = {};
    for (const i of invoices) {
      const c = creditOfImportedInvoice(i.doc.config, cnByInvoice.get(i.doc.id) ?? [], opts.creditsByInvoiceNo?.get(`${i.doc.organizationId}|${i.doc.name}`));
      if (c > 0) credits[i.doc.id] = c;
    }
    return credits;
  };
  const byDate = (a: { doc: PlanDoc }, b: { doc: PlanDoc }) => String(a.doc.config?.date ?? '').localeCompare(String(b.doc.config?.date ?? '')) || String(a.doc.name).localeCompare(String(b.doc.name));

  // Top-up: existing imported orders gain newly linked invoices; status, Billed % and credits are recomputed.
  const updates: PlannedUpdate[] = [];
  const docById = new Map(docs.map((d) => [d.id, d]));
  const quoteById = new Map(quotes.map((q) => [q.id, q]));
  for (const ex of opts.existingImported?.values() ?? []) {
    if (exclude.has(ex.organizationId)) continue;
    const m: any = importedMarkerOf(ex) || {};
    const ld: any = ex.linkedDocuments || {};
    const curIds: string[] = Array.isArray(ld.invoice) ? ld.invoice.map((x: any) => x?.id).filter(Boolean) : [];
    const cur = curIds.map((id) => docById.get(id)).filter(Boolean).map((doc) => ({ doc: doc as PlanDoc, source: (m.linkSources?.[(doc as PlanDoc).id] ?? 'contract_no') as ImportedLinkSource }));
    const addInvoices = (ex.sourceQuotationId ? perQuote.get(ex.sourceQuotationId) ?? [] : []).filter((i) => !curIds.includes(i.doc.id)).sort(byDate);
    const all = [...cur, ...addInvoices];
    const q = ex.sourceQuotationId ? quoteById.get(ex.sourceQuotationId) ?? null : null;
    const credits = creditsFor(all);
    const quoteTotal = q ? grossOf(q.config) : m.quoteTotal ?? null;
    const st = importedOrderStatus(all.map((i) => ({ ...i.doc, credit: credits[i.doc.id] ?? 0 })), quoteTotal, { completed: importedCompletionOf(ex), partBilledRule: usesPartBilledRule(ex), dos: importedDosOf(ex) });
    const curCn: string[] = Array.isArray(ld.creditNote) ? ld.creditNote.map((x: any) => x?.id) : [];
    const addCreditNotes = all.flatMap((i) => cnByInvoice.get(i.doc.id) ?? []).filter((c) => !curCn.includes(c.id));
    const changes: string[] = [];
    if (addInvoices.length) changes.push('invoices');
    if (st.status !== ex.status) changes.push('status');
    if ((m.billedPct ?? null) !== st.billedPct || (m.billed ?? null) !== st.billed || (m.quoteTotal ?? null) !== quoteTotal) changes.push('billed');
    if (JSON.stringify(sortKeys(m.credits ?? {})) !== JSON.stringify(sortKeys(credits)) || addCreditNotes.length) changes.push('credits');
    if (!changes.length) continue;
    const customerId = (q?.config?.customerId as string) || null;
    updates.push({
      order: ex,
      quotation: q,
      addInvoices,
      addCreditNotes,
      oldStatus: ex.status,
      status: st,
      credits,
      quoteTotal,
      erpDoNumbers: [...new Set([...(Array.isArray(m.erpDoNumbers) ? m.erpDoNumbers : []), ...(all.map((i) => erpDoNumberOf(i.doc.config)).filter(Boolean) as string[])])],
      customerMismatch: q ? all.filter((i) => (i.doc.config?.customerId || null) !== customerId).map((i) => String(i.doc.name)) : Array.isArray(m.customerMismatch) ? m.customerMismatch : [],
      changes,
    });
  }

  const orders: PlannedOrder[] = [];
  let alreadyOrdered = 0;
  for (const q of quotes) {
    const invoices = perQuote.get(q.id);
    if (!invoices?.length) continue;
    if (opts.existingImported?.has(q.id)) continue;
    if (opts.quotationIdsWithOrder?.has(q.id)) {
      alreadyOrdered++;
      continue;
    }
    invoices.sort(byDate);
    const customerId = (q.config?.customerId as string) || null;
    const credits = creditsFor(invoices);
    const quoteTotal = grossOf(q.config);
    const st = importedOrderStatus(invoices.map((i) => ({ ...i.doc, credit: credits[i.doc.id] ?? 0 })), quoteTotal);
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
      quoteTotal,
      credits,
    });
  }
  return { orders, skipped, quotesWithoutInvoice: quotes.length - perQuote.size, alreadyOrdered, disagreements, updates };
}

const sortKeys = (o: Record<string, number>) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));

// ── Status ──────────────────────────────────────────────────────────────────
//
// Money basis: TAX INCLUSIVE (grossOf: totalWithTax, then nettTotal / xeroGross) for the
// quotation and every invoice. Cent tolerance: 0.005.
//
// Per invoice (voided ones are left out):
//   gross 0                                  NO_CHARGE  ("No charge"; never counts as billing)
//   credit >= gross                          CREDITED   (fully credited; bills nothing, owes nothing)
//   owes nothing (document-money owedOf)     PAID       (a partial credit is shown beside it)
//   owes part of it                          PART_PAID
//   owes all of it                           UNPAID
// An invoice BILLS gross minus its credit ("net"); NO_CHARGE and CREDITED invoices bill 0.
//
// Per order (Elroy 2026-11-18): no full-billing check.
//   every linked invoice owes nothing (paid, credited or $0)   PAID      "Paid"
//   ...except nothing invoiced ($0) against a quotation total  INVOICED  "Invoiced" (Billed 0%)
//   otherwise                                                  INVOICED  "Invoiced" / "Invoiced, part paid"
// Billed % = billed (sum of net) / quotation total x 100, 1 decimal; blank when the quotation has
// no total (or 0). Shown beside the status, it never changes it.
// Credit notes: never subtracted from the balance again (the imported balance already has it);
// a credit only lowers what the invoice bills. Sources, first found: the invoice's tracker credit
// notes (erpImport.creditNotes), its imported CREDIT_NOTE documents, the WCT ERP credit-note export
// by invoice no. (stored on the order by the script, since WCT invoices carry no amount).

export type ImportedInvoiceState = 'NO_CHARGE' | 'CREDITED' | 'PAID' | 'PART_PAID' | 'UNPAID';
export const IMPORTED_INVOICE_STATE_LABEL: Record<ImportedInvoiceState, string> = {
  NO_CHARGE: 'No charge',
  CREDITED: 'Credited',
  PAID: 'Paid',
  PART_PAID: 'Part paid',
  UNPAID: 'Unpaid',
};
/**
 * 2026-11-19 (Elroy): PART_BILLED = billed below the quotation total (not for a $0 quotation); INVOICED = billed in
 * full, something unpaid; PAID = billed in full and every invoice settled; COMPLETED = marked complete (by a
 * person, or assumed closed by age).
 */
export type ImportedOrderStatusCode = 'INVOICED' | 'PAID' | 'PART_BILLED' | 'COMPLETED' | 'DO_DRAFT' | 'DO_COMPLETED';

const EPS = 0.005;
const R2 = (n: number) => Math.round(n * 100) / 100;

/** Credit applied to an imported invoice: tracker credit notes, else its CN documents, else the ERP export amount. */
export function creditOfImportedInvoice(config: any, creditNoteDocs: Array<{ config: any }> = [], exportAmount?: number | null): number {
  const list: any[] = Array.isArray(erpImportOf(config)?.creditNotes) ? (erpImportOf(config) as any).creditNotes : [];
  const fromTracker = list.reduce((t, c) => t + (Number(c?.amount) || 0), 0);
  if (fromTracker > 0) return R2(fromTracker);
  const fromDocs = creditNoteDocs.reduce((t, d) => t + (grossOf(d.config) ?? 0), 0);
  if (fromDocs > 0) return R2(fromDocs);
  return exportAmount && exportAmount > 0 ? R2(exportAmount) : 0;
}

export interface ImportedInvoiceMoney {
  state: ImportedInvoiceState;
  gross: number;
  credit: number;
  net: number;
  owed: number;
}

export function importedInvoiceMoney(doc: { config: any }, credit = 0): ImportedInvoiceMoney {
  const gross = R2(grossOf(doc.config) ?? 0);
  const c = R2(Math.min(Math.max(0, credit || 0), gross));
  const net = R2(Math.max(0, gross - c));
  const owed = R2(owedOf(doc.config));
  let state: ImportedInvoiceState;
  if (gross < EPS) state = 'NO_CHARGE';
  else if (c >= gross - EPS) state = 'CREDITED';
  else if (owed < EPS) state = 'PAID';
  else if (owed < net - EPS || (amountPaidOf(doc.config) ?? 0) > EPS) state = 'PART_PAID';
  else state = 'UNPAID';
  return { state, gross, credit: c, net, owed: state === 'CREDITED' || state === 'NO_CHARGE' ? 0 : owed };
}

export interface ImportedOrderStatus {
  status: ImportedOrderStatusCode;
  label: string;
  /** Some money received on an invoice not settled yet. */
  partPaid: boolean;
  /** Invoiced (gross, tax inclusive) across the live invoices. */
  total: number;
  /** Billed: gross minus credits; $0 / fully credited invoices bill nothing. */
  billed: number;
  quoteTotal: number | null;
  /** billed / quotation total x 100 (1 decimal), null without a quotation total. */
  billedPct: number | null;
  owed: number;
  credited: number;
}

export function billedPercent(billed: number, quoteTotal: number | null | undefined): number | null {
  const qt = quoteTotal == null ? NaN : Number(quoteTotal);
  if (!Number.isFinite(qt) || qt < EPS) return null;
  return Math.round((billed / qt) * 1000) / 10;
}

/** An invoice that counts on the order: not voided, not a draft (a new AIMS invoice counts once confirmed). */
export const isCountedInvoice = (d: { status?: string; config?: any }) => d?.config?.voided !== true && !['void', 'unconfirmed', 'draft'].includes(String(d?.status ?? ''));

export function importedOrderStatus(
  invoices: Array<{ status?: string; config: any; credit?: number }>,
  quoteTotal: number | null | undefined,
  opts: { completed?: ImportedCompletion | null; partBilledRule?: boolean; dos?: Array<{ erpStatus?: string | null }> } = {},
): ImportedOrderStatus {
  const live = invoices.filter(isCountedInvoice);
  const money = live.map((d) => importedInvoiceMoney(d, d.credit ?? 0));
  const billing = money.filter((m) => m.net >= EPS);
  const billed = R2(billing.reduce((t, m) => t + m.net, 0));
  const qt = quoteTotal == null || !Number.isFinite(Number(quoteTotal)) ? null : R2(Number(quoteTotal));
  const settled = money.every((m) => m.owed < EPS);
  const partPaid = !settled && billing.some((m) => m.owed < m.net - EPS);
  const base = {
    partPaid,
    total: R2(money.reduce((t, m) => t + m.gross, 0)),
    billed,
    quoteTotal: qt,
    billedPct: billedPercent(billed, qt),
    owed: R2(money.reduce((t, m) => t + m.owed, 0)),
    credited: R2(money.reduce((t, m) => t + m.credit, 0)),
  };
  if (opts.completed) return { status: 'COMPLETED', label: 'Complete', ...base };
  // Imported from an ERP DO before any invoice (2026-11-19): the DO's state, Billed 0%.
  if (!live.length && opts.dos?.length) {
    const done = opts.dos.every((d) => /sign|complet|deliver/i.test(String(d.erpStatus ?? '')));
    return done ? { status: 'DO_COMPLETED', label: 'DO completed, invoice pending', ...base } : { status: 'DO_DRAFT', label: 'DO draft', ...base };
  }
  if (!opts.partBilledRule) {
    // The 18 Nov rule (orders without the 2026-11-19 mark): Paid = every invoice settled; $0 invoiced against a real
    // quotation total is not Paid (a $0 quotation with $0 invoiced stays Paid).
    const nothingInvoiced = base.total < EPS && qt != null && qt >= EPS;
    return settled && !nothingInvoiced ? { status: 'PAID', label: 'Paid', ...base } : { status: 'INVOICED', label: partPaid ? 'Invoiced, part paid' : 'Invoiced', ...base };
  }
  // Elroy 2026-11-19: billed below the quotation total = Part billed ($0 and fully credited invoices bill nothing;
  // a $0 quotation is never part billed). Over-billed counts as billed in full.
  if (qt != null && qt >= EPS && billed < qt - EPS) return { status: 'PART_BILLED', label: 'Part billed', ...base };
  return settled ? { status: 'PAID', label: 'Paid', ...base } : { status: 'INVOICED', label: partPaid ? 'Invoiced, part paid' : 'Invoiced', ...base };
}

export const IMPORTED_STATUS_LABEL = (s: Pick<ImportedOrderStatus, 'label'>): string => s.label;

/**
 * The order page's tracker for an imported order: Quotation and Invoice done,
 * DO and Service report not applicable (the old ERP's DO numbers shown as text).
 */
export function importedTracker(order: { erpDoNumbers?: string[]; dos?: Array<{ name?: string | null; erpStatus?: string | null }> }, st: Pick<ImportedOrderStatus, 'label'> & { status?: string }) {
  // 2026-11-19: ERP DOs imported and linked: the DO step shows them; an order made from a DO has no invoice yet.
  const dos = (order.dos ?? []).filter((d) => d && d.name);
  const noInvoice = st.status === 'DO_DRAFT' || st.status === 'DO_COMPLETED';
  return [
    { key: 'quotation', label: 'Quotation', state: 'done' as const },
    { key: 'invoice', label: 'Invoice', state: noInvoice ? ('todo' as const) : ('done' as const), note: noInvoice ? 'Invoice pending' : IMPORTED_STATUS_LABEL(st) },
    dos.length
      ? { key: 'do', label: 'DO', state: 'done' as const, note: dos.map((d) => `${d.name}${d.erpStatus ? ` (${d.erpStatus})` : ''}`).join(', ') }
      : { key: 'do', label: 'DO', state: 'na' as const, note: order.erpDoNumbers?.length ? `ERP DO ${order.erpDoNumbers.join(', ')}` : null },
    { key: 'serviceReport', label: 'Service report', state: 'na' as const, note: null },
  ];
}

/**
 * Re-read an imported order's invoices (and its quotation total) and store its status (2026-11-19). Used after
 * anything that can change it: a payment or a confirm on an AIMS invoice made for the order (refreshOrderStatus
 * routes imported orders here), Mark complete / Reopen. Returns the status, or null when not an imported order.
 */
export async function refreshImportedOrderStatus(prisma: any, organizationId: string, orderId: string): Promise<ImportedOrderStatus | null> {
  const order = await prisma.order.findFirst({ where: { id: orderId, organizationId }, select: { id: true, status: true, linkedDocuments: true, sourceQuotationId: true } });
  if (!order || !isImportedOrder(order)) return null;
  const m: any = importedMarkerOf(order) || {};
  const refs: any[] = Array.isArray((order.linkedDocuments as any)?.invoice) ? (order.linkedDocuments as any).invoice.filter((x: any) => x && typeof x.id === 'string') : [];
  const docs: any[] = refs.length ? await prisma.document.findMany({ where: { organizationId, id: { in: refs.map((r) => r.id) } }, select: { id: true, status: true, config: true } }) : [];
  let quoteTotal: number | null = m.quoteTotal != null && Number.isFinite(Number(m.quoteTotal)) ? Number(m.quoteTotal) : null;
  if (quoteTotal == null && order.sourceQuotationId) {
    const q = await prisma.document.findFirst({ where: { id: order.sourceQuotationId, organizationId }, select: { config: true } });
    quoteTotal = q ? grossOf(q.config) : null;
  }
  const st = importedOrderStatus(
    docs.map((d) => ({ ...d, credit: Number(m.credits?.[d.id]) || creditOfImportedInvoice(d.config) })),
    quoteTotal,
    { completed: importedCompletionOf(order), partBilledRule: usesPartBilledRule(order), dos: importedDosOf(order) },
  );
  if (st.status !== order.status) await prisma.order.update({ where: { id: order.id }, data: { status: st.status } });
  return st;
}

/** The order's ERP DOs (linkedDocuments.do, imported) for the status: their ERP state. */
export const importedDosOf = (order: { linkedDocuments?: unknown } | null | undefined): Array<{ erpStatus?: string | null }> => {
  const list = (order?.linkedDocuments as any)?.do;
  return Array.isArray(list) ? list.filter((d: any) => d && d.imported === true) : [];
};
