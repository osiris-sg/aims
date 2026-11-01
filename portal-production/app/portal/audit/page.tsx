"use client";

import React, { useState } from "react";
import AuditLogs from "./components/AuditLogs";
import ActivityLog from "./components/ActivityLog";
import MainCard from "@/components/MainCard";
import { Box, Tab, Tabs } from "@mui/material";
import { useTranslations } from "next-intl";
import { useOrganizationFeatures, FEATURE_FLAG_DEFAULTS } from "../hooks/useOrganizationFeatures";

export default function Page() {
  const { features } = useOrganizationFeatures();
  const t = useTranslations("audit.tabs");
  // Default ON for every org (stored config only overrides when an admin
  // explicitly switched it off).
  const actionLogEnabled = features?.enableActionLog ?? FEATURE_FLAG_DEFAULTS.enableActionLog;
  const [tab, setTab] = useState(0);

  // Explicitly switched off → legacy audit page unchanged.
  if (!actionLogEnabled) return <AuditLogs />;

  return (
    <Box>
      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 1, borderBottom: 1, borderColor: "divider" }}>
        <Tab label={t("activity")} />
        <Tab label={t("legacy")} />
      </Tabs>
      {tab === 0 ? (
        <MainCard>
          <ActivityLog />
        </MainCard>
      ) : (
        <AuditLogs />
      )}
    </Box>
  );
}
