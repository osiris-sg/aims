import React from "react";
import { Box, Chip, alpha } from "@mui/material";

// The chosen roles in Add / Edit User. Multi-role orgs (features.enableMultiRole, WCT group): several
// plain chips; the first role picked is the primary role quietly (helpers/multiRole rolePayload), with no
// star, "Primary" label or way to change it here (2026-11-18). Other orgs: plain chips, exactly as before.
export default function RoleChips({
  selected,
  labelOf,
  multi,
  onDelete,
}: {
  selected: string[];
  labelOf: (id: string) => string;
  multi: boolean;
  onDelete?: (id: string) => void;
}) {
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  return (
    <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
      {selected.filter(Boolean).map((value) => (
        <Chip
          key={value}
          label={labelOf(value)}
          size="small"
          sx={{
            bgcolor: (th) => alpha(th.palette.primary.main, th.palette.mode === "dark" ? 0.22 : 0.12),
            color: "primary.main",
            fontWeight: 500,
            "& .MuiChip-deleteIcon": {
              color: "primary.main",
              "&:hover": { color: "primary.dark" },
            },
          }}
          onMouseDown={multi ? stop : undefined}
          onDelete={onDelete ? () => onDelete(value) : undefined}
        />
      ))}
    </Box>
  );
}
