"use client";

// The theme a PRINTABLE DOCUMENT should derive from.
//
// An org can wear a different app theme (enableRoleHome lays the role-home
// look over every page — see app/portal/components/RoleHome/demoTheme.ts).
// That is chrome. A document on paper — invoice preview, P&L sheet — must come
// out identical whichever chrome surrounds it, so paper code reads the theme
// from here instead of useTheme(): the app theme as it was BEFORE any org
// overlay. With no overlay active this is simply the current theme.

import * as React from "react";
import { ThemeProvider, useTheme, type Theme } from "@mui/material/styles";

const BaseThemeContext = React.createContext<Theme | null>(null);

/** Mounted by whoever applies an org overlay, holding the pre-overlay theme. */
export const BaseThemeProvider = BaseThemeContext.Provider;

/** The pre-overlay theme (or the current one when no overlay is active). */
export function useBaseTheme(): Theme {
  const base = React.useContext(BaseThemeContext);
  const current = useTheme();
  return base ?? current;
}

/** Render children under the pre-overlay theme. A no-op without an overlay. */
export function BaseTheme({ children }: { children: React.ReactNode }) {
  const base = React.useContext(BaseThemeContext);
  if (!base) return <>{children}</>;
  return <ThemeProvider theme={base}>{children}</ThemeProvider>;
}
