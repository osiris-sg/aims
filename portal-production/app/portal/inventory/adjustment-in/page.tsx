"use client";

import React from "react";
import MainCard from "@/components/MainCard";
import { Box, Typography, Button } from "@mui/material";
import AddBoxIcon from "@mui/icons-material/AddBox";
import ConstructionIcon from "@mui/icons-material/Construction";

export default function StockAdjustmentInPage() {
  return (
    <MainCard>
      <Box
        sx={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "60vh",
          textAlign: "center",
          gap: 3,
        }}
      >
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 80,
            height: 80,
            borderRadius: "50%",
            bgcolor: "success.light",
            mb: 2,
          }}
        >
          <AddBoxIcon sx={{ fontSize: 40, color: "success.main" }} />
        </Box>

        <Typography variant="h4" gutterBottom>
          Stock Adjustment In
        </Typography>

        <Typography variant="body1" color="text.secondary" sx={{ maxWidth: 500 }}>
          Record stock additions and corrections. Use this to add inventory that was found, transferred in, or needs adjustment for any reason.
        </Typography>

        <Box sx={{ display: "flex", alignItems: "center", gap: 1, mt: 2, color: "warning.main" }}>
          <ConstructionIcon />
          <Typography variant="body2" color="warning.main">
            This feature is coming soon
          </Typography>
        </Box>

        <Button
          variant="contained"
          disabled
          startIcon={<AddBoxIcon />}
          sx={{ mt: 2 }}
        >
          Create Adjustment In
        </Button>
      </Box>
    </MainCard>
  );
}
