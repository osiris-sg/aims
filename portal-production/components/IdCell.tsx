"use client";
/*
 * The ID column of every list (guru 2026-11-21: "for like order no which is an
 * id, follow the same font and size and bold as the rest"): order no, document
 * / voucher / job number, customer or supplier code, SKU, project id… All of
 * them render through this — bold 600, tabular figures, the table's own font
 * size. Companion rule: the Status column is always the LAST data column.
 */
import React from "react";
import { Box } from "@mui/material";

export const idCellSx = { fontVariantNumeric: "tabular-nums", fontWeight: 600 } as const;

export function IdCell({ children }: { children: React.ReactNode }) {
  return (
    <Box component="span" sx={idCellSx}>
      {children}
    </Box>
  );
}
