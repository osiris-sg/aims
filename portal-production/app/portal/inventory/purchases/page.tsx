"use client";

import React from "react";
import MainCard from "@/components/MainCard";
import { Box, Typography, Button } from "@mui/material";
import ShoppingCartIcon from "@mui/icons-material/ShoppingCart";
import ConstructionIcon from "@mui/icons-material/Construction";

export default function PurchasesPage() {
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
          <ShoppingCartIcon sx={{ fontSize: 40, color: "primary.main" }} />
        </Box>

        <Typography variant="h4" gutterBottom>
          Purchases
        </Typography>

        <Typography variant="body1" color="text.secondary" sx={{ maxWidth: 500 }}>
          Record and manage purchase orders from suppliers. Track incoming stock and maintain supplier relationships.
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
          startIcon={<ShoppingCartIcon />}
          sx={{ mt: 2 }}
        >
          Create Purchase Order
        </Button>
      </Box>
    </MainCard>
  );
}
