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
      //Lets keep this for purpule varients
      main: "#7C4AAE",
      light: "#9C6DD6",
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
    h1: {
      fontSize: "2rem",
      fontWeight: 700,
    },
    h2: {
      fontSize: "1.8rem", // Custom size for h2
      fontWeight: 600,
    },
    h3: {
      fontSize: "1.5rem", // Custom size for h3
      fontWeight: 500,
    },
    h4: {
      fontSize: "1.25rem", // Custom size for h3
      fontWeight: 600,
    },
    h5: {
      fontSize: "1rem", // Custom size for h3
      fontWeight: 500,
    },
    h6: {
      fontSize: "0.8rem", // Custom size for h3
      fontWeight: 500,
    },
    body1: {
      fontSize: "1rem", // Custom size for body1 (paragraph text)
    },
    body2: {
      fontSize: "0.875rem", // Custom size for body2
      fontWeight: 300,
    },
    caption: {
      fontSize: "0.75rem", // Custom size for captions
    },
  },
  components: {
    MuiListItemText: {
      styleOverrides: {
        primary: {
          fontSize: "1rem", // Default font size for ListItem primary text
        },
        secondary: {
          fontSize: "0.8rem", // Default font size for ListItem secondary text
        },
      },
    },
    MuiTextField: {
      styleOverrides: {
        root: {
          borderRadius: "0.7rem",
          "& .MuiOutlinedInput-root": {
            borderRadius: "0.7rem",
          },
        },
      },
    },
    MuiButton: {
      styleOverrides: {
        root: {
          borderRadius: "0.7rem",
          fontWeight: 400, // Custom button font weight
          textTransform: "capitalize",
          fontSize: "1rem",
          padding: "var(--half-padding) var(--large-padding)",
        },
      },
    },
  },
});

export default theme;
