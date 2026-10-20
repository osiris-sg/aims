"use client";

import React from "react";
import { Box, Paper, Stack, Typography } from "@mui/material";
import type { SxProps, Theme } from "@mui/material/styles";
import { useTheme } from "@mui/material/styles";
import { fieldTone, type FieldTone } from "@/themes/fieldTheme";

/**
 * Small shared pieces of the field app's look (SiteClock `widgets/ui.dart`):
 * StatusChip, EmptyState, SectionHeader, ListCard, plus the one big-button sx.
 * Presentation only: nothing here owns state, routing or data.
 */

/** The field app's primary-action size (was copied into six screens). */
export const FIELD_BUTTON_SX = { minHeight: 48, fontSize: "0.9375rem" } as const;

/** AIMS status words -> SiteClock tone. Unknown statuses read as neutral. */
const STATUS_TONE: Record<string, FieldTone> = {
  completed: "good",
  signed: "good",
  delivered: "info",
  in_progress: "warn",
  pending: "warn",
  scheduled: "info",
  draft: "warn",
  cancelled: "bad",
  failed: "bad",
};

export function toneForStatus(status: string | null | undefined): FieldTone {
  return STATUS_TONE[String(status ?? "").toLowerCase()] ?? "neutral";
}

/** Tone pill: 11 / w700 / 0.3 letter-spacing, radius 20, tone colours. */
export function StatusChip({ label, tone = "neutral", sx }: { label: React.ReactNode; tone?: FieldTone; sx?: SxProps<Theme> }) {
  const theme = useTheme();
  const { bg, fg } = fieldTone(theme, tone);
  return (
    <Box
      component="span"
      sx={[
        {
          display: "inline-flex",
          alignItems: "center",
          flexShrink: 0,
          px: 1.25,
          py: 0.5,
          borderRadius: "20px",
          bgcolor: bg,
          color: fg,
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: "0.3px",
          lineHeight: 1.3,
          whiteSpace: "nowrap",
        },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
    >
      {label}
    </Box>
  );
}

/** Grey icon + message, onSurface @45 %. */
export function EmptyState({ icon, message, children }: { icon?: React.ReactNode; message: React.ReactNode; children?: React.ReactNode }) {
  return (
    <Stack alignItems="center" spacing={1.5} sx={{ py: 6, px: 4, textAlign: "center", color: (t) => (t.palette.mode === "dark" ? "rgba(227,230,235,0.45)" : "rgba(26,28,31,0.45)") }}>
      {icon && <Box sx={{ "& .MuiSvgIcon-root": { fontSize: 44 }, lineHeight: 0 }}>{icon}</Box>}
      <Typography sx={{ fontSize: 14, color: "inherit" }}>{message}</Typography>
      {children}
    </Stack>
  );
}

/** Section title inside a page body (16 / w700) with an optional trailing action. */
export function SectionHeader({ title, action, sx }: { title: React.ReactNode; action?: React.ReactNode; sx?: SxProps<Theme> }) {
  return (
    <Stack direction="row" alignItems="center" sx={[{ minHeight: 32 }, ...(Array.isArray(sx) ? sx : [sx])]}>
      <Typography variant="subtitle1" sx={{ flex: 1, minWidth: 0 }}>
        {title}
      </Typography>
      {action}
    </Stack>
  );
}

/** One card holding a list of rows (SiteClock menu card). */
export function ListCard({ children, sx }: { children: React.ReactNode; sx?: SxProps<Theme> }) {
  return (
    <Paper
      variant="outlined"
      sx={[
        { borderRadius: "16px", overflow: "hidden", p: 0, "& .MuiListItemButton-root": { borderRadius: 0 } },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
    >
      {children}
    </Paper>
  );
}
