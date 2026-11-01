"use client";

import React from "react";
import { Chip } from "@mui/material";
import { alpha } from "@mui/material/styles";

type PillColor = "default" | "info" | "warning" | "success" | "error";

/**
 * Order / job status chip on the WCT order screens, readable in both themes.
 * The themes tint success / warning / error chips (soft background, coloured
 * text) but not info: a filled info chip was pale text on a pale pill in dark
 * mode ("Scheduled", "Invoiced"). Info gets the same tint here.
 */
export default function StatusPill({ label, color, variant = "filled" }: { label: string; color: PillColor; variant?: "filled" | "outlined" }) {
  return (
    <Chip
      size="small"
      label={label}
      color={color}
      variant={variant}
      sx={
        color === "info" && variant === "filled"
          ? (t) => ({
              bgcolor: alpha(t.palette.info.main, t.palette.mode === "dark" ? 0.2 : 0.14),
              color: t.palette.mode === "dark" ? t.palette.info.main : t.palette.info.dark,
            })
          : undefined
      }
    />
  );
}
