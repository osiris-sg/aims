"use client";
import React from "react";
import { Box, IconButton, Typography } from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import { useRouter } from "next/navigation";

interface Props {
  children: React.ReactNode;
}

export default function DocumentViewLayout({ children }: Props) {
  const router = useRouter();

  const handleBack = () => {
    router.back();
  };

  return (
    <Box sx={{ height: "100vh", width: "100vw", display: "flex", flexDirection: "column", bgcolor: "#f5f5f5" }}>
      {/* Simple header with back button */}
      <Box
        sx={{
          height: "56px",
          bgcolor: "white",
          borderBottom: 1,
          borderColor: "divider",
          display: "flex",
          alignItems: "center",
          px: 2,
          boxShadow: "0 1px 3px rgba(0,0,0,0.12)",
          zIndex: 100,
        }}
      >
        <IconButton onClick={handleBack} sx={{ mr: 2 }}>
          <ArrowBackIcon />
        </IconButton>
        <Typography variant="h6" sx={{ fontWeight: 500 }}>
          Document Editor
        </Typography>
      </Box>

      {/* Content area takes full remaining height */}
      <Box sx={{ flex: 1, overflow: "hidden", bgcolor: "#f5f5f5" }}>
        {children}
      </Box>
    </Box>
  );
}