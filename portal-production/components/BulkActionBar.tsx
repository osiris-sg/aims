"use client";
/*
 * Floating bulk-action pill — the CIEL ID-quotation editor's selection bar
 * (tick rows → a pill floats bottom-centre with "N selected", the available
 * actions, and Clear), extracted for reuse on any list table with row
 * selection (guru 2026-09-11: "replicate that for all other tables").
 *
 * Usage: keep a Set of selected row ids in the page, render a checkbox
 * column (stopPropagation so the row-click pattern still opens records),
 * and mount <BulkActionBar> after the table. Actions with `disabled` keep
 * their tooltip (wrapped in a span) so users learn WHY it's disabled.
 */
import React from "react";
import { Paper, Typography, Button, Tooltip } from "@mui/material";

export interface BulkAction {
  key: string;
  label: string;
  icon?: React.ReactNode;
  color?: "inherit" | "primary" | "secondary" | "error" | "warning" | "info" | "success";
  disabled?: boolean;
  tooltip?: string;
  onClick: () => void;
}

interface Props {
  count: number;
  actions: BulkAction[];
  onClear: () => void;
  /** Word after the count, defaults to "selected". */
  noun?: string;
}

export default function BulkActionBar({ count, actions, onClear, noun = "selected" }: Props) {
  if (count <= 0) return null;
  return (
    <Paper
      elevation={8}
      sx={{
        position: "fixed",
        bottom: 24,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 30,
        px: 2,
        py: 1,
        borderRadius: 3,
        display: "flex",
        gap: 1.5,
        alignItems: "center",
      }}
    >
      <Typography variant="body2" sx={{ fontWeight: 700, whiteSpace: "nowrap" }}>
        {count} {noun}
      </Typography>
      {actions.map((a) => (
        <Tooltip key={a.key} title={a.tooltip || ""}>
          <span>
            <Button
              size="small"
              color={a.color}
              startIcon={a.icon}
              disabled={a.disabled}
              onClick={a.onClick}
              sx={{ textTransform: "none", whiteSpace: "nowrap" }}
            >
              {a.label}
            </Button>
          </span>
        </Tooltip>
      ))}
      <Button size="small" onClick={onClear} sx={{ textTransform: "none", color: "text.secondary" }}>
        Clear
      </Button>
    </Paper>
  );
}
