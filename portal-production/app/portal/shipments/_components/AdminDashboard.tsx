/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

// Round T — the Admin dashboard (ADH Manager / Admin, shipments:money). Reuses the Biofuel ops dashboard's
// pieces (WidgetFrame cards, ColumnChart, the viz tokens / money formatter) and its style: stat tiles on
// top, charts in cards, tables below. USD and JPY stay apart (no FX mixing); profit says "formula pending"
// until ADH confirms the formula; imported invoices without payment data are "not tracked".

import React from "react";
import { Alert, Box, Chip, CircularProgress, Grid, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography } from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import WidgetFrame from "@/components/Dashboard/ops/WidgetFrame";
import ColumnChart from "@/components/Dashboard/ops/ColumnChart";
import { monthLabel } from "@/components/Dashboard/ops/vizTokens";
import { useShipmentsApi, type AdminDashboard as AdminData, type Cur } from "../_lib/api";
import { monthShort } from "../_lib/format";

const fmt = (n: number | null | undefined, cur: Cur = "USD") => (n === null || n === undefined ? "—" : `${cur === "JPY" ? "¥" : "$"}${Math.round(n).toLocaleString("en-US")}`);
const fmt2 = (n: number | null | undefined, cur: Cur = "USD") => (n === null || n === undefined ? "—" : `${cur === "JPY" ? "¥" : "$"}${n.toLocaleString("en-US", { minimumFractionDigits: cur === "JPY" ? 0 : 2, maximumFractionDigits: cur === "JPY" ? 0 : 2 })}`);

function Tile({ label, value, sub, tone }: { label: string; value: string; sub?: string | null; tone?: "good" | "warn" }) {
  return (
    <WidgetFrame title={label} bare editing={false} onRemove={() => {}}>
      <Box sx={{ p: 2 }}>
        <Typography variant="caption" color="text.secondary">
          {label}
        </Typography>
        <Typography variant="h5" sx={{ fontWeight: 800, color: tone === "good" ? "success.main" : tone === "warn" ? "warning.main" : undefined }}>
          {value}
        </Typography>
        {sub && (
          <Typography variant="caption" color="text.secondary">
            {sub}
          </Typography>
        )}
      </Box>
    </WidgetFrame>
  );
}

function CashChart({ d, cur }: { d: AdminData; cur: Cur }) {
  const data = d.months.map((m) => ({ month: m.month, values: { in: m.in[cur], out: m.out[cur] } }));
  const net = d.months.map((m) => m.net[cur]);
  return (
    <WidgetFrame editing={false} onRemove={() => {}} title={`Money in / out · ${cur}`} subtitle={`Last 6 months + this month · net ${cur === "USD" ? "$" : "¥"}${Math.round(net.reduce((a, b) => a + b, 0)).toLocaleString("en-US")}`}>
      <Box sx={{ px: 1, pb: 1 }}>
        <ColumnChart data={data} series={[{ key: "in", label: "In", slot: 2 }, { key: "out", label: "Out", slot: 1 }]} height={190} format={(n) => fmt(n, cur)} emptyMessage={`No ${cur} payments in this window`} />
        <Table size="small" sx={{ mt: 1 }}>
          <TableHead>
            <TableRow>
              <TableCell>Month</TableCell>
              <TableCell align="right">In</TableCell>
              <TableCell align="right">Out</TableCell>
              <TableCell align="right">Net</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {d.months.map((m) => (
              <TableRow key={m.month}>
                <TableCell>{monthLabel(m.month)}</TableCell>
                <TableCell align="right">{fmt(m.in[cur], cur)}</TableCell>
                <TableCell align="right" title={Object.entries(m.outBy).filter(([, v]) => v[cur]).map(([k, v]) => `${d.outKinds[k] ?? k}: ${fmt(v[cur], cur)}`).join("\n")}>
                  {fmt(m.out[cur], cur)}
                </TableCell>
                <TableCell align="right" sx={{ color: m.net[cur] < 0 ? "error.main" : "success.main", fontWeight: 600 }}>
                  {fmt(m.net[cur], cur)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Box>
    </WidgetFrame>
  );
}

export default function AdminDashboard() {
  const api = useShipmentsApi();
  const q = useQuery({ queryKey: ["trade-dashboard", "admin"], queryFn: () => api.adminDashboard(), retry: false });
  if (q.isLoading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
        <CircularProgress />
      </Box>
    );
  }
  if (q.isError || !q.data) return <Alert severity="error" sx={{ m: 3 }}>{(q.error as Error)?.message || "You don't have access to the money view."}</Alert>;
  const d = q.data;
  const s = d.summary;
  const e = d.expected;
  return (
    <Box sx={{ p: { xs: 1.5, md: 3 }, maxWidth: 1400, mx: "auto" }} data-tour="admin-dashboard">
      <Typography variant="caption" color="text.secondary" component="div" sx={{ mb: 1.5 }}>
        Last 3 months ({s.months.map(monthShort).join(" · ")}) · {d.note}
      </Typography>
      <Grid container spacing={2} sx={{ mb: 2 }}>
        <Grid item xs={6} md={2.4}>
          <Tile label="Revenue invoiced (USD)" value={fmt(s.revenueInvoiced.USD)} sub={`received ${fmt(s.received.USD)}`} />
        </Grid>
        <Grid item xs={6} md={2.4}>
          <Tile label="Costs paid" value={`${fmt(s.costs.USD)} · ${fmt(s.costs.JPY, "JPY")}`} sub="USD · JPY, separately" />
        </Grid>
        <Grid item xs={6} md={2.4}>
          <Tile label="Margin (USD)" value={fmt(s.margin.USD)} sub={`${s.orders} order${s.orders === 1 ? "" : "s"} delivered`} tone="good" />
        </Grid>
        <Grid item xs={6} md={2.4}>
          <Tile label="Profit (USD)" value={s.profit.pending ? "formula pending" : fmt(s.profit.USD)} sub={s.profit.pending ? "until ADH sends the task list" : null} tone={s.profit.pending ? "warn" : "good"} />
        </Grid>
        <Grid item xs={6} md={2.4}>
          <Tile label="Tonnage" value={`${s.tonnageMt.toLocaleString("en-US")} MT`} sub="net, by arrival month" />
        </Grid>
      </Grid>
      <Grid container spacing={2} sx={{ mb: 2 }}>
        <Grid item xs={12} lg={6}>
          <CashChart d={d} cur="USD" />
        </Grid>
        <Grid item xs={12} lg={6}>
          <CashChart d={d} cur="JPY" />
        </Grid>
      </Grid>
      <Grid container spacing={2} sx={{ mb: 2 }}>
        <Grid item xs={12} lg={6}>
          <WidgetFrame editing={false} onRemove={() => {}} title="Expected: invoices not yet received" subtitle={`${fmt2(e.outstandingTotal.USD)} outstanding · ${e.notTrackedInvoices.length} imported, not tracked`}>
            <Box sx={{ px: 1, pb: 1 }} data-tour="admin-outstanding">
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Invoice</TableCell>
                    <TableCell>Customer</TableCell>
                    <TableCell align="right">Outstanding</TableCell>
                    <TableCell>Due</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {e.outstandingInvoices.map((i) => (
                    <TableRow key={i.id}>
                      <TableCell>
                        {i.number}
                        {i.orderLabel ? <span style={{ opacity: 0.6 }}> · {i.orderLabel}</span> : null}
                      </TableCell>
                      <TableCell>{i.customerName ?? "—"}</TableCell>
                      <TableCell align="right">{fmt2(i.amount)}</TableCell>
                      <TableCell sx={{ color: i.overdue ? "error.main" : undefined }}>{i.dueDate ?? "—"}{i.overdue ? " · overdue" : ""}</TableCell>
                    </TableRow>
                  ))}
                  {!e.outstandingInvoices.length && (
                    <TableRow>
                      <TableCell colSpan={4}>Nothing outstanding.</TableCell>
                    </TableRow>
                  )}
                  {e.notTrackedInvoices.map((i) => (
                    <TableRow key={i.id} sx={{ opacity: 0.6 }}>
                      <TableCell>
                        {i.number}
                        {i.orderLabel ? <span> · {i.orderLabel}</span> : null}
                      </TableCell>
                      <TableCell>{i.customerName ?? "—"}</TableCell>
                      <TableCell align="right">{fmt2(i.total)}</TableCell>
                      <TableCell>
                        <Chip size="small" variant="outlined" label="not tracked" />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Box>
          </WidgetFrame>
        </Grid>
        <Grid item xs={12} lg={6}>
          <WidgetFrame editing={false} onRemove={() => {}} title="Due to Vedanta, not yet paid" subtitle={`${fmt2(e.supplierDueTotal.USD)} · deposits and CI balances`}>
            <Box sx={{ px: 1, pb: 1 }} data-tour="admin-supplier-due">
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>What</TableCell>
                    <TableCell align="right">Amount</TableCell>
                    <TableCell>Due</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {e.supplierDue.map((x, i) => (
                    <TableRow key={i}>
                      <TableCell>{x.label}</TableCell>
                      <TableCell align="right">{x.amount === null ? "—" : fmt2(x.amount)}</TableCell>
                      <TableCell sx={{ color: x.overdue ? "error.main" : undefined }}>{x.kind === "CI" ? (x.dueDate ? `by arrival ${x.dueDate}` : "by arrival") : x.dueDate ?? "—"}{x.overdue ? " · overdue" : ""}</TableCell>
                    </TableRow>
                  ))}
                  {!e.supplierDue.length && (
                    <TableRow>
                      <TableCell colSpan={3}>Nothing due.</TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </Box>
          </WidgetFrame>
        </Grid>
      </Grid>
      <WidgetFrame editing={false} onRemove={() => {}} title="Per order" subtitle="Sell and buy in USD · costs in JPY and USD · margin = (client − supplier premium + upcharge) × MT · profit per the reconciliation">
        <Box sx={{ px: 1, pb: 1, overflowX: "auto" }} data-tour="admin-orders">
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Order</TableCell>
                <TableCell>Customer</TableCell>
                <TableCell>Product</TableCell>
                <TableCell align="right">MT</TableCell>
                <TableCell align="right">Sell</TableCell>
                <TableCell align="right">Buy</TableCell>
                <TableCell align="right">Costs ¥</TableCell>
                <TableCell align="right">Costs $</TableCell>
                <TableCell align="right">Margin</TableCell>
                <TableCell align="right">Profit</TableCell>
                <TableCell>Status</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {d.orders.map((o) => (
                <TableRow key={o.id} hover>
                  <TableCell>
                    {o.label}
                    {o.deliveryMonth ? <span style={{ opacity: 0.6 }}> · {monthShort(o.deliveryMonth)}</span> : null}
                  </TableCell>
                  <TableCell>{o.customerName ?? "—"}</TableCell>
                  <TableCell>{o.product ?? "—"}</TableCell>
                  <TableCell align="right">{o.qtyMt ?? "—"}</TableCell>
                  <TableCell align="right">{fmt(o.sellUsd)}</TableCell>
                  <TableCell align="right">{fmt(o.buyUsd)}</TableCell>
                  <TableCell align="right">{fmt(o.costsJpy, "JPY")}</TableCell>
                  <TableCell align="right">{fmt(o.costsUsd)}</TableCell>
                  <TableCell align="right">{fmt(o.margin)}</TableCell>
                  <TableCell align="right">{o.profitLabel ? <Chip size="small" variant="outlined" label={o.profitLabel} /> : fmt(o.profit)}</TableCell>
                  <TableCell>
                    <Chip size="small" variant="outlined" label={o.status} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Box>
      </WidgetFrame>
      <Stack sx={{ mt: 1 }}>
        <Typography variant="caption" color="text.secondary">
          Same numbers as the WhatsApp assistant&apos;s money answers.
        </Typography>
      </Stack>
    </Box>
  );
}
