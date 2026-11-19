"use client";

// Add / Edit User "Custom access" (enableCustomAccess, WCT group 2026-11-19; Admin / superadmin
// only): when on, the person's access is set per tab here and replaces their roles.
import React from "react";
import { Box, FormControlLabel, Switch } from "@mui/material";
import AccessGrid from "@/app/portal/settings/roles/_components/AccessGrid";
import type { TabAccessMap } from "@/helpers/customAccess";

export default function CustomAccessSection({
  on,
  tabs,
  onToggle,
  onChange,
  orgSettingsEdit,
  disabled = false,
}: {
  on: boolean;
  tabs: TabAccessMap;
  onToggle: (on: boolean) => void;
  onChange: (tabs: TabAccessMap) => void;
  orgSettingsEdit: boolean;
  disabled?: boolean;
}) {
  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
      <FormControlLabel control={<Switch checked={on} disabled={disabled} onChange={(e) => onToggle(e.target.checked)} />} label="Custom access" />
      {on && <AccessGrid value={tabs} onChange={onChange} orgSettingsEdit={orgSettingsEdit} />}
    </Box>
  );
}
