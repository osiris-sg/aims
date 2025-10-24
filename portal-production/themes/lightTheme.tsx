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
    htmlFontSize: 12, // Default is 16px, increase this to make everything bigger (try 18 or 20)
    // Remove fontSize overrides to let them scale with htmlFontSize
    // MUI default scale: h1=6rem, h2=3.75rem, h3=3rem, h4=2.125rem, h5=1.5rem, h6=1.25rem, body1=1rem, body2=0.875rem
    h1: {
      fontWeight: 700,
    },
    h2: {
      fontWeight: 600,
    },
    h3: {
      fontWeight: 500,
    },
    h4: {
      fontWeight: 600,
    },
    h5: {
      fontWeight: 500,
    },
    h6: {
      fontWeight: 500,
    },
    body1: {
      // Will be 1rem = 18px with htmlFontSize: 18
    },
    body2: {
      fontWeight: 300,
      // Will be 0.875rem = 15.75px with htmlFontSize: 18
    },
    caption: {
      // Will be 0.75rem = 13.5px with htmlFontSize: 18
    },
  },
  components: {
    MuiListItemText: {
      styleOverrides: {
        primary: {
          // Will scale with htmlFontSize automatically
        },
        secondary: {
          // Will scale with htmlFontSize automatically
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
          // fontSize removed to let it scale with htmlFontSize
          padding: "var(--half-padding) var(--large-padding)",
        },
      },
    },
  },
});

export default theme;
