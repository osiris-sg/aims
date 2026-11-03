"use client";

import { useOrganizationFeatures } from "@/app/portal/hooks/useOrganizationFeatures";
import { runWords, type RunWords } from "@/helpers/jobWording";

/** "Job" for WCT (enableWctOrders), "Delivery" for everyone else. See helpers/jobWording.ts. */
export function useRunWords(): RunWords & { isWct: boolean } {
  const { isWctOrdersEnabled } = useOrganizationFeatures();
  return { ...runWords(!!isWctOrdersEnabled), isWct: !!isWctOrdersEnabled };
}
