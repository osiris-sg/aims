"use client";

import { ACTIVE_ORG_KEY } from "./multiOrg";
import { serviceReportsZipName } from "./serviceReportFiles";

const API_BASE = (process.env.NEXT_PUBLIC_BACKEND_API_URL || "").replace(/\/$/, "");

/**
 * Several signed service reports as ONE zip of separate PDFs, downloaded by the
 * browser (it blocks a burst of separate downloads). POST
 * /maintenance-reports/bulk-pdf; the server keeps the order of `ids`. Throws
 * the server's message (a draft in the list, more than 50, …).
 */
export async function downloadServiceReportsZip(ids: string[], token: string): Promise<string> {
  const headers: Record<string, string> = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  try {
    const org = window.sessionStorage.getItem(ACTIVE_ORG_KEY);
    if (org) headers["X-Active-Org-Id"] = org;
  } catch {
    /* no session storage */
  }
  const res = await fetch(`${API_BASE}/maintenance-reports/bulk-pdf`, { method: "POST", headers, body: JSON.stringify({ ids }) });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const msg = Array.isArray(body?.message) ? body.message.join(", ") : body?.message;
    throw new Error(msg || `Could not download the reports (${res.status})`);
  }
  const blob = await res.blob();
  // Named here: the API does not expose Content-Disposition across origins.
  const fileName = serviceReportsZipName(ids.length);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return fileName;
}
