/**
 * One order page for AIMS and imported orders (WCT group, round 24, 2026-11-19): the money summary of an AIMS
 * (native) WCT order, read the same way as an imported order's (imported-orders.ts / imported-remaining.ts) so
 * both pages show Quotation total, Billed, Billed %, Billed qty, Left to bill and Owed alike.
 *
 * Display only: pure, never stored, never used for the order's status or its invoicing.
 * Billed = the order's counted invoices (not draft, not voided) with their GST; a $0 invoice bills nothing.
 * Owed = what those invoices still owe (document-money owedOf). Left to bill = the quotation's lines minus what
 * the counted invoices billed (one "Balance of quotation" line when the lines cannot be matched).
 */

import { grossOf } from '../common/document-money';
import { IMPORTED_INVOICE_STATE_LABEL, billedPercent, importedInvoiceMoney, isCountedInvoice } from './imported-orders';
import { billingSteps, importedInvoicePrefill, invoiceRefOf, remainingToBill, type QuoteLine, type RemainingLine } from './imported-remaining';

export interface OrderPageSummary {
  quoteTotal: number | null;
  billed: number;
  billedPct: number | null;
  owed: number;
  /** "1 of 2 Paid · 2 of 2 Draft" (one priced quotation line), else empty. */
  billingSteps: Array<{ label: string; state: string }>;
  progress: { billed: number; quoted: number } | null;
  remaining: { matched: boolean; remainingNet: number; remainingGross: number; lines: RemainingLine[] };
}

const R2 = (n: number) => Math.round(n * 100) / 100;

/** A native order invoice as one Documents row reads it: its money (owed only once it counts), its date. */
export function nativeInvoiceMoney(d: { status?: string; config?: any; createdAt?: Date | string | null }): { gross: number; owed: number | null; date: string | null } {
  const c: any = d.config || {};
  const m = importedInvoiceMoney({ config: c }, 0);
  const date = c.date ?? c.documentInfo?.date ?? c.invoiceDate ?? null;
  return { gross: m.gross, owed: isCountedInvoice(d) ? m.owed : null, date: typeof date === 'string' && date ? date : d.createdAt ? new Date(d.createdAt).toISOString() : null };
}

export function nativeOrderSummary(args: {
  quotation: { name?: string | null; config?: any } | null;
  invoices: Array<{ id: string; status?: string; config?: any; createdAt?: Date | string | null }>;
  /** Round 29: quotations linked to the order (Link existing document) add their total and lines, as on an imported order. */
  linkedQuotations?: Array<{ name?: string | null; config?: any }>;
  /** Round 36: credit notes on each invoice (gross, confirmed, not voided): a credited invoice bills only what is left. */
  credits?: Map<string, number>;
}): OrderPageSummary {
  const qc: any = args.quotation?.config || {};
  const extra = (args.linkedQuotations ?? []).filter((x) => x && x.config);
  const quoteItems = [...(Array.isArray(qc.items) ? qc.items : []), ...extra.flatMap((x) => (Array.isArray(x.config?.items) ? x.config.items : []))];
  const totals = [...(args.quotation ? [grossOf(qc)] : []), ...extra.map((x) => grossOf(x.config))].filter((v): v is number => v != null && Number.isFinite(Number(v)));
  const quoteTotal = totals.length ? R2(totals.reduce((t, v) => t + Number(v), 0)) : null;
  const counted = args.invoices.filter((d) => isCountedInvoice({ status: d.status, config: d.config }));
  const money = counted.map((d) => ({ d, m: importedInvoiceMoney({ config: d.config || {} }, args.credits?.get(d.id) ?? 0) }));
  const billing = money.filter((x) => x.m.net >= 0.005);
  const billed = R2(billing.reduce((t, x) => t + x.m.net, 0));
  const owed = R2(money.reduce((t, x) => t + x.m.owed, 0));
  const plan = remainingToBill({
    quoteItems,
    billedInvoiceItems: billing.map((x) => (Array.isArray(x.d.config?.items) ? x.d.config.items : [])),
    quoteTotal: quoteTotal ?? 0,
    billed,
    gstPercent: Number(qc.gstPercent) || 0,
    quotationNo: [args.quotation?.name, ...extra.map((x) => x.name)].filter(Boolean).join(', ') || null,
    subject: qc.subject ?? null,
    billedInvoices: billing.map((x) => invoiceRefOf(x.d as any, x.m.net)),
  });
  // Counted invoices by date first, then drafts (as an imported order's "1 of 2 Paid · 2 of 2 Draft").
  const stateOf = (d: { id?: string; status?: string; config?: any }) => (isCountedInvoice(d) ? IMPORTED_INVOICE_STATE_LABEL[importedInvoiceMoney({ config: d.config || {} }, (d.id && args.credits?.get(d.id)) || 0).state] : 'Draft');
  const live = args.invoices.filter((d) => d.config?.voided !== true && String(d.status ?? '') !== 'void');
  const ordered = [...live].sort((a, b) => (isCountedInvoice(a) ? 0 : 1) - (isCountedInvoice(b) ? 0 : 1) || String(a.config?.date ?? '').localeCompare(String(b.config?.date ?? '')));
  return {
    quoteTotal,
    billed,
    billedPct: billedPercent(billed, quoteTotal),
    owed,
    billingSteps: billingSteps(quoteItems, ordered.map((d) => ({ items: Array.isArray(d.config?.items) ? d.config.items : [], state: stateOf(d) }))),
    progress: plan.progress,
    remaining: { matched: plan.matched, remainingNet: plan.remainingNet, remainingGross: plan.remainingGross, lines: plan.lines },
  };
}

/**
 * Round 36 (WCT group, 2026-11-19): "Create invoice" on an AIMS order stays available until the order is billed in
 * full. While the order's counted invoices (not draft, not voided; a credited invoice counts only for what the credit
 * notes leave) bill less than the quotation total, the order offers Create invoice for what is left: the remaining
 * lines prefilled (imported-remaining.ts, the same reading as an imported order), editable in the dialog.
 * Only once the order has an invoice (before that the order's first invoice is made the usual way: Invoice now / from
 * the quotation), never with a draft invoice open on it (that one opens instead), never on a cancelled order.
 */
export function nativeRemainderOf(args: {
  invoicing: boolean;
  cancelled: boolean;
  hasQuotation: boolean;
  invoices: Array<{ id: string; name?: string | null; status?: string; config?: any; documentTemplateId?: string | null }>;
  summary: Pick<OrderPageSummary, 'quoteTotal' | 'remaining'>;
  quoteItems: QuoteLine[];
}): { canInvoiceRemaining: boolean; invoiceLines: RemainingLine[]; draftInvoice: { id: string; name: string | null; templateId: string | null } | null } {
  const draft = args.invoices.find((d) => !isCountedInvoice(d) && d.config?.voided !== true && d.config?.cancelledWithOrder !== true) ?? null;
  const can =
    args.invoicing &&
    !args.cancelled &&
    args.hasQuotation &&
    !draft &&
    args.invoices.length > 0 &&
    args.summary.quoteTotal != null &&
    args.summary.remaining.remainingGross > 0.005;
  return {
    canInvoiceRemaining: can,
    invoiceLines: can ? importedInvoicePrefill(args.summary.remaining, args.quoteItems) : [],
    draftInvoice: draft ? { id: draft.id, name: draft.name ?? null, templateId: draft.documentTemplateId ?? null } : null,
  };
}
