"use client";

import React from "react";
import { ThemeProvider } from "@mui/material/styles";
import lightTheme from "@/themes/lightTheme";

/**
 * Re-provides the OFFICE theme inside the field app, for the printed-document
 * surfaces only (DO A4 render, maintenance report print, DO on-screen view).
 *
 * Their print themes (usePrintDocTheme, CleanDocumentPreview) are built by
 * spreading the PARENT theme, so under the field theme they would pick up the
 * field typography and component overrides and the paper would change. Wrapping
 * them here keeps the parent exactly what it was before the field redesign.
 *
 * Always the LIGHT office theme: these are paper documents, and they keep
 * their fixed light look whatever the rider chose for the app (Light / Dark /
 * Follow phone) and whatever the office portal's own toggle says.
 */
export default function OfficeThemeScope({ children }: { children: React.ReactNode }) {
  return <ThemeProvider theme={lightTheme}>{children}</ThemeProvider>;
}
