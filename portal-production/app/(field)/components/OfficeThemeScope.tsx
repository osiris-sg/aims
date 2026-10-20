"use client";

import React from "react";
import { ThemeProvider } from "@mui/material/styles";
import lightTheme from "@/themes/lightTheme";
import darkTheme from "@/themes/darkTheme";
import { useThemeMode } from "@/contexts/ThemeModeContext";

/**
 * Re-provides the OFFICE theme inside the field app, for the printed-document
 * surfaces only (DO A4 render, maintenance report print, DO on-screen view).
 *
 * Their print themes (usePrintDocTheme, CleanDocumentPreview) are built by
 * spreading the PARENT theme, so under the field theme they would pick up the
 * field typography and component overrides and the paper would change. Wrapping
 * them here keeps the parent exactly what it was before the field redesign.
 */
export default function OfficeThemeScope({ children }: { children: React.ReactNode }) {
  const { mode } = useThemeMode();
  return <ThemeProvider theme={mode === "dark" ? darkTheme : lightTheme}>{children}</ThemeProvider>;
}
