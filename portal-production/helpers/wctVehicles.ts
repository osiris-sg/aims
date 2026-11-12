"use client";

import { request } from "./request";
import { ACTIVE_ORG_KEY } from "./multiOrg";

// WCT Vehicles (enableWctVehicles, 2026-11-12): the API calls and the small
// display rules shared by the list and the vehicle page.

export type VehicleRow = {
  id: string;
  vehicleNo: string;
  model: string | null;
  coeExpiry: string | null;
  lifespanExpiry: string | null;
  coeDays: number | null;
  lifespanDays: number | null;
  expiryWarning: boolean;
  notes: string | null;
  archived: boolean;
  currentDriver?: string | null;
  inUseSince?: string | null;
  lastMileage: number | null;
  usageCount?: number;
  repairsToApprove?: number;
};

export type VehicleUsage = {
  id: string;
  vehicleId: string;
  driverUserId: string | null;
  driverName: string;
  startDate: string;
  startMileage: number;
  endDate: string | null;
  endMileage: number | null;
  open: boolean;
  repairDetails: string | null;
  repairApprovedBy: string | null;
  repairApprovedAt: string | null;
  repairLocked: boolean;
  repairUnlocks: Array<{ at: string; byName: string | null; reason: string; approvedBy: string | null; approvedAt: string | null }>;
};

export type VehicleDetail = VehicleRow & { openUsageId: string | null; usages: VehicleUsage[] };

/**
 * Can this user do `action` (read / update / approve) on vehicles? No roles at
 * all is the platform admin viewing an org: allowed, the same fallback as
 * isModuleAllowed (the API still checks every request).
 */
export const canVehicles = (userRoles: unknown[], hasPermission: (resource: string, action: string) => boolean, action: "read" | "update" | "approve") =>
  userRoles.length === 0 || hasPermission("vehicles", action);

/** One call; throws the server's message (request() reports errors as { success: false }). */
export async function vehiclesApi<T = any>(path: string, method: "GET" | "POST" | "PATCH" | "PUT", token: string, body: any = {}): Promise<T> {
  const res: any = await request({ path: `/vehicles${path}`, method }, body, token);
  if (res?.success === false) throw new Error(res.message || "Something went wrong");
  return (res?.data ?? res) as T;
}

/** The paper form PDF as a Blob (GET /vehicles/:id/log-pdf). */
export async function fetchVehicleLogPdf(id: string, token: string): Promise<Blob> {
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  try {
    const org = window.sessionStorage.getItem(ACTIVE_ORG_KEY);
    if (org) headers["X-Active-Org-Id"] = org;
  } catch {
    /* no session storage */
  }
  const base = (process.env.NEXT_PUBLIC_BACKEND_API_URL || "").replace(/\/$/, "");
  const res = await fetch(`${base}/vehicles/${encodeURIComponent(id)}/log-pdf`, { headers });
  if (!res.ok) throw new Error(`Could not make the form (${res.status})`);
  return res.blob();
}

/** dd/mm/yyyy, as the paper form writes dates. */
export const fmtDate = (ymd: string | null | undefined) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd ?? "");
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "-";
};

export const fmtKm = (n: number | null | undefined) => (n == null ? "-" : `${n.toLocaleString("en-SG")} km`);

/** Chip for an expiry: red once past, amber within 90 days, none otherwise. */
export function expiryChip(days: number | null): { label: string; color: "error" | "warning" } | null {
  if (days == null) return null;
  if (days < 0) return { label: `Expired ${-days} day${days === -1 ? "" : "s"} ago`, color: "error" };
  if (days === 0) return { label: "Expires today", color: "error" };
  if (days <= 90) return { label: `${days} day${days === 1 ? "" : "s"} left`, color: "warning" };
  return null;
}
