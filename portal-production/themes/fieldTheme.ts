"use client";
import { createTheme, alpha, type Theme } from "@mui/material/styles";

/**
 * THE FIELD APP THEME (rider screens under app/(field), Capacitor shell).
 *
 * Modelled on SiteClock's Flutter theme (docs/design-reference/DESIGN_SPEC.md):
 * navy brand, flat cards with a 1px border, 12px inputs/buttons, 16px cards,
 * 20px dialogs and chips, 48px primary buttons at 15/700, Roboto.
 *
 * Provided ONLY by app/(field)/layout.tsx, so the office portal keeps
 * themes/lightTheme + darkTheme. Printed documents (DO, service report) are
 * re-wrapped in the office theme by OfficeThemeScope, so paper output does not
 * change with this file.
 */

export type FieldMode = "light" | "dark";
export type FieldTone = "good" | "warn" | "bad" | "info" | "neutral";

export const FIELD_BRAND_NAVY = "#14365C";
export const FIELD_BRAND_ACCENT = "#2F80ED";

const TOKENS = {
  light: {
    primary: FIELD_BRAND_NAVY,
    primaryLight: "#2A5486",
    primaryDark: "#0C2440",
    onPrimary: "#FFFFFF",
    scaffold: "#F4F6F9",
    surface: "#FFFFFF",
    border: "#E4E8EE",
    inputBorder: "#D7DDE5",
    onSurface: "#1A1C1F",
    appBar: FIELD_BRAND_NAVY,
    onAppBar: "#FFFFFF",
    navIndicator: alpha(FIELD_BRAND_NAVY, 0.1),
  },
  dark: {
    primary: "#8FB6E8",
    primaryLight: "#B3CEF0",
    primaryDark: "#6E9BD6",
    onPrimary: "#0B2340",
    scaffold: "#12151A",
    surface: "#1C2128",
    border: "rgba(255,255,255,0.10)",
    inputBorder: "rgba(255,255,255,0.12)",
    onSurface: "#E3E6EB",
    appBar: "#1C2128",
    onAppBar: "#E3E6EB",
    navIndicator: alpha(FIELD_BRAND_ACCENT, 0.25),
  },
} as const;

/** Status tone pairs [background, foreground], SiteClock `toneColors()`. */
const TONES: Record<FieldMode, Record<FieldTone, [string, string]>> = {
  light: {
    good: ["#E1F4E8", "#1B7F45"],
    warn: ["#FDF0DC", "#A96A0B"],
    bad: ["#FCE5E3", "#B3362B"],
    info: ["#E3EEFB", "#1C5FAD"],
    neutral: ["#EBEEF2", "#5A6472"],
  },
  dark: {
    good: ["#1F3A2C", "#7BD8A0"],
    warn: ["#3E321A", "#F0C36C"],
    bad: ["#41262A", "#F2938C"],
    info: ["#20303F", "#84BDF0"],
    neutral: ["#2A2F36", "#B6BDC6"],
  },
};

export function fieldTone(theme: Theme, tone: FieldTone): { bg: string; fg: string } {
  const [bg, fg] = TONES[theme.palette.mode === "dark" ? "dark" : "light"][tone];
  return { bg, fg };
}

/** Field-only extras the shared components read (app bar, nav pill). */
export function fieldChrome(theme: Theme) {
  const t = TOKENS[theme.palette.mode === "dark" ? "dark" : "light"];
  return { appBar: t.appBar, onAppBar: t.onAppBar, navIndicator: t.navIndicator, border: t.border };
}

const FONT = "Roboto, system-ui, -apple-system, 'Segoe UI', 'Helvetica Neue', Arial, sans-serif";

const MUI_COLOR_TO_TONE: Record<string, FieldTone> = {
  success: "good",
  warning: "warn",
  error: "bad",
  info: "info",
  default: "neutral",
  secondary: "neutral",
};

function build(mode: FieldMode): Theme {
  const t = TOKENS[mode];
  const tone = TONES[mode];
  const muted = alpha(t.onSurface, 0.6);

  return createTheme({
    palette: {
      mode,
      primary: { main: t.primary, light: t.primaryLight, dark: t.primaryDark, contrastText: t.onPrimary },
      secondary: { main: FIELD_BRAND_ACCENT, contrastText: "#FFFFFF" },
      success: { main: tone.good[1], light: tone.good[0], dark: mode === "dark" ? "#5CC384" : "#146236", contrastText: mode === "dark" ? "#0E2A1B" : "#FFFFFF" },
      warning: { main: tone.warn[1], light: tone.warn[0], dark: mode === "dark" ? "#E0AE4E" : "#87540A", contrastText: mode === "dark" ? "#2E2209" : "#FFFFFF" },
      error: { main: mode === "dark" ? tone.bad[1] : "#C5362B", light: tone.bad[0], dark: mode === "dark" ? "#E6766E" : "#9A2C23", contrastText: mode === "dark" ? "#3A0F0C" : "#FFFFFF" },
      info: { main: tone.info[1], light: tone.info[0], dark: mode === "dark" ? "#62A5E6" : "#154A87", contrastText: mode === "dark" ? "#0B2340" : "#FFFFFF" },
      // Office-theme palette extras, mapped so any shared component that
      // reads them still resolves inside the field app.
      tertiary: { main: tone.neutral[0], light: t.scaffold, dark: t.primary, contrastText: t.onSurface },
      customYellow: { main: tone.warn[1], light: tone.warn[0], dark: "#87540A", contrastText: "#FFFFFF" },
      customRed: { main: tone.bad[1], light: tone.bad[0], dark: "#9A2C23", contrastText: "#FFFFFF" },
      customGray: { main: muted, light: t.border, dark: t.onSurface, contrastText: "#FFFFFF" },
      surfaceTones: {
        base: t.scaffold,
        low: t.scaffold,
        lowest: t.surface,
        container: tone.neutral[0],
        high: tone.neutral[0],
        highest: tone.neutral[0],
        dim: t.border,
      },
      outlineVariant: t.border,
      primaryFixedDim: tone.info[0],
      text: { primary: t.onSurface, secondary: muted, disabled: alpha(t.onSurface, 0.38) },
      divider: t.border,
      background: { default: t.scaffold, paper: t.surface },
      action: { hover: alpha(t.onSurface, 0.05), selected: alpha(t.primary, 0.1) },
    },
    shape: { borderRadius: 12 },
    typography: {
      fontFamily: FONT,
      htmlFontSize: 16,
      fontSize: 14,
      h1: { fontSize: "2rem", fontWeight: 800, lineHeight: 1.2 },
      h2: { fontSize: "1.75rem", fontWeight: 800, lineHeight: 1.2 },
      h3: { fontSize: "1.5rem", fontWeight: 800, lineHeight: 1.25 },
      h4: { fontSize: "1.375rem", fontWeight: 800, lineHeight: 1.25 },
      // Page / profile title (SiteClock 20 / w800).
      h5: { fontSize: "1.25rem", fontWeight: 800, lineHeight: 1.3, letterSpacing: "-0.01em" },
      // AppBar / pushed-page title (SiteClock 18 / w700 / -0.2).
      h6: { fontSize: "1.125rem", fontWeight: 700, lineHeight: 1.35, letterSpacing: "-0.0125em" },
      // Section header (16 / w700).
      subtitle1: { fontSize: "1rem", fontWeight: 700, lineHeight: 1.4, letterSpacing: "-0.0125em" },
      // Card title (14 / w700).
      subtitle2: { fontSize: "0.875rem", fontWeight: 700, lineHeight: 1.4 },
      body1: { fontSize: "0.875rem", lineHeight: 1.45 },
      body2: { fontSize: "0.8125rem", lineHeight: 1.45 },
      caption: { fontSize: "0.75rem", lineHeight: 1.4 },
      button: { fontSize: "0.9375rem", fontWeight: 700, textTransform: "none", letterSpacing: 0 },
      overline: { fontSize: "0.75rem", fontWeight: 800, letterSpacing: "0.1em", lineHeight: 1.6 },
    },
    components: {
      MuiButton: {
        defaultProps: { disableElevation: true },
        styleOverrides: {
          root: { borderRadius: 12, textTransform: "none", fontWeight: 700, boxShadow: "none" },
          sizeMedium: { minHeight: 44, paddingInline: 18 },
          sizeLarge: { minHeight: 48, fontSize: "0.9375rem" },
          sizeSmall: { minHeight: 34, borderRadius: 10, fontSize: "0.8125rem" },
          text: { borderRadius: 10, fontWeight: 600 },
          outlined: { borderColor: t.inputBorder },
          outlinedPrimary: { borderColor: alpha(t.primary, 0.5) },
          contained: { "&:hover": { boxShadow: "none" } },
        },
      },
      MuiIconButton: {
        styleOverrides: { root: { borderRadius: 12 } },
      },
      MuiPaper: {
        defaultProps: { elevation: 0 },
        styleOverrides: {
          root: { backgroundImage: "none" },
          outlined: { borderColor: t.border },
        },
      },
      MuiCard: {
        defaultProps: { elevation: 0 },
        styleOverrides: {
          root: { borderRadius: 16, border: `1px solid ${t.border}`, backgroundColor: t.surface, backgroundImage: "none" },
        },
      },
      MuiCardContent: {
        styleOverrides: { root: { padding: 14, "&:last-child": { paddingBottom: 14 } } },
      },
      MuiCardActionArea: {
        styleOverrides: { root: { borderRadius: 16 } },
      },
      MuiOutlinedInput: {
        styleOverrides: {
          root: {
            borderRadius: 12,
            backgroundColor: t.surface,
            "& .MuiOutlinedInput-notchedOutline": { borderColor: t.inputBorder },
            "&:hover .MuiOutlinedInput-notchedOutline": { borderColor: alpha(t.onSurface, 0.35) },
            "&.Mui-focused .MuiOutlinedInput-notchedOutline": { borderColor: FIELD_BRAND_ACCENT, borderWidth: 1.6 },
          },
        },
      },
      MuiInputLabel: {
        styleOverrides: { root: { "&.Mui-focused": { color: FIELD_BRAND_ACCENT } } },
      },
      MuiChip: {
        styleOverrides: {
          root: ({ ownerState }) => {
            const key = MUI_COLOR_TO_TONE[String(ownerState.color ?? "default")];
            const base = { borderRadius: 20, fontWeight: 600, fontSize: "0.75rem" };
            if (!key) return base;
            const [bg, fg] = tone[key];
            return ownerState.variant === "outlined"
              ? { ...base, color: fg, borderColor: alpha(fg, 0.45) }
              : { ...base, backgroundColor: bg, color: fg, "& .MuiChip-icon": { color: fg } };
          },
          label: { paddingInline: 10 },
        },
      },
      MuiAlert: {
        styleOverrides: {
          root: { borderRadius: 12, alignItems: "center" },
          standardSuccess: { backgroundColor: tone.good[0], color: tone.good[1], "& .MuiAlert-icon": { color: tone.good[1] } },
          standardWarning: { backgroundColor: tone.warn[0], color: tone.warn[1], "& .MuiAlert-icon": { color: tone.warn[1] } },
          standardError: { backgroundColor: tone.bad[0], color: tone.bad[1], "& .MuiAlert-icon": { color: tone.bad[1] } },
          standardInfo: { backgroundColor: tone.info[0], color: tone.info[1], "& .MuiAlert-icon": { color: tone.info[1] } },
          outlined: { backgroundColor: t.surface },
        },
      },
      MuiTabs: {
        styleOverrides: {
          indicator: { backgroundColor: t.primary, height: 3, borderRadius: "3px 3px 0 0" },
        },
      },
      MuiTab: {
        styleOverrides: {
          root: {
            textTransform: "none",
            fontWeight: 600,
            fontSize: "0.875rem",
            minHeight: 44,
            color: muted,
            "&.Mui-selected": { color: t.primary },
          },
        },
      },
      MuiDialog: {
        styleOverrides: {
          paper: { borderRadius: 20, backgroundColor: t.surface, backgroundImage: "none" },
        },
      },
      MuiDialogTitle: {
        styleOverrides: { root: { fontSize: "1.125rem", fontWeight: 700, padding: "20px 20px 8px" } },
      },
      MuiDialogContent: {
        styleOverrides: { root: { padding: "8px 20px" } },
      },
      MuiDialogActions: {
        styleOverrides: { root: { padding: "12px 20px 20px", gap: 8, "& > :not(style) ~ :not(style)": { marginLeft: 0 } } },
      },
      MuiMenu: {
        styleOverrides: { paper: { borderRadius: 12, border: `1px solid ${t.border}` } },
      },
      MuiDivider: {
        styleOverrides: { root: { borderColor: t.border } },
      },
      MuiAppBar: {
        defaultProps: { elevation: 0 },
        styleOverrides: { root: { backgroundColor: t.appBar, color: t.onAppBar, backgroundImage: "none" } },
      },
      MuiListItemButton: {
        styleOverrides: { root: { borderRadius: 12 } },
      },
      MuiToggleButton: {
        styleOverrides: { root: { borderRadius: 12, textTransform: "none", fontWeight: 600 } },
      },
      MuiLinearProgress: {
        styleOverrides: { root: { borderRadius: 4 } },
      },
      MuiTooltip: {
        styleOverrides: { tooltip: { fontSize: "0.75rem", borderRadius: 8 } },
      },
    },
  });
}

export const fieldLightTheme = build("light");
export const fieldDarkTheme = build("dark");
