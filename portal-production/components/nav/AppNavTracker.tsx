"use client";

// Records the in-app history depth (helpers/appNav.ts) for orgs with
// features.enableWctDocNav; renders nothing. Other orgs: not installed.
import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { installAppNavTracker } from "@/helpers/appNav";
import { useOrganizationFeatures } from "@/app/portal/hooks/useOrganizationFeatures";

export default function AppNavTracker() {
  const { isWctDocNavEnabled } = useOrganizationFeatures();
  const pathname = usePathname();
  useEffect(() => {
    // Re-checked on every route change: a router remount may restore unwrapped functions.
    if (isWctDocNavEnabled && typeof window !== "undefined") installAppNavTracker(window.history);
  }, [isWctDocNavEnabled, pathname]);
  return null;
}
