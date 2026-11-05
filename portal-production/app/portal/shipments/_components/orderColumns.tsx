/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

// The Orders list's columns (round M: moved out of the page so the layout can be
// checked on its own). Progress and Status have FIXED pixel widths — the table is
// table-layout: fixed, so without them the Progress content ran under the Status
// chip. Rows: an order, or (expanded) one of its shipments.

import React from "react";
import { Box, Button, Chip, IconButton, Typography } from "@mui/material";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import type { OrderListItem, OrderShipmentRow } from "../_lib/api";
import { fmtDay, fmtMt, monthShort, shortCustomer } from "../_lib/format";
import { ORDERS_COLUMN_PX } from "../_lib/progress";
import { RecordStatusChip } from "./bits";
import ProgressBarCell from "./ProgressBarCell";

/** The table's rows: the orders and (expanded) their shipments right under them. */
export type OrderRow = ({ kind: "order" } & OrderListItem) | ({ kind: "shipment"; order: OrderListItem } & OrderShipmentRow);
type Row = OrderRow;

/** `t` = useTranslations("orders.columns") from the caller (headers are plain strings for PageTable). */
export function orderColumns(o: { onMenu: (e: React.MouseEvent, row: OrderListItem) => void; onReopen?: (row: OrderListItem) => void; t: (key: string, values?: Record<string, string | number>) => string }) {
  const t = o.t;
  // Round BF: a cancelled order (found by a search, or on All / Cancelled) is greyed; its Status cell says "Cancelled · Reopen".
  const dimmed = (r: Row) => r.kind === "order" && r.status === "CANCELLED";
  const cols = [
      {
        id: "no",
        header: "#",
        cell: ({ row }: any) => {
          const r: Row = row.original;
          if (r.kind === "order") {
            // Round Q: no expand chevron — the row opens the order; each shipment's bar is in the progress hover.
            return (
              <>
                <Typography variant="body2" sx={{ fontWeight: 800, whiteSpace: "nowrap" }}>
                  {r.label}
                </Typography>
                {r.was && (
                  <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: "nowrap" }} data-tour="order-was">
                    {t("was", { no: r.was })}
                  </Typography>
                )}
              </>
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
        header: t("customer"),
        cell: ({ row }: any) => {
          const r: Row = row.original;
          // Round Q: the short name ("Kato"); the full name in the tooltip.
          return r.kind === "order" ? <span title={r.customerName ?? undefined}>{shortCustomer(r.customerName) || "—"}</span> : <Typography variant="body2">{r.blNumber ? `B/L ${r.blNumber}` : t("blPending")}</Typography>;
        },
      },
      {
        id: "contract",
        header: t("contract"),
        cell: ({ row }: any) => {
          const r: Row = row.original;
          return r.kind === "order" ? r.contractNo || "—" : <Typography variant="body2" color="text.secondary">{[r.vessel, r.voyageNo].filter(Boolean).join(" / ") || t("vesselNone")}</Typography>;
        },
      },
      {
        id: "shipMonth",
        header: t("shipMonth"),
        cell: ({ row }: any) => {
          const r: Row = row.original;
          return r.kind === "order" ? <Box sx={{ whiteSpace: "nowrap" }}>{r.shipMonth ? monthShort(r.shipMonth) : "—"}</Box> : null;
        },
      },
      {
        id: "months",
        header: t("months"),
        // Round N: its own width — "Oct 26 → Dec 26" ran into Product in the fixed table layout.
        pxWidth: 150,
        cell: ({ row }: any) => {
          const r: Row = row.original;
          // One line, never cut ("Oct 26 → Dec 26"): the column takes the width it needs.
          return <Box sx={{ whiteSpace: "nowrap" }}>{r.kind === "order" ? r.monthsLabel || "—" : <Typography variant="body2" color="text.secondary">{t("eta", { date: fmtDay(r.eta) })}</Typography>}</Box>;
        },
      },
      {
        id: "product",
        header: t("product"),
        cell: ({ row }: any) =>
          row.original.kind === "order" ? [row.original.grade || row.original.product, row.original.size].filter(Boolean).join(" · ") || "—" : row.original.netWeightMt != null ? t("mtNet", { mt: fmtMt(row.original.netWeightMt) }) : "",
      },
      {
        id: "qty",
        header: t("qty"),
        cell: ({ row }: any) => (row.original.kind === "order" ? <Box sx={{ fontVariantNumeric: "tabular-nums", textAlign: "right" }}>{row.original.qtyMt != null ? fmtMt(row.original.qtyMt) : "—"}</Box> : null),
      },
      {
        id: "ships",
        header: t("shipments"),
        cell: ({ row }: any) => (row.original.kind === "order" ? <Chip size="small" variant="outlined" label={row.original.shipmentCount} /> : null),
      },
      {
        id: "progress",
        header: t("progress"),
        // Fixed width (the table is table-layout: fixed): the bar, its count and one line of label stay inside.
        pxWidth: ORDERS_COLUMN_PX.progress,
        cell: ({ row }: any) => (
          <Box sx={{ width: "100%", minWidth: 0, overflow: "hidden", py: 0.5 }} data-testid="progress-cell">
            <ProgressBarCell bar={row.original.bar} currentStep={row.original.currentStep} shipments={row.original.kind === "order" ? row.original.shipments : undefined} />
          </Box>
        ),
      },
      {
        id: "status",
        header: t("status"),
        pxWidth: ORDERS_COLUMN_PX.status,
        cell: ({ row }: any) =>
          row.original.kind === "order" && row.original.status === "CANCELLED" ? (
            <Box sx={{ whiteSpace: "nowrap", display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 0.25 }} data-testid="status-cell">
              <Typography variant="caption" sx={{ fontWeight: 700, color: "text.secondary", border: 1, borderColor: "divider", borderRadius: 1, px: 0.75, lineHeight: 1.7 }}>
                {t("cancelledBadge")}
              </Typography>
              {o.onReopen && (
                <Button
                  size="small"
                  sx={{ minWidth: 0, px: 0.5, py: 0, textTransform: "none", fontSize: 12, lineHeight: 1.6 }}
                  onClick={(e) => {
                    e.stopPropagation();
                    o.onReopen!(row.original);
                  }}
                  data-tour="order-row-reopen"
                >
                  {t("reopen")}
                </Button>
              )}
            </Box>
          ) : (
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
              aria-label={t("actions")}
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
  // Grey every cell of a cancelled order except Status (its badge + Reopen stay readable) and the ⋮.
  return cols.map((c: any) =>
    c.id === "status" || c.id === "actions"
      ? c
      : {
          ...c,
          cell: (ctx: any) => {
            const node = c.cell(ctx);
            return dimmed(ctx.row.original) ? <Box sx={{ opacity: 0.5 }}>{node}</Box> : node;
          },
        }
  );
}
