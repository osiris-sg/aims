"use client";

// Round AZ — small helpers on top of next-intl's useTranslations.
import { useCallback } from "react";
import { useTranslations } from "next-intl";

/**
 * A step's name in the portal language, by its code (i18n/messages/<lang>/steps.json); the stored title when the
 * code isn't in the catalog (an org's own step). The Japanese names are proposed wording — ADH to confirm.
 */
export function useStepName() {
  const t = useTranslations("steps");
  // Round BO: step 2 of a single-billing customer invoiced there (Kato) reads "Issue and send invoices" (API SINGLE_ON_STEP2_TITLE).
  return useCallback(
    (code: string | null | undefined, title?: string | null) => {
      // Round BP: and its step 11 is the optional follow-up (実費差分 / correction invoices).
      const key = code === "INVOICE_1" && title === "Issue and send invoices" ? "INVOICE_1_SINGLE" : code === "INVOICE_2" && title === "Actual-cost / correction invoices (optional)" ? "INVOICE_2_FOLLOWUP" : code;
      return key && t.has(key) ? t(key) : (title ?? code ?? "");
    },
    [t],
  );
}
