"use client";

// Fetch helper for the interior-design project pages (Clerk token +
// X-Active-Org-Id + {success,data} unwrap).

import { useAuth } from "@clerk/nextjs";
import { useCallback, useMemo } from "react";

const apiBase = process.env.NEXT_PUBLIC_BACKEND_API_URL;

export type Cost = {
  id: string;
  date: string | null;
  supplierName: string | null;
  supplierId?: string | null;
  description: string;
  invoiceNo: string | null;
  amount: number;
  sectionId: string | null;
  attachmentUrl: string | null;
  attachmentKey?: string | null;
  source: string;
  status: string;
  createdByName?: string | null;
  notes?: string | null;
  createdAt: string;
};

export type Milestone = {
  id: string;
  kind: "milestone" | "vo" | "refund";
  label: string;
  pct: number | null;
  amount: number;
  sortOrder: number;
  dueTrigger: string | null;
  invoiceId: string | null;
  paidAmount: number;
  paidAt: string | null;
  paymentMethod: string | null;
  invoice?: { id: string; number: string | null; status: string; path: string } | null;
};

export type Summary = {
  project: {
    id: string;
    projectNumber: string | null;
    name: string;
    address: string | null;
    status: string;
    stage: string | null;
    designer: string | null;
    commissionPct: number;
    startDate: string | null;
    endDate: string | null;
    customer: { id: string; name: string; phone?: string | null; email?: string | null } | null;
    client: { name: string | null; contact: string | null; nric: string | null; address: string | null };
  };
  quotation: { id: string; number: string | null; status: string; grandTotal: number; signedAt: string | null; signedBy: string | null; isId: boolean } | null;
  documents: Array<{ id: string; name: string | null; type: string; status: string; createdAt: string; documentTemplateId: string }>;
  costs: Cost[];
  milestones: Milestone[];
  depositMode: "engagement" | "percent" | null;
  engagementFee: number;
  sections: Array<{ id: string; letter: string | null; title: string }>;
  tally: Array<{ sectionId: string; letter: string | null; title: string; quoted: number; provisionedCost: number; actualCost: number }>;
  unallocatedCost: number;
  totals: {
    contractTotal: number;
    initialContractSum: number;
    voTotal: number;
    collected: number;
    refunded: number;
    balanceDue: number;
    totalCost: number;
    pendingCost: number;
    profit: number;
    commissionPct: number;
    commission: number;
    advanced: number;
    commissionBalance: number;
    marginOnCollected: number | null;
    projectedProfit: number;
    projectedMargin: number | null;
  };
  stages: string[];
};

export type ScheduleItem = { id: string; label: string; kind: "work" | "note" | "holiday"; startDate: string; endDate: string; sortOrder: number; notes: string | null };
export type Schedule = {
  header: { projectSite: string; contractNo: string | null; manager: string | null; contact: string | null };
  items: ScheduleItem[];
  weeks: Array<{ index: number; days: Array<{ iso: string; dow: string; holiday: string | null; work: string[]; notes: string[] }> }>;
  sequence: string[];
  holidays: Record<string, string>;
};

export function useIdProjectApi() {
  const { getToken } = useAuth();
  const request = useCallback(
    async <T = any,>(path: string, init?: RequestInit): Promise<T> => {
      const token = await getToken();
      const headers: Record<string, string> = { "Content-Type": "application/json", ...(init?.headers as any), Authorization: `Bearer ${token}` };
      if (typeof window !== "undefined") {
        const activeOrgId = window.sessionStorage.getItem("aims-admin-active-org");
        if (activeOrgId) headers["X-Active-Org-Id"] = activeOrgId;
      }
      const res = await fetch(`${apiBase}${path}`, { ...init, headers });
      const text = await res.text();
      let json: any = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = text;
      }
      if (!res.ok) {
        const msg = json?.message?.message || json?.message || `Request failed (${res.status})`;
        throw new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
      }
      return (json?.data ?? json) as T;
    },
    [getToken],
  );
  const j = (body: any) => JSON.stringify(body);
  return useMemo(
    () => ({
      request,
      list: (q: { page: number; limit: number; search?: string; stage?: string; designer?: string }) =>
        request<{ docs: any[]; total: number }>(`/id-projects?page=${q.page}&limit=${q.limit}&search=${encodeURIComponent(q.search || "")}&stage=${encodeURIComponent(q.stage || "")}&designer=${encodeURIComponent(q.designer || "")}`),
      summary: (id: string) => request<Summary>(`/projects/${id}/costing`),
      updateFields: (id: string, body: any) => request(`/projects/${id}/id-fields`, { method: "PATCH", body: j(body) }),
      addCost: (id: string, body: any) => request<Cost>(`/projects/${id}/costs`, { method: "POST", body: j(body) }),
      extractCost: (id: string, file: string, filename?: string) => request<any>(`/projects/${id}/costs/extract`, { method: "POST", body: j({ file, filename }) }),
      updateCost: (costId: string, body: any) => request<Cost>(`/projects/costs/${costId}`, { method: "PATCH", body: j(body) }),
      removeCost: (costId: string) => request(`/projects/costs/${costId}`, { method: "DELETE" }),
      addMilestone: (id: string, body: any) => request<Milestone>(`/projects/${id}/milestones`, { method: "POST", body: j(body) }),
      updateMilestone: (mid: string, body: any) => request<Milestone>(`/projects/milestones/${mid}`, { method: "PATCH", body: j(body) }),
      removeMilestone: (mid: string) => request(`/projects/milestones/${mid}`, { method: "DELETE" }),
      recalcMilestones: (id: string) => request(`/projects/${id}/milestones/recalc`, { method: "POST" }),
      // schedule
      getSchedule: (id: string) => request<Schedule>(`/projects/${id}/schedule`),
      getScheduleHtml: (id: string) => request<{ html: string }>(`/projects/${id}/schedule/html`),
      addScheduleItems: (id: string, items: Array<{ label: string; kind?: string; startDate: string; endDate?: string; notes?: string | null }>) => request(`/projects/${id}/schedule`, { method: "POST", body: j({ items }) }),
      updateScheduleItem: (itemId: string, body: any) => request(`/projects/schedule/${itemId}`, { method: "PATCH", body: j(body) }),
      removeScheduleItem: (itemId: string) => request(`/projects/schedule/${itemId}`, { method: "DELETE" }),
      shiftSchedule: (id: string, days: number, fromDate?: string) => request(`/projects/${id}/schedule/shift`, { method: "POST", body: j({ days, fromDate }) }),
      createScheduleLink: (id: string) => request<{ url: string; path: string }>(`/projects/${id}/schedule/share-link`, { method: "POST" }),
      revokeScheduleLink: (id: string) => request(`/projects/${id}/schedule/share-link/revoke`, { method: "POST" }),
      // Designer-role holders only (fallback to all users when the org has no
      // designers yet, so the picker still works during setup).
      listOrgUsers: () =>
        request<any>(`/users/list`, { method: "POST", body: j({ page: 1, limit: 100, search: "", filters: {} }) }).then((r: any) => {
          const all = (r?.users || r?.docs || (Array.isArray(r) ? r : [])).map((u: any) => ({
            id: u.id,
            name: u.name || u.email || u.id,
            email: u.email,
            whatsappNumber: u.whatsappNumber || null,
            isDesigner: (u.roles || []).some((role: any) => /designer/i.test(role?.name || "")),
          }));
          const designers = all.filter((u: any) => u.isDesigner);
          return designers.length ? designers : all;
        }),
      setDepositMode: (id: string, body: { mode: "engagement" | "percent"; engagementFee?: number; pct?: number }) => request(`/projects/${id}/deposit-mode`, { method: "PATCH", body: j(body) }),
      createMilestoneInvoice: (mid: string) => request<{ id: string; number: string | null; status: string; path: string; created: boolean }>(`/projects/milestones/${mid}/invoice`, { method: "POST" }),
    }),
    [request],
  );
}

export const money = (n: number | null | undefined) => new Intl.NumberFormat("en-SG", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n) || 0);
export const pct = (n: number | null | undefined) => (n == null ? "—" : `${n.toFixed(1)}%`);
export const fmtDate = (d?: string | null) => (d ? new Date(d).toLocaleDateString("en-SG", { day: "2-digit", month: "short", year: "numeric" }) : "—");
export const STAGE_LABEL: Record<string, string> = { signed: "Signed", design: "Design & 3D", works: "Works in progress", carpentry: "Carpentry", handover: "Handover", completed: "Completed" };
