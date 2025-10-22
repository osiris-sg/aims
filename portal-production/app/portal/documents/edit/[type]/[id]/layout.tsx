"use client";
import React from "react";
import { Box } from "@mui/material";

interface Props {
  children: React.ReactNode;
}

export default function DocumentTemplateEditLayout({ children }: Props) {
  return (
    <Box sx={{ height: "100vh", width: "100vw", display: "flex", flexDirection: "column", bgcolor: "#f5f5f5" }}>
      {children}
    </Box>
  );
}