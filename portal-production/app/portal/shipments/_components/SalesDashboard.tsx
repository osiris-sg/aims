"use client";

// Round Z (2026-10-22): the Sales dashboard IS the portal home — /portal renders this for an org with the SHIPMENTS
// module (app/portal/page.tsx), the way Biofuel gets its own dashboard there; /portal/shipments/dashboard redirects.
// One page,
// two views behind a toggle: "Overview" (the email-first dashboard, round P) and "Admin" (money in / out,
// expected vs received, per-order margin & profit, 3-month summary) — the Admin toggle shows only for roles
// with shipments:money (ADH Manager / Admin); the API enforces it too. The old Home (LegacyHome) stays behind
// enableShipmentsHome, off. Round W: Inbox left the Sales menu — `?view=emails` renders the full two-tab
// email view (EmailsAll) as a sub-view of the Dashboard, with "← Back to Dashboard" above it.

import React, { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Box, CircularProgress, Stack, ToggleButton, ToggleButtonGroup } from "@mui/material";
import { useOrganizationFeatures } from "@/app/portal/hooks/useOrganizationFeatures";
import { useUserPermissions } from "@/app/portal/hooks/useUserPermissions";
import EmailDashboard from "./EmailDashboard";
import LegacyHome from "./LegacyHome";
import AdminDashboard from "./AdminDashboard";
import EmailsAll from "./inbox/EmailsAll";
import { SHIPMENTS_HOME } from "@/helpers/shipmentsNav";

type View = "overview" | "admin";
const KEY = "aims-sales-dashboard-view";

const Spinner = () => (
  <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
    <CircularProgress />
  </Box>
);

export default function SalesDashboard() {
  // useSearchParams needs a Suspense boundary for the static render.
  return (
    <Suspense fallback={<Spinner />}>
      <SalesDashboardInner />
    </Suspense>
  );
}

function SalesDashboardInner() {
  const params = useSearchParams();
  const emailsView = params?.get("view") === "emails";
  const { isLoading, isShipmentsHomeEnabled } = useOrganizationFeatures();
  const { hasPermission, userRoles } = useUserPermissions();
  // ADH Manager (shipments:money) or a platform admin role (the API lets osirisadmin / superadmin through too).
  // (A platform admin "viewing as" ADH has no role row in the org — the same convention as the nav: no roles = admin.)
  const canAdmin = hasPermission("shipments", "money") || userRoles.length === 0 || userRoles.some((r: any) => ["superadmin", "admin", "osirisadmin"].includes(String(r?.name ?? "").toLowerCase()));
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
  if (isLoading) return <Spinner />;
  if (emailsView) {
    // The emails sub-view: no Overview / Admin toggle, just the way back.
    return (
      <Box>
        <Box sx={{ px: { xs: 1.5, md: 3 }, pt: 2 }}>
          <Link href={SHIPMENTS_HOME} style={{ fontSize: 13, fontWeight: 600 }} data-tour="emails-back">
            ← Back to Dashboard
          </Link>
        </Box>
        <EmailsAll />
      </Box>
    );
  }
  if (isShipmentsHomeEnabled) return <LegacyHome />;
  const showAdmin = canAdmin && view === "admin";
  return (
    <Box>
      {canAdmin && (
        // Round AC (owner): no "Dashboard" heading — the Overview / Admin toggle alone, on the first line, left-aligned with the content column.
        <Stack direction="row" spacing={2} alignItems="center" sx={{ px: { xs: 1.5, md: 3 }, pt: 2, maxWidth: showAdmin ? 1400 : 1200, mx: "auto" }} data-tour="dashboard-toggle">
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
