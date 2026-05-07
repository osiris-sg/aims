"use client";

// Tiny shared helper for the accounting pages — wraps fetch with the Clerk
// token, prefixes the API base URL, and unwraps the {success,data,message}
// envelope returned by CustomResponseInterceptor on the backend.

import { useAuth } from "@clerk/nextjs";
import { useCallback, useMemo } from "react";

const apiBase = process.env.NEXT_PUBLIC_BACKEND_API_URL;

type FetchInit = RequestInit & { rawBody?: boolean };

export function useAccountingApi() {
  const { getToken } = useAuth();

  const request = useCallback(
    async <T = any>(path: string, init?: FetchInit): Promise<T> => {
      const token = await getToken();
      const res = await fetch(`${apiBase}${path}`, {
        ...init,
        headers: {
          "Content-Type": "application/json",
          ...(init?.headers || {}),
          Authorization: `Bearer ${token}`,
        },
      });
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
      // Backend wraps everything in { success, data, message }
      return (json?.data ?? json) as T;
    },
    [getToken],
  );

  return useMemo(() => ({ request }), [request]);
}
