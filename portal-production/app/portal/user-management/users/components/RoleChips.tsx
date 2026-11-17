import React from "react";
import { Box, Chip, Tooltip, alpha } from "@mui/material";
import StarIcon from "@mui/icons-material/Star";
import StarBorderIcon from "@mui/icons-material/StarBorder";
import { useTranslations } from "next-intl";

// The chosen roles in Add / Edit User. Multi-role orgs (features.enableMultiRole): the
// first chip is the Primary role (filled star + "Primary"); the star on any other chip
// makes that role primary. Other orgs: plain chips, exactly as before.
export default function RoleChips({
  selected,
  labelOf,
  multi,
  onDelete,
  onMakePrimary,
}: {
  selected: string[];
  labelOf: (id: string) => string;
  multi: boolean;
  onDelete?: (id: string) => void;
  onMakePrimary?: (id: string) => void;
}) {
  const t = useTranslations("users.form");
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  return (
    <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
      {selected.filter(Boolean).map((value, i) => {
        const primary = multi && i === 0;
        const icon = !multi ? undefined : primary ? (
          <StarIcon data-testid="role-chip-primary" />
        ) : (
          <Tooltip title={t("makePrimary")}>
            <StarBorderIcon
              data-testid={`role-chip-make-primary-${value}`}
              onMouseDown={stop}
              onClick={(e) => {
                e.stopPropagation();
                onMakePrimary?.(value);
              }}
              sx={{ cursor: "pointer" }}
            />
          </Tooltip>
        );
        return (
          <Chip
            key={value}
            icon={icon}
            label={primary ? `${labelOf(value)} · ${t("primary")}` : labelOf(value)}
            size="small"
            data-testid={primary ? "role-chip-primary-chip" : undefined}
            sx={{
              bgcolor: (th) => alpha(th.palette.primary.main, th.palette.mode === "dark" ? (primary ? 0.34 : 0.22) : primary ? 0.2 : 0.12),
              color: "primary.main",
              fontWeight: primary ? 600 : 500,
              "& .MuiChip-icon": { color: "primary.main" },
              "& .MuiChip-deleteIcon": {
                color: "primary.main",
                "&:hover": { color: "primary.dark" },
              },
            }}
            onMouseDown={multi ? stop : undefined}
            onDelete={onDelete ? () => onDelete(value) : undefined}
          />
        );
      })}
    </Box>
  );
}
