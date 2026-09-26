"use client";

// Stock on hand, one row per product: a horizontal stacked bar showing how the
// units of that product are split across statuses, with the counts spelled out
// beside it. The numbers are repeated as text on purpose — the light-mode
// palette sits below 3:1 against the surface, and the rule is that colour alone
// may not carry a value.

import React, { useState } from "react";
import { Box, Typography, useTheme } from "@mui/material";
import { seriesColor, STOCK_STATUSES } from "./vizTokens";

export interface StockRow {
  asset: string;
  total: number;
  instock: number;
  rental: number;
  reserved: number;
  maintenance: number;
  sold: number;
}

export default function StockBars({ rows }: { rows: StockRow[] }) {
  const dark = useTheme().palette.mode === "dark";
  const [hover, setHover] = useState<string | null>(null);
  const widest = Math.max(1, ...rows.map((r) => r.total));

  if (!rows.length) {
    return (
      <Typography variant="body2" sx={{ color: "text.secondary", py: 4, textAlign: "center" }}>
        No units recorded yet.
      </Typography>
    );
  }

  return (
    <Box>
      {rows.map((r) => (
        <Box
          key={r.asset}
          onMouseEnter={() => setHover(r.asset)}
          onMouseLeave={() => setHover(null)}
          sx={{ mb: 1.25, opacity: hover == null || hover === r.asset ? 1 : 0.6, transition: "opacity 120ms" }}
        >
          <Box sx={{ display: "flex", alignItems: "baseline", gap: 1, mb: 0.4 }}>
            <Typography variant="body2" sx={{ fontWeight: 600, flex: 1, minWidth: 0, wordBreak: "break-word" }}>
              {r.asset}
            </Typography>
            <Typography variant="caption" sx={{ color: "text.secondary", fontVariantNumeric: "tabular-nums" }}>
              {r.instock} in stock · {r.rental} on rent
            </Typography>
            <Typography variant="body2" sx={{ fontWeight: 700, fontVariantNumeric: "tabular-nums", minWidth: 28, textAlign: "right" }}>
              {r.total}
            </Typography>
          </Box>
          <Box
            sx={{
              display: "flex",
              width: `${Math.max((r.total / widest) * 100, 2)}%`,
              height: 12,
              borderRadius: "0 4px 4px 0", // rounded data-end, square at the baseline
              overflow: "hidden",
              bgcolor: "action.hover",
            }}
          >
            {STOCK_STATUSES.map((s, i) => {
              const v = (r as any)[s.key] as number;
              if (!v) return null;
              return (
                <Box
                  key={s.key}
                  title={`${s.label}: ${v}`}
                  sx={{
                    width: `${(v / r.total) * 100}%`,
                    bgcolor: seriesColor(s.slot, dark),
                    // 2px gap in the surface colour separates touching segments.
                    borderRight: i < STOCK_STATUSES.length - 1 ? "2px solid" : "none",
                    borderColor: "background.paper",
                  }}
                />
              );
            })}
          </Box>
        </Box>
      ))}
    </Box>
  );
}
