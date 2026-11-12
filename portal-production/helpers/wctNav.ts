/**
 * WCT navigation (enableWctOrders, 2026-11-03). WCT's menu reads Dashboard,
 * Sales, Orders, Jobs, then the rest as stored. "Jobs" is the DELIVERIES
 * module under WCT's name (a WCT job is a service visit from an order, stored
 * as a delivery run), at its usual route /portal/deliveries. Other orgs:
 * unchanged.
 */

/** Display-order overrides that win over each module's stored sortOrder. */
export function menuOrderOverride(isWct: boolean): Record<string, number> {
  // Sales sits just below Dashboard for every org; WCT's Orders, then Jobs, right after it.
  return isWct ? { SALES: 0.5, ORDERS: 0.6, DELIVERIES: 0.7 } : { SALES: 0.5 };
}

/** The menu entry as WCT reads it: DELIVERIES is "Jobs". Other orgs: the module as stored. */
export function wctMenuModule<M extends { moduleCode?: string; displayName?: string }>(m: M, isWct: boolean): M {
  return isWct && m.moduleCode === "DELIVERIES" ? { ...m, displayName: "Jobs" } : m;
}

/**
 * WCT Vehicles (enableWctVehicles, 2026-11-12): a menu entry of its own right
 * after Orders, shown to users holding vehicles:read. Not a stored module, so
 * no org needs a module row for it.
 */
export const VEHICLES_PATH = "/portal/vehicles";
export function vehiclesNavModule(afterSortOrder: number) {
  return {
    moduleCode: "VEHICLES",
    displayName: "Vehicles",
    enabled: true,
    icon: "LocalShipping",
    sortOrder: afterSortOrder + 0.05,
    config: { route: VEHICLES_PATH },
  };
}

/** The Jobs page (WCT): /portal/deliveries, optionally on one status tab. */
export const JOBS_PATH = "/portal/deliveries";
export const jobsHref = (state?: string | null) => (state ? `${JOBS_PATH}?status=${state}` : JOBS_PATH);

/** The Orders page's old ?tab= links (2026-11-03 build): where they go now (null = stay on Orders). */
export function ordersTabRedirect(tab: string | null | undefined): string | null {
  if (tab === "jobs") return jobsHref();
  if (tab === "verify") return jobsHref("to_verify");
  return null;
}

/** The Jobs page's status tabs, in order ("" = All). */
export const JOB_TABS: Array<{ key: string; label: string }> = [
  { key: "", label: "All" },
  { key: "draft", label: "Draft" },
  { key: "scheduled", label: "Scheduled" },
  { key: "in_progress", label: "In progress" },
  { key: "done", label: "Done" },
  { key: "to_verify", label: "To verify" },
  { key: "rejected", label: "Rejected" },
  { key: "completed", label: "Completed" },
  { key: "cancelled", label: "Cancelled" },
];

/** A Jobs status tab named by ?status= ("" when absent or unknown). */
export function jobsTab(raw: string | null | undefined): string {
  return JOB_TABS.some((t) => t.key === raw) ? String(raw) : "";
}

/** The Verified column: who signed off, or what is still owed. */
export function verifiedText(j: { verificationState?: string | null; verifiedByName?: string | null; verifiedAt?: string | null }): string {
  if (j.verificationState === "verified") return j.verifiedByName ? `Verified by ${j.verifiedByName}` : "Verified";
  if (j.verificationState === "pending") return "To verify";
  if (j.verificationState === "rejected") return "Rejected";
  return "-";
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
