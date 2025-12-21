"use client";

import React from "react";
import MainCard from "@/components/MainCard";
import { Box, Typography, Button } from "@mui/material";
import AssignmentReturnIcon from "@mui/icons-material/AssignmentReturn";
import ConstructionIcon from "@mui/icons-material/Construction";

export default function PurchasesReturnPage() {
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
            bgcolor: "primary.light",
            mb: 2,
          }}
        >
          <AssignmentReturnIcon sx={{ fontSize: 40, color: "primary.main" }} />
        </Box>

        <Typography variant="h4" gutterBottom>
          Purchases Return
        </Typography>

        <Typography variant="body1" color="text.secondary" sx={{ maxWidth: 500 }}>
          Manage returns to suppliers. Track defective or excess items being returned and maintain accurate inventory records.
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
          startIcon={<AssignmentReturnIcon />}
          sx={{ mt: 2 }}
        >
          Create Return
        </Button>
      </Box>
    </MainCard>
  );
}
