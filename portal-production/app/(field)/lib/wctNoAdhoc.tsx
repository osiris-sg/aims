"use client";

import React, { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useOrganizationFeatures } from "@/app/portal/hooks/useOrganizationFeatures";

/**
 * WCT (enableWctOrders, 2026-11-03): every job starts from an order, so the
 * field app's ad-hoc / scan-a-unit start flows are closed for it. A WCT worker
 * who reaches one (an old link, a bookmark) is sent to the Jobs list.
 * Other orgs: the page as before.
 */
export function withNoAdhocForWct<P extends object>(Page: React.ComponentType<P>) {
  function Guarded(props: P) {
    const router = useRouter();
    const { isWctOrdersEnabled, isLoading } = useOrganizationFeatures();
    useEffect(() => {
      if (!isLoading && isWctOrdersEnabled) router.replace("/scan");
    }, [isLoading, isWctOrdersEnabled, router]);
    if (isLoading || isWctOrdersEnabled) return null;
    return <Page {...props} />;
  }
  Guarded.displayName = `NoAdhocForWct(${Page.displayName || Page.name || "Page"})`;
  return Guarded;
}
