"use client";

import { ACTIVE_ORG_KEY } from "./multiOrg";

const API_BASE = (process.env.NEXT_PUBLIC_BACKEND_API_URL || "").replace(/\/$/, "");

/** Which file of a service report: the report itself (GET :id/pdf) or its photos attachment. */
export type ServiceReportFileKind = "report" | "photos";

/**
 * A service report's file as a Blob, through the authenticated API (the bucket
 * is not read directly). For an uploaded report "report" is the uploaded file
 * as stored (a PDF or an image); otherwise it is the generated PDF.
 */
export async function fetchServiceReportFile(reportId: string, kind: ServiceReportFileKind, token: string): Promise<Blob> {
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  // Admin "Viewing as org": the API scopes the read to this org.
  try {
    const org = window.sessionStorage.getItem(ACTIVE_ORG_KEY);
    if (org) headers["X-Active-Org-Id"] = org;
  } catch {
    /* no session storage */
  }
  const path = kind === "photos" ? "photos-file" : "pdf";
  const res = await fetch(`${API_BASE}/maintenance-reports/${encodeURIComponent(reportId)}/${path}`, { headers });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.message || `Could not load the file (${res.status})`);
  }
  return res.blob();
}

/** Hand a Blob to the browser as a download. */
export function saveBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** "pdf" / "jpg" / … for a MIME type (what the API serves for these files). */
export function extForMime(mimeType: string | null | undefined): string {
  const m = (mimeType || "").toLowerCase();
  if (m === "image/jpeg") return "jpg";
  if (m.startsWith("image/")) return m.slice(6) || "img";
  return "pdf";
}

/** "000012" style number the WCT viewer already uses in file names. */
export const reportFileStem = (reportNumber: number | null, reportId: string) =>
  `service-report-${reportNumber != null ? String(reportNumber).padStart(6, "0") : reportId.slice(0, 8)}`;
