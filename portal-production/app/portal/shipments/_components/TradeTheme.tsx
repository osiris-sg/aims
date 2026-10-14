"use client";

// Shipments / trade Documents pages: "done" reads GREEN in both modes. Dark
// mode's success is already green (tertiary #6FFBBE); the org-wide light theme
// is monochrome (success = near-black), which made Done chips, progress bars
// and the Complete button look grey/black here. This nested theme gives light
// mode a green success for these pages only — every color="success" (chips,
// LinearProgress, buttons, "Completed" text) — leaving the rest of the app as is.

import React from "react";
import { alpha, ThemeProvider, type Theme } from "@mui/material/styles";

/** Light-mode green with AA contrast on white (green-700). */
const GREEN = { main: "#15803D", light: "#DCFCE7", dark: "#166534", contrastText: "#FFFFFF" };

const withGreen = (outer: Theme): Theme => {
  if (outer.palette.mode === "dark") return outer;
  const chip = (outer.components?.MuiChip ?? {}) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
  return {
    ...outer,
    palette: { ...outer.palette, success: { ...outer.palette.success, ...GREEN } },
    components: {
      ...outer.components,
      MuiChip: {
        ...chip,
        styleOverrides: { ...(chip.styleOverrides ?? {}), colorSuccess: { backgroundColor: alpha(GREEN.main, 0.1), color: GREEN.main } },
      },
    },
  };
};

export default function TradeTheme({ children }: { children: React.ReactNode }) {
  return <ThemeProvider theme={withGreen}>{children}</ThemeProvider>;
}
