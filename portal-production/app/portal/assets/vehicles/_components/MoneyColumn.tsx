"use client";

import React from "react";
import { Box, Stack, Typography } from "@mui/material";
import { LOG_TYPES, LOG_TYPE_SHORT, fmtMoney, type MoneyPeriod } from "@/helpers/wctVehicles";

/**
 * One period of the vehicle page's "Money spent" card (enableWctVehicles): the
 * total and the types that have spending. A period with no spending shows just
 * its total, S$0.00, with no line under it (WCT round 12).
 */
export default function MoneyColumn({ title, p }: { title: string; p: MoneyPeriod }) {
  const parts = LOG_TYPES.filter((t) => p.byType[t] > 0);
  return (
    <Box sx={{ flex: 1, minWidth: 180 }}>
      <Typography variant="caption" color="text.secondary">
        {title}
      </Typography>
      <Typography variant="h6" fontWeight={700} sx={{ fontVariantNumeric: "tabular-nums" }}>
        {fmtMoney(p.total)}
      </Typography>
      {parts.map((t) => (
        <Stack key={t} direction="row" justifyContent="space-between" sx={{ typography: "caption", color: "text.secondary" }}>
          <span>{LOG_TYPE_SHORT[t]}</span>
          <span style={{ fontVariantNumeric: "tabular-nums" }}>{fmtMoney(p.byType[t])}</span>
        </Stack>
      ))}
    </Box>
  );
}
