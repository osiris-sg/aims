"use client";

// The pipeline in the shape of ADH's Excel: per delivery month, one column per
// order (#n), one row per step 0–14, each cell coloured done / in progress /
// N/A / overdue / not started. Clicking an order opens it.

import React from "react";
import { useRouter } from "next/navigation";
import { Box, Paper, Stack, Table, TableBody, TableCell, TableHead, TableRow, Tooltip, Typography } from "@mui/material";
import type { CellState, Pipeline } from "../_lib/api";
import { monthShort } from "../_lib/format";

const CELL: Record<CellState, { bg: string; fg: string; label: string; mark: string }> = {
  done: { bg: "rgba(46,125,50,0.22)", fg: "success.main", label: "Done", mark: "✓" },
  in_progress: { bg: "rgba(237,108,2,0.22)", fg: "warning.main", label: "In progress", mark: "●" },
  overdue: { bg: "rgba(211,47,47,0.28)", fg: "error.main", label: "Overdue", mark: "!" },
  na: { bg: "rgba(127,127,127,0.12)", fg: "text.disabled", label: "N/A", mark: "–" },
  not_started: { bg: "transparent", fg: "text.disabled", label: "Not started", mark: "" },
  none: { bg: "transparent", fg: "text.disabled", label: "", mark: "" },
};

export default function PipelineGrid({ data }: { data: Pipeline }) {
  const router = useRouter();
  if (!data.months.length)
    return (
      <Typography variant="body2" color="text.secondary">
        No orders in the pipeline.
      </Typography>
    );
  return (
    <Stack spacing={2} data-tour="pipeline-grid">
      <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap>
        {(["done", "in_progress", "overdue", "na", "not_started"] as CellState[]).map((k) => (
          <Stack key={k} direction="row" spacing={0.75} alignItems="center">
            <Box sx={{ width: 14, height: 14, borderRadius: 0.5, bgcolor: CELL[k].bg, border: 1, borderColor: "divider" }} />
            <Typography variant="caption">{CELL[k].label}</Typography>
          </Stack>
        ))}
      </Stack>
      {data.months.map((m) => (
        <Paper key={m.month ?? "none"} variant="outlined" sx={{ overflowX: "auto" }}>
          <Typography variant="subtitle2" sx={{ px: 1.5, pt: 1 }}>
            Delivery {m.month ? monthShort(m.month) : "month not set"} · {m.orders.length} order(s)
          </Typography>
          <Table size="small" sx={{ "& td, & th": { px: 0.75, py: 0.4 } }}>
            <TableHead>
              <TableRow>
                <TableCell sx={{ minWidth: 220, position: "sticky", left: 0, bgcolor: "background.paper", zIndex: 1 }}>Step</TableCell>
                {m.orders.map((o) => (
                  <TableCell key={o.id} align="center" sx={{ minWidth: 72, cursor: "pointer" }} onClick={() => router.push(`/portal/shipments/orders/${o.id}`)}>
                    <Typography variant="body2" sx={{ fontWeight: 800 }}>
                      {o.label}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" component="div" sx={{ maxWidth: 120, wordBreak: "break-word" }}>
                      {o.customerName ?? ""}
                    </Typography>
                  </TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {data.rows.map((r) => (
                <TableRow key={r.no}>
                  <TableCell sx={{ position: "sticky", left: 0, bgcolor: "background.paper", zIndex: 1 }}>
                    <Typography variant="body2" sx={{ wordBreak: "break-word" }}>
                      <b>{r.no}</b> {r.title}
                    </Typography>
                  </TableCell>
                  {m.orders.map((o) => {
                    const c = CELL[o.cells[r.no] ?? "none"];
                    return (
                      <Tooltip key={o.id} title={c.label ? `${o.label} · ${r.no} ${r.title}: ${c.label}` : ""}>
                        <TableCell align="center" sx={{ bgcolor: c.bg, color: c.fg, fontWeight: 800, borderLeft: 1, borderColor: "divider" }}>
                          {c.mark}
                        </TableCell>
                      </Tooltip>
                    );
                  })}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Paper>
      ))}
    </Stack>
  );
}
