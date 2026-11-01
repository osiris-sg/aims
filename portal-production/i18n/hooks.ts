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
  return useCallback((code: string | null | undefined, title?: string | null) => (code && t.has(code) ? t(code) : title ?? code ?? ""), [t]);
}
