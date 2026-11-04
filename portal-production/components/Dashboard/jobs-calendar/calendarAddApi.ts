"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */

// WCT jobs calendar add: the dialogs' API calls. Plain fetch (not helpers/request) so a 409 "link anyway?" is
// answered in the dialog instead of a global error toast. Keeps the admin "viewing as" org like every fetch helper.

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";

export interface ApiResult<T = any> {
  ok: boolean;
  status: number;
  data: T | null;
  message: string;
}

export function useCalendarApi() {
  const { getToken } = useAuth();
  return useCallback(
    async <T = any>(method: string, path: string, body?: any): Promise<ApiResult<T>> => {
      const token = await getToken();
      const headers: Record<string, string> = { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) };
      try {
        const org = window.sessionStorage.getItem("aims-admin-active-org");
        if (org) headers["X-Active-Org-Id"] = org;
      } catch {
        /* no sessionStorage */
      }
      try {
        const res = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_API_URL}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
        const j: any = await res.json().catch(() => null);
        const m = j?.message;
        return { ok: res.ok, status: res.status, data: (j && "data" in j ? j.data : j) ?? null, message: (Array.isArray(m) ? m.join(". ") : m) || (res.ok ? "" : `Request failed (${res.status})`) };
      } catch (e: any) {
        return { ok: false, status: 0, data: null, message: e?.message || "Network error" };
      }
    },
    [getToken],
  );
}

export interface WorkerOption {
  id: string;
  name: string;
  employeeNo: string | null;
  group: string;
}

/** SiteClock workers (grouped by team) for the job and note forms; enabled = the org's SiteClock link is on. */
export function useSiteClockWorkers(open: boolean) {
  const api = useCalendarApi();
  const [state, setState] = useState<{ enabled: boolean; options: WorkerOption[]; loading: boolean; error: string }>({ enabled: false, options: [], loading: false, error: "" });
  useEffect(() => {
    if (!open) return;
    let live = true;
    setState((s) => ({ ...s, loading: true, error: "" }));
    (async () => {
      const cfg = await api<any>("GET", "/deliveries/siteclock/config");
      if (!live) return;
      if (!cfg.ok || !cfg.data?.enabled) return setState({ enabled: false, options: [], loading: false, error: "" });
      const res = await api<any>("GET", "/deliveries/siteclock/workers");
      if (!live) return;
      if (!res.ok) return setState({ enabled: true, options: [], loading: false, error: res.message || "Couldn't load SiteClock workers" });
      const seen = new Set<string>();
      const options: WorkerOption[] = [];
      for (const t of res.data?.teams ?? []) for (const w of t.workers ?? []) if (!seen.has(w.id) && seen.add(w.id)) options.push({ id: w.id, name: w.name, employeeNo: w.employeeNo ?? null, group: t.name });
      for (const w of res.data?.others ?? []) if (!seen.has(w.id) && seen.add(w.id)) options.push({ id: w.id, name: w.name, employeeNo: w.employeeNo ?? null, group: "Not in a team" });
      setState({ enabled: true, options, loading: false, error: "" });
    })();
    return () => {
      live = false;
    };
  }, [open, api]);
  return state;
}
