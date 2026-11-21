"use client";

// Round BW (Sayaka, 18 Nov): a slim bar above a shipment's steps that sticks under the top nav while the steps scroll
// ("#25-1 · SUS · 6063 · 305.949 t · B/L … · vessel / voyage · ETA …" + the current step), so a deep step (7's tax and
// courier cards) still shows which shipment it is. It is sticky in the page flow, so it narrows with the page when
// the AIMEE side panel is open instead of going under it. No truncation: on a narrow screen the line wraps.
// Round BX: ‹ ▾ › switch to the order's other shipments, keeping the same card in view (see _lib/keep-place.ts).

import React, { useState } from "react";
import { Box, Button, IconButton, ListItemText, Menu, MenuItem, Stack, Tooltip, Typography } from "@mui/material";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import ArrowDropDownIcon from "@mui/icons-material/ArrowDropDown";
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

/** Round BX (Sayaka): ‹ #25-1 ▾ › — the other shipments of the order (or deal), without scrolling back up. */
export type ShipmentSwitcher = { items: Array<{ id: string; label: string; hint?: string | null }>; currentId: string; onSwitch: (id: string) => void };

function Switcher({ title, sw }: { title: string; sw: ShipmentSwitcher }) {
  const t = useTranslations("shipments.stickyBar");
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const i = sw.items.findIndex((x) => x.id === sw.currentId);
  const prev = i > 0 ? sw.items[i - 1] : null;
  const next = i >= 0 && i < sw.items.length - 1 ? sw.items[i + 1] : null;
  const arrow = (to: typeof prev, label: string, icon: React.ReactNode, tour: string) => (
    <Tooltip title={to ? `${label} · ${to.label}` : label}>
      <span>
        <IconButton size="small" disabled={!to} onClick={() => to && sw.onSwitch(to.id)} aria-label={label} data-tour={tour} sx={{ p: 0.25 }}>
          {icon}
        </IconButton>
      </span>
    </Tooltip>
  );
  return (
    <Stack direction="row" alignItems="center" spacing={0} data-tour="shipment-sticky-switcher">
      {arrow(prev, t("prev"), <ChevronLeftIcon fontSize="small" />, "shipment-sticky-prev")}
      <Button
        size="small"
        color="inherit"
        endIcon={<ArrowDropDownIcon />}
        onClick={(e) => setAnchor(e.currentTarget)}
        aria-label={t("pick")}
        data-tour="shipment-sticky-pick"
        sx={{ minWidth: 0, px: 0.75, py: 0, fontWeight: 800, fontSize: "0.95rem", textTransform: "none", "& .MuiButton-endIcon": { ml: 0 } }}
      >
        {title}
      </Button>
      {arrow(next, t("next"), <ChevronRightIcon fontSize="small" />, "shipment-sticky-next")}
      <Menu anchorEl={anchor} open={!!anchor} onClose={() => setAnchor(null)}>
        {sw.items.map((x) => (
          <MenuItem
            key={x.id}
            selected={x.id === sw.currentId}
            dense
            onClick={() => {
              setAnchor(null);
              if (x.id !== sw.currentId) sw.onSwitch(x.id);
            }}
          >
            <ListItemText primary={x.label} secondary={x.hint ?? undefined} primaryTypographyProps={{ fontWeight: 700 }} />
          </MenuItem>
        ))}
      </Menu>
    </Stack>
  );
}

export default function ShipmentStickyBar({ title, facts, current, total, stepOverride, status, actions, switcher }: { title: string; facts: Array<string | null | undefined | false>; current: CurrentStep; total: number; stepOverride?: string | null; status?: React.ReactNode; actions?: React.ReactNode; switcher?: ShipmentSwitcher | null }) {
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
        {switcher && switcher.items.length > 1 ? (
          <Switcher title={title} sw={switcher} />
        ) : (
          <Typography variant="subtitle2" sx={{ fontWeight: 800, fontSize: "0.95rem" }}>
            {title}
          </Typography>
        )}
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
