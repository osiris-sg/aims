"use client";
import { Box } from "@mui/material";
import React from "react";

interface Props {
  children: React.ReactNode;
}

export default function AdminCard(props: Props) {
  const { children } = props;

  return (
    <Box
      sx={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {children}
    </Box>
  );
}
