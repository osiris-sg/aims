"use client";

import React, { useEffect } from "react";
import { Box } from "@mui/material";
import AimeeBar from "@/app/portal/chat/AimeeBar";
import EmailDashboard from "@/app/portal/shipments/_components/EmailDashboard";
import { setAimeeContext } from "@/app/portal/shipments/_components/aimee/bridge";

export default function DashboardPreview() {
  useEffect(() => {
    setAimeeContext("page", { view: "Dashboard", path: "/portal" });
  }, []);
  return (
    <Box sx={{ minHeight: "100vh", bgcolor: "background.default", display: "flex", flexDirection: "column" }}>
      <Box sx={{ pt: 2 }}>
        <AimeeBar />
      </Box>
      <Box sx={{ pt: 2 }}>
        <EmailDashboard />
      </Box>
    </Box>
  );
}
