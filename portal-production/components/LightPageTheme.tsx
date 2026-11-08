"use client";

// Public, client-facing pages (sign / pay / signature links) are a single
// LIGHT document whatever theme the viewer's browser or portal session is in.
// They already pin a light canvas; this pins the MUI theme to match, so text,
// fields, checkboxes and buttons stop inheriting the dark palette and reading
// white-on-white (guru 2026-11-08, photo of a client's VO sign page).

import React from "react";
import { ThemeProvider } from "@mui/material/styles";
import lightTheme from "@/themes/lightTheme";

export default function LightPageTheme({ children }: { children: React.ReactNode }) {
  return <ThemeProvider theme={lightTheme}>{children}</ThemeProvider>;
}
