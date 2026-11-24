"use client";

// Field module (FIELD_PLAN.md): the API calls and the caller's access (GET /field/me).
import { useQuery } from "@tanstack/react-query";
import { useCallback } from "react";
import { useAccountingApi } from "@/app/portal/accounting/_lib/api";
import { useOrganizationFeatures } from "@/app/portal/hooks/useOrganizationFeatures";
import type { FieldAccess, FieldArea } from "@/helpers/fieldModule";

export interface FieldMe {
  areas: FieldArea[];
  access: FieldAccess;
  workerId: string | null;
  timezone: string;
  supervisedSiteIds: string[];
  supervisedWorkerIds: string[];
}

/** JSON calls to /field/*; errors throw with the server's message. */
export function useFieldApi() {
  const { request } = useAccountingApi();
  const get = useCallback(<T = any,>(path: string) => request<T>(path), [request]);
  const send = useCallback(
    <T = any,>(path: string, method: "POST" | "PATCH" | "PUT" | "DELETE", body?: unknown) =>
      request<T>(path, { method, body: body === undefined ? undefined : JSON.stringify(body) }),
    [request],
  );
  return { get, send };
}

/** The areas that are on and what this person may do (null while loading or when the module is off). */
export function useFieldMe() {
  const { fieldAreas } = useOrganizationFeatures();
  const { get } = useFieldApi();
  const on = (fieldAreas?.length ?? 0) > 0;
  const q = useQuery({
    queryKey: ["field-me", (fieldAreas ?? []).join(",")],
    queryFn: () => get<FieldMe>("/field/me"),
    enabled: on,
    staleTime: 60_000,
    retry: false,
  });
  return { me: on ? q.data ?? null : null, loading: on && q.isLoading, error: q.error as Error | null };
}
