// WCT orders (2026-11-01, flag enableWctOrders). Pure helpers for the Orders
// list, the order page and its "Add job" prefill; tested by
// helpers/wctOrders.test.mjs. Statuses mirror
// api-server-production/src/orders/wct-orders.ts (deriveOrderStatus).

export type WctOrderStatus = "OPEN" | "SCHEDULED" | "IN_PROGRESS" | "AWAITING_VERIFICATION" | "COMPLETED" | "INVOICED" | "PAID" | "CLOSED";

export const ORDER_STATUS_LABEL: Record<WctOrderStatus, string> = {
  OPEN: "Open",
  SCHEDULED: "Scheduled",
  IN_PROGRESS: "In progress",
  AWAITING_VERIFICATION: "Awaiting verification",
  COMPLETED: "Completed",
  INVOICED: "Invoiced",
  PAID: "Paid",
  CLOSED: "Closed",
};

export const ORDER_STATUS_COLOR: Record<WctOrderStatus, "default" | "info" | "warning" | "success"> = {
  OPEN: "default",
  SCHEDULED: "info",
  IN_PROGRESS: "warning",
  AWAITING_VERIFICATION: "warning",
  COMPLETED: "success",
  INVOICED: "info",
  PAID: "success",
  CLOSED: "default",
};

export const orderStatusLabel = (s: string | null | undefined) => ORDER_STATUS_LABEL[s as WctOrderStatus] ?? (s || "—");
export const orderStatusColor = (s: string | null | undefined) => ORDER_STATUS_COLOR[s as WctOrderStatus] ?? "default";

export type OrderTab = "all" | "open" | "active" | "completed" | "billing";
export const ORDER_TABS: { key: OrderTab; label: string }[] = [
  { key: "all", label: "All" },
  { key: "open", label: "Open" },
  { key: "active", label: "Scheduled / in progress" },
  { key: "completed", label: "Completed" },
  { key: "billing", label: "Invoiced / paid" },
];

export function orderMatchesTab(o: { status?: string | null }, tab: OrderTab): boolean {
  if (tab === "open") return o.status === "OPEN";
  if (tab === "active") return o.status === "SCHEDULED" || o.status === "IN_PROGRESS" || o.status === "AWAITING_VERIFICATION";
  if (tab === "completed") return o.status === "COMPLETED";
  if (tab === "billing") return o.status === "INVOICED" || o.status === "PAID" || o.status === "CLOSED";
  return true;
}

/** Search over order no., customer, quotation no. */
export function orderMatchesSearch(
  o: { orderNumber?: string | null; customer?: { name?: string | null; customerCode?: string | null } | null; sourceQuotation?: { name?: string | null } | null },
  term: string,
): boolean {
  const t = term.trim().toLowerCase();
  if (!t) return true;
  return [o.orderNumber, o.customer?.name, o.customer?.customerCode, o.sourceQuotation?.name].filter(Boolean).join(" ").toLowerCase().includes(t);
}

const RUN_STATUS_LABEL: Record<string, string> = {
  scheduled: "Scheduled",
  in_progress: "In progress",
  delivered: "Delivered",
  completed: "Completed",
  cancelled: "Cancelled",
};

/** A job's state on the order page; a draft (not scheduled yet) reads "Draft", a finish still to be checked reads its check. */
export function jobStatusLabel(j: { status: string; isDraft?: boolean | null; verificationState?: string | null }): string {
  if (j.isDraft && j.status === "scheduled") return "Draft";
  if (j.status === "completed" && j.verificationState === "pending") return "Awaiting verification";
  if (j.status === "completed" && j.verificationState === "rejected") return "Rejected";
  return RUN_STATUS_LABEL[j.status] ?? j.status;
}

export function jobStatusColor(j: { status: string; isDraft?: boolean | null; verificationState?: string | null }): "default" | "info" | "warning" | "success" | "error" {
  if (j.isDraft && j.status === "scheduled") return "default";
  if (j.status === "completed" && j.verificationState === "rejected") return "error";
  if (j.status === "completed" && j.verificationState === "pending") return "warning";
  if (j.status === "completed") return "success";
  if (j.status === "in_progress" || j.status === "delivered") return "warning";
  if (j.status === "cancelled") return "default";
  return "info";
}

/** "3 jobs · 1 done" (drafts and cancelled named when present). */
export function jobCountsLine(c: { total: number; drafts: number; completed: number; cancelled: number; awaitingVerification?: number } | null | undefined): string {
  if (!c || (!c.total && !c.cancelled)) return "No jobs";
  const parts = [`${c.total} job${c.total === 1 ? "" : "s"}`];
  if (c.completed) parts.push(`${c.completed} done`);
  if (c.awaitingVerification) parts.push(`${c.awaitingVerification} to verify`);
  if (c.drafts) parts.push(`${c.drafts} draft`);
  if (c.cancelled) parts.push(`${c.cancelled} cancelled`);
  return parts.join(" · ");
}

/** Singapore date + time, e.g. "Tue 03 Nov, 10:00"; an all-day job (2026-11-10) is the date only, "Tue 03 Nov". */
export function fmtJobWhen(iso: string | null | undefined, allDay?: boolean): string {
  if (!iso) return "No date";
  return new Date(iso).toLocaleString("en-GB", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    ...(allDay ? {} : { hour: "2-digit", minute: "2-digit" }),
    timeZone: "Asia/Singapore",
  });
}

export interface PrefillLine {
  asset: { id: string; name: string; skuKey: string | null } | null;
  description: string;
  quantity: number;
  assetClass: string | null;
}

/** What "Add job" hands the schedule dialog. */
export interface AddJobPrefill {
  orderId: string;
  orderNumber: string;
  customer: { id: string; name: string; customerCode: string | null; address: string | null } | null;
  siteAddress: string | null;
  lines: PrefillLine[];
}

export function addJobPrefill(order: {
  id: string;
  orderNumber: string;
  customer?: { id: string; name: string; customerCode?: string | null; address?: string | null } | null;
  prefill?: { siteAddress?: string | null; lines?: PrefillLine[] } | null;
}): AddJobPrefill {
  return {
    orderId: order.id,
    orderNumber: order.orderNumber,
    customer: order.customer ? { id: order.customer.id, name: order.customer.name, customerCode: order.customer.customerCode ?? null, address: order.customer.address ?? null } : null,
    siteAddress: order.prefill?.siteAddress ?? null,
    lines: (order.prefill?.lines ?? []).filter((l) => l && (l.asset || (l.description || "").trim())),
  };
}

/**
 * "Invoice now" confirmation: what gets billed now and what happens to the rest.
 * The quotation is billed once per order (on its first invoice); a later
 * invoice bills only the lines added to its jobs on top of the quotation.
 */
export function invoiceNowText(toInvoice: number[], openJobs: number, quoteBilled = false): string {
  const many = toInvoice.length !== 1;
  const jobs = toInvoice.map((n) => `#${n}`).join(", ");
  if (quoteBilled) {
    return `Invoice the verified job${many ? "s" : ""} ${jobs} now? The quotation is already billed on this order, so only lines added to ${many ? "these jobs" : "this job"} on top of the quotation are invoiced. If there are none, no invoice is made and ${many ? "the jobs are" : "the job is"} marked as covered.`;
  }
  const rest =
    openJobs > 0
      ? ` The ${openJobs} job${openJobs === 1 ? "" : "s"} not done or not verified yet ${openJobs === 1 ? "is" : "are"} covered by this invoice. Lines added to ${openJobs === 1 ? "it" : "them"} on top of the quotation go on a second invoice once verified.`
      : "";
  return `Create the invoice now for the verified job${many ? "s" : ""} ${jobs}? It bills the quotation once, plus any lines added to ${many ? "these jobs" : "this job"} on top of it.${rest}`;
}

/** WCT service report on the order (Phase 5): an uploaded file or a linked AIMS service report. */
export interface OrderAttachment {
  id: string;
  kind: "file" | "report";
  label?: string | null;
  fileKey?: string;
  fileName?: string;
  mimeType?: string;
  reportId?: string;
  reportNumber?: number | null;
  report?: { id: string; reportNumber: number | null; status: string } | null;
  addedAt?: string;
  addedByName?: string | null;
}

export interface ReportOption {
  id: string;
  reportNumber: number | null;
  status: string;
  jobNumber: number | null;
  technicianName: string | null;
  ofThisOrder: boolean;
}

/** One line of the order's Service report list. */
export function attachmentLine(a: OrderAttachment): { title: string; detail: string } {
  const when = a.addedAt ? new Date(a.addedAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Singapore" }) : "";
  // "linked by Elroy Lee · 01 Nov 2026"; without a name, "linked 01 Nov 2026".
  const by = (verb: string) => (a.addedByName ? [`${verb} by ${a.addedByName}`, when].filter(Boolean).join(" · ") : when ? `${verb} ${when}` : "");
  if (a.kind === "report") {
    const n = a.report?.reportNumber ?? a.reportNumber;
    const st = a.report ? (a.report.status === "completed" ? "Completed" : "Draft") : "Report not found";
    return { title: `Service report ${n ? `#${n}` : "(draft)"}`, detail: [st, by("linked")].filter(Boolean).join(" · ") };
  }
  return { title: a.fileName || "File", detail: [a.label || "Uploaded file", by("added")].filter(Boolean).join(" · ") };
}

/**
 * The editor's order line on a WCT order document (a job's DO or an order
 * invoice), shown under the document number: "Order ORD202611-001 · Quotation
 * QO202611-0016" on a DO, "Order ORD202611-001 · DO202611008, DO202611009" on
 * an invoice. Empty for every document without an order.
 */
export function orderDocLine(doc: { orderNo?: string | null; quotationNo?: string | null; sourceDocumentNumber?: string | null; deliveryOrderNos?: string[] | null } | null | undefined, documentType: string): string {
  const orderNo = String(doc?.orderNo ?? "").trim();
  if (!orderNo) return "";
  const t = String(documentType || "").toUpperCase();
  if (t === "INVOICE" || t === "TI") {
    const dos = (Array.isArray(doc?.deliveryOrderNos) ? doc!.deliveryOrderNos : []).filter(Boolean).join(", ");
    return dos ? `Order ${orderNo} · ${dos}` : `Order ${orderNo}`;
  }
  const qo = String(doc?.quotationNo || doc?.sourceDocumentNumber || "").trim();
  return qo ? `Order ${orderNo} · Quotation ${qo}` : `Order ${orderNo}`;
}
