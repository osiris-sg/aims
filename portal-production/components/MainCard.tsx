"use client";
import { Box, useMediaQuery, useTheme } from "@mui/material";
import React from "react";

interface Props {
  children: React.ReactNode;
}

export default function MainCard(props: Props) {
  const theme = useTheme();
  const isXsScreen = useMediaQuery(theme.breakpoints.down("md"));

  const { children } = props;
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
