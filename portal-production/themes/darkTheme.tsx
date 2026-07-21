"use client";
import { createTheme, alpha } from "@mui/material/styles";

// Editorial Ledger — Dark mode tokens (Material Design 3 conventions)
const tokens = {
  primary: "#A8C5F4",
  primaryContainer: "#1A2B3C",
  onPrimary: "#0E1B2E",
  onPrimaryContainer: "#D9E3F3",
  tertiary: "#6FFBBE",
  tertiaryFixed: "#6FFBBE",
  onTertiaryFixedVariant: "#00513A",
  onTertiaryContainer: "#6FFBBE",
  secondary: "#B5C7E5",
  secondaryContainer: "#28394F",
  onSecondaryContainer: "#D5E0F7",
  surface: "#10141B",
  surfaceContainerLow: "#161B23",
  surfaceContainerLowest: "#0A0E14",
  surfaceContainerHigh: "#1F252E",
  surfaceContainerHighest: "#292F39",
  surfaceDim: "#0A0E14",
  onSurface: "#DFE3EE",
  onSurfaceVariant: "#C2C7D0",
  outlineVariant: "#43474E",
  amber: "#FBBF24",
  error: "#FFB4AB",
  errorContainer: "#93000A",
  onErrorContainer: "#FFDAD6",
};

const theme = createTheme({
  palette: {
    mode: "dark",
    primary: {
      main: tokens.primary,
      light: "#C8DAF8",
      dark: "#7AA0D8",
      contrastText: tokens.onPrimary,
    },
    secondary: {
      main: tokens.secondary,
      light: tokens.secondaryContainer,
      dark: "#8FA3C2",
      contrastText: tokens.onSecondaryContainer,
    },
    tertiary: {
      main: tokens.tertiary,
      light: "#B7FDDD",
      dark: "#00A572",
      contrastText: tokens.onTertiaryFixedVariant,
    },
    customYellow: {
      light: "#FCD34D",
      main: tokens.amber,
      dark: "#F59E0B",
      contrastText: "#3D2A00",
    },
    customRed: {
      light: tokens.errorContainer,
      main: tokens.error,
      dark: "#FF8A80",
      contrastText: "#690005",
    },
    customGray: {
      main: tokens.onSurfaceVariant,
      light: tokens.outlineVariant,
      dark: tokens.onSurface,
      contrastText: tokens.onSurface,
    },
    success: {
      main: tokens.tertiary,
      light: "#B7FDDD",
      dark: "#00A572",
      contrastText: tokens.onTertiaryFixedVariant,
    },
    warning: {
      main: tokens.amber,
      light: "#FCD34D",
      dark: "#F59E0B",
      contrastText: "#3D2A00",
    },
    error: {
      main: tokens.error,
      light: tokens.errorContainer,
      dark: "#FF8A80",
      contrastText: "#690005",
    },
    info: {
      main: tokens.secondary,
      light: tokens.surfaceContainerHigh,
      dark: "#8FA3C2",
      contrastText: tokens.onSecondaryContainer,
    },
    text: {
      primary: tokens.onSurface,
      secondary: tokens.onSurfaceVariant,
      disabled: alpha(tokens.onSurface, 0.38),
    },
    divider: alpha(tokens.outlineVariant, 0.5),
    background: {
      default: tokens.surface,
      paper: tokens.surfaceContainerLow,
    },
    surfaceTones: {
      base: tokens.surface,
      low: tokens.surfaceContainerLow,
      lowest: tokens.surfaceContainerLowest,
      container: tokens.surfaceContainerLow,
      high: tokens.surfaceContainerHigh,
      highest: tokens.surfaceContainerHighest,
      dim: tokens.surfaceDim,
    },
    outlineVariant: tokens.outlineVariant,
    primaryFixedDim: tokens.tertiary,
  },
  shape: {
    borderRadius: 10,
  },
  typography: {
    fontFamily:
      "'Helvetica Neue', Helvetica, Arial, sans-serif",
    htmlFontSize: 16,
    fontSize: 12,
    h1: {
      fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif",
      fontSize: "1.75rem",
      fontWeight: 700,
      letterSpacing: "-0.02em",
      lineHeight: 1.2,
    },
    h2: {
      fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif",
      fontSize: "1.4rem",
      fontWeight: 700,
      letterSpacing: "-0.015em",
      lineHeight: 1.25,
    },
    h3: {
      fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif",
      fontSize: "1.2rem",
      fontWeight: 600,
      letterSpacing: "-0.01em",
    },
    h4: {
      fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif",
      fontSize: "1.05rem",
      fontWeight: 600,
      letterSpacing: "-0.005em",
    },
    h5: {
      fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif",
      fontSize: "0.95rem",
      fontWeight: 600,
    },
    h6: {
      fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif",
      fontSize: "0.85rem",
      fontWeight: 600,
    },
    body1: {
      fontSize: "0.8125rem",
      lineHeight: 1.5,
    },
    body2: {
      fontSize: "0.75rem",
      fontWeight: 400,
      color: tokens.onSurfaceVariant,
    },
    caption: {
      fontSize: "0.6875rem",
      letterSpacing: "0.02em",
    },
    button: {
      fontSize: "0.8125rem",
      fontWeight: 500,
      letterSpacing: "0.01em",
    },
    overline: {
      fontSize: "0.6875rem",
      fontWeight: 600,
      letterSpacing: "0.08em",
      textTransform: "uppercase",
    },
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: {
          backgroundColor: tokens.surface,
          color: tokens.onSurface,
          fontFeatureSettings: '"tnum", "cv11"',
        },
        ".tabular-nums, .currency, [data-tabular]": {
          fontVariantNumeric: "tabular-nums",
          fontFeatureSettings: '"tnum" 1',
        },
      },
    },
    MuiListItemText: {
      styleOverrides: {
        primary: { fontSize: "0.8125rem", fontWeight: 500 },
        secondary: { fontSize: "0.75rem", color: tokens.onSurfaceVariant },
      },
    },
    MuiTextField: {
      defaultProps: { size: "small", variant: "outlined" },
      styleOverrides: {
        root: {
          "& .MuiOutlinedInput-root": {
            borderRadius: 10,
            backgroundColor: alpha(tokens.surfaceContainerHigh, 0.6),
            fontSize: "0.8125rem",
            transition: "background-color 160ms ease, border-color 160ms ease",
            "& fieldset": {
              borderColor: alpha(tokens.outlineVariant, 0.7),
            },
            "&:hover fieldset": {
              borderColor: alpha(tokens.primary, 0.4),
            },
            "&.Mui-focused": {
              backgroundColor: tokens.surfaceContainerHigh,
            },
            "&.Mui-focused fieldset": {
              borderColor: alpha(tokens.primary, 0.7),
              borderWidth: 1,
            },
          },
          "& .MuiInputLabel-root": {
            fontSize: "0.8125rem",
            color: tokens.onSurfaceVariant,
          },
        },
      },
    },
    MuiInputBase: {
      styleOverrides: {
        root: { fontSize: "0.8125rem" },
        input: { fontSize: "0.8125rem", padding: "8px 12px" },
      },
    },
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          borderRadius: 10,
        },
      },
    },
    MuiSelect: {
      defaultProps: { size: "small" },
      styleOverrides: {
        select: { fontSize: "0.8125rem", padding: "8px 12px" },
      },
    },
    MuiMenuItem: {
      styleOverrides: {
        root: {
          fontSize: "0.8125rem",
          borderRadius: 6,
          margin: "2px 6px",
          "&.Mui-selected": {
            backgroundColor: tokens.secondaryContainer,
            "&:hover": { backgroundColor: alpha(tokens.secondaryContainer, 0.8) },
          },
        },
      },
    },
    MuiMenu: {
      styleOverrides: {
        paper: {
          borderRadius: 12,
          boxShadow: `0 16px 48px ${alpha("#000000", 0.4)}`,
          border: `1px solid ${alpha(tokens.outlineVariant, 0.4)}`,
          backgroundColor: tokens.surfaceContainerHigh,
        },
      },
    },
    MuiTableCell: {
      styleOverrides: {
        root: {
          fontSize: "0.8125rem",
          padding: "10px 16px",
          borderBottom: `1px solid ${alpha(tokens.outlineVariant, 0.4)}`,
          color: tokens.onSurface,
        },
        head: {
          fontSize: "0.6875rem",
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          color: tokens.onSurfaceVariant,
          backgroundColor: tokens.surfaceContainerHigh,
          // Match the light theme's header underline (dark-mode shade)
          borderBottom: "1px solid #3A4148",
        },
      },
    },
    MuiTableRow: {
      styleOverrides: {
        root: {
          transition: "background-color 140ms ease",
          "&:hover": {
            backgroundColor: tokens.surfaceContainerHigh,
          },
        },
      },
    },
    MuiTab: {
      styleOverrides: {
        root: {
          fontSize: "0.8125rem",
          fontWeight: 500,
          minHeight: 40,
          textTransform: "none",
          letterSpacing: 0,
        },
      },
    },
    MuiTabs: {
      styleOverrides: {
        indicator: {
          backgroundColor: tokens.primary,
          height: 3,
          borderRadius: "3px 3px 0 0",
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: {
          fontSize: "0.6875rem",
          fontWeight: 500,
          height: 22,
          borderRadius: 999,
        },
        label: { fontSize: "0.6875rem", padding: "0 10px" },
        colorSuccess: {
          backgroundColor: alpha(tokens.tertiary, 0.18),
          color: tokens.tertiary,
        },
        colorWarning: {
          backgroundColor: alpha(tokens.amber, 0.2),
          color: tokens.amber,
        },
        colorError: {
          backgroundColor: alpha(tokens.error, 0.2),
          color: tokens.error,
        },
      },
    },
    MuiButton: {
      defaultProps: { size: "small", disableElevation: true },
      styleOverrides: {
        root: {
          borderRadius: 10,
          fontWeight: 500,
          textTransform: "none",
          fontSize: "0.8125rem",
          padding: "6px 14px",
          letterSpacing: "0.005em",
        },
        containedPrimary: {
          background: `linear-gradient(135deg, ${tokens.primary} 0%, #C8DAF8 100%)`,
          color: tokens.onPrimary,
          boxShadow: "none",
          "&:hover": {
            background: `linear-gradient(135deg, #C8DAF8 0%, ${tokens.primary} 100%)`,
            boxShadow: `0 8px 24px ${alpha(tokens.primary, 0.35)}`,
          },
        },
        outlined: {
          borderColor: alpha(tokens.outlineVariant, 0.6),
          color: tokens.onSurface,
          backgroundColor: tokens.surfaceContainerLow,
          "&:hover": {
            borderColor: alpha(tokens.primary, 0.5),
            backgroundColor: tokens.surfaceContainerHigh,
          },
        },
        text: {
          color: tokens.onSurface,
          "&:hover": { backgroundColor: tokens.surfaceContainerHigh },
        },
      },
    },
    MuiIconButton: {
      defaultProps: { size: "small" },
      styleOverrides: {
        root: {
          borderRadius: 10,
          "&:hover": { backgroundColor: tokens.surfaceContainerHigh },
        },
      },
    },
    MuiAutocomplete: {
      styleOverrides: {
        input: { fontSize: "0.8125rem" },
        option: { fontSize: "0.8125rem" },
        paper: {
          borderRadius: 12,
          boxShadow: `0 16px 48px ${alpha("#000000", 0.4)}`,
          backgroundColor: tokens.surfaceContainerHigh,
        },
      },
    },
    MuiCard: {
      defaultProps: { elevation: 0 },
      styleOverrides: {
        root: {
          backgroundColor: tokens.surfaceContainerLow,
          borderRadius: 14,
          backgroundImage: "none",
          boxShadow: `0 0 0 1px ${alpha(tokens.outlineVariant, 0.3)}, 0 1px 2px ${alpha("#000000", 0.2)}`,
          transition: "box-shadow 180ms ease, transform 180ms ease",
        },
      },
    },
    MuiPaper: {
      defaultProps: { elevation: 0 },
      styleOverrides: {
        root: {
          backgroundImage: "none",
        },
        rounded: { borderRadius: 14 },
      },
    },
    MuiDrawer: {
      styleOverrides: {
        paper: {
          backgroundImage: "none",
          borderRight: "none",
        },
      },
    },
    MuiAppBar: {
      defaultProps: { elevation: 0 },
      styleOverrides: {
        root: {
          backgroundColor: tokens.surfaceContainerLow,
          color: tokens.onSurface,
          borderBottom: `1px solid ${alpha(tokens.outlineVariant, 0.4)}`,
        },
      },
    },
    MuiDialog: {
      styleOverrides: {
        paper: {
          backgroundColor: tokens.surfaceContainerHigh,
          borderRadius: 16,
          boxShadow: `0 32px 80px ${alpha("#000000", 0.6)}`,
        },
      },
    },
    MuiDivider: {
      styleOverrides: {
        root: { borderColor: alpha(tokens.outlineVariant, 0.4) },
      },
    },
    MuiTooltip: {
      styleOverrides: {
        tooltip: {
          backgroundColor: tokens.surfaceContainerHighest,
          color: tokens.onSurface,
          fontSize: "0.6875rem",
          borderRadius: 6,
          padding: "6px 10px",
          border: `1px solid ${alpha(tokens.outlineVariant, 0.4)}`,
        },
        arrow: { color: tokens.surfaceContainerHighest },
      },
    },
    MuiCheckbox: {
      styleOverrides: {
        root: { color: tokens.onSurfaceVariant },
      },
    },
    MuiLinearProgress: {
      styleOverrides: {
        root: {
          borderRadius: 999,
          height: 6,
          backgroundColor: alpha(tokens.primary, 0.15),
        },
        bar: { borderRadius: 999 },
      },
    },
    MuiAvatar: {
      styleOverrides: {
        root: {
          backgroundColor: tokens.secondaryContainer,
          color: tokens.onSecondaryContainer,
          fontWeight: 600,
        },
      },
    },
  },
});

export default theme;
