"use client";

// Dashboard (/portal/shipments/dashboard) — its own top-level nav item since round T (2026-10-22). One page,
// two views behind a toggle: "Overview" (the email-first dashboard, round P) and "Admin" (money in / out,
// expected vs received, per-order margin & profit, 3-month summary) — the Admin toggle shows only for roles
// with shipments:money (ADH Manager / Admin); the API enforces it too. The old Home (LegacyHome) stays behind
// enableShipmentsHome, off.

import React, { useEffect, useState } from "react";
import { Box, CircularProgress, Stack, ToggleButton, ToggleButtonGroup, Typography } from "@mui/material";
import { useOrganizationFeatures } from "@/app/portal/hooks/useOrganizationFeatures";
import { useUserPermissions } from "@/app/portal/hooks/useUserPermissions";
import EmailDashboard from "../_components/EmailDashboard";
import LegacyHome from "../_components/LegacyHome";
import AdminDashboard from "../_components/AdminDashboard";

type View = "overview" | "admin";
const KEY = "aims-sales-dashboard-view";

export default function SalesDashboardPage() {
  const { isLoading, isShipmentsHomeEnabled } = useOrganizationFeatures();
  const { hasPermission, userRoles } = useUserPermissions();
  // ADH Manager (shipments:money) or a platform admin role (the API lets osirisadmin / superadmin through too).
  const canAdmin = hasPermission("shipments", "money") || userRoles.some((r: any) => ["superadmin", "admin", "osirisadmin"].includes(String(r?.name ?? "").toLowerCase()));
  const [view, setView] = useState<View>("overview");
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(KEY);
      if (saved === "admin") setView("admin");
    } catch {
      /* per-viewer convenience only */
    }
  }, []);
  const pick = (v: View) => {
    setView(v);
    try {
      window.localStorage.setItem(KEY, v);
    } catch {
      /* ignore */
    }
  };
  if (isLoading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
        <CircularProgress />
      </Box>
    );
  }
  if (isShipmentsHomeEnabled) return <LegacyHome />;
  const showAdmin = canAdmin && view === "admin";
  return (
    <Box>
      {canAdmin && (
        <Stack direction="row" spacing={2} alignItems="center" sx={{ px: { xs: 1.5, md: 3 }, pt: 2 }} data-tour="dashboard-toggle">
          <Typography variant="h5" sx={{ fontWeight: 800 }}>
            Dashboard
          </Typography>
          <ToggleButtonGroup size="small" exclusive value={view} onChange={(_, v) => v && pick(v)}>
            <ToggleButton value="overview" sx={{ textTransform: "none", px: 2 }}>
              Overview
            </ToggleButton>
            <ToggleButton value="admin" sx={{ textTransform: "none", px: 2 }}>
              Admin
            </ToggleButton>
          </ToggleButtonGroup>
        </Stack>
      )}
      {showAdmin ? <AdminDashboard /> : <EmailDashboard />}
    </Box>
  );
}
