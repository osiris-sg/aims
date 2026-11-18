"use client";

// Totals under a ledger / balances table, rendered as a FOOTER ROW of the same
// table so every figure sits under its own column (guru 2026-11-16: "align the
// bottom credit, debit and total with the top columns — all such components").
// The old free-floating strip (a flex Paper under the table) drifted away from
// the columns. Sticks to the bottom of a scrolling TableContainer.

import React from "react";
import { TableCell, TableFooter, TableRow, Typography } from "@mui/material";
import { alpha } from "@mui/material/styles";

export interface TotalsCell {
  /** small uppercase caption above the figure, e.g. "Total Debit"; omit for a blank cell */
  label?: string;
  value?: React.ReactNode;
  colSpan?: number;
  align?: "left" | "right";
}

export default function TableTotalsRow({
  note, noteColSpan, cells,
}: {
  /** muted text in the leading cells (a hint such as "Click a customer…"), or "Total" */
  note?: React.ReactNode;
  noteColSpan: number;
  cells: TotalsCell[];
}) {
  const cellSx = (t: any) => ({
    position: "sticky" as const,
    bottom: 0,
    zIndex: 1,
    py: 0.75,
    bgcolor: "background.paper",
    // same soft tint the old strip had, in both themes
    backgroundImage: `linear-gradient(${alpha(t.palette.text.primary, 0.04)}, ${alpha(t.palette.text.primary, 0.04)})`,
    borderTop: `1px solid ${t.palette.text.primary}`,
    // No rule under the strip (guru 2026-11-18: the double line at the bottom
    // of the GL / AR / AP homes looked like a glitch on screen; the printed
    // reports keep their own double-ruled TOTAL).
    borderBottom: "none",
  });
  return (
    <TableFooter>
      <TableRow>
        <TableCell colSpan={noteColSpan} sx={cellSx}>
          {typeof note === "string" ? (
            <Typography variant="caption" sx={{ color: "text.secondary" }}>{note}</Typography>
          ) : note}
        </TableCell>
        {cells.map((c, i) => (
          <TableCell key={i} colSpan={c.colSpan} sx={(t) => ({ ...cellSx(t), textAlign: c.align || "right", whiteSpace: "nowrap" })}>
            {c.label && (
              <Typography variant="caption" sx={{ display: "block", color: "text.secondary", textTransform: "uppercase", letterSpacing: "0.06em", lineHeight: 1.2 }}>
                {c.label}
              </Typography>
            )}
            {c.value != null && (
              <Typography sx={{ fontVariantNumeric: "tabular-nums", fontWeight: 700, color: "text.primary", lineHeight: 1.3 }}>{c.value}</Typography>
            )}
          </TableCell>
        ))}
      </TableRow>
    </TableFooter>
  );
}
