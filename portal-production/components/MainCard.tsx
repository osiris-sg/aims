"use client";
import { Box, useMediaQuery, useTheme } from "@mui/material";
import React, { createContext, useContext } from "react";

interface Props {
  children: React.ReactNode;
}

// Set by a page that already wraps several sections in ONE MainCard (the jobs
// calendar dashboard): a MainCard inside it renders as a plain block instead of
// a second full-height scroll area. Unset everywhere else, so nothing changes.
export const MainCardEmbedContext = createContext(false);

export default function MainCard(props: Props) {
  const theme = useTheme();
  const isXsScreen = useMediaQuery(theme.breakpoints.down("md"));
  const embedded = useContext(MainCardEmbedContext);

  const { children } = props;
  if (embedded) return <Box sx={{ width: "100%" }}>{children}</Box>;
  return (
    <Box
      sx={{
        flexGrow: 1,
        pt: isXsScreen ? "5rem" : 4,
        pb: isXsScreen ? 2 : 4,
        display: "flex",
        justifyContent: "center",
        alignItems: "stretch",
        height: "100%",
        overflow: "hidden",
      }}
    >
      <Box
        sx={{
          width: "100%",
          height: "100%",
          px: { xs: 2, md: 4 },
          overflowY: "auto",
          display: "flex",
          alignItems: "center",
          flexDirection: "column",
        }}
      >
        <Box sx={{ maxWidth: "var(--page-max-width)", width: "100%", height: "100%" }}>{children}</Box>
      </Box>
    </Box>
  );
}
