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
const theme = createTheme({
  palette: {
    mode: "light",
    primary: {
      //Black theme
      main: "#333333",
      light: "#555555",
      dark: "#111111",
      contrastText: "#fff",
    },
    secondary: {
      //Lets keep this for blue varients
      main: "#1976d2",
      light: "#e0e0e0",
      dark: "#08619C",
      contrastText: "#fff",
    },
    tertiary: {
      //Lets keep this for grey varients
      main: "#dad9d9",
      light: "#fafafa",
      dark: "#949494",
      contrastText: "#F4F3F0",
    },
    customYellow: {
      light: "#FEDF05",
      main: "#FEB000",
      dark: "#DC7C00",
      contrastText: "#fff",
    },
    customRed: {
      // using 'customRed' since 'red' might conflict with existing colors
      light: "#DB4444",
      main: "#E03137",
      dark: "#D30F02",
      contrastText: "#ffffff",
    },
    customGray: {
      main: "#A2A1A8",
    },
    text: {
      primary: "#000000",
      secondary: "#757575",
    },

    background: {
      paper: "#ffffff",
    },
  },
  typography: {
    htmlFontSize: 16,
    fontSize: 12, // Base font size ~9pt
    fontWeightRegular: 600,
    h1: {
      fontSize: '1.5rem',
      fontWeight: 700,
    },
    h2: {
      fontSize: '1.25rem',
      fontWeight: 700,
    },
    h3: {
      fontSize: '1.1rem',
      fontWeight: 600,
    },
    h4: {
      fontSize: '1rem',
      fontWeight: 600,
    },
    h5: {
      fontSize: '0.9rem',
      fontWeight: 600,
    },
    h6: {
      fontSize: '0.85rem',
      fontWeight: 600,
    },
    body1: {
      fontSize: '0.75rem', // ~9pt
      fontWeight: 600,
    },
    body2: {
      fontSize: '0.7rem',
      fontWeight: 600,
    },
    caption: {
      fontSize: '0.65rem',
      fontWeight: 600,
    },
    button: {
      fontSize: '0.75rem',
      fontWeight: 600,
    },
  },
  components: {
    MuiListItemText: {
      styleOverrides: {
        primary: {
          fontSize: '0.75rem',
        },
        secondary: {
          fontSize: '0.7rem',
        },
      },
    },
    MuiTextField: {
      defaultProps: {
        size: 'small',
      },
      styleOverrides: {
        root: {
          borderRadius: "0.5rem",
          "& .MuiOutlinedInput-root": {
            borderRadius: "0.5rem",
            fontSize: '0.75rem',
          },
          "& .MuiInputLabel-root": {
            fontSize: '0.75rem',
          },
        },
      },
    },
    MuiInputBase: {
      styleOverrides: {
        root: {
          fontSize: '0.75rem',
        },
        input: {
          fontSize: '0.75rem',
          padding: '6px 10px',
        },
      },
    },
    MuiSelect: {
      defaultProps: {
        size: 'small',
      },
      styleOverrides: {
        select: {
          fontSize: '0.75rem',
          padding: '6px 10px',
        },
      },
    },
    MuiMenuItem: {
      styleOverrides: {
        root: {
          fontSize: '0.75rem',
        },
      },
    },
    MuiTableCell: {
      styleOverrides: {
        root: {
          fontSize: '0.75rem',
          padding: '6px 12px',
        },
        head: {
          fontSize: '0.75rem',
          fontWeight: 600,
        },
      },
    },
    MuiTab: {
      styleOverrides: {
        root: {
          fontSize: '0.75rem',
          minHeight: 36,
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: {
          fontSize: '0.7rem',
        },
        label: {
          fontSize: '0.7rem',
        },
      },
    },
    MuiButton: {
      defaultProps: {
        size: 'small',
      },
      styleOverrides: {
        root: {
          borderRadius: "0.5rem",
          fontWeight: 400,
          textTransform: "capitalize",
          fontSize: '0.75rem',
          padding: "4px 12px",
        },
      },
    },
    MuiIconButton: {
      defaultProps: {
        size: 'small',
      },
    },
    MuiAutocomplete: {
      styleOverrides: {
        input: {
          fontSize: '0.75rem',
        },
        option: {
          fontSize: '0.75rem',
        },
      },
    },
  },
});

export default theme;
