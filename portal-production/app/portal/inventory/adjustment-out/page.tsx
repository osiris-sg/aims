"use client";

import React from "react";
import MainCard from "@/components/MainCard";
import { Box, Typography, Button } from "@mui/material";
import IndeterminateCheckBoxIcon from "@mui/icons-material/IndeterminateCheckBox";
import ConstructionIcon from "@mui/icons-material/Construction";

export default function StockAdjustmentOutPage() {
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
            bgcolor: "error.light",
            mb: 2,
          }}
        >
          <IndeterminateCheckBoxIcon sx={{ fontSize: 40, color: "error.main" }} />
        </Box>

        <Typography variant="h4" gutterBottom>
          Stock Adjustment Out
        </Typography>

        <Typography variant="body1" color="text.secondary" sx={{ maxWidth: 500 }}>
          Record stock removals and corrections. Use this to remove inventory that was damaged, lost, transferred out, or needs adjustment for any reason.
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
          startIcon={<IndeterminateCheckBoxIcon />}
          sx={{ mt: 2 }}
        >
          Create Adjustment Out
        </Button>
      </Box>
    </MainCard>
  );
}
