"use client";

// The Orders list's progress (round M, N): ONE thin continuous bar — green =
// steps done (on every shipment), lighter green = done on some shipments only,
// a small amber marker = the step being worked on (red, with a red-tinted
// track, when overdue) — the count "7/14" on the same line, right side, and
// one line of label under it ("Step 7 · Customs docs & tax": the furthest-
// behind open step; round AD: wraps, never "…"). The denominator is the
// order's whole process (shipment steps count as not started before the first
// shipment). An order with several shipments shows each shipment's mini bar on
// hover (#19-1 8/10, #19-2 6/10).

import React from "react";
import { Box, Stack, Tooltip, Typography } from "@mui/material";
import { useTranslations } from "next-intl";
import type { CurrentStep, ListBar } from "../_lib/api";
import { barCount, barGeometry, type BarInput } from "../_lib/progress";
import { useUiLang } from "@/i18n/UiLangProvider";
import { useStepName } from "@/i18n/hooks";

/** The bar's label / tooltip: the API's English text; in Japanese rebuilt from the step's code (same shape). */
function useBarText() {
  const { lang } = useUiLang();
  const t = useTranslations("orders.progress");
  const stepName = useStepName();
  return (bar: ListBar, step?: CurrentStep): { label: string | null; title: string | null } => {
    if (lang !== "ja") return { label: bar.label, title: bar.title ?? null };
    if (!step) return { label: bar.label === "Done" ? t("done") : bar.label === "No steps" ? t("noSteps") : bar.label, title: bar.title ?? null };
    const name = step.code === "AWAITING_SHIPMENT" ? t("awaitingShipment") : stepName(step.code, step.title);
    return step.displayNo ? { label: t("stepLabel", { no: step.displayNo, name }), title: `${step.displayNo}. ${name}` } : { label: name, title: name };
  };
}

export function ThinBar({ bar, height = 6 }: { bar: BarInput; height?: number }) {
  const t = useTranslations("orders.progress");
  const g = barGeometry(bar);
  return (
    <Box
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={bar.total}
      aria-valuenow={bar.done}
      data-tour="orders-progress-bar"
      sx={{
        display: "flex",
        flex: 1,
        minWidth: 0,
        height,
        borderRadius: height,
        overflow: "hidden",
        bgcolor: g.tint === "overdue" ? "rgba(211,47,47,0.18)" : "action.disabledBackground",
      }}
    >
      {/* Plain flex boxes — nothing positioned: done (green), then the step being worked on (amber / red). */}
      <Box sx={{ width: `${g.fillPct}%`, flexShrink: 0, bgcolor: "success.main" }} />
      {g.partialPct > 0 && <Box data-testid="bar-partial" title={t("partial")} sx={{ width: `${g.partialPct}%`, flexShrink: 0, bgcolor: "success.light", opacity: 0.55 }} />}
      {g.markerPct !== null && <Box data-testid="bar-marker" sx={{ width: `${g.markerWidthPct}%`, flexShrink: 0, bgcolor: g.tint === "overdue" ? "error.main" : "warning.main" }} />}
    </Box>
  );
}

type Shipment = { ref: string; bar?: ListBar; currentStep?: CurrentStep };

export default function ProgressBarCell({ bar, shipments, currentStep }: { bar?: ListBar | null; shipments?: Shipment[]; currentStep?: CurrentStep }) {
  const barText = useBarText();
  if (!bar) return <Typography variant="body2">—</Typography>;
  const ships = (shipments ?? []).filter((s) => s.bar && s.bar.total);
  const text = barText(bar, currentStep);
  const body = (
    // Above the table's stretched row link (zIndex 0) so hover reaches the tooltips; a click still bubbles to the row.
    <Box sx={{ width: "100%", minWidth: 0, position: "relative", zIndex: 1 }} data-testid="progress-hover">
      <Stack direction="row" spacing={1} alignItems="center">
        <ThinBar bar={bar} />
        <Typography variant="caption" color="text.secondary" sx={{ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap", flexShrink: 0 }} data-testid="bar-count">
          {barCount(bar)}
        </Typography>
      </Stack>
      <Tooltip title={text.title ?? ""} disableHoverListener={!text.title || ships.length >= 2} placement="bottom-start">
        <Typography variant="caption" component="div" sx={{ mt: 0.25, whiteSpace: "normal", wordBreak: "break-word" }} data-testid="bar-label">
          {text.label ?? "—"}
        </Typography>
      </Tooltip>
    </Box>
  );
  if (ships.length < 2) return body;
  return (
    <Tooltip
      placement="bottom-start"
      title={
        <Stack spacing={1} sx={{ py: 0.5, minWidth: 220 }}>
          {text.title && (
            <Typography variant="caption" sx={{ fontWeight: 700 }}>
              {text.title}
            </Typography>
          )}
          {ships.map((s) => (
            <Box key={s.ref}>
              <Stack direction="row" spacing={1} alignItems="center">
                <Typography variant="caption" sx={{ fontWeight: 700, width: 44 }}>
                  {s.ref}
                </Typography>
                <ThinBar bar={s.bar!} height={4} />
                <Typography variant="caption" sx={{ fontVariantNumeric: "tabular-nums" }}>
                  {barCount(s.bar!)}
                </Typography>
              </Stack>
              {s.bar!.label && (
                <Typography variant="caption" component="div" sx={{ opacity: 0.85, pl: 6.5 }}>
                  {barText(s.bar!, s.currentStep).label}
                </Typography>
              )}
            </Box>
          ))}
        </Stack>
      }
    >
      {body}
    </Tooltip>
  );
}
