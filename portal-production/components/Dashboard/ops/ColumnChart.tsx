"use client";

// Monthly columns, optionally stacked by series. Used for revenue over time
// (one series) and field activity by kind (four series).
//
// Mark spec: columns capped at 24px so the band keeps its air, 4px rounded top
// with a square foot on the baseline, a 2px surface gap between stacked
// segments. Grid and axis text stay recessive; the values live in the tooltip
// and in selective direct labels rather than on every column.

import React, { useState } from "react";
import { Box, Typography, useTheme } from "@mui/material";
import { seriesColor, monthLabel } from "./vizTokens";

export interface ColumnDatum {
  month: string;
  /** series key -> value. A single-series chart passes one entry. */
  values: Record<string, number>;
}

interface Props {
  data: ColumnDatum[];
  series: Array<{ key: string; label: string; slot: number }>;
  height?: number;
  /** Formats the tooltip + direct label (money vs plain count). */
  format?: (n: number) => string;
  emptyMessage?: string;
}

export default function ColumnChart({ data, series, height = 200, format, emptyMessage }: Props) {
  const theme = useTheme();
  const dark = theme.palette.mode === "dark";
  const [hover, setHover] = useState<number | null>(null);
  const fmt = format || ((n: number) => String(Math.round(n)));

  const totals = data.map((d) => series.reduce((t, s) => t + (Number(d.values[s.key]) || 0), 0));
  const peak = Math.max(1, ...totals);

  if (!data.length) {
    return (
      <Box sx={{ height, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Typography variant="body2" sx={{ color: "text.secondary" }}>
          {emptyMessage || "Nothing in this period"}
        </Typography>
      </Box>
    );
  }

  const plotH = height - 28; // leave room for the month axis
  // Cap the column, then centre it in whatever the band turns out to be.
  const bandPct = 100 / data.length;

  return (
    <Box sx={{ position: "relative" }}>
      <Box sx={{ display: "flex", alignItems: "flex-end", height: plotH, gap: 0 }}>
        {data.map((d, i) => {
          const total = totals[i];
          const isHover = hover === i;
          // Direct-label only the tallest column — labels work because they're sparing.
          const isPeak = total === peak && total > 0;
          return (
            <Box
              key={d.month}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              sx={{
                width: `${bandPct}%`,
                height: "100%",
                display: "flex",
                flexDirection: "column",
                justifyContent: "flex-end",
                alignItems: "center",
                position: "relative",
                cursor: "default",
              }}
            >
              {isPeak && (
                <Typography
                  variant="caption"
                  sx={{ color: "text.secondary", mb: 0.25, fontVariantNumeric: "tabular-nums" }}
                >
                  {fmt(total)}
                </Typography>
              )}
              <Box
                sx={{
                  width: "100%",
                  maxWidth: 24,
                  height: `${(total / peak) * 100}%`,
                  minHeight: total > 0 ? 3 : 0,
                  display: "flex",
                  flexDirection: "column-reverse",
                  // 4px rounded data-end, square foot on the baseline.
                  borderTopLeftRadius: 4,
                  borderTopRightRadius: 4,
                  overflow: "hidden",
                  opacity: hover == null || isHover ? 1 : 0.55,
                  transition: "opacity 120ms",
                }}
              >
                {series.map((s, si) => {
                  const v = Number(d.values[s.key]) || 0;
                  if (v <= 0) return null;
                  return (
                    <Box
                      key={s.key}
                      sx={{
                        height: `${(v / total) * 100}%`,
                        bgcolor: seriesColor(s.slot, dark),
                        // 2px surface gap does the separating, never a border.
                        borderBottom: si > 0 ? "2px solid" : "none",
                        borderColor: "background.paper",
                      }}
                    />
                  );
                })}
              </Box>
            </Box>
          );
        })}
      </Box>

      {/* Recessive month axis */}
      <Box sx={{ display: "flex", mt: 0.75, borderTop: 1, borderColor: "divider", pt: 0.5 }}>
        {data.map((d) => (
          <Typography
            key={d.month}
            variant="caption"
            sx={{ width: `${bandPct}%`, textAlign: "center", color: "text.secondary" }}
          >
            {monthLabel(d.month)}
          </Typography>
        ))}
      </Box>

      {hover != null && (
        <Box
          sx={{
            position: "absolute",
            top: 0,
            left: `${Math.min(Math.max(hover * bandPct, 0), 100 - bandPct)}%`,
            transform: "translateX(-25%)",
            bgcolor: "background.paper",
            border: 1,
            borderColor: "divider",
            borderRadius: 1,
            boxShadow: 3,
            p: 1,
            pointerEvents: "none",
            zIndex: 2,
            minWidth: 130,
          }}
        >
          <Typography variant="caption" sx={{ fontWeight: 700, display: "block", mb: 0.25 }}>
            {monthLabel(data[hover].month)} {data[hover].month.split("-")[0]}
          </Typography>
          {series.map((s) => {
            const v = Number(data[hover].values[s.key]) || 0;
            if (v <= 0) return null;
            return (
              <Box key={s.key} sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
                <Box sx={{ width: 8, height: 8, borderRadius: "2px", bgcolor: seriesColor(s.slot, dark), flexShrink: 0 }} />
                <Typography variant="caption" sx={{ color: "text.secondary", flex: 1 }}>
                  {s.label}
                </Typography>
                <Typography variant="caption" sx={{ fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>
                  {fmt(v)}
                </Typography>
              </Box>
            );
          })}
        </Box>
      )}
    </Box>
  );
}
