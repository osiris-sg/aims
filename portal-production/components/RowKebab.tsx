"use client";

// Shared row-actions kebab for the CLAUDE.md table pattern (rows open on
// click; secondary actions live behind a MoreVert menu). Drop `kebabColumn()`
// into a PageTable columns array and render row-specific actions:
//
//   kebabColumn((row) => [
//     { label: "Open", onClick: () => openRecord(row) },
//     { label: "Delete", destructive: true, onClick: () => confirmDelete(row) },
//   ])
//
// Actions returning an empty array render no button for that row.

import React, { useState } from "react";
import { IconButton, Menu, MenuItem } from "@mui/material";
import MoreVertIcon from "@mui/icons-material/MoreVert";

export interface RowKebabAction {
  label: string;
  onClick: () => void;
  destructive?: boolean;
  disabled?: boolean;
}

export function RowKebab({ actions }: { actions: RowKebabAction[] }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  if (!actions.length) return null;
  return (
    <>
      <IconButton
        size="small"
        aria-label="Row actions"
        onClick={(e) => {
          e.stopPropagation();
          setAnchor(e.currentTarget);
        }}
        sx={{ color: "text.secondary" }}
      >
        <MoreVertIcon fontSize="small" />
      </IconButton>
      <Menu
        anchorEl={anchor}
        open={!!anchor}
        onClose={() => setAnchor(null)}
        onClick={(e) => e.stopPropagation()}
      >
        {actions.map((a) => (
          <MenuItem
            key={a.label}
            disabled={a.disabled}
            onClick={() => {
              setAnchor(null);
              a.onClick();
            }}
            sx={a.destructive ? { color: "error.main" } : undefined}
          >
            {a.label}
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}

/** Column factory for PageTable/Table column arrays. */
export function kebabColumn(actionsFor: (row: any) => RowKebabAction[]) {
  return {
    accessorKey: "action",
    header: "",
    nowrap: true,
    align: "center" as const,
    pxWidth: 56,
    enableSorting: false,
    cell: ({ row }: any) => <RowKebab actions={actionsFor(row.original)} />,
  };
}
