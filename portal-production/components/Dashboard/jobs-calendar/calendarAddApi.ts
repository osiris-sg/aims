"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */

// WCT jobs calendar add: the dialogs' API calls. Plain fetch (not helpers/request) so a 409 "link anyway?" is
// answered in the dialog instead of a global error toast. Keeps the admin "viewing as" org like every fetch helper.

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { useOrganizationFeatures } from "@/app/portal/hooks/useOrganizationFeatures";

export interface ApiResult<T = any> {
  ok: boolean;
  status: number;
  data: T | null;
  message: string;
}

export function useCalendarApi() {
  const { getToken } = useAuth();
  return useCallback(
    // orgId (round 36): read another company of the group the person is a member of (the panel's documents of
    // that company's job); the server still checks the membership.
    async <T = any>(method: string, path: string, body?: any, orgId?: string | null): Promise<ApiResult<T>> => {
      const token = await getToken();
      const headers: Record<string, string> = { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) };
      try {
        const org = orgId || window.sessionStorage.getItem("aims-admin-active-org");
        if (org) headers["X-Active-Org-Id"] = org;
      } catch {
        if (orgId) headers["X-Active-Org-Id"] = orgId;
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

/** SiteClock workers (grouped by team) for the job and note forms; enabled = the org's SiteClock link is on.
 * orgId (group New job, 2026-11-22): the chosen company's workers instead of the current org's. */
export function useSiteClockWorkers(open: boolean, orgId?: string | null) {
  const api = useCalendarApi();
  const [state, setState] = useState<{ enabled: boolean; options: WorkerOption[]; loading: boolean; error: string }>({ enabled: false, options: [], loading: false, error: "" });
  useEffect(() => {
    if (!open) return;
    let live = true;
    setState((s) => ({ ...s, loading: true, error: "" }));
    (async () => {
      const cfg = await api<any>("GET", "/deliveries/siteclock/config", undefined, orgId);
      if (!live) return;
      if (!cfg.ok || !cfg.data?.enabled) return setState({ enabled: false, options: [], loading: false, error: "" });
      const res = await api<any>("GET", "/deliveries/siteclock/workers", undefined, orgId);
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
  }, [open, api, orgId]);
  return state;
}

export interface StylePerson {
  id: string;
  name: string;
  /** PTW applicants list entries (2026-11-19): the calendar bar colour. */
  colour?: string;
}

export interface CalendarStylePeople {
  enabled: boolean;
  salespeople: StylePerson[];
  applicants: StylePerson[];
  /** The viewer when they are Sales (a "Sales" role or a salesman code). */
  defaultSalesperson: StylePerson | null;
  /** The org's default PTW applicant (Settings > Job fields: the PTW applicants list, else Calendar colours). */
  defaultApplicant: StylePerson | null;
  /** true: the applicants are the org's PTW applicants list (a job's pick outside it shows marked). */
  applicantsFromList?: boolean;
}

const NO_STYLE: CalendarStylePeople = { enabled: false, salespeople: [], applicants: [], defaultSalesperson: null, defaultApplicant: null };

/** Calendar style (enableCalendarStyle): the Salesperson / PTW applicant pickers; enabled false for every other org. */
export function useCalendarStylePeople(open: boolean, orgId?: string | null) {
  const api = useCalendarApi();
  // Only orgs with the flag ask the server (every other org: no request, nothing shown).
  const { features } = useOrganizationFeatures();
  const on = features?.enableCalendarStyle === true;
  const [state, setState] = useState<CalendarStylePeople & { loaded: boolean }>({ ...NO_STYLE, loaded: false });
  useEffect(() => {
    if (!open || !on) return;
    let live = true;
    setState({ ...NO_STYLE, loaded: false });
    void api<CalendarStylePeople>("GET", "/dashboard/calendar-style/people", undefined, orgId).then((res) => {
      if (!live) return;
      const d = res.ok && res.data?.enabled ? res.data : NO_STYLE;
      setState({ ...NO_STYLE, ...d, loaded: true });
    });
    return () => {
      live = false;
    };
  }, [open, on, api, orgId]);
  // pending (2026-11-23): the WCT group's New job shows its Salesperson / COD / sticker / crew fields at once and fills
  // them when the people arrive, instead of waiting for them.
  return on ? { ...state, pending: !state.loaded } : { ...NO_STYLE, loaded: true, pending: false };
}

export interface JobCompanies {
  /** false = the org is in no active group (every org outside the WCT group): no Company field. */
  group: boolean;
  /** The org the person is in now (the default). */
  current: string;
  /** The group's companies this person belongs to, the parent first. */
  orgs: Array<{ id: string; name: string }>;
}

/** Group New job (WCT 2026-11-22): the companies a new job can go under (GET /dashboard/jobs-calendar/companies). */
export function useJobCompanies(open: boolean) {
  const api = useCalendarApi();
  const [state, setState] = useState<JobCompanies | null>(null);
  useEffect(() => {
    if (!open) return;
    let live = true;
    void api<JobCompanies>("GET", "/dashboard/jobs-calendar/companies").then((res) => {
      if (!live) return;
      setState(res.ok && res.data && Array.isArray(res.data.orgs) ? res.data : null);
    });
    return () => {
      live = false;
    };
  }, [open, api]);
  return state;
}
