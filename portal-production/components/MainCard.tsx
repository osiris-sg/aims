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
        padding: isXsScreen ? "var(--mobile-portal-content-padding)" : "var(--portal-content-padding)",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        height: "100%",
        overflow: "hidden",
      }}
    >
      <Box
        sx={{
          width: "100%",
          height: "100%",
          px: "var(--default-padding)",
          overflowY: "auto",
          display: "flex",
          alignItems: "center",
          flexDirection: "column",
          //
        }}
      >
        <Box sx={{ maxWidth: "var(--page-max-width)", width: "100%", height: "100%" }}>{children}</Box>
      </Box>
    </Box>
  );
}
