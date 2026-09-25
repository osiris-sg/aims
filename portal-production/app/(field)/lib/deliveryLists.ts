/**
 * Shared data layer for the field delivery lists. One source of truth for the
 * three feeds (Pending / In progress / Completed) so the Deliveries home
 * (/scan) and the standalone list pages (/scan/deliveries, /scan/deliveries/
 * scheduled, /scan/deliveries/finished) never drift apart.
 *
 * Every function here is the exact query the list pages already made; nothing
 * new is asked of the backend.
 */

import { request } from "@/helpers/request";
import { resumeHref } from "./deliveryStep";

export interface RunItemSummary {
  id: string;
  deliveryStatus?: "not_delivered" | "delivering" | "not_installed" | "completed";
  quantity?: number | null;
  description?: string | null;
  assetId?: string | null;
  inventoryId?: string | null;
  // Enriched by the list endpoint from the bound unit (null until one is
  // scanned in). An office-scheduled slot has an assetId but no unit yet.
  sku?: string | null;
  serialNumber?: string | null;
}

export interface RunSummary {
  id: string;
  deliveryNumber: number;
  status: string;
  direction?: "OUTBOUND" | "RETURN";
  riderName?: string | null;
  siteAddress: string | null;
  scheduledFor?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  createdAt: string;
  items: RunItemSummary[];
  // The run's DO (PO number + a full-DO link target).
  document: { id: string; name: string | null; poNo?: string | null } | null;
  project: { id: string; name: string } | null;
  customer: { id: string; name: string } | null;
}

const docsOf = (res: any): RunSummary[] => ((res?.data ?? res)?.docs ?? []) as RunSummary[];

async function fetchRuns(path: string, token: string, fallback: string): Promise<RunSummary[]> {
  const res = await request({ path, method: "GET" }, {}, token);
  if (res?.success === false) throw new Error(res.message ?? fallback);
  return docsOf(res);
}

/** Org-wide scheduled runs: the run-first entry point. */
export const fetchScheduledRuns = (token: string) =>
  fetchRuns(`/deliveries?status=scheduled&limit=100`, token, "Failed to load scheduled deliveries");

/** The rider's own runs in {in_progress, delivered}. */
export const fetchInProgressRuns = (token: string) =>
  fetchRuns(`/deliveries?mine=true&unfinished=true&limit=100`, token, "Failed to load deliveries");

// 7-day display window: the run's completion time (fallback createdAt for any
// historic completed row that predates completedAt stamping).
export const COMPLETED_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
export const completedRunTime = (r: RunSummary): number => new Date(r.completedAt ?? r.createdAt).getTime();

/**
 * The rider's own COMPLETED runs, last 7 days. The window is a client-side
 * DISPLAY filter; the endpoint returns all completed runs.
 */
export async function fetchCompletedRuns(token: string): Promise<RunSummary[]> {
  const all = await fetchRuns(`/deliveries?mine=true&status=completed&limit=100`, token, "Failed to load deliveries");
  const now = Date.now();
  return all.filter((r) => now - completedRunTime(r) <= COMPLETED_WINDOW_MS);
}

/**
 * Where tapping an in-progress run lands. The list payload omits assetId/
 * inventoryId/reports, so fetch the full run and resolve the exact step to
 * drop into; fall back to the basket on any failure.
 */
export async function resolveInProgressHref(id: string, token: string | null): Promise<string> {
  const basket = `/scan/delivery/${id}`;
  if (!token) return basket;
  try {
    const res = await request({ path: `/deliveries/${id}`, method: "GET" }, {}, token);
    const run = res?.data ?? res;
    return run?.id ? resumeHref(run) : basket;
  } catch {
    return basket;
  }
}

// Compact relative time: riders scan the same day, so "2h ago" beats a date.
export const relTime = (at: string | number): string => {
  const then = typeof at === "number" ? at : new Date(at).getTime();
  const mins = Math.max(0, Math.round((Date.now() - then) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(then).toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
};

// "LION375-001 +2": first unit sku (fallback serial), then a remainder count.
export const itemLabel = (items: RunItemSummary[]): string => {
  if (items.length === 0) return "No items";
  const first = items[0].sku ?? items[0].serialNumber ?? "1 item";
  return items.length > 1 ? `${first} +${items.length - 1}` : first;
};

/**
 * Loose client-side search used by every field home list: trimmed,
 * case-insensitive substring over whatever fields the row shows. An empty
 * query matches everything.
 */
export function looseMatch(raw: string, fields: Array<string | number | null | undefined>): boolean {
  const term = raw.trim().toLowerCase();
  if (!term) return true;
  return fields.some((f) => f != null && String(f).toLowerCase().includes(term));
}

/**
 * Search over a loaded run list: run number, project, customer, PO no., site
 * address, DO name, and each line's serial/sku and description (model).
 */
export const runMatchesSearch = (r: RunSummary, raw: string): boolean =>
  looseMatch(raw, [
    `#${r.deliveryNumber}`,
    r.project?.name,
    r.customer?.name,
    r.document?.poNo,
    r.document?.name,
    r.siteAddress,
    ...r.items.flatMap((i) => [i.sku, i.serialNumber, i.description]),
  ]);
