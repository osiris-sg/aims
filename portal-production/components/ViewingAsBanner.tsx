"use client";

import React from "react";
import { Box, Typography, Button } from "@mui/material";
import { alpha } from "@mui/material/styles";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import { useOrganization } from "@/app/portal/hooks/useOrganization";

/**
 * Subtle info bar shown when an osiris-admin is viewing a different
 * organization than their actual membership. Important because any write
 * action (create project, upload document, etc.) will be scoped to the
 * switched org — the admin needs an unambiguous indicator of where they are.
 *
 * Hidden when:
 *   - User is not an osiris-admin
 *   - The active org equals the user's home org
 */
export default function ViewingAsBanner() {
  const { isOsirisAdmin, organization, realOrganization, setActiveOrgId } = useOrganization();

  if (!isOsirisAdmin) return null;
  if (!organization || !realOrganization) return null;
  if (organization.id === realOrganization.id) return null;

  return (
    <Box
      sx={{
        mt: 2,
        mx: 2,
        px: 1.5,
        py: 0.5,
        bgcolor: (theme) => alpha(theme.palette.info.main, 0.08),
        borderLeft: 3,
        borderColor: "info.main",
        borderRadius: 0.5,
        display: "flex",
        alignItems: "center",
        gap: 1.25,
        flexWrap: "wrap",
      }}
    >
      <InfoOutlinedIcon fontSize="small" sx={{ color: "info.main", flexShrink: 0 }} />
      <Typography variant="caption" sx={{ color: "text.primary", fontWeight: 600 }}>
        Viewing as {organization.name}
      </Typography>
      <Typography variant="caption" sx={{ color: "text.secondary", flex: 1, minWidth: 0 }}>
        Data and writes are scoped to this org, not your home ({realOrganization.name}).
      </Typography>
      <Button
        size="small"
        variant="text"
        color="info"
        onClick={() => setActiveOrgId(null)}
        sx={{ fontSize: "0.75rem", py: 0.25, minWidth: 0 }}
      >
        Reset to home
      </Button>
    </Box>
  );
}
