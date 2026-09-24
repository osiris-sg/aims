"use client";

import { useMemo } from "react";
import { createTheme, useTheme, type Theme } from "@mui/material/styles";

/**
 * THE PRINTED-DOCUMENT THEME.
 *
 * A rendered document is a PRINTABLE ARTIFACT: white paper, black text, in
 * both app modes. It must not inherit the app's palette, because in dark mode
 * every theme token flips — `action.hover` becomes a light-on-dark overlay
 * (black table headers), `text.*` becomes white or grey, `background.paper`
 * becomes near-black, and a `Chip color="success"` picks the dark-mode green.
 * Serialise that into a PDF and the customer receives a black document.
 *
 * Forcing tokens one at a time does not work and is worse than doing nothing:
 * miss `action.hover` and you get black text on a black band; miss
 * `text.secondary` and you get white text on white paper. The only safe fix is
 * to force `palette.mode` to "light" so NOTHING resolves to a dark value, and
 * that is what this does.
 *
 * Extracted from CleanDocumentPreview, which has always done exactly this for
 * the DO. Both now share this one definition so the DO and the maintenance
 * report cannot drift apart.
 */
export function usePrintDocTheme(): Theme {
  const parentTheme = useTheme();
  return useMemo(
    () =>
      createTheme({
        ...parentTheme,
        palette: {
          ...parentTheme.palette,
          // See the header: forcing the MODE is what makes this complete.
          // Previously only text.primary was forced, and palette-derived
          // colours (primary, action, divider) plus the dark MuiTableRow hover
          // still leaked in, giving black text on dark surfaces.
          mode: "light",
          text: { ...parentTheme.palette.text, primary: "#000", secondary: "#444", disabled: "#888" },
          background: { ...parentTheme.palette.background, paper: "#fff", default: "#fff" },
          primary: { ...parentTheme.palette.primary, main: "#1976d2" },
          // Status colours are stated explicitly: a Chip takes its fill from
          // these, and the dark-mode variants print as the wrong green/red.
          success: { ...parentTheme.palette.success, main: "#2e7d32", contrastText: "#fff" },
          error: { ...parentTheme.palette.error, main: "#c62828", contrastText: "#fff" },
          warning: { ...parentTheme.palette.warning, main: "#ed6c02", light: "#fff4e5", contrastText: "#fff" },
          divider: "rgba(0,0,0,0.12)",
          action: {
            ...parentTheme.palette.action,
            hover: "rgba(0,0,0,0.04)",
            selected: "rgba(0,0,0,0.08)",
            disabled: "rgba(0,0,0,0.26)",
          },
        },
        typography: {
          ...parentTheme.typography,
          fontWeightRegular: 400,
          h1: { ...parentTheme.typography.h1, fontWeight: 700 },
          h2: { ...parentTheme.typography.h2, fontWeight: 600 },
          h3: { ...parentTheme.typography.h3, fontWeight: 500 },
          h4: { ...parentTheme.typography.h4, fontWeight: 600 },
          h5: { ...parentTheme.typography.h5, fontWeight: 500 },
          h6: { ...parentTheme.typography.h6, fontWeight: 500 },
          body1: { ...parentTheme.typography.body1, fontWeight: 400, color: "#000" },
          // The app theme defines the body2 VARIANT as carrying a muted grey
          // (`color: onSurfaceVariant`), so an uncoloured body2 prints grey on
          // white. Spreading the parent typography carried that into the PDF.
          // A printed document is black on white; state it here so no call site
          // can leak grey into print by forgetting an explicit colour.
          body2: { ...parentTheme.typography.body2, fontWeight: 400, color: "#000" },
          caption: { ...parentTheme.typography.caption, fontWeight: 400 },
          button: { ...parentTheme.typography.button, fontWeight: 400 },
        },
        components: {
          ...parentTheme.components,
          MuiTableCell: {
            styleOverrides: {
              // Solid-black cells. MUI TableCell otherwise pulls its colour from
              // palette.text.primary (light grey in dark mode), washing out the
              // printed table. Belt-and-suspenders with the palette above.
              root: { fontWeight: 400, color: "#000" },
              head: { fontWeight: 600, color: "#000" },
            },
          },
          // A printed document is STATIC — it must not carry the app theme's
          // interactive row hover/selected background (dark in dark mode).
          MuiTableRow: {
            styleOverrides: {
              root: {
                "&:hover": { backgroundColor: "transparent" },
                "&.Mui-selected": { backgroundColor: "transparent" },
                "&.Mui-selected:hover": { backgroundColor: "transparent" },
              },
            },
          },
          // Paper is the surface every section sits on; in dark mode its
          // background is near-black even with palette.background forced,
          // because the elevation overlay is applied on top.
          MuiPaper: {
            styleOverrides: {
              root: { backgroundColor: "#fff", backgroundImage: "none", color: "#000" },
            },
          },
        },
      }),
    [parentTheme],
  );
}
