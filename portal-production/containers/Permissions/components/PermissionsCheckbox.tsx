// /containers/Permissions/components/PermissionsCheckbox.tsx
import React from "react";
import { Box, Checkbox, FormControlLabel, Typography, Tooltip } from "@mui/material";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";

interface Permission {
  id: string;
  name: string;
  description: string;
  resource: string;
  action: string;
}

interface Props {
  permission: Permission;
  checked: boolean;
  onChange: () => void;
}

export default function PermissionsCheckbox({ permission, checked, onChange }: Props) {
  return (
    <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
      <FormControlLabel
        control={<Checkbox checked={checked} onChange={onChange} />}
        label={
          <Box sx={{ display: "flex", alignItems: "center" }}>
            <Typography variant="body2">{permission.name}</Typography>
          </Box>
        }
      />
      <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
        <Typography variant="caption" color="text.secondary" sx={{ textTransform: "capitalize" }}>
          {permission.action}
        </Typography>
        <Tooltip title={permission.description || "No description available"}>
          <InfoOutlinedIcon fontSize="small" color="action" />
        </Tooltip>
      </Box>
    </Box>
  );
}