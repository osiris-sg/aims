"use client";

// A legend is always present for two or more series, so identity never rests on
// colour alone. Swatches carry the colour; the text stays in text tokens.

import React from "react";
import { Box, Typography, useTheme } from "@mui/material";
import { seriesColor } from "./vizTokens";

export default function Legend({
  series,
  counts,
}: {
  series: ReadonlyArray<{ key: string; label: string; slot: number }>;
  /** Optional value shown beside each label — doubles as the table view. */
  counts?: Record<string, number>;
}) {
  const dark = useTheme().palette.mode === "dark";
  return (
    <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1.5, rowGap: 0.5 }}>
      {series.map((s) => (
        <Box key={s.key} sx={{ display: "flex", alignItems: "center", gap: 0.6 }}>
          <Box sx={{ width: 10, height: 10, borderRadius: "2px", bgcolor: seriesColor(s.slot, dark), flexShrink: 0 }} />
          <Typography variant="caption" sx={{ color: "text.secondary" }}>
            {s.label}
            {counts && counts[s.key] != null ? (
              <Box component="span" sx={{ color: "text.primary", fontWeight: 600, ml: 0.5, fontVariantNumeric: "tabular-nums" }}>
                {counts[s.key]}
              </Box>
            ) : null}
          </Typography>
        </Box>
      ))}
    </Box>
  );
}
