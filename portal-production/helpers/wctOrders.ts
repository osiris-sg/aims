// WCT orders (2026-11-01, flag enableWctOrders). Pure helpers for the Orders
// list, the order page and its "Add job" prefill; tested by
// helpers/wctOrders.test.mjs. Statuses mirror
// api-server-production/src/orders/wct-orders.ts (deriveOrderStatus).

export type WctOrderStatus = "OPEN" | "SCHEDULED" | "IN_PROGRESS" | "AWAITING_VERIFICATION" | "COMPLETED";

export const ORDER_STATUS_LABEL: Record<WctOrderStatus, string> = {
  OPEN: "Open",
  SCHEDULED: "Scheduled",
  IN_PROGRESS: "In progress",
  AWAITING_VERIFICATION: "Awaiting verification",
  COMPLETED: "Completed",
};

export const ORDER_STATUS_COLOR: Record<WctOrderStatus, "default" | "info" | "warning" | "success"> = {
  OPEN: "default",
  SCHEDULED: "info",
  IN_PROGRESS: "warning",
  AWAITING_VERIFICATION: "warning",
  COMPLETED: "success",
};

export const orderStatusLabel = (s: string | null | undefined) => ORDER_STATUS_LABEL[s as WctOrderStatus] ?? (s || "—");
export const orderStatusColor = (s: string | null | undefined) => ORDER_STATUS_COLOR[s as WctOrderStatus] ?? "default";

export type OrderTab = "all" | "open" | "active" | "completed";
export const ORDER_TABS: { key: OrderTab; label: string }[] = [
  { key: "all", label: "All" },
  { key: "open", label: "Open" },
  { key: "active", label: "Scheduled / in progress" },
  { key: "completed", label: "Completed" },
];

export function orderMatchesTab(o: { status?: string | null }, tab: OrderTab): boolean {
  if (tab === "open") return o.status === "OPEN";
  if (tab === "active") return o.status === "SCHEDULED" || o.status === "IN_PROGRESS" || o.status === "AWAITING_VERIFICATION";
  if (tab === "completed") return o.status === "COMPLETED";
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

/** Singapore date + time, e.g. "Tue 03 Nov, 10:00". */
export function fmtJobWhen(iso: string | null | undefined): string {
  if (!iso) return "No date";
  return new Date(iso).toLocaleString("en-GB", { weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Singapore" });
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
