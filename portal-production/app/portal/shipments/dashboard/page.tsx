"use client";

// Sales › Dashboard (/portal/shipments/dashboard) — the landing page of a
// trade org (round P). The email-first dashboard (EmailDashboard); with the
// org flag enableShipmentsHome the OLD Home (tasks + cash / margin, LegacyHome)
// shows here instead — kept, not deleted.

import React from "react";
import { Box, CircularProgress } from "@mui/material";
import { useOrganizationFeatures } from "@/app/portal/hooks/useOrganizationFeatures";
import EmailDashboard from "../_components/EmailDashboard";
import LegacyHome from "../_components/LegacyHome";

export default function SalesDashboardPage() {
  const { isLoading, isShipmentsHomeEnabled } = useOrganizationFeatures();
  if (isLoading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
        <CircularProgress />
      </Box>
    );
  }
  return isShipmentsHomeEnabled ? <LegacyHome /> : <EmailDashboard />;
}
