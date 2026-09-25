/**
 * Shared data layer for the field maintenance-report lists: Pending Sign
 * (/scan/reports/ongoing and the Maintenance home's Pending tab) and the
 * completed lists (/scan/reports and the Maintenance home's Completed tab).
 */

import { request } from "@/helpers/request";
import { looseMatch } from "./deliveryLists";

export interface ReportSummary {
  id: string;
  reportNumber: number | null;
  status?: string;
  createdAt: string;
  signedAt?: string | null;
  technicianName?: string | null;
  serviceData: {
    customerName?: string | null;
    model?: string | null;
    serial?: string | null;
    serviceDate?: string | null;
    templateId?: string | null;
  } | null;
  asset: { name: string | null } | null;
  inventory: { sku: string | null } | null;
}

const docsOf = (res: any): ReportSummary[] => {
  const docs = res?.docs ?? res?.data?.docs ?? res?.data ?? [];
  return Array.isArray(docs) ? docs : [];
};

/** The group a report sits in, and the unit a batch signature is locked to. */
export const customerOf = (r: ReportSummary) => r.serviceData?.customerName?.trim() || "Unknown customer";

/**
 * Reports awaiting a signature (submitted with Skip). Org-wide, SERVICE kind,
 * capped at 100 by the client. Exactly the Pending Sign query.
 */
export async function fetchPendingSignReports(token: string): Promise<ReportSummary[]> {
  const res = await request({ path: "/maintenance-reports?status=draft&limit=100", method: "GET" }, {}, token);
  if (res?.success === false) throw new Error(res.message ?? "Could not load reports awaiting signature");
  return docsOf(res);
}

export const COMPLETED_REPORTS_WINDOW_DAYS = 30;
const COMPLETED_REPORTS_MAX = 500;
const PAGE_SIZE = 100;

/**
 * Completed reports CREATED in the last 30 days.
 *
 * The endpoint has no date filter and sorts by createdAt desc, so this pages
 * until a row is older than the window (or the server runs out), hard-capped
 * at 500 rows. Known gap: a report created more than 30 days ago but signed
 * recently falls outside the window, because the server cannot sort or filter
 * by signedAt.
 */
export async function fetchRecentCompletedReports(token: string): Promise<ReportSummary[]> {
  const cutoff = Date.now() - COMPLETED_REPORTS_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const out: ReportSummary[] = [];
  for (let page = 1; out.length < COMPLETED_REPORTS_MAX; page++) {
    const res = await request(
      { path: `/maintenance-reports?status=completed&page=${page}&limit=${PAGE_SIZE}`, method: "GET" },
      {},
      token,
    );
    if (res?.success === false) throw new Error(res.message ?? "Could not load completed reports");
    const docs = docsOf(res);
    let pastWindow = false;
    for (const r of docs) {
      if (new Date(r.createdAt).getTime() < cutoff) {
        pastWindow = true;
        break;
      }
      out.push(r);
      if (out.length >= COMPLETED_REPORTS_MAX) break;
    }
    const hasNext = res?.hasNextPage ?? res?.data?.hasNextPage ?? docs.length === PAGE_SIZE;
    if (pastWindow || !hasNext || docs.length === 0) break;
  }
  return out;
}

/** Loose search across every field a report row shows. */
export const reportMatchesSearch = (r: ReportSummary, q: string): boolean =>
  looseMatch(q, [
    r.reportNumber != null ? `#${r.reportNumber}` : null,
    r.serviceData?.customerName,
    r.serviceData?.model,
    r.asset?.name,
    r.serviceData?.serial,
    r.inventory?.sku,
    r.serviceData?.serviceDate,
  ]);
