"use client";

// Round H (2026-10): Declaration, Payments, Stock and the supplier-order pages
// left the menu (one order process; payments on the steps). Their routes stay
// but show only with the org flag enableTradeLegacyPages (off by default).

import React from "react";
import { Alert, Box, Button, CircularProgress } from "@mui/material";
import { useOrganizationFeatures } from "@/app/portal/hooks/useOrganizationFeatures";

export default function LegacyGate({ what, children }: { what: string; children: React.ReactNode }) {
  const { features, isLoading } = useOrganizationFeatures();
  if (isLoading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
        <CircularProgress />
      </Box>
    );
  }
  if (!(features as Record<string, boolean>).enableTradeLegacyPages) {
    return (
      <Box sx={{ p: 3, maxWidth: 720, mx: "auto" }}>
        <Alert
          severity="info"
          action={
            <Button color="inherit" size="small" href="/portal/shipments">
              Orders
            </Button>
          }
        >
          {what} is no longer used — orders are one process now (PI, deposit and payments are on the order&apos;s steps; the month&apos;s orders are made with “+ New monthly order”).
        </Alert>
      </Box>
    );
  }
  return <>{children}</>;
}
