"use client";

// In-app Back (features.enableWctDocNav, WCT group 2026-11-17). See helpers/appNav.ts.
//   const { goBack } = useAppBack();
//   <Button onClick={() => goBack("/portal/maintenance-reports")}>Back</Button>
// Setting on: history back when the page was reached inside the app, else the
// fallback (the parent list). Setting off: router.push(fallback), as before.

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { backAction, navDepth } from "@/helpers/appNav";
import { useOrganizationFeatures } from "./useOrganizationFeatures";

export function useAppBack() {
  const router = useRouter();
  const { isWctDocNavEnabled } = useOrganizationFeatures();
  const goBack = useCallback(
    (fallback: string) => {
      const depth = typeof window !== "undefined" ? navDepth(window.history.state) : 0;
      const a = backAction({ enabled: isWctDocNavEnabled, depth, fallback });
      if (a.kind === "history") router.back();
      else router.push(a.href);
    },
    [router, isWctDocNavEnabled],
  );
  return { goBack, enabled: isWctDocNavEnabled };
}
