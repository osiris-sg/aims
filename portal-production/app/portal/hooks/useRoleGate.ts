"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { request } from "@/helpers/request";

/**
 * Classifies the signed-in user's roles for route-group isolation.
 *
 * Mirrors FieldOnlyGuard's approach (GET /users/me/roles), but as a reusable
 * hook so the (field) and (submit) layouts can bounce restricted roles to
 * their own home without duplicating the fetch. Fail-open: on any error the
 * names list stays empty, so every `only*` flag is false and no one is locked
 * out on a transient failure — the backend permission gates remain the real
 * enforcement.
 */
export interface RoleGate {
  loading: boolean;
  names: string[];
  onlyFieldTech: boolean;
  onlyNormalUser: boolean;
  hasNormalUser: boolean;
  isAdmin: boolean;
}

export function useRoleGate(): RoleGate {
  const { getToken } = useAuth();
  const [names, setNames] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = await getToken();
        if (!token) {
          if (!cancelled) setLoading(false);
          return;
        }
        const res = await request({ path: "/users/me/roles", method: "GET" }, {}, token);
        const roles = (res?.data ?? res ?? []) as Array<{ name?: string }>;
        if (cancelled) return;
        setNames(roles.map((r) => (r?.name ?? "").toLowerCase()));
      } catch {
        // fail-open — leave names empty so no `only*` flag trips.
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [getToken]);

  const onlyFieldTech = names.length > 0 && names.every((n) => n === "field-tech");
  const onlyNormalUser = names.length > 0 && names.every((n) => n === "normal_user");
  const hasNormalUser = names.includes("normal_user");
  const isAdmin = names.some((n) => n === "superadmin" || n === "osirisadmin");

  return { loading, names, onlyFieldTech, onlyNormalUser, hasNormalUser, isAdmin };
}
