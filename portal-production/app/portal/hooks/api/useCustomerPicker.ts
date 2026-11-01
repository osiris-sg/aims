/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

// Customer pickers (2026-11-02): never load "all" customers. WCT has ~4,000 and
// a capped list (limit 1000 / 5000 / the default page) silently missed the
// selected customer — Record Payment showed an empty, disabled Customer field.
// Pickers search the server as you type (useCustomerSearch) and fetch the
// customers they already reference by id (useCustomersByIds). Everything seen
// lands in a per-org pool, so the document editor's id lookups keep working.
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@clerk/nextjs";
import { useOrganization } from "@hooks/useOrganization";
import { request } from "@/helpers/request";

export type PickerCustomer = {
  id: string;
  name: string;
  customerCode?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  gstRegNo?: string | null;
  uen?: string | null;
  externalRef?: string | null;
  currency?: string | null;
  contacts?: any[];
  salesman?: any;
  [key: string]: any;
};

// ── Pool: every customer a picker has seen, per org ────────────────────────
const pools = new Map<string, Map<string, PickerCustomer>>();
let version = 0;
const listeners = new Set<() => void>();
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const poolOf = (orgId: string) => {
  let p = pools.get(orgId);
  if (!p) pools.set(orgId, (p = new Map()));
  return p;
};

/** Add customers to the org's pool (search results, lookups, a just-created one). */
export function rememberCustomers(orgId: string | undefined, customers: (PickerCustomer | null | undefined)[]) {
  if (!orgId) return;
  const p = poolOf(orgId);
  let changed = false;
  for (const c of customers) {
    if (!c?.id) continue;
    const prev = p.get(c.id);
    const next = { ...prev, ...c };
    // Nothing new: keep the same object and don't notify. Re-adding a known
    // customer must be a no-op, or a component that remembers what it renders
    // (CustomerPicker's initialCustomer) loops forever.
    if (prev && JSON.stringify(next) === JSON.stringify(prev)) continue;
    p.set(c.id, next);
    changed = true;
  }
  if (changed) {
    version++;
    listeners.forEach((l) => l());
  }
}

function usePool(orgId: string | undefined) {
  useSyncExternalStore(subscribe, () => version, () => version);
  return orgId ? poolOf(orgId) : new Map<string, PickerCustomer>();
}

const docsOf = (res: any): PickerCustomer[] => {
  const d = res?.data ?? res;
  if (Array.isArray(d)) return d;
  return d?.docs || d?.customers || [];
};

// ── Search as you type ────────────────────────────────────────────────────
/** Server search (code, name, email, phone, address, UEN, old code). Empty term = newest customers. */
export function useCustomerSearch(term: string, { limit = 20, enabled = true }: { limit?: number; enabled?: boolean } = {}) {
  const { organization } = useOrganization();
  const orgId = organization?.id;
  const { getToken } = useAuth();
  const q = term.trim();
  const query = useQuery({
    queryKey: ["customer-search", orgId, q, limit],
    enabled: !!orgId && enabled,
    staleTime: 30_000,
    queryFn: async () => {
      const token = await getToken();
      // exactFirst: an exact code / UEN / old-code hit leads (a short old code
      // like "449" also matches many phones and addresses).
      const res = await request({ path: "/customers", method: "POST" }, { page: 1, limit, search: q, exactFirst: true }, token || undefined);
      return { docs: docsOf(res), total: Number(res?.data?.total ?? res?.data?.totalDocuments ?? 0) };
    },
  });
  useEffect(() => {
    if (query.data?.docs) rememberCustomers(orgId, query.data.docs);
  }, [query.data, orgId]);
  return { customers: query.data?.docs ?? [], total: query.data?.total ?? 0, isLoading: query.isFetching };
}

// ── By id ────────────────────────────────────────────────────────────────
/**
 * The customers with these ids (from the pool, else fetched via
 * POST /customers/lookup in chunks of 500). Unknown ids are simply missing.
 */
export function useCustomersByIds(ids: (string | null | undefined)[]) {
  const { organization } = useOrganization();
  const orgId = organization?.id;
  const { getToken } = useAuth();
  const pool = usePool(orgId);
  const wanted = useMemo(() => [...new Set(ids.filter((i): i is string => !!i))].sort(), [JSON.stringify(ids)]); // eslint-disable-line react-hooks/exhaustive-deps
  const missing = wanted.filter((id) => !pool.has(id));
  const query = useQuery({
    queryKey: ["customer-lookup", orgId, missing],
    enabled: !!orgId && missing.length > 0,
    staleTime: 60_000,
    queryFn: async () => {
      const token = await getToken();
      const out: PickerCustomer[] = [];
      for (let i = 0; i < missing.length; i += 500) {
        const res = await request({ path: "/customers/lookup", method: "POST" }, { ids: missing.slice(i, i + 500) }, token || undefined);
        out.push(...docsOf(res));
      }
      return out;
    },
  });
  useEffect(() => {
    if (query.data) rememberCustomers(orgId, query.data);
  }, [query.data, orgId]);
  const byId = new Map<string, PickerCustomer>();
  for (const id of wanted) {
    const c = pool.get(id);
    if (c) byId.set(id, c);
  }
  return { byId, customers: [...byId.values()], isLoading: missing.length > 0 && query.isFetching };
}

export function useCustomerById(id: string | null | undefined) {
  const { byId, isLoading } = useCustomersByIds([id]);
  return { customer: id ? byId.get(id) ?? null : null, isLoading };
}

/**
 * The document editor's `customers` list: the given customers (fetched by id)
 * plus every customer seen by a picker in this org. Replaces the capped
 * "load the first 1000/5000" lists the editor pages used to pass.
 */
export function useCustomerPool(ids: (string | null | undefined)[]) {
  const { organization } = useOrganization();
  const orgId = organization?.id;
  useCustomersByIds(ids);
  const pool = usePool(orgId);
  return useMemo(() => [...pool.values()], [pool, version]); // eslint-disable-line react-hooks/exhaustive-deps
}
