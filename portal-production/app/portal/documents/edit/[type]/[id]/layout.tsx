"use client";
import React from "react";
import { Box } from "@mui/material";

interface Props {
  children: React.ReactNode;
}

export default function DocumentTemplateEditLayout({ children }: Props) {
  return (
    <Box sx={{ height: "100%", width: "100%", display: "flex", flexDirection: "column", bgcolor: "#f5f5f5" }}>
      {children}
    </Box>
  );
}