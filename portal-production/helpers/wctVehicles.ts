"use client";

import { fileSrc } from "@/helpers/fileUrl";
import { request } from "./request";
import { ACTIVE_ORG_KEY } from "./multiOrg";

// WCT Vehicles (enableWctVehicles, 2026-11-12; log book 2026-11-16): the API
// calls and the small display rules shared by the list and the vehicle page.

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
  roadTaxExpiry?: string | null;
  insuranceExpiry?: string | null;
  inspectionExpiry?: string | null;
  roadTaxDays?: number | null;
  insuranceDays?: number | null;
  inspectionDays?: number | null;
  currentDriver?: string | null;
  driverSince?: string | null;
  lastMileage: number | null;
  entryCount?: number;
  spentThisYear?: number;
  repairsToApprove?: number;
};

export const LOG_TYPES = ["DRIVER", "REPAIR", "FUEL", "RENEWAL", "PARKING", "OTHER"] as const;
export type LogType = (typeof LOG_TYPES)[number];
export const LOG_TYPE_LABEL: Record<LogType, string> = {
  DRIVER: "Driver assigned",
  REPAIR: "Repair / servicing",
  FUEL: "Fuel",
  RENEWAL: "Road tax / insurance / COE / inspection",
  PARKING: "Parking / ERP / fines",
  OTHER: "Other",
};
/** Short names for chips and the money card. */
export const LOG_TYPE_SHORT: Record<LogType, string> = { DRIVER: "Driver", REPAIR: "Repair", FUEL: "Fuel", RENEWAL: "Renewals", PARKING: "Parking / ERP / fines", OTHER: "Other" };
export const LOG_TYPE_COLOR: Record<LogType, "default" | "primary" | "secondary" | "success" | "warning" | "info" | "error"> = {
  DRIVER: "primary",
  REPAIR: "warning",
  FUEL: "info",
  RENEWAL: "secondary",
  PARKING: "error",
  OTHER: "default",
};
export const RENEWAL_KINDS = [
  { key: "ROAD_TAX", label: "Road tax" },
  { key: "INSURANCE", label: "Insurance" },
  { key: "COE", label: "COE" },
  { key: "INSPECTION", label: "Inspection" },
] as const;

export type LogAttachment = { key: string; fileName: string | null; mimeType: string | null };

export type VehicleLogEntry = {
  id: string;
  vehicleId: string;
  date: string;
  type: LogType;
  typeLabel: string;
  description: string | null;
  details: string;
  mileage: number | null;
  amount: number | null;
  attachment: LogAttachment | null;
  driverUserId: string | null;
  driverName: string | null;
  vendor: string | null;
  renewalKind: string | null;
  renewalExpiry: string | null;
  repairApprovedBy: string | null;
  repairApprovedAt: string | null;
  repairLocked: boolean;
  repairUnlocks: Array<{ at: string; byName: string | null; reason: string; approvedBy: string | null; approvedAt: string | null }>;
  converted: boolean;
  createdByName: string | null;
  createdAt: string;
};

export type MoneyPeriod = { total: number; byType: Record<LogType, number> };
export type VehicleDetail = VehicleRow & {
  currentDriverUserId: string | null;
  summary: { month: MoneyPeriod; year: MoneyPeriod; all: MoneyPeriod };
  entries: VehicleLogEntry[];
};

/** S$1,234.50 */
export const fmtMoney = (n: number | null | undefined) => (n == null ? "-" : `S$${n.toLocaleString("en-SG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

/** An uploaded file's public URL (S3). */
export const fileUrl = (key: string) => fileSrc(key);

/** The log, filtered as the page shows it (type, date range inclusive). */
export function filterEntries(entries: VehicleLogEntry[], f: { type?: string; from?: string; to?: string }) {
  return entries.filter((e) => (!f.type || e.type === f.type) && (!f.from || e.date >= f.from) && (!f.to || e.date <= f.to));
}

/**
 * Can this user do `action` (read / update / approve) on vehicles? No roles at
 * all is the platform admin viewing an org: allowed, the same fallback as
 * isModuleAllowed (the API still checks every request).
 */
export const canVehicles = (userRoles: unknown[], hasPermission: (resource: string, action: string) => boolean, action: "read" | "update" | "approve") =>
  userRoles.length === 0 || hasPermission("vehicles", action);

/** One call; throws the server's message (request() reports errors as { success: false }). */
export async function vehiclesApi<T = any>(path: string, method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE", token: string, body: any = {}): Promise<T> {
  const res: any = await request({ path: `/vehicles${path}`, method }, body, token);
  if (res?.success === false) throw new Error(res.message || "Something went wrong");
  return (res?.data ?? res) as T;
}

/** The paper form PDF as a Blob (GET /vehicles/:id/log-pdf). */
export async function fetchVehicleLogPdf(id: string, token: string, filter: { type?: string; from?: string; to?: string } = {}): Promise<Blob> {
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  try {
    const org = window.sessionStorage.getItem(ACTIVE_ORG_KEY);
    if (org) headers["X-Active-Org-Id"] = org;
  } catch {
    /* no session storage */
  }
  const base = (process.env.NEXT_PUBLIC_BACKEND_API_URL || "").replace(/\/$/, "");
  const qs = new URLSearchParams(Object.entries(filter).filter(([, v]) => !!v) as Array<[string, string]>).toString();
  const res = await fetch(`${base}/vehicles/${encodeURIComponent(id)}/log-pdf${qs ? `?${qs}` : ""}`, { headers });
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
