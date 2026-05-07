"use client";
import { createTheme, alpha } from "@mui/material/styles";

declare module "@mui/material/styles" {
  interface Palette {
    tertiary: Palette["primary"];
    customYellow: Palette["primary"];
    customRed: Palette["primary"];
    customGray: Palette["primary"];
    surfaceTones: {
      base: string;
      low: string;
      lowest: string;
      container: string;
      high: string;
      highest: string;
      dim: string;
    };
    outlineVariant: string;
    primaryFixedDim: string;
  }
  interface PaletteOptions {
    tertiary?: PaletteOptions["primary"];
    customYellow?: PaletteOptions["primary"];
    customRed?: PaletteOptions["primary"];
    customGray?: PaletteOptions["primary"];
    surfaceTones?: {
      base: string;
      low: string;
      lowest: string;
      container: string;
      high: string;
      highest: string;
      dim: string;
    };
    outlineVariant?: string;
    primaryFixedDim?: string;
  }
}

// Wholesale Food Co. design tokens
const tokens = {
  primary: "#00685f",
  primaryContainer: "#008378",
  onPrimary: "#ffffff",
  onPrimaryContainer: "#f4fffc",
  primaryFixed: "#89f5e7",
  primaryFixedDim: "#6bd8cb",
  onPrimaryFixed: "#00201d",
  onPrimaryFixedVariant: "#005049",
  secondary: "#515f74",
  secondaryContainer: "#d5e3fc",
  onSecondary: "#ffffff",
  onSecondaryContainer: "#57657a",
  onSecondaryFixed: "#0d1c2e",
  onSecondaryFixedVariant: "#3a485b",
  tertiary: "#545c72",
  tertiaryContainer: "#6c748b",
  onTertiary: "#ffffff",
  onTertiaryContainer: "#fefcff",
  tertiaryFixed: "#dae2fd",
  onTertiaryFixed: "#131b2e",
  onTertiaryFixedVariant: "#3f465c",
  surface: "#f8f9ff",
  surfaceContainerLowest: "#ffffff",
  surfaceContainerLow: "#eff4ff",
  surfaceContainer: "#e6eeff",
  surfaceContainerHigh: "#dde9ff",
  surfaceContainerHighest: "#d5e3fd",
  surfaceDim: "#ccdbf4",
  onSurface: "#0d1c2f",
  onSurfaceVariant: "#3d4947",
  outline: "#6d7a77",
  outlineVariant: "#bcc9c6",
  amber: "#F59E0B",
  error: "#ba1a1a",
  errorContainer: "#ffdad6",
  onErrorContainer: "#93000a",
};

const theme = createTheme({
  palette: {
    mode: "light",
    primary: {
      main: tokens.primary,
      light: tokens.primaryContainer,
      dark: "#00504a",
      contrastText: tokens.onPrimary,
    },
    secondary: {
      main: tokens.secondary,
      light: tokens.secondaryContainer,
      dark: "#3a485b",
      contrastText: tokens.onSecondaryContainer,
    },
    tertiary: {
      main: tokens.primaryFixedDim,
      light: tokens.primaryFixed,
      dark: tokens.primary,
      contrastText: tokens.onPrimaryFixed,
    },
    customYellow: {
      light: "#FCD34D",
      main: tokens.amber,
      dark: "#B45309",
      contrastText: "#3D2A00",
    },
    customRed: {
      light: tokens.errorContainer,
      main: tokens.error,
      dark: "#8B0F14",
      contrastText: "#FFFFFF",
    },
    customGray: {
      main: tokens.onSurfaceVariant,
      light: tokens.outlineVariant,
      dark: tokens.onSurface,
      contrastText: "#FFFFFF",
    },
    success: {
      main: tokens.primary,
      light: tokens.primaryFixedDim,
      dark: "#00504a",
      contrastText: "#FFFFFF",
    },
    warning: {
      main: tokens.amber,
      light: "#FCD34D",
      dark: "#B45309",
      contrastText: "#3D2A00",
    },
    error: {
      main: tokens.error,
      light: tokens.errorContainer,
      dark: "#8B0F14",
      contrastText: "#FFFFFF",
    },
    info: {
      main: tokens.secondary,
      light: tokens.surfaceContainerHigh,
      dark: "#3a485b",
      contrastText: "#FFFFFF",
    },
    text: {
      primary: tokens.onSurface,
      secondary: tokens.onSurfaceVariant,
      disabled: alpha(tokens.onSurface, 0.38),
    },
    divider: alpha(tokens.outlineVariant, 0.4),
    background: {
      default: tokens.surface,
      paper: tokens.surfaceContainerLowest,
    },
    surfaceTones: {
      base: tokens.surface,
      low: tokens.surfaceContainerLow,
      lowest: tokens.surfaceContainerLowest,
      container: tokens.surfaceContainer,
      high: tokens.surfaceContainerHigh,
      highest: tokens.surfaceContainerHighest,
      dim: tokens.surfaceDim,
    },
    outlineVariant: tokens.outlineVariant,
    primaryFixedDim: tokens.primaryFixedDim,
  },
  shape: {
    borderRadius: 8,
  },
  typography: {
    fontFamily:
      'Inter, "Manrope", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    htmlFontSize: 16,
    fontSize: 12,
    h1: {
      fontFamily: 'Manrope, Inter, sans-serif',
      fontSize: "1.875rem",
      fontWeight: 800,
      letterSpacing: "-0.02em",
      lineHeight: 1.2,
    },
    h2: {
      fontFamily: 'Manrope, Inter, sans-serif',
      fontSize: "1.5rem",
      fontWeight: 800,
      letterSpacing: "-0.015em",
      lineHeight: 1.25,
    },
    h3: {
      fontFamily: 'Manrope, Inter, sans-serif',
      fontSize: "1.25rem",
      fontWeight: 700,
      letterSpacing: "-0.01em",
    },
    h4: {
      fontFamily: 'Manrope, Inter, sans-serif',
      fontSize: "1.125rem",
      fontWeight: 700,
      letterSpacing: "-0.005em",
    },
    h5: {
      fontFamily: 'Manrope, Inter, sans-serif',
      fontSize: "1rem",
      fontWeight: 700,
    },
    h6: {
      fontFamily: 'Manrope, Inter, sans-serif',
      fontSize: "0.875rem",
      fontWeight: 700,
    },
    body1: {
      fontSize: "0.875rem",
      lineHeight: 1.5,
    },
    body2: {
      fontSize: "0.75rem",
      fontWeight: 400,
      color: tokens.onSurfaceVariant,
    },
    caption: {
      fontSize: "0.75rem",
      letterSpacing: "0.02em",
    },
    button: {
      fontSize: "0.875rem",
      fontWeight: 600,
      letterSpacing: "0.005em",
    },
    overline: {
      fontSize: "0.625rem",
      fontWeight: 700,
      letterSpacing: "0.1em",
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
        primary: { fontSize: "0.875rem", fontWeight: 500 },
        secondary: { fontSize: "0.75rem", color: tokens.onSurfaceVariant },
      },
    },
    MuiTextField: {
      defaultProps: { size: "small", variant: "outlined" },
      styleOverrides: {
        root: {
          "& .MuiOutlinedInput-root": {
            borderRadius: 6,
            backgroundColor: tokens.surfaceContainer,
            fontSize: "0.875rem",
            transition: "background-color 160ms ease, box-shadow 160ms ease",
            "& fieldset": {
              borderColor: "transparent",
            },
            "&:hover fieldset": {
              borderColor: alpha(tokens.primary, 0.2),
            },
            "&.Mui-focused": {
              backgroundColor: tokens.surfaceContainerLowest,
              boxShadow: `0 0 0 2px ${alpha(tokens.primary, 0.2)}`,
            },
            "&.Mui-focused fieldset": {
              borderColor: alpha(tokens.primary, 0.3),
              borderWidth: 1,
            },
          },
          "& .MuiInputLabel-root": {
            fontSize: "0.875rem",
            color: tokens.onSurfaceVariant,
          },
        },
      },
    },
    MuiInputBase: {
      styleOverrides: {
        root: { fontSize: "0.875rem" },
        input: { fontSize: "0.875rem", padding: "8px 12px" },
      },
    },
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          borderRadius: 6,
        },
      },
    },
    MuiSelect: {
      defaultProps: { size: "small" },
      styleOverrides: {
        select: { fontSize: "0.875rem", padding: "8px 12px" },
      },
    },
    MuiMenuItem: {
      styleOverrides: {
        root: {
          fontSize: "0.875rem",
          borderRadius: 4,
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
          borderRadius: 8,
          boxShadow: `0 16px 48px ${alpha(tokens.onSurface, 0.08)}`,
          border: `1px solid ${alpha(tokens.outlineVariant, 0.15)}`,
        },
      },
    },
    MuiTableCell: {
      styleOverrides: {
        root: {
          fontSize: "0.875rem",
          padding: "16px 24px",
          borderBottom: `1px solid ${alpha(tokens.outlineVariant, 0.1)}`,
          color: tokens.onSurface,
        },
        head: {
          fontSize: "0.625rem",
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "0.1em",
          color: tokens.onSurfaceVariant,
          backgroundColor: tokens.surfaceContainerLow,
          borderBottom: `1px solid ${alpha(tokens.outlineVariant, 0.15)}`,
          padding: "16px 24px",
        },
      },
    },
    MuiTableRow: {
      styleOverrides: {
        root: {
          transition: "background-color 140ms ease",
          "&:hover": {
            backgroundColor: alpha(tokens.surfaceContainerLow, 0.5),
          },
        },
      },
    },
    MuiTab: {
      styleOverrides: {
        root: {
          fontSize: "0.875rem",
          fontWeight: 600,
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
          fontSize: "0.625rem",
          fontWeight: 700,
          height: 22,
          borderRadius: 4,
          letterSpacing: "0.02em",
          textTransform: "uppercase",
        },
        label: { fontSize: "0.625rem", padding: "0 8px" },
        colorSuccess: {
          backgroundColor: alpha(tokens.primary, 0.1),
          color: tokens.primary,
        },
        colorWarning: {
          backgroundColor: alpha(tokens.amber, 0.18),
          color: "#8B5A00",
        },
        colorError: {
          backgroundColor: alpha(tokens.errorContainer, 0.5),
          color: tokens.error,
        },
      },
    },
    MuiButton: {
      defaultProps: { size: "small", disableElevation: true },
      styleOverrides: {
        root: {
          borderRadius: 6,
          fontWeight: 600,
          textTransform: "none",
          fontSize: "0.875rem",
          padding: "8px 16px",
          letterSpacing: "0.005em",
        },
        // Editorial Ledger primary CTA: dark navy gradient
        containedPrimary: {
          background: "linear-gradient(135deg, #041627 0%, #1A2B3C 100%)",
          color: "#FFFFFF",
          boxShadow: "none",
          "&:hover": {
            background: "linear-gradient(135deg, #1A2B3C 0%, #041627 100%)",
            boxShadow: `0 8px 24px ${alpha("#041627", 0.25)}`,
          },
        },
        outlined: {
          borderColor: alpha(tokens.outlineVariant, 0.4),
          color: tokens.onSurface,
          backgroundColor: tokens.surfaceContainerLowest,
          "&:hover": {
            borderColor: alpha(tokens.primary, 0.3),
            backgroundColor: tokens.surfaceContainerLow,
          },
        },
        text: {
          color: tokens.onSurface,
          "&:hover": { backgroundColor: tokens.surfaceContainerLow },
        },
      },
    },
    MuiIconButton: {
      defaultProps: { size: "small" },
      styleOverrides: {
        root: {
          borderRadius: 6,
          "&:hover": { backgroundColor: tokens.surfaceContainerHigh },
        },
      },
    },
    MuiAutocomplete: {
      styleOverrides: {
        input: { fontSize: "0.875rem" },
        option: { fontSize: "0.875rem" },
        paper: {
          borderRadius: 8,
          boxShadow: `0 16px 48px ${alpha(tokens.onSurface, 0.08)}`,
        },
      },
    },
    MuiCard: {
      defaultProps: { elevation: 0 },
      styleOverrides: {
        root: {
          backgroundColor: tokens.surfaceContainerLowest,
          borderRadius: 8,
          backgroundImage: "none",
          border: `1px solid ${alpha(tokens.outlineVariant, 0.1)}`,
          boxShadow: "none",
          transition: "box-shadow 180ms ease, transform 180ms ease",
          "&:hover": {
            boxShadow: `0 4px 12px ${alpha(tokens.onSurface, 0.04)}`,
          },
        },
      },
    },
    MuiPaper: {
      defaultProps: { elevation: 0 },
      styleOverrides: {
        root: {
          backgroundImage: "none",
        },
        rounded: { borderRadius: 8 },
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
          backgroundColor: tokens.surfaceContainerLowest,
          color: tokens.onSurface,
          borderBottom: `1px solid ${alpha(tokens.outlineVariant, 0.15)}`,
        },
      },
    },
    MuiDialog: {
      styleOverrides: {
        paper: {
          backgroundColor: tokens.surfaceContainerLowest,
          borderRadius: 12,
          boxShadow: `0 32px 80px ${alpha(tokens.onSurface, 0.18)}`,
        },
      },
    },
    MuiDivider: {
      styleOverrides: {
        root: { borderColor: alpha(tokens.outlineVariant, 0.15) },
      },
    },
    MuiTooltip: {
      styleOverrides: {
        tooltip: {
          backgroundColor: tokens.onSurface,
          color: tokens.surfaceContainerLowest,
          fontSize: "0.6875rem",
          borderRadius: 4,
          padding: "6px 10px",
        },
        arrow: { color: tokens.onSurface },
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
          backgroundColor: alpha(tokens.outlineVariant, 0.2),
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
