/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

// Shipments home. Everyone: "My tasks today" (the alerts due now and in the
// next 3 days); the pipeline grid only with the org flag enableTradePipelineGrid
// (off since round K — the Orders list shows a progress bar per order). ADH Manager (shipments:money) also sees
// cash in / out by month, margin and profit per order and month, and open
// credits — the money section is simply absent for staff.

import React from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Box, Button, Chip, CircularProgress, Grid, IconButton, Paper, Stack, Table, TableBody, TableCell, TableHead, TableRow, Tooltip, Typography } from "@mui/material";
import CheckIcon from "@mui/icons-material/Check";
import CloseIcon from "@mui/icons-material/Close";
import RefreshIcon from "@mui/icons-material/Refresh";
import { useShipmentsApi, type Money, type TradeAlert } from "../_lib/api";
import { SHIPMENT_KEYS } from "../_lib/hooks";
import { fmtDmy, monthShort } from "../_lib/format";
import { toast } from "../_lib/toast";
import PipelineGrid from "../_components/PipelineGrid";
import { useOrganizationFeatures } from "@/app/portal/hooks/useOrganizationFeatures";

const KEY = [...SHIPMENT_KEYS.orders, "dashboard"] as const;
const usd = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `US$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const sums = (m: Record<string, number>) => (Object.keys(m).length ? Object.entries(m).map(([c, v]) => `${c} ${v.toLocaleString("en-US", { maximumFractionDigits: 2 })}`).join(" + ") : "—");

export default function ShipmentsHome() {
  const api = useShipmentsApi();
  const qc = useQueryClient();
  const tasks = useQuery({ queryKey: [...KEY, "tasks"], queryFn: () => api.myTasks() });
  const { features } = useOrganizationFeatures();
  const showPipeline = !!(features as Record<string, boolean>).enableTradePipelineGrid;
  const pipeline = useQuery({ queryKey: [...KEY, "pipeline"], queryFn: () => api.pipeline(), enabled: showPipeline });
  // 403 for staff: the money section just doesn't show.
  const money = useQuery({ queryKey: [...KEY, "money"], queryFn: () => api.money(), retry: false });
  const refresh = async () => {
    try {
      const r = await api.refreshAlerts();
      await qc.invalidateQueries({ queryKey: KEY });
      toast.success(`Reminders re-planned (${r.created} new, ${r.updated} changed)`);
    } catch (e: any) {
      toast.error(e?.message || "Could not refresh");
    }
  };
  return (
    <Box sx={{ p: { xs: 1.5, md: 3 }, maxWidth: 1400, mx: "auto" }} data-tour="shipments-home">
      <Stack direction="row" alignItems="center" sx={{ mb: 2 }}>
        <Typography variant="h5" sx={{ fontWeight: 800, flex: 1 }}>
          Shipments
        </Typography>
        <Button startIcon={<RefreshIcon />} onClick={refresh}>
          Refresh reminders
        </Button>
      </Stack>
      <Grid container spacing={2}>
        <Grid item xs={12} lg={money.data ? 5 : 12}>
          <Tasks alerts={tasks.data} loading={tasks.isLoading} onChanged={() => qc.invalidateQueries({ queryKey: KEY })} />
        </Grid>
        {money.data && (
          <Grid item xs={12} lg={7}>
            <MoneySummary m={money.data} />
          </Grid>
        )}
        {showPipeline && (
          <Grid item xs={12}>
            <Paper variant="outlined" sx={{ p: 2 }}>
              <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1 }}>
                Pipeline
              </Typography>
              {pipeline.isLoading ? <CircularProgress size={22} /> : pipeline.data ? <PipelineGrid data={pipeline.data} /> : <Alert severity="error">Could not load the pipeline</Alert>}
            </Paper>
          </Grid>
        )}
        {money.data && (
          <Grid item xs={12}>
            <MarginTable m={money.data} />
          </Grid>
        )}
      </Grid>
    </Box>
  );
}

function Tasks({ alerts, loading, onChanged }: { alerts?: TradeAlert[]; loading: boolean; onChanged: () => void }) {
  const api = useShipmentsApi();
  const router = useRouter();
  const today = new Date().toISOString().slice(0, 10);
  const act = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      onChanged();
    } catch (e: any) {
      toast.error(e?.message || "Could not update");
    }
  };
  return (
    <Paper variant="outlined" sx={{ p: 2, height: "100%" }} data-tour="my-tasks">
      <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1 }}>
        My tasks today
      </Typography>
      {loading ? (
        <CircularProgress size={22} />
      ) : !alerts?.length ? (
        <Typography variant="body2" color="text.secondary">
          Nothing due — reminders appear here (tax funding, arrival notices, free time, due dates, stuck steps).
        </Typography>
      ) : (
        <Stack spacing={0.75}>
          {alerts.map((a) => {
            const overdue = a.dueAt.slice(0, 10) < today;
            return (
              <Stack key={a.id} direction="row" spacing={1} alignItems="center">
                <Chip size="small" color={overdue ? "error" : a.status === "DUE" ? "warning" : "default"} label={fmtDmy(a.dueAt)} sx={{ minWidth: 92 }} />
                <Box sx={{ flex: 1, minWidth: 0, cursor: a.linkUrl ? "pointer" : undefined }} onClick={() => a.linkUrl && router.push(a.linkUrl)}>
                  <Typography variant="body2" noWrap>
                    {a.title}
                  </Typography>
                  {a.detail && (
                    <Typography variant="caption" color="text.secondary" noWrap component="div">
                      {a.detail}
                    </Typography>
                  )}
                </Box>
                <Tooltip title="Done">
                  <IconButton size="small" aria-label="Done" onClick={() => act(() => api.alertDone(a.id))}>
                    <CheckIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
                <Tooltip title="Dismiss (comes back if its date moves)">
                  <IconButton size="small" aria-label="Dismiss" onClick={() => act(() => api.alertDismiss(a.id))}>
                    <CloseIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              </Stack>
            );
          })}
        </Stack>
      )}
    </Paper>
  );
}

function MoneySummary({ m }: { m: Money }) {
  const months = Object.keys(m.cashByMonth).sort().slice(-6);
  return (
    <Paper variant="outlined" sx={{ p: 2, height: "100%" }} data-tour="manager-money">
      <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1 }}>
        Cash in / out by month
      </Typography>
      {!months.length ? (
        <Typography variant="body2" color="text.secondary">
          No payments recorded on the steps yet.
        </Typography>
      ) : (
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Month</TableCell>
              <TableCell align="right">In</TableCell>
              <TableCell align="right">Out</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {months.map((k) => (
              <TableRow key={k}>
                <TableCell>{monthShort(k)}</TableCell>
                <TableCell align="right">{sums(m.cashByMonth[k].in)}</TableCell>
                <TableCell align="right">{sums(m.cashByMonth[k].out)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <Typography variant="subtitle2" sx={{ mt: 2, mb: 0.5 }}>
        Open credits
      </Typography>
      {!m.openCredits.length ? (
        <Typography variant="body2" color="text.secondary">
          None.
        </Typography>
      ) : (
        m.openCredits.map((c) => (
          <Typography key={c.id} variant="body2">
            {c.customerName ?? "—"} · {c.sourceNumber ?? "credit note"} · <b>{usd(c.amount)}</b>
          </Typography>
        ))
      )}
    </Paper>
  );
}

function MarginTable({ m }: { m: Money }) {
  const router = useRouter();
  const months = Object.keys(m.byMonth).sort();
  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1 }}>
        Margin and profit
      </Typography>
      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mb: 1.5 }}>
        {months.map((k) => (
          <Chip
            key={k}
            variant="outlined"
            label={`${k === "—" ? "No month" : monthShort(k)}: margin ${usd(m.byMonth[k].margin)} · profit ${usd(m.byMonth[k].profit)}${m.byMonth[k].profitPending ? " (formula pending)" : ""}`}
          />
        ))}
      </Stack>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Order</TableCell>
            <TableCell>Customer</TableCell>
            <TableCell>Delivery</TableCell>
            <TableCell align="right">Qty (MT)</TableCell>
            <TableCell align="right">Margin</TableCell>
            <TableCell align="right">Profit</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {m.orders.map((o) => (
            <TableRow key={o.id} hover sx={{ cursor: "pointer" }} onClick={() => router.push(`/portal/shipments/orders/${o.id}`)}>
              <TableCell sx={{ fontWeight: 700 }}>{o.label}</TableCell>
              <TableCell>{o.customerName ?? "—"}</TableCell>
              <TableCell>{o.deliveryMonth ? monthShort(o.deliveryMonth) : "—"}</TableCell>
              <TableCell align="right">{o.qtyMt ?? "—"}</TableCell>
              <TableCell align="right">{usd(o.margin)}</TableCell>
              <TableCell align="right">
                {usd(o.profit)}
                {o.profitStatus === "FORMULA_PENDING" && o.profit !== null && (
                  <Typography variant="caption" color="warning.main" component="div">
                    formula pending
                  </Typography>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Paper>
  );
}
