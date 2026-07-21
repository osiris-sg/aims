"use client";

// Shared fetch helper for the WhatsApp pages — Clerk token + X-Active-Org-Id
// + {success,data} envelope unwrap (same shape as useAccountingApi).

import { useAuth } from "@clerk/nextjs";
import { useCallback, useMemo } from "react";

const apiBase = process.env.NEXT_PUBLIC_BACKEND_API_URL;

type WhatsAppRequest = <T = any>(path: string, init?: RequestInit) => Promise<T>;

export function useWhatsAppApi(): { request: WhatsAppRequest } {
  const { getToken } = useAuth();

  const request: WhatsAppRequest = useCallback(
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
        const msg = json?.message || (typeof json === "string" ? json : `Request failed (${res.status})`);
        throw new Error(msg);
      }
      return (json?.data ?? json) as T;
    },
    [getToken],
  );

  return useMemo(() => ({ request }), [request]);
}
