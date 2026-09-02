"use client";

// Fetch helper for the ID quotation editor — Clerk token + X-Active-Org-Id
// (admin "Viewing as org") + {success,data} envelope unwrap.

import { useAuth } from "@clerk/nextjs";
import { useCallback, useMemo } from "react";
import type { IdQuote, QuoteDocument, WorkItem, WorkSection } from "./types";

const apiBase = process.env.NEXT_PUBLIC_BACKEND_API_URL;

export class ApiError extends Error {
  status: number;
  payload: any;
  constructor(message: string, status: number, payload?: any) {
    super(message);
    this.status = status;
    this.payload = payload;
  }
}

export function useIdQuoteApi() {
  const { getToken } = useAuth();

  const request = useCallback(
    async <T = any,>(path: string, init?: RequestInit): Promise<T> => {
      const token = await getToken();
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        ...(init?.headers as Record<string, string> | undefined),
        Authorization: `Bearer ${token}`,
      };
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
        const msg = json?.message?.message || json?.message || (typeof json === "string" ? json : `Request failed (${res.status})`);
        throw new ApiError(typeof msg === "string" ? msg : JSON.stringify(msg), res.status, json?.message ?? json);
      }
      return (json?.data ?? json) as T;
    },
    [getToken],
  );

  return useMemo(
    () => ({
      request,
      getDocument: (id: string) => request<QuoteDocument>(`/documents/${id}`),
      /** Save the quote tree (+ flattened items) with optimistic-concurrency version. */
      saveDocument: (doc: { id: string; type: string; config: any; version?: number; status?: string; projectId?: string | null }) =>
        request<QuoteDocument>(`/documents/update`, { method: "POST", body: JSON.stringify(doc) }),
      getHtml: (id: string) => request<{ html: string; name: string | null; type: string }>(`/documents/${id}/html`),
      marginAlert: (id: string, body: { marginPct: number | null; floorPct: number; lines: string[] }) =>
        request(`/documents/${id}/margin-alert`, { method: "POST", body: JSON.stringify(body) }),
      listWorkItems: () => request<WorkItem[]>(`/revenue-items?workOnly=true&activeOnly=true`),
      // Users pickable as the quotation's Designer: only holders of the
      // "Designer" role. Falls back to everyone ONLY when the org has no
      // designer users yet (so the picker isn't uselessly empty during setup).
      listOrgUsers: () =>
        request<any>(`/users/list`, { method: "POST", body: JSON.stringify({ page: 1, limit: 100, search: "", filters: {} }) }).then((r: any) => {
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
      listSections: () => request<WorkSection[]>(`/revenue-items/sections?activeOnly=true`),
      searchCustomers: (search: string) =>
        request<any>(`/customers`, { method: "POST", body: JSON.stringify({ page: 1, limit: 20, search, filters: {} }) }).then(
          (d) => d?.docs || d?.customers || [],
        ),
      /** Template for the type + a new draft document already stamped as an ID quote. */
      createQuotation: async (organizationId: string, quote: IdQuote, opts?: { projectId?: string; leadId?: string | null }) => {
        const tpl = await request<{ id: string }>(`/documentTemplates/type/QUOTATION`);
        if (!tpl?.id) throw new Error("No quotation template is active for this organisation");
        return request<QuoteDocument>(`/documents/basic`, {
          method: "POST",
          body: JSON.stringify({
            type: "QUOTATION",
            documentTemplateId: tpl.id,
            organizationId,
            // Raised from a project (Lead → Project → Quotation): links the doc
            // so signing confirms onto that SAME project instead of creating one.
            ...(opts?.projectId ? { projectId: opts.projectId } : {}),
            // skipNumbering: the CI serial is allocated on CONFIRM, not on
            // create — drafts must not burn contract numbers (CIEL 09-01).
            config: { templateVariant: "ID", quote, items: [], skipNumbering: true, ...(opts?.leadId ? { leadId: opts.leadId } : {}) },
          }),
        });
      },
      listQuotations: (body: any) => request<any>(`/documents/paginated`, { method: "POST", body: JSON.stringify(body) }),
      // Client e-signature link
      createSignLink: (id: string) => request<{ url: string; expiresAt: string | null; createdAt: string }>(`/documents/${id}/sign-link`, { method: "POST" }),
      signLinkStatus: (id: string) =>
        request<{ active: { url: string; expiresAt: string | null; createdAt: string } | null; signed: { signedAt: string; signerName: string | null } | null }>(`/documents/${id}/sign-link`),
      revokeSignLink: (id: string) => request(`/documents/${id}/sign-link/revoke`, { method: "POST" }),
      getProject: (id: string) => request<any>(`/projects/${id}`),
      ensureProject: (id: string) => request<{ projectId: string; name: string; created: boolean }>(`/documents/${id}/ensure-project`, { method: "POST" }),
      deleteDocument: (id: string) => request(`/documents/delete/${id}`, { method: "DELETE" }),
    }),
    [request],
  );
}
