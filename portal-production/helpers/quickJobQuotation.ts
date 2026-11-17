// WCT jobs calendar "New job" with a Quotation (2026-11-17, same gate as the calendar add: enableWctOrders +
// enableJobsCalendar). Pure helpers, tested by helpers/quickJobQuotation.test.mjs. The server side is
// api-server-production/src/deliveries/quick-job-quotation.ts.

/** A row of the Quotation list (GET /deliveries/quick-job/quotations). */
export interface QuotationOption {
  id: string;
  name: string | null;
  customerId: string | null;
  customerName: string | null;
  subject: string | null;
  site: string | null;
  status: string;
  statusLabel: string;
  orderId: string | null;
  orderNumber: string | null;
}

/** A picked quotation (GET /deliveries/quick-job/quotations/:id): autofill data, its order and open DOs. */
export interface QuotationDetail extends QuotationOption {
  customer: { id: string; name: string; address?: string | null; [k: string]: unknown } | null;
  /** The quotation's job location, else the customer's default address. */
  siteOrAddress: string | null;
  openDos: { id: string; name: string | null; date: string | null }[];
  cancelled?: boolean;
}

/** The list request: newest first on the server, narrowed to the picked customer. */
export function quotationSearchPath(term: string, customerId: string | null | undefined, limit = 20): string {
  const p = new URLSearchParams();
  const q = term.trim();
  if (q) p.set("q", q);
  if (customerId) p.set("customerId", customerId);
  p.set("limit", String(limit));
  return `/deliveries/quick-job/quotations?${p.toString()}`;
}

/** What the box shows for a picked quotation. */
export const quotationLabel = (o: Pick<QuotationOption, "name" | "id"> | null | undefined): string => (o ? o.name || o.id : "");

/** A list row: QO number and status on the first line, customer and Subject on the second. */
export function quotationRow(o: QuotationOption): { title: string; status: string; detail: string } {
  return { title: o.name || o.id, status: o.statusLabel, detail: [o.customerName, o.subject].filter(Boolean).join(" · ") };
}

export interface QuotationFillTarget {
  customerId: string | null;
  siteAddress: string;
  remarks: string;
}

/**
 * Picking a quotation: its customer, its Site (job location, else the customer's address) and, only when Remarks
 * is empty, its Subject as Remarks. Anything the quotation does not have keeps what is typed. All stay editable.
 */
export function applyQuotationPick<T extends QuotationFillTarget>(form: T, q: QuotationDetail): T {
  const customerId = q.customer?.id ?? q.customerId ?? form.customerId;
  const site = (q.siteOrAddress ?? "").trim();
  const subject = (q.subject ?? "").trim();
  return {
    ...form,
    customerId,
    siteAddress: site || form.siteAddress,
    remarks: form.remarks.trim() ? form.remarks : subject || form.remarks,
  };
}

/** Does the form need a DO pick: the quotation's order has more than one open DO. */
export const needsDoPick = (q: QuotationDetail | null | undefined): boolean => !!q?.orderId && (q.openDos?.length ?? 0) > 1;

/** The "DO" select's options: number and date. */
export const doOptionLabel = (d: { name: string | null; id: string; date: string | null }): string => [d.name || d.id, d.date].filter(Boolean).join(" · ");

/** The toast after saving: where the job went. */
export function linkedToast(r: { orderNumber?: string | null; doName?: string | null } | null | undefined, quotationName: string | null | undefined): string {
  if (r?.orderNumber) return r.doName ? `Job added to ${r.orderNumber}, ${r.doName}` : `Job added to ${r.orderNumber}`;
  if (quotationName) return `Job added. It moves onto the order when ${quotationName} is signed`;
  return "Job added";
}
