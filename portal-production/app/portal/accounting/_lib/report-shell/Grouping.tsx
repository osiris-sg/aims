"use client";

// Xero-style Grouping/Summarising control + generic client-side engine.
//
// Semantics (studied from live Xero 2026-07-10):
// - "Group by X":      group header row per distinct X value → detail rows →
//                      bold "Total <X>" row with numeric subtotals.
// - "Summarise by X":  ONE aggregated bold row per distinct X value; the
//                      report's non-numeric columns are left blank.
// - The grouped field's own column is removed from the table; when grouping
//   by something other than Contact, Contact shows as a normal column.
// - Group keys are the field's display value (dates = "1 Jul 2026", exact
//   date, not month). Groups sort ascending by raw value.

import React, { useState } from "react";
import {
  Box, Divider, ListItemText, Menu, MenuItem, Radio, Stack, TextField, Typography,
} from "@mui/material";
import { fmtDate, ReportRow } from "./ReportTable";

export type GroupMode = "group" | "summarise";

export interface GroupField {
  key: string; // row-object property
  label: string; // menu + column label
  kind?: "text" | "date" | "number";
}

export interface GroupingValue {
  mode: GroupMode;
  fieldKey: string; // "" = None
}

export function GroupingSelect({
  value, onChange, fields,
}: {
  value: GroupingValue;
  onChange: (v: GroupingValue) => void;
  fields: GroupField[];
}) {
  const [anchor, setAnchor] = useState<null | HTMLElement>(null);
  const active = fields.find((f) => f.key === value.fieldKey);
  const display = !active ? "None" : `${value.mode === "group" ? "Group" : "Summarise"} by ${active.label}`;
  return (
    <Box>
      <Typography variant="caption" sx={{ fontWeight: 700, color: "text.primary" }}>Grouping/Summarising</Typography>
      <TextField
        size="small" value={display} onClick={(e) => setAnchor(e.currentTarget)}
        sx={{ display: "block", mt: 0.25, width: 210, "& input": { cursor: "pointer" } }}
        InputProps={{ readOnly: true }}
        fullWidth
      />
      <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}>
        {(["group", "summarise"] as GroupMode[]).map((m) => (
          <MenuItem key={m} onClick={() => onChange({ ...value, mode: m })} dense>
            <Radio size="small" checked={value.mode === m} sx={{ p: 0.5, mr: 1 }} />
            <ListItemText primary={m === "group" ? "Group by" : "Summarise by"} />
          </MenuItem>
        ))}
        <Divider />
        <MenuItem
          selected={!value.fieldKey}
          onClick={() => { onChange({ ...value, fieldKey: "" }); setAnchor(null); }}
        >
          None
        </MenuItem>
        {fields.map((f) => (
          <MenuItem
            key={f.key}
            selected={value.fieldKey === f.key}
            onClick={() => { onChange({ ...value, fieldKey: f.key }); setAnchor(null); }}
          >
            {f.label}
          </MenuItem>
        ))}
      </Menu>
    </Box>
  );
}

// ---------------------------------------------------------------------
// Engine: flat rows → ReportRow[] for ReportTable.
// ---------------------------------------------------------------------

export interface FlatColumn {
  key: string;
  label: string;
  align?: "left" | "right";
  width?: number | string;
  kind?: "text" | "date" | "number";
  /** numeric columns aggregated in subtotal/summarise rows */
  aggregate?: boolean;
  /** counts (e.g. quantity) rendered without 2dp */
  isCount?: boolean;
}

const cellValue = (row: any, col: FlatColumn) => {
  const v = row[col.key];
  if (col.kind === "date") return fmtDate(v);
  if (col.kind === "number") return v ?? 0;
  if (col.isCount) return String(v ?? 0);
  return v ?? "";
};

const rawGroupValue = (row: any, field: GroupField) => {
  const v = row[field.key];
  if (v == null || v === "") return "";
  return field.kind === "date" ? new Date(v).getTime() : v;
};

const displayGroupValue = (row: any, field: GroupField) => {
  const v = row[field.key];
  if (v == null || v === "") return "(none)";
  if (field.kind === "date") return fmtDate(v);
  if (typeof v === "number") return v.toLocaleString("en-SG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return String(v);
};

export function buildGroupedRows(
  flat: any[],
  allColumns: FlatColumn[],
  grouping: GroupingValue,
  fields: GroupField[],
): { columns: FlatColumn[]; rows: ReportRow[] } {
  const field = fields.find((f) => f.key === grouping.fieldKey);

  // Grouped field's column is removed from the table (Xero behavior).
  const columns = field ? allColumns.filter((c) => c.key !== field.key) : allColumns;
  const aggIdx = columns.map((c, i) => (c.aggregate ? i : -1)).filter((i) => i >= 0);

  const dataRow = (r: any, i: number): ReportRow => ({
    kind: "row",
    key: r.__key ?? `r${i}`,
    cells: columns.map((c) => cellValue(r, c)),
  });
  const aggregateRow = (label: string, rows: any[], kind: "subtotal" | "total"): ReportRow => ({
    kind,
    key: `${kind}-${label}-${rows.length}`,
    cells: columns.map((c, i) => {
      if (i === 0) return label;
      if (!aggIdx.includes(i)) return "";
      const sum = rows.reduce((s, r) => s + (Number(r[c.key]) || 0), 0);
      return c.isCount ? String(Math.round(sum * 100) / 100) : Math.round(sum * 100) / 100;
    }),
  });

  if (!field) {
    return { columns, rows: [...flat.map(dataRow), aggregateRow("Total", flat, "total")] };
  }

  const groups = new Map<string, { raw: any; rows: any[] }>();
  for (const r of flat) {
    const disp = displayGroupValue(r, field);
    const g = groups.get(disp) || { raw: rawGroupValue(r, field), rows: [] };
    g.rows.push(r);
    groups.set(disp, g);
  }
  const sorted = [...groups.entries()].sort((a, b) => {
    const x = a[1].raw, y = b[1].raw;
    if (typeof x === "number" && typeof y === "number") return x - y;
    return String(x).localeCompare(String(y));
  });

  const out: ReportRow[] = [];
  for (const [disp, g] of sorted) {
    if (grouping.mode === "summarise") {
      out.push(aggregateRow(disp, g.rows, "subtotal"));
    } else {
      out.push({ kind: "group", key: `g-${disp}`, cells: [disp] });
      g.rows.forEach((r, i) => out.push(dataRow(r, i)));
      out.push(aggregateRow(`Total ${disp}`, g.rows, "subtotal"));
    }
  }
  out.push(aggregateRow("Total", flat, "total"));
  return { columns, rows: out };
}
