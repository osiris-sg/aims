"use client";

// Custom access (enableCustomAccess, WCT group 2026-11-19): one row per tab with
// No access / View / Edit (Sales report: No access / Own / All). Used by Org Settings > Roles
// and by Add / Edit User's "Custom access". The server enforces the same table.
import React from "react";
import { Box, ToggleButton, ToggleButtonGroup, Typography } from "@mui/material";
import { ACCESS_TABS, levelLabel, type AccessLevel, type TabAccessMap, type TabKey } from "@/helpers/customAccess";

export default function AccessGrid({
  value,
  onChange,
  readOnly = false,
  orgSettingsEdit = false,
}: {
  value: TabAccessMap;
  onChange?: (next: TabAccessMap) => void;
  readOnly?: boolean;
  /** Org Settings Edit is offered only for someone who holds the Admin role. */
  orgSettingsEdit?: boolean;
}) {
  const set = (key: TabKey, level: AccessLevel | null) => {
    if (!level || readOnly || !onChange) return;
    onChange({ ...value, [key]: level });
  };
  return (
    <Box sx={{ display: "flex", flexDirection: "column", border: 1, borderColor: "divider", borderRadius: 1 }}>
      {ACCESS_TABS.map((t, i) => (
        <Box
          key={t.key}
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 1,
            px: 1.5,
            py: 0.75,
            borderTop: i ? 1 : 0,
            borderColor: "divider",
            flexWrap: "wrap",
          }}
        >
          <Typography variant="body2" sx={{ fontWeight: 500, color: "text.primary", minWidth: 120 }}>
            {t.label}
          </Typography>
          <ToggleButtonGroup
            size="small"
            exclusive
            value={value[t.key]}
            onChange={(_e, v) => set(t.key, v)}
            disabled={readOnly}
            aria-label={t.label}
          >
            {t.levels.map((l) => (
              <ToggleButton
                key={l}
                value={l}
                disabled={readOnly || (t.key === "orgSettings" && l === "edit" && !orgSettingsEdit)}
                sx={{ textTransform: "none", px: 1.25, py: 0.25, fontSize: "0.8rem" }}
              >
                {levelLabel(t.key, l)}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
        </Box>
      ))}
    </Box>
  );
}
