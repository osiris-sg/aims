/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

// Round AZ — the portal language (EN / 日本語). Each user picks it per org with the switch in the top bar; it is
// saved on their member profile (PATCH /users/me/ui-lang) and remembered in this browser so a reload doesn't flash
// English. Only orgs with the SHIPMENTS module have the switch — every other org is always English. Switching
// remounts the page so plain formatters (i18n/lang) re-render too.

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { NextIntlClientProvider, type IntlError, IntlErrorCode } from "next-intl";
import { useAuth } from "@clerk/nextjs";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { request } from "@/helpers/request";
import { useConfiguration } from "@/app/portal/context/ConfigurationContext";
import { useOrganization } from "@hooks/useOrganization";
import { isUiLang, setCurrentLang, type UiLang } from "./lang";
import { messagesFor } from "./messages";

type Ctx = { lang: UiLang; available: boolean; setLang: (l: UiLang) => Promise<void>; saving: boolean };
const LangCtx = createContext<Ctx>({ lang: "en", available: false, setLang: async () => undefined, saving: false });

/** The portal language and the switch's state. Outside the provider: English. */
export const useUiLang = () => useContext(LangCtx);

const memoKey = (orgId: string) => `aims-ui-lang:${orgId}`;
const readMemo = (orgId?: string): UiLang | null => {
  if (!orgId) return null;
  try {
    const v = window.localStorage.getItem(memoKey(orgId));
    return isUiLang(v) ? v : null;
  } catch {
    return null;
  }
};
const writeMemo = (orgId: string, l: UiLang) => {
  try {
    window.localStorage.setItem(memoKey(orgId), l);
  } catch {
    /* private mode — the saved profile still has it */
  }
};

// A Japanese string not written yet falls back to English (messages.ts); never throw or log for that.
const onError = (e: IntlError) => {
  if (e.code !== IntlErrorCode.MISSING_MESSAGE && process.env.NODE_ENV !== "production") console.warn("[i18n]", e.message);
};
const TZ = typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : "UTC";

/** Wraps a subtree in the message catalogs of `lang` (also used by the preview pages with a fixed language). */
export function IntlFor({ lang, children }: { lang: UiLang; children: React.ReactNode }) {
  setCurrentLang(lang);
  return (
    <NextIntlClientProvider locale={lang} messages={messagesFor(lang) as any} timeZone={TZ} onError={onError} getMessageFallback={({ key }) => key.split(".").pop() ?? key}>
      {children}
    </NextIntlClientProvider>
  );
}

/** Fixed language without the switch (preview pages, tests). */
export function StaticUiLang({ lang, children }: { lang: UiLang; children: React.ReactNode }) {
  const value = useMemo(() => ({ lang, available: true, setLang: async () => undefined, saving: false }), [lang]);
  return (
    <LangCtx.Provider value={value}>
      <IntlFor lang={lang}>{children}</IntlFor>
    </LangCtx.Provider>
  );
}

export default function UiLangProvider({ children }: { children: React.ReactNode }) {
  const { isModuleEnabled, loading } = useConfiguration();
  const { organization } = useOrganization();
  const orgId = organization?.id as string | undefined;
  const { getToken } = useAuth();
  const qc = useQueryClient();
  const available = !loading && isModuleEnabled("SHIPMENTS");
  const [memo, setMemo] = useState<UiLang | null>(null);
  useEffect(() => setMemo(readMemo(orgId)), [orgId]);
  const q = useQuery({
    queryKey: ["me", "ui-lang", orgId],
    enabled: available && !!orgId,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<UiLang> => {
      const token = await getToken();
      const res: any = await request({ path: "/users/me/profile", method: "GET" }, {}, token ?? undefined);
      const v = (res?.data ?? res)?.uiLang;
      return isUiLang(v) ? v : "en";
    },
  });
  useEffect(() => {
    if (orgId && q.data) {
      writeMemo(orgId, q.data);
      setMemo(q.data);
    }
  }, [orgId, q.data]);
  const [saving, setSaving] = useState(false);
  // While the org's modules load, this browser's last choice for the org (only ever saved for SHIPMENTS orgs) avoids
  // an English flash and a second mount.
  const lang: UiLang = loading ? (memo ?? "en") : available ? (q.data ?? memo ?? "en") : "en";
  const setLang = useCallback(
    async (l: UiLang) => {
      if (!orgId || l === lang) return;
      setSaving(true);
      try {
        const token = await getToken();
        const res: any = await request({ path: "/users/me/ui-lang", method: "PATCH" }, { uiLang: l }, token ?? undefined);
        if (res && res.success === false) throw new Error(res.message || "Could not save the language");
        writeMemo(orgId, l);
        setMemo(l);
        qc.setQueryData(["me", "ui-lang", orgId], l);
      } finally {
        setSaving(false);
      }
    },
    [orgId, lang, getToken, qc],
  );
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);
  const value = useMemo(() => ({ lang, available, setLang, saving }), [lang, available, setLang, saving]);
  return (
    <LangCtx.Provider value={value}>
      <IntlFor lang={lang}>
        <React.Fragment key={lang}>{children}</React.Fragment>
      </IntlFor>
    </LangCtx.Provider>
  );
}
