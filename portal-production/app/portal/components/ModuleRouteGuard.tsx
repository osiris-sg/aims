"use client";

import React, { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { Box, CircularProgress } from "@mui/material";
import { request } from "@/helpers/request";
import { requiredModuleFor } from "@/helpers/moduleRoutes";
import { useConfiguration } from "../context/ConfigurationContext";
import { useOrganization } from "../hooks/useOrganization";

interface ModuleOrg {
  id: string;
  name: string;
}

/**
 * Module route guard (round Y, 2026-10-22). A portal page is only rendered
 * when the module it belongs to (helpers/moduleRoutes.ts) is enabled for the
 * org being viewed. Otherwise:
 *   1. ask the backend which of this user's orgs DO have the module
 *      (GET /configuration/modules/<CODE>/organizations) and, if there is one
 *      other than the current org, switch to it keeping the URL (an admin's
 *      deep link to an ADH page while viewing Biofuel just opens under ADH);
 *   2. failing that, go to /portal (the org's home — /portal itself lands
 *      Sales orgs on their Dashboard).
 * While the configuration loads, or while deciding, a small spinner stands in
 * for the page so a disallowed page never mounts (no flash, no fetches).
 * Hotfix 2026-10-23: only the Sales hubs (/portal/shipments/*,
 * /portal/trade-documents/*) are guarded; every other path needs no module
 * and renders at once, without waiting for the module list.
 */
export default function ModuleRouteGuard({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "";
  const router = useRouter();
  const { getToken } = useAuth();
  const { modules, loading } = useConfiguration();
  const { organization, realOrganization, isLoaded: orgLoaded, setActiveOrgId } = useOrganization();

  const code = requiredModuleFor(pathname, modules);
  const settled = !loading && orgLoaded;
  const enabled = code === null || modules.some((m) => m.moduleCode === code && m.enabled);
  // One decision per (org, module, path): the switch reloads the page and the
  // fallback navigates away — neither may run twice for the same situation.
  const decidedKey = useRef<string | null>(null);

  useEffect(() => {
    if (!settled || code === null || enabled) return;
    const key = `${organization?.id ?? ""}|${code}|${pathname}`;
    if (decidedKey.current === key) return;
    decidedKey.current = key;

    let cancelled = false;
    const goHome = () => {
      if (!cancelled) router.replace("/portal");
    };
    (async () => {
      try {
        const token = await getToken();
        if (!token) return goHome();
        const res = await request({ path: `/configuration/modules/${code}/organizations`, method: "GET" }, {}, token);
        if (cancelled) return;
        const raw = res?.success ? (res.data?.data ?? res.data) : null;
        const orgs: ModuleOrg[] = Array.isArray(raw) ? raw.filter((o: ModuleOrg) => o && typeof o.id === "string") : [];
        // Never switch to the org already being viewed — that would loop.
        const target = orgs.find((o) => o.id !== organization?.id);
        if (!target) return goHome();
        // Picking the home org clears the override; anything else writes it.
        setActiveOrgId(target.id === realOrganization?.id ? null : target.id, { keepUrl: true });
      } catch (err) {
        console.error("Module route guard: cross-org lookup failed:", err);
        goHome();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [settled, code, enabled, pathname, organization?.id, realOrganization?.id, getToken, router, setActiveOrgId]);

  // Nothing to guard: render straight away.
  if (code === null || (settled && enabled)) return <>{children}</>;
  return (
    <Box
      role="status"
      aria-label="Loading"
      sx={{ flex: 1, minHeight: "40vh", display: "flex", alignItems: "center", justifyContent: "center", px: 2 }}
    >
      <CircularProgress size={28} />
    </Box>
  );
}
