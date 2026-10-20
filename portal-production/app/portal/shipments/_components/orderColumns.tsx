/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

// The Orders list's columns (round M: moved out of the page so the layout can be
// checked on its own). Progress and Status have FIXED pixel widths — the table is
// table-layout: fixed, so without them the Progress content ran under the Status
// chip. Rows: an order, or (expanded) one of its shipments.

import React from "react";
import { Box, Chip, IconButton, Stack, Typography } from "@mui/material";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import KeyboardArrowRightIcon from "@mui/icons-material/KeyboardArrowRight";
import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import type { OrderListItem, OrderShipmentRow } from "../_lib/api";
import { fmtDay, fmtMt, monthShort } from "../_lib/format";
import { ORDERS_COLUMN_PX } from "../_lib/progress";
import { RecordStatusChip } from "./bits";
import ProgressBarCell from "./ProgressBarCell";

/** The table's rows: the orders and (expanded) their shipments right under them. */
export type OrderRow = ({ kind: "order" } & OrderListItem) | ({ kind: "shipment"; order: OrderListItem } & OrderShipmentRow);
type Row = OrderRow;

export function orderColumns(o: { expanded: Set<string>; toggle: (id: string) => void; onMenu: (e: React.MouseEvent, row: OrderListItem) => void }) {
  return [
      {
        id: "no",
        header: "#",
        cell: ({ row }: any) => {
          const r: Row = row.original;
          if (r.kind === "order") {
            const open = o.expanded.has(r.id);
            return (
              <Stack direction="row" alignItems="center" spacing={0.25} sx={{ whiteSpace: "nowrap" }}>
                <IconButton
                  size="small"
                  aria-label={open ? "Hide shipments" : "Show shipments"}
                  disabled={!r.shipmentCount}
                  data-tour="orders-expand"
                  onClick={(e) => {
                    e.stopPropagation();
                    o.toggle(r.id);
                  }}
                >
                  {open ? <KeyboardArrowDownIcon fontSize="small" /> : <KeyboardArrowRightIcon fontSize="small" />}
                </IconButton>
                <Typography variant="body2" sx={{ fontWeight: 800 }}>
                  {r.label}
                </Typography>
              </Stack>
            );
          }
          return (
            <Typography variant="body2" sx={{ pl: 4.5, fontWeight: 600 }} color="text.secondary">
              {r.ref}
            </Typography>
          );
        },
      },
      {
        id: "customer",
        header: "Customer",
        cell: ({ row }: any) => {
          const r: Row = row.original;
          return r.kind === "order" ? r.customerName || "—" : <Typography variant="body2">{r.blNumber ? `B/L ${r.blNumber}` : "B/L pending"}</Typography>;
        },
      },
      {
        id: "contract",
        header: "Contract",
        cell: ({ row }: any) => {
          const r: Row = row.original;
          return r.kind === "order" ? r.contractNo || "—" : <Typography variant="body2" color="text.secondary">{[r.vessel, r.voyageNo].filter(Boolean).join(" / ") || "Vessel —"}</Typography>;
        },
      },
      {
        id: "shipMonth",
        header: "Ship month",
        cell: ({ row }: any) => {
          const r: Row = row.original;
          return r.kind === "order" ? <Box sx={{ whiteSpace: "nowrap" }}>{r.shipMonth ? monthShort(r.shipMonth) : "—"}</Box> : null;
        },
      },
      {
        id: "months",
        header: "Ship → delivery",
        cell: ({ row }: any) => {
          const r: Row = row.original;
          // One line, never cut ("Oct 26 → Dec 26"): the column takes the width it needs.
          return <Box sx={{ whiteSpace: "nowrap" }}>{r.kind === "order" ? r.monthsLabel || "—" : <Typography variant="body2" color="text.secondary">ETA {fmtDay(r.eta)}</Typography>}</Box>;
        },
      },
      {
        id: "product",
        header: "Product",
        cell: ({ row }: any) =>
          row.original.kind === "order" ? [row.original.grade || row.original.product, row.original.size].filter(Boolean).join(" · ") || "—" : row.original.netWeightMt != null ? `${fmtMt(row.original.netWeightMt)} MT net` : "",
      },
      {
        id: "qty",
        header: "Qty (MT)",
        cell: ({ row }: any) => (row.original.kind === "order" ? <Box sx={{ fontVariantNumeric: "tabular-nums", textAlign: "right" }}>{row.original.qtyMt != null ? fmtMt(row.original.qtyMt) : "—"}</Box> : null),
      },
      {
        id: "ships",
        header: "Shipments",
        cell: ({ row }: any) => (row.original.kind === "order" ? <Chip size="small" variant="outlined" label={row.original.shipmentCount} /> : null),
      },
      {
        id: "progress",
        header: "Progress",
        // Fixed width (the table is table-layout: fixed): the bar, its count and one line of label stay inside.
        pxWidth: ORDERS_COLUMN_PX.progress,
        cell: ({ row }: any) => (
          <Box sx={{ width: "100%", minWidth: 0, overflow: "hidden", py: 0.5 }} data-testid="progress-cell">
            <ProgressBarCell bar={row.original.bar} shipments={row.original.kind === "order" ? row.original.shipments : undefined} />
          </Box>
        ),
      },
      {
        id: "status",
        header: "Status",
        pxWidth: ORDERS_COLUMN_PX.status,
        cell: ({ row }: any) => (
          <Box sx={{ whiteSpace: "nowrap" }} data-testid="status-cell">
            <RecordStatusChip status={row.original.status} />
          </Box>
        ),
      },
      {
        id: "actions",
        header: "",
        pxWidth: 48,
        enableSorting: false,
        cell: ({ row }: any) =>
          row.original.kind === "order" ? (
            <IconButton
              size="small"
              aria-label="Order actions"
              onClick={(e) => {
                e.stopPropagation();
                o.onMenu(e, row.original);
              }}
            >
              <MoreVertIcon fontSize="small" />
            </IconButton>
          ) : null,
      },
    ];
}
