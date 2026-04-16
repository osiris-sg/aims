"use client";
import { createTheme } from "@mui/material/styles";

declare module "@mui/material/styles" {
  interface Palette {
    tertiary: Palette["primary"];
    customYellow: Palette["primary"];
    customRed: Palette["primary"];
    customGray: Palette["primary"];
  }
  interface PaletteOptions {
    tertiary?: PaletteOptions["primary"];
    customYellow?: PaletteOptions["primary"];
    customRed?: PaletteOptions["primary"];
    customGray?: PaletteOptions["primary"];
  }
}

const darkTheme = createTheme({
  palette: {
    mode: "dark",
    primary: {
      main: "#e0e0e0",
      light: "#ffffff",
      dark: "#b0b0b0",
      contrastText: "#0a0a0a",
    },
    secondary: {
      main: "#64b5f6",
      light: "#90caf9",
      dark: "#1976d2",
      contrastText: "#0a0a0a",
    },
    tertiary: {
      main: "#2a2a2a",
      light: "#1a1a1a",
      dark: "#555555",
      contrastText: "#e0e0e0",
    },
    customYellow: {
      light: "#FCD34D",
      main: "#F59E0B",
      dark: "#B45309",
      contrastText: "#0a0a0a",
    },
    customRed: {
      light: "#f87171",
      main: "#ef4444",
      dark: "#b91c1c",
      contrastText: "#ffffff",
    },
    customGray: {
      main: "#6b7280",
    },
    text: {
      primary: "#e8e8e8",
      secondary: "#9ca3af",
    },
    background: {
      default: "#0f0f0f",
      paper: "#1a1a1a",
    },
    divider: "rgba(255, 255, 255, 0.08)",
    error: {
      main: "#ef4444",
      light: "#f87171",
      dark: "#b91c1c",
    },
    warning: {
      main: "#F59E0B",
      light: "#FCD34D",
      dark: "#B45309",
    },
    success: {
      main: "#22c55e",
      light: "#4ade80",
      dark: "#16a34a",
    },
    info: {
      main: "#64b5f6",
      light: "#90caf9",
      dark: "#1976d2",
    },
  },
  typography: {
    htmlFontSize: 16,
    fontSize: 12,
    fontWeightRegular: 600,
    h1: { fontSize: "1.5rem", fontWeight: 700 },
    h2: { fontSize: "1.25rem", fontWeight: 700 },
    h3: { fontSize: "1.1rem", fontWeight: 600 },
    h4: { fontSize: "1rem", fontWeight: 600 },
    h5: { fontSize: "0.9rem", fontWeight: 600 },
    h6: { fontSize: "0.85rem", fontWeight: 600 },
    body1: { fontSize: "0.75rem", fontWeight: 600 },
    body2: { fontSize: "0.7rem", fontWeight: 600 },
    caption: { fontSize: "0.65rem", fontWeight: 600 },
    button: { fontSize: "0.75rem", fontWeight: 600 },
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: {
          backgroundColor: "#0f0f0f",
          scrollbarColor: "#333 transparent",
        },
      },
    },
    MuiListItemText: {
      styleOverrides: {
        primary: { fontSize: "0.75rem" },
        secondary: { fontSize: "0.7rem" },
      },
    },
    MuiTextField: {
      defaultProps: { size: "small" },
      styleOverrides: {
        root: {
          borderRadius: "0.5rem",
          "& .MuiOutlinedInput-root": {
            borderRadius: "0.5rem",
            fontSize: "0.75rem",
          },
          "& .MuiInputLabel-root": {
            fontSize: "0.75rem",
          },
        },
      },
    },
    MuiInputBase: {
      styleOverrides: {
        root: { fontSize: "0.75rem" },
        input: { fontSize: "0.75rem", padding: "6px 10px" },
      },
    },
    MuiSelect: {
      defaultProps: { size: "small" },
      styleOverrides: {
        select: { fontSize: "0.75rem", padding: "6px 10px" },
      },
    },
    MuiMenuItem: {
      styleOverrides: {
        root: { fontSize: "0.75rem" },
      },
    },
    MuiTableCell: {
      styleOverrides: {
        root: {
          fontSize: "0.75rem",
          padding: "6px 12px",
          borderBottom: "1px solid rgba(255, 255, 255, 0.06)",
        },
        head: {
          fontSize: "0.75rem",
          fontWeight: 600,
          backgroundColor: "#1f1f1f",
        },
      },
    },
    MuiTableRow: {
      styleOverrides: {
        root: {
          "&:hover": {
            backgroundColor: "rgba(255, 255, 255, 0.03)",
          },
        },
      },
    },
    MuiTab: {
      styleOverrides: {
        root: { fontSize: "0.75rem", minHeight: 36 },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: { fontSize: "0.7rem" },
        label: { fontSize: "0.7rem" },
      },
    },
    MuiButton: {
      defaultProps: { size: "small" },
      styleOverrides: {
        root: {
          borderRadius: "0.5rem",
          fontWeight: 600,
          textTransform: "capitalize",
          fontSize: "0.75rem",
          padding: "4px 12px",
        },
      },
    },
    MuiIconButton: {
      defaultProps: { size: "small" },
    },
    MuiAutocomplete: {
      styleOverrides: {
        input: { fontSize: "0.75rem" },
        option: { fontSize: "0.75rem" },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          backgroundImage: "none",
        },
      },
    },
    MuiDrawer: {
      styleOverrides: {
        paper: {
          backgroundImage: "none",
          borderRight: "1px solid rgba(255, 255, 255, 0.06)",
        },
      },
    },
    MuiCard: {
      defaultProps: { elevation: 0 },
      styleOverrides: {
        root: {
          backgroundImage: "none",
          border: "1px solid rgba(255, 255, 255, 0.06)",
        },
      },
    },
    MuiDialog: {
      styleOverrides: {
        paper: {
          backgroundImage: "none",
        },
      },
    },
    MuiAppBar: {
      defaultProps: { elevation: 0 },
      styleOverrides: {
        root: {
          backgroundImage: "none",
          borderBottom: "1px solid rgba(255, 255, 255, 0.06)",
        },
      },
    },
    MuiTooltip: {
      styleOverrides: {
        tooltip: {
          backgroundColor: "#2a2a2a",
          border: "1px solid rgba(255, 255, 255, 0.08)",
        },
      },
    },
  },
});

export default darkTheme;
