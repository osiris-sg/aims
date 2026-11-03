/**
 * WCT navigation (enableWctOrders, 2026-11-03). WCT's menu reads Dashboard,
 * Sales, Orders, then the rest as stored; Deliveries is not in it (its jobs
 * live under Orders → Jobs / To verify). The DELIVERIES module itself stays
 * enabled, so job pages, the field app and the API keep working. Other orgs:
 * unchanged.
 */

/** Display-order overrides that win over each module's stored sortOrder. */
export function menuOrderOverride(isWct: boolean): Record<string, number> {
  // Sales sits just below Dashboard for every org; WCT's Orders right after it.
  return isWct ? { SALES: 0.5, ORDERS: 0.6 } : { SALES: 0.5 };
}

/** A module never shown in the menu for this org. */
export function hiddenFromMenu(moduleCode: string, isWct: boolean): boolean {
  return isWct && moduleCode === "DELIVERIES";
}

export type OrdersTab = "orders" | "jobs" | "verify";

/** The Orders page tab named by ?tab= (WCT only; anything else is the orders list). */
export function ordersTab(raw: string | null | undefined): OrdersTab {
  return raw === "jobs" || raw === "verify" ? raw : "orders";
}

/** WCT's old /portal/deliveries links: where they go now (null = stay; job pages still open). */
export function wctDeliveriesRedirect(pathname: string): string | null {
  const p = pathname.replace(/\/+$/, "");
  if (p === "/portal/deliveries") return "/portal/orders?tab=jobs";
  if (p === "/portal/deliveries/verification") return "/portal/orders?tab=verify";
  return null;
}

/** Orders → Jobs: the status each row reads (server state keys, see deliveries/order-jobs.ts). */
export const ORDER_JOB_STATE_LABEL: Record<string, string> = {
  draft: "Draft",
  scheduled: "Scheduled",
  in_progress: "In progress",
  done: "Done",
  to_verify: "To verify",
  rejected: "Rejected",
  completed: "Completed",
  cancelled: "Cancelled",
};

export function orderJobStateColor(state: string): "default" | "info" | "warning" | "success" | "error" {
  if (state === "rejected") return "error";
  if (state === "to_verify" || state === "in_progress" || state === "done") return "warning";
  if (state === "completed") return "success";
  if (state === "draft" || state === "cancelled") return "default";
  return "info";
}
