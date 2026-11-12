// The role-home look, applied to EVERY page of an org with enableRoleHome
// (guru 2026-11-06: "only for this org use this same UI everywhere").
//
// It is the normal AIMS theme with the mock-up's tokens laid over it: Plus
// Jakarta Sans, the lilac-grey page (#F2F4FA), white 14px cards with the soft
// two-layer shadow, deep-indigo primary (#2B2257) on pill buttons, teal
// (#1BA39C) as the accent, and the mock-up's red for anything urgent.
// Nothing about a page's structure or behaviour changes — the same components
// render, wearing different tokens — so no screen needs a second version.
//
// Derived from the theme that is already active, so light and dark both work
// and the type scale, densities and every override not named here are kept.

import { alpha, createTheme, type Theme } from "@mui/material/styles";
import { DEMO_FONT } from "./demoFont";

const NAVY = "#2B2257";
const NAVY_HOVER = "#3A2F72";
const TEAL = "#1BA39C";
const RED = "#E5293F";
const INK = "#1C1A33";
const MUTED = "#64748B";
const PAGE = "#F2F4FA";
const SURFACE_LOW = "#F4F6FB";
const SURFACE_MID = "#EEF0F8";
const LINE = "#E2E8F0";

const CARD_SHADOW = "0 1px 2px rgba(28, 26, 51, 0.04), 0 4px 16px rgba(28, 26, 51, 0.05)";

export function buildDemoTheme(base: Theme): Theme {
  const dark = base.palette.mode === "dark";
  // Dark keeps the base palette's surfaces (the mock-up is light-only) and
  // takes the typeface, shapes and accents.
  const primaryMain = dark ? "#B9B0F2" : NAVY;
  const family = { fontFamily: DEMO_FONT };
  const heading = { fontFamily: DEMO_FONT, letterSpacing: "-0.01em" };

  return createTheme(base, {
    palette: {
      primary: { main: primaryMain, light: dark ? "#D3CCFA" : NAVY_HOVER, dark: dark ? "#9B90E0" : "#1F1842", contrastText: dark ? "#16122E" : "#FFFFFF" },
      secondary: { main: TEAL, light: "#E3F5F3", dark: "#178F8A", contrastText: "#FFFFFF" },
      success: { main: dark ? "#34D399" : "#059669", light: "#D1FAE5", dark: "#047857", contrastText: "#FFFFFF" },
      error: { main: RED, light: "#FDE6EA", dark: "#B81D30", contrastText: "#FFFFFF" },
      info: { main: dark ? "#8FD3CF" : "#178F8A", light: "#E3F5F3", dark: "#126E69", contrastText: "#FFFFFF" },
      ...(dark
        ? {}
        : {
            text: { primary: INK, secondary: MUTED, disabled: alpha(INK, 0.38) },
            background: { default: PAGE, paper: "#FFFFFF" },
            divider: LINE,
            outlineVariant: LINE,
            surfaceTones: {
              base: PAGE,
              low: SURFACE_LOW,
              lowest: "#FFFFFF",
              container: SURFACE_LOW,
              high: SURFACE_MID,
              highest: "#E2E5F2",
              dim: LINE,
            },
          }),
    },
    shape: { borderRadius: 12 },
    // Every variant is named: the base theme is already BUILT, so each variant
    // carries its own baked-in fontFamily and the root key alone changes
    // nothing a Typography actually renders with.
    typography: {
      fontFamily: DEMO_FONT,
      h1: heading,
      h2: heading,
      h3: heading,
      h4: heading,
      h5: family,
      h6: family,
      subtitle1: family,
      subtitle2: family,
      body1: family,
      body2: dark ? family : { ...family, color: MUTED },
      button: family,
      caption: family,
      overline: family,
    },
    components: {
      MuiCssBaseline: {
        styleOverrides: dark ? {} : { body: { backgroundColor: PAGE, color: INK } },
      },
      MuiButton: {
        styleOverrides: {
          // The mock-up's buttons are pills.
          root: { borderRadius: 999, fontFamily: DEMO_FONT, fontWeight: 500, padding: "6px 16px" },
          containedPrimary: dark
            ? { backgroundImage: "none", backgroundColor: primaryMain, color: "#16122E", "&:hover": { backgroundColor: "#D3CCFA" } }
            : { backgroundColor: NAVY, color: "#FFFFFF", "&:hover": { backgroundColor: NAVY_HOVER, boxShadow: "none" } },
          ...(dark
            ? {}
            : {
                outlined: {
                  borderColor: LINE,
                  color: INK,
                  backgroundColor: "#FFFFFF",
                  "&:hover": { borderColor: alpha(NAVY, 0.35), backgroundColor: SURFACE_LOW },
                },
                text: { color: INK, "&:hover": { backgroundColor: SURFACE_LOW } },
              }),
        },
      },
      MuiIconButton: {
        styleOverrides: { root: { borderRadius: 999, ...(dark ? {} : { "&:hover": { backgroundColor: SURFACE_MID } }) } },
      },
      MuiCard: {
        styleOverrides: {
          root: dark
            ? { borderRadius: 14 }
            : { borderRadius: 14, border: "none", boxShadow: CARD_SHADOW, "&:hover": { boxShadow: CARD_SHADOW } },
        },
      },
      MuiPaper: {
        styleOverrides: {
          rounded: { borderRadius: 14 },
          ...(dark ? {} : { outlined: { borderColor: LINE } }),
        },
      },
      MuiDialog: { styleOverrides: { paper: { borderRadius: 20 } } },
      MuiMenu: {
        styleOverrides: { paper: { borderRadius: 14, ...(dark ? {} : { border: `1px solid ${LINE}`, boxShadow: "0 10px 30px rgba(28, 26, 51, 0.10)" }) } },
      },
      MuiMenuItem: {
        styleOverrides: {
          root: { borderRadius: 8, ...(dark ? {} : { "&.Mui-selected": { backgroundColor: SURFACE_MID, "&:hover": { backgroundColor: "#E2E5F2" } } }) },
        },
      },
      MuiOutlinedInput: { styleOverrides: { root: { borderRadius: 12 } } },
      MuiTextField: {
        styleOverrides: {
          root: {
            "& .MuiOutlinedInput-root": {
              borderRadius: 12,
              ...(dark
                ? {}
                : {
                    "& fieldset": { borderColor: LINE },
                    "&:hover fieldset": { borderColor: "#CBD5E1" },
                    "&.Mui-focused": { boxShadow: `0 0 0 2px ${alpha(TEAL, 0.25)}` },
                    "&.Mui-focused fieldset": { borderColor: TEAL, borderWidth: 1 },
                  }),
            },
          },
        },
      },
      // Dark: DM Sans at 400 drops below comfortable stroke weight when it is
      // light-on-dark (guru 2026-11-13), so data text runs one notch heavier.
      // Light keeps 400 — the same weight on white reads fine.
      MuiInputBase: { styleOverrides: dark ? { input: { fontWeight: 500 } } : {} },
      MuiTableCell: {
        styleOverrides: dark
          ? { body: { fontWeight: 500 } }
          : {
              root: { color: INK, borderBottom: `1px solid ${SURFACE_MID}` },
              head: { color: MUTED, backgroundColor: SURFACE_LOW, borderBottom: `1px solid ${LINE}` },
            },
      },
      MuiTableRow: {
        styleOverrides: dark ? {} : { root: { "&.MuiTableRow-hover:hover": { backgroundColor: SURFACE_LOW } } },
      },
      MuiTabs: { styleOverrides: { indicator: { backgroundColor: TEAL } } },
      MuiTab: { styleOverrides: { root: { fontFamily: DEMO_FONT, ...(dark ? {} : { "&.Mui-selected": { color: INK } }) } } },
      MuiChip: {
        styleOverrides: {
          root: { fontFamily: DEMO_FONT },
          colorSuccess: { backgroundColor: alpha(TEAL, 0.14), color: dark ? "#6EE7D9" : "#126E69" },
          colorError: { backgroundColor: dark ? alpha(RED, 0.22) : "#FDE6EA", color: dark ? "#FF8A9B" : RED },
        },
      },
      MuiCheckbox: { styleOverrides: { root: { "&.Mui-checked": { color: dark ? primaryMain : NAVY } } } },
      MuiSwitch: {
        styleOverrides: {
          switchBase: { "&.Mui-checked": { color: TEAL }, "&.Mui-checked + .MuiSwitch-track": { backgroundColor: TEAL } },
        },
      },
      MuiTooltip: { styleOverrides: dark ? {} : { tooltip: { backgroundColor: INK, borderRadius: 8 }, arrow: { color: INK } } },
      MuiLinearProgress: { styleOverrides: { bar: { backgroundColor: TEAL } } },
    },
  });
}

/**
 * The CSS custom properties in globals.css that pages read directly
 * (`var(--surface)`, `var(--field-border)`…). Light only — the dark values
 * stay as they are.
 */
export const DEMO_CSS_VARS_LIGHT = {
  "--surface": PAGE,
  "--surface-container-low": SURFACE_LOW,
  "--surface-container-lowest": "#FFFFFF",
  "--surface-container": SURFACE_LOW,
  "--surface-container-high": SURFACE_MID,
  "--surface-container-highest": "#E2E5F2",
  "--surface-dim": LINE,
  "--field-border": "#CBD5E1",
  "--field-border-hover": "#94A3B8",
  "--table-grid": LINE,
  "--on-surface": INK,
  "--on-surface-variant": MUTED,
  "--primary-deep": NAVY,
  "--primary-container": NAVY_HOVER,
  "--outline-variant": LINE,
  "--default-border-radius": "0.75rem",
} as const;
