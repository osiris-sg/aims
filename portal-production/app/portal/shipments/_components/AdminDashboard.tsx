/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

// Round T — the Admin dashboard (ADH Manager / Admin, shipments:money). Reuses the Biofuel ops dashboard's
// pieces (WidgetFrame cards, ColumnChart, the viz tokens / money formatter) and its style: stat tiles on
// top, charts in cards, tables below. USD and JPY stay apart (no FX mixing); profit shows $0 until the
// profit formula exists (round W: no "formula pending" label); imported invoices without payment data are "not tracked".

import React from "react";
import { Alert, Box, Chip, CircularProgress, Grid, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography } from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useUiLang } from "@/i18n/UiLangProvider";
import WidgetFrame from "@/components/Dashboard/ops/WidgetFrame";
import ColumnChart from "@/components/Dashboard/ops/ColumnChart";
import { monthLabel } from "@/components/Dashboard/ops/vizTokens";
import { useShipmentsApi, type AdminDashboard as AdminData, type Cur } from "../_lib/api";
import { fmtMonth, monthShort } from "../_lib/format";

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
  const t = useTranslations("inbox.admin");
  const { lang } = useUiLang();
  const data = d.months.map((m) => ({ month: m.month, values: { in: m.in[cur], out: m.out[cur] } }));
  const net = d.months.map((m) => m.net[cur]);
  return (
    <WidgetFrame editing={false} onRemove={() => {}} title={t("cashTitle", { cur })} subtitle={t("cashSub", { net: `${cur === "USD" ? "$" : "¥"}${Math.round(net.reduce((a, b) => a + b, 0)).toLocaleString("en-US")}` })}>
      <Box sx={{ px: 1, pb: 1 }}>
        <ColumnChart data={data} series={[{ key: "in", label: t("in"), slot: 2 }, { key: "out", label: t("out"), slot: 1 }]} height={190} format={(n) => fmt(n, cur)} emptyMessage={t("noPayments", { cur })} />
        <Table size="small" sx={{ mt: 1 }}>
          <TableHead>
            <TableRow>
              <TableCell>{t("month")}</TableCell>
              <TableCell align="right">{t("in")}</TableCell>
              <TableCell align="right">{t("out")}</TableCell>
              <TableCell align="right">{t("net")}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {d.months.map((m) => (
              <TableRow key={m.month}>
                <TableCell>{lang === "ja" ? fmtMonth(m.month) : monthLabel(m.month)}</TableCell>
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
  const t = useTranslations("inbox.admin");
  const { lang } = useUiLang();
  const mShort = (m: string) => (lang === "ja" ? fmtMonth(m) : monthShort(m));
  const q = useQuery({ queryKey: ["trade-dashboard", "admin"], queryFn: () => api.adminDashboard(), retry: false });
  if (q.isLoading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
        <CircularProgress />
      </Box>
    );
  }
  if (q.isError || !q.data) return <Alert severity="error" sx={{ m: 3 }}>{(q.error as Error)?.message || t("noAccess")}</Alert>;
  const d = q.data;
  const s = d.summary;
  const e = d.expected;
  return (
    <Box sx={{ p: { xs: 1.5, md: 3 }, maxWidth: 1400, mx: "auto" }} data-tour="admin-dashboard">
      <Typography variant="caption" color="text.secondary" component="div" sx={{ mb: 1.5 }}>
        {t("last3", { months: s.months.map(mShort).join(" · ") })} · {d.note}
      </Typography>
      <Grid container spacing={2} sx={{ mb: 2 }}>
        <Grid item xs={6} md={2.4}>
          <Tile label={t("revenue")} value={fmt(s.revenueInvoiced.USD)} sub={t("received", { v: fmt(s.received.USD) })} />
        </Grid>
        <Grid item xs={6} md={2.4}>
          <Tile label={t("costsPaid")} value={`${fmt(s.costs.USD)} · ${fmt(s.costs.JPY, "JPY")}`} sub={t("separately")} />
        </Grid>
        <Grid item xs={6} md={2.4}>
          <Tile label={t("margin")} value={fmt(s.margin.USD)} sub={t("delivered", { n: s.orders })} tone="good" />
        </Grid>
        <Grid item xs={6} md={2.4}>
          <Tile label={t("profit")} value={fmt(s.profit.USD)} tone="good" />
        </Grid>
        <Grid item xs={6} md={2.4}>
          <Tile label={t("tonnage")} value={`${s.tonnageMt.toLocaleString("en-US")} MT`} sub={t("byArrival")} />
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
          <WidgetFrame editing={false} onRemove={() => {}} title={t("expectedTitle")} subtitle={t("expectedSub", { v: fmt2(e.outstandingTotal.USD), n: e.notTrackedInvoices.length })}>
            <Box sx={{ px: 1, pb: 1 }} data-tour="admin-outstanding">
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>{t("invoice")}</TableCell>
                    <TableCell>{t("customer")}</TableCell>
                    <TableCell align="right">{t("outstanding")}</TableCell>
                    <TableCell>{t("due")}</TableCell>
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
                      <TableCell sx={{ color: i.overdue ? "error.main" : undefined }}>{i.dueDate ?? "—"}{i.overdue ? ` · ${t("overdue")}` : ""}</TableCell>
                    </TableRow>
                  ))}
                  {!e.outstandingInvoices.length && (
                    <TableRow>
                      <TableCell colSpan={4}>{t("nothingOutstanding")}</TableCell>
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
                        <Chip size="small" variant="outlined" label={t("notTracked")} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Box>
          </WidgetFrame>
        </Grid>
        <Grid item xs={12} lg={6}>
          <WidgetFrame editing={false} onRemove={() => {}} title={t("vedantaTitle")} subtitle={`${fmt2(e.supplierDueTotal.USD)} · ${t("vedantaSub")}`}>
            <Box sx={{ px: 1, pb: 1 }} data-tour="admin-supplier-due">
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>{t("what")}</TableCell>
                    <TableCell align="right">{t("amount")}</TableCell>
                    <TableCell>{t("due")}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {e.supplierDue.map((x, i) => (
                    <TableRow key={i}>
                      <TableCell>{x.label}</TableCell>
                      <TableCell align="right">{x.amount === null ? "—" : fmt2(x.amount)}</TableCell>
                      <TableCell sx={{ color: x.overdue ? "error.main" : undefined }}>{x.kind === "CI" ? (x.dueDate ? t("byArrivalDate", { d: x.dueDate }) : t("byArrivalOnly")) : x.dueDate ?? "—"}{x.overdue ? ` · ${t("overdue")}` : ""}</TableCell>
                    </TableRow>
                  ))}
                  {!e.supplierDue.length && (
                    <TableRow>
                      <TableCell colSpan={3}>{t("nothingDue")}</TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </Box>
          </WidgetFrame>
        </Grid>
      </Grid>
      <WidgetFrame editing={false} onRemove={() => {}} title={t("perOrder")} subtitle={t("perOrderSub")}>
        <Box sx={{ px: 1, pb: 1, overflowX: "auto" }} data-tour="admin-orders">
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{t("order")}</TableCell>
                <TableCell>{t("customer")}</TableCell>
                <TableCell>{t("product")}</TableCell>
                <TableCell align="right">MT</TableCell>
                <TableCell align="right">{t("sell")}</TableCell>
                <TableCell align="right">{t("buy")}</TableCell>
                <TableCell align="right">{t("costsJpy")}</TableCell>
                <TableCell align="right">{t("costsUsd")}</TableCell>
                <TableCell align="right">{t("colMargin")}</TableCell>
                <TableCell align="right">{t("colProfit")}</TableCell>
                <TableCell>{t("status")}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {d.orders.map((o) => (
                <TableRow key={o.id} hover>
                  <TableCell>
                    {o.label}
                    {o.deliveryMonth ? <span style={{ opacity: 0.6 }}> · {mShort(o.deliveryMonth)}</span> : null}
                  </TableCell>
                  <TableCell>{o.customerName ?? "—"}</TableCell>
                  <TableCell>{o.product ?? "—"}</TableCell>
                  <TableCell align="right">{o.qtyMt ?? "—"}</TableCell>
                  <TableCell align="right">{fmt(o.sellUsd)}</TableCell>
                  <TableCell align="right">{fmt(o.buyUsd)}</TableCell>
                  <TableCell align="right">{fmt(o.costsJpy, "JPY")}</TableCell>
                  <TableCell align="right">{fmt(o.costsUsd)}</TableCell>
                  <TableCell align="right">{fmt(o.margin)}</TableCell>
                  <TableCell align="right">{fmt(o.profit ?? 0)}</TableCell>
                  <TableCell>
                    <Chip size="small" variant="outlined" label={["OPEN", "COMPLETED", "CANCELLED"].includes(o.status) ? t(`statuses.${o.status}`) : o.status} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Box>
      </WidgetFrame>
      <Stack sx={{ mt: 1 }}>
        <Typography variant="caption" color="text.secondary">
          {t("sameNumbers")}
        </Typography>
      </Stack>
    </Box>
  );
}
