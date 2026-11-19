/**
 * Orders list "+" (round 38, WCT group, enableWctOrders orgs, 2026-11-20): an EMPTY Quotation / DO(s) / Invoice cell
 * shows a small "+" when the order page would offer the same step. The rules are the order page's own
 * (portal helpers/orderPage.ts: nativeCreateInvoice, the "Add DO" action, the imported model), read from what the
 * list already loads; the portal adds the person's permissions on top. Pure, tested in order-list-add.spec.ts.
 */

export interface ListAdd {
  /** "+" Quotation: a new quotation prefilled with the order's customer / site, linked to the order on save. */
  quotation: boolean;
  /** "+" DO: the order page's "Add DO" (a draft DO on the order), then the DO editor. */
  do: boolean;
  /** "+" Invoice: the order page's "Create invoice" (its own dialog, the org's next INV number). */
  invoice: boolean;
}

export const NO_LIST_ADD: ListAdd = { quotation: false, do: false, invoice: false };

export interface NativeListAddInput {
  cancelled: boolean;
  /** The order's own quotation, or a quotation linked to it. */
  hasQuotation: boolean;
  /** DOs in the row's DO(s) cell (made on the order, on its jobs, or linked to it; not cancelled). */
  doCount: number;
  /** Invoices in the row's Invoice cell (drafts too). */
  invoiceCount: number;
  /** Verified jobs with no invoice yet (the page's toInvoice). */
  toInvoiceJobs: number;
  /** Completed DOs with no job and no invoice yet (the page's toInvoiceDos). */
  toInvoiceDos: number;
}

/**
 * An AIMS order. Quotation: none on the order. DO: manual flow ("Add DO" is a manual flow step). Invoice: the org
 * invoices per order and Create invoice would make one now: in the manual flow an order with no invoice always can
 * (from the quotation, or the completed DOs); otherwise only with a verified job or a completed DO waiting for it
 * (the "what is left" invoice needs a first invoice, so it never applies to an empty cell).
 */
export function nativeListAdd(o: NativeListAddInput, ctx: { manualFlow: boolean; invoicing: boolean }): ListAdd {
  if (o.cancelled) return NO_LIST_ADD;
  return {
    quotation: !o.hasQuotation,
    do: ctx.manualFlow && o.doCount === 0,
    invoice: ctx.invoicing && o.invoiceCount === 0 && (ctx.manualFlow || o.toInvoiceJobs > 0 || o.toInvoiceDos > 0),
  };
}

/**
 * An imported (old ERP) order. Its quotation came with it, so never "+" Quotation. DO: the page's "Add DO" (manual
 * flow). Invoice: the page's Create invoice (canInvoice: it has its quotation and no AIMS draft; an empty cell has
 * no invoice at all, so no draft either).
 */
export function importedListAdd(o: { hasQuotation: boolean; doCount: number; invoiceCount: number }, ctx: { manualFlow: boolean }): ListAdd {
  return {
    quotation: false,
    do: ctx.manualFlow && o.doCount === 0,
    invoice: o.invoiceCount === 0 && o.hasQuotation,
  };
}

/** The DO numbers an imported order's DO(s) cell lists: the ERP DO numbers its invoices named, its linked DOs, its AIMS DOs. */
export function importedDoNumbers(erpDoNumbers: unknown, linkedDos: unknown, aimsDoNames: Array<string | null | undefined>): string[] {
  const out: string[] = [];
  const add = (v: unknown) => {
    const s = typeof v === 'string' ? v.trim() : '';
    if (s && !out.includes(s)) out.push(s);
  };
  if (Array.isArray(erpDoNumbers)) erpDoNumbers.forEach(add);
  if (Array.isArray(linkedDos)) linkedDos.forEach((d: any) => d && typeof d === 'object' && add(d.name));
  aimsDoNames.forEach(add);
  return out;
}

/**
 * "+" Quotation: a pending link on the new quotation's config (server-owned, the editor never sends it). The first
 * save of the quotation links it to the order (Order.sourceQuotationId), then the key is dropped.
 */
export const PENDING_ORDER_LINK_KEY = 'linkToOrderOnSave';

export function pendingOrderLinkOf(config: unknown): string | null {
  const v = (config as any)?.[PENDING_ORDER_LINK_KEY];
  const id = v && typeof v === 'object' ? v.orderId : null;
  return typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id) ? id : null;
}
