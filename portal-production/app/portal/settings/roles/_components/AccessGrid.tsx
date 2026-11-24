"use client";

// Custom access (enableCustomAccess, WCT group 2026-11-19): one row per tab with
// No access / View / Edit (Sales report: No access / Own / All; the HR rows, where the org has HR, may
// also offer Approve). Used by Org Settings > Roles
// and by Add / Edit User's "Custom access". The server enforces the same table.
import React from "react";
import { Box, ToggleButton, ToggleButtonGroup, Typography } from "@mui/material";
import { ACCESS_TABS, isHrTab, levelLabel, type AccessLevel, type TabAccessMap, type TabKey } from "@/helpers/customAccess";
import { useOrganizationFeatures } from "@/app/portal/hooks/useOrganizationFeatures";

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
  // HR rows (2026-11-24): only for orgs with the HR (Field) module on; other orgs see the grid as before.
  const { fieldAreas } = useOrganizationFeatures();
  const hrOn = (fieldAreas?.length ?? 0) > 0;
  const set = (key: TabKey, level: AccessLevel | null) => {
    if (!level || readOnly || !onChange) return;
    onChange({ ...value, [key]: level });
  };
  return (
    <Box sx={{ display: "flex", flexDirection: "column", border: 1, borderColor: "divider", borderRadius: 1 }}>
      {ACCESS_TABS.map((t, i) => (isHrTab(t.key) && !hrOn ? null : (
        <React.Fragment key={t.key}>
        {t.group && ACCESS_TABS[i - 1]?.group !== t.group && (
          <Box sx={{ px: 1.5, py: 0.75, borderTop: i ? 1 : 0, borderColor: "divider", bgcolor: "action.hover" }}>
            <Typography variant="overline" sx={{ color: "text.secondary", lineHeight: 1.6 }}>
              {t.group}
            </Typography>
          </Box>
        )}
        <Box
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
            aria-label={t.group ? `${t.group} ${t.label}` : t.label}
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
        </React.Fragment>
      )))}
    </Box>
  );
}
