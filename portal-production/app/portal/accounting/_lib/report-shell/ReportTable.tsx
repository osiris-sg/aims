"use client";

// Xero-style report table: sticky headers, group header rows, bold subtotal
// rows, right-aligned numerics with dash-for-zero and (parens) negatives,
// optional drill-down links. Theme-token colors only.

import React from "react";
import { Box, Link as MuiLink, Table, TableBody, TableCell, TableHead, TableRow, Typography, alpha } from "@mui/material";

export const fmtAmount = (v: number | null | undefined, dashZero = true): string => {
  if (v == null || (dashZero && Math.abs(v) < 0.005)) return "-";
  const abs = Math.abs(v).toLocaleString("en-SG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return v < 0 ? `(${abs})` : abs;
};

export const fmtDate = (v: string | Date | null | undefined): string => {
  if (!v) return "";
  const d = typeof v === "string" ? new Date(v) : v;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
};

export interface ReportColumn {
  key: string;
  label: string;
  align?: "left" | "right";
  width?: number | string;
}

export type ReportRowKind = "group" | "row" | "subtotal" | "total" | "percent";

export interface ReportRow {
  kind: ReportRowKind;
  cells: (string | number | null | { text: string; href?: string; onClick?: () => void })[];
  key: string;
  /** flag row (e.g. GST estimated ≠ actual) — rendered with an error tint */
  highlight?: boolean;
}

export default function ReportTable({
  columns, rows, compact = true,
}: {
  columns: ReportColumn[];
  rows: ReportRow[];
  compact?: boolean;
}) {
  const py = compact ? 0.5 : 1.1;
  const renderCell = (c: ReportRow["cells"][number], col: ReportColumn, bold: boolean) => {
    const align = col.align || "left";
    let content: React.ReactNode;
    if (c != null && typeof c === "object") {
      content = c.href || c.onClick ? (
        <MuiLink href={c.href} onClick={c.onClick} underline="hover" sx={{ cursor: "pointer", color: "primary.main" }}>{c.text}</MuiLink>
      ) : c.text;
    } else if (typeof c === "number") {
      content = fmtAmount(c);
    } else {
      content = c ?? "";
    }
    return (
      <Typography variant="body2" sx={{ fontWeight: bold ? 700 : 400, textAlign: align, fontVariantNumeric: "tabular-nums" }}>
        {content}
      </Typography>
    );
  };

  return (
    <Box sx={{ overflowX: "auto" }}>
      <Table size="small" sx={{ minWidth: 720 }}>
        <TableHead>
          <TableRow>
            {columns.map((col) => (
              <TableCell
                key={col.key}
                sx={{
                  position: "sticky", top: 0, zIndex: 1,
                  bgcolor: "background.paper",
                  borderBottom: (t) => `1px solid ${t.palette.text.primary}`,
                  color: "text.secondary",
                  fontSize: "0.75rem",
                  width: col.width,
                  textAlign: col.align || "left",
                  py: 0.75,
                }}
              >
                {col.label}
              </TableCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((r) => {
            if (r.kind === "group") {
              return (
                <TableRow key={r.key}>
                  <TableCell colSpan={columns.length} sx={{ borderBottom: "none", pt: 1.5, pb: 0.25 }}>
                    <Typography variant="body2" sx={{ fontWeight: 700 }}>{String(r.cells[0] ?? "")}</Typography>
                  </TableCell>
                </TableRow>
              );
            }
            const bold = r.kind === "subtotal" || r.kind === "total" || r.kind === "percent";
            return (
              <TableRow
                key={r.key}
                sx={{
                  ...(r.kind === "total" ? { "& td": { borderTop: (t: any) => `1px solid ${t.palette.text.primary}` } } : {}),
                  ...(r.highlight ? { bgcolor: (t: any) => alpha(t.palette.error.main, 0.08) } : {}),
                  "&:hover": r.kind === "row"
                    ? { bgcolor: (t) => alpha(r.highlight ? t.palette.error.main : t.palette.primary.main, r.highlight ? 0.14 : 0.04) }
                    : {},
                }}
              >
                {r.cells.map((c, i) => (
                  <TableCell key={i} sx={{ py, borderBottom: (t) => `1px solid ${t.palette.divider}`, ...(r.kind === "percent" ? { borderBottom: "none" } : {}) }}>
                    {renderCell(c, columns[i], bold)}
                  </TableCell>
                ))}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </Box>
  );
}
