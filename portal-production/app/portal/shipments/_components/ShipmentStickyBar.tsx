"use client";

// Round BW (Sayaka, 18 Nov): a slim bar above a shipment's steps that sticks under the top nav while the steps scroll
// ("#25-1 · SUS · 6063 · 305.949 t · B/L … · vessel / voyage · ETA …" + the current step), so a deep step (7's tax and
// courier cards) still shows which shipment it is. It is sticky in the page flow, so it narrows with the page when
// the AIMEE side panel is open instead of going under it. No truncation: on a narrow screen the line wraps.

import React from "react";
import { Box, Stack, Typography } from "@mui/material";
import { useLocale, useTranslations } from "next-intl";
import type { CurrentStep } from "../_lib/api";
import { headerStepText } from "../_lib/order-focus";

/** Below the fixed mobile app bar (56 / 64) and the sticky desktop top nav (52). */
export const STICKY_TOP = { xs: 56, sm: 64, md: 52 } as const;

/** "Step 7 · Customs documents & tax estimate" — in Japanese the step's name from the steps catalog (ステップ7 · 通関書類・輸入税見積). */
function useStepText(current: CurrentStep, total: number): string {
  const ts = useTranslations("steps");
  const ja = useLocale() === "ja";
  if (current && ja && ts.has(current.code as never)) return headerStepText({ ...current, title: ts(current.code as never) }, total, "ja");
  return headerStepText(current, total, ja ? "ja" : "en");
}

export default function ShipmentStickyBar({ title, facts, current, total, stepOverride, status, actions }: { title: string; facts: Array<string | null | undefined | false>; current: CurrentStep; total: number; stepOverride?: string | null; status?: React.ReactNode; actions?: React.ReactNode }) {
  const stepText = useStepText(current, total);
  const step = stepOverride ?? stepText;
  const parts = facts.filter((x): x is string => typeof x === "string" && x.trim() !== "");
  return (
    <Box
      data-tour="shipment-sticky-bar"
      sx={{
        position: "sticky",
        top: STICKY_TOP,
        // Over the step cards, under the nav, menus and dialogs.
        zIndex: (th) => th.zIndex.appBar - 1,
        mb: 1.5,
        px: 1.5,
        py: 0.75,
        bgcolor: "background.paper",
        border: 1,
        borderColor: "divider",
        borderRadius: 1.5,
        boxShadow: (th) => (th.palette.mode === "dark" ? "0 2px 8px rgba(0,0,0,0.5)" : "0 2px 8px rgba(15,23,42,0.08)"),
      }}
    >
      <Stack direction="row" alignItems="center" flexWrap="wrap" useFlexGap columnGap={1.25} rowGap={0.25}>
        <Typography variant="subtitle2" sx={{ fontWeight: 800, fontSize: "0.95rem" }}>
          {title}
        </Typography>
        {status}
        {parts.map((p, i) => (
          <Typography key={i} variant="body2" color="text.secondary" sx={{ whiteSpace: "nowrap" }}>
            {i === 0 ? p : `· ${p}`}
          </Typography>
        ))}
        <Box sx={{ flex: 1 }} />
        {step && (
          <Typography variant="body2" sx={{ fontWeight: 700, color: "primary.main" }} data-tour="shipment-sticky-step">
            {step}
          </Typography>
        )}
        {actions}
      </Stack>
    </Box>
  );
}
