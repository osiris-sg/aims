"use client";

// Round AZ — EN / 日本語 in the top bar (orgs with the SHIPMENTS module only). Saved per user per org.

import React from "react";
import { Box, ButtonBase, Tooltip } from "@mui/material";
import { toast } from "react-toastify";
import { useUiLang } from "@/i18n/UiLangProvider";
import type { UiLang } from "@/i18n/lang";

const OPTIONS: Array<{ lang: UiLang; label: string }> = [
  { lang: "en", label: "EN" },
  { lang: "ja", label: "日本語" },
];

export default function LangSwitch({ dark = true }: { dark?: boolean }) {
  const { lang, available, setLang, saving } = useUiLang();
  if (!available) return null;
  const pick = (l: UiLang) => {
    if (l === lang || saving) return;
    setLang(l).catch((e: Error) => toast.error(e.message || "Could not save the language"));
  };
  const fg = dark ? "rgba(255,255,255,0.75)" : "text.secondary";
  return (
    <Tooltip title={lang === "ja" ? "表示言語" : "Language"}>
      <Box role="group" aria-label="Language" data-tour="lang-switch" sx={{ display: "inline-flex", borderRadius: 999, p: "2px", bgcolor: dark ? "rgba(255,255,255,0.08)" : "action.hover", flexShrink: 0 }}>
        {OPTIONS.map((o) => {
          const on = o.lang === lang;
          return (
            <ButtonBase
              key={o.lang}
              onClick={() => pick(o.lang)}
              disabled={saving}
              aria-pressed={on}
              lang={o.lang}
              sx={{ px: 1, height: 24, borderRadius: 999, fontSize: "0.72rem", fontWeight: 700, color: on ? (dark ? "#0b1324" : "primary.contrastText") : fg, bgcolor: on ? (dark ? "rgba(255,255,255,0.92)" : "primary.main") : "transparent", "&:focus-visible": { outline: "2px solid rgba(85,233,255,0.8)" } }}
            >
              {o.label}
            </ButtonBase>
          );
        })}
      </Box>
    </Tooltip>
  );
}
