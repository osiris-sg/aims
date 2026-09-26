"use client";

// Operations dashboard (Biofuel, guru 2026-09-26).
//
// What the admin asked to see on one screen: what is on the shelf, what moved
// in and out lately, what each product earns over a period he can filter, how
// often the field team services units, and where the fleet physically sits.
//
// Reading order is deliberate — the four headline numbers answer "is anything
// wrong?", then each panel below answers one question in full. The date range
// and product filter sit in a single row at the top and drive revenue and
// field activity together, so the whole lower half always describes the same
// period.

import React, { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import {
  Alert,
  Box,
  Card,
  CardContent,
  CircularProgress,
  Divider,
  Grid,
  MenuItem,
  Skeleton,
  Stack,
  TextField,
  Typography,
  useTheme,
} from "@mui/material";
import InventoryOutlinedIcon from "@mui/icons-material/Inventory2Outlined";
import LocalShippingOutlinedIcon from "@mui/icons-material/LocalShippingOutlined";
import PaidOutlinedIcon from "@mui/icons-material/PaidOutlined";
import BuildOutlinedIcon from "@mui/icons-material/BuildOutlined";
import SouthWestIcon from "@mui/icons-material/SouthWest";
import NorthEastIcon from "@mui/icons-material/NorthEast";
import MainCard from "@/components/MainCard";
import { useAuth } from "@clerk/nextjs";
import { request } from "@/helpers/request";
import ColumnChart from "./ops/ColumnChart";
import StockBars, { StockRow } from "./ops/StockBars";
import Legend from "./ops/Legend";
import { MSR_KINDS, STOCK_STATUSES, money } from "./ops/vizTokens";

// Leaflet reaches for `window` at import time, so the map may only load in the
// browser — same constraint as the delivery route map.
const FleetMap = dynamic(() => import("./ops/FleetMap"), {
  ssr: false,
  loading: () => <Skeleton variant="rectangular" height={380} sx={{ borderRadius: 1 }} />,
});

const iso = (d: Date) => d.toISOString().slice(0, 10);
const monthsAgo = (n: number) => {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return d;
};

/** A headline figure. No plot, so no tooltip — the label carries the meaning. */
function StatTile({ label, value, hint, icon, tone }: any) {
  return (
    <Card variant="outlined" sx={{ height: "100%" }}>
      <CardContent sx={{ p: 2, "&:last-child": { pb: 2 } }}>
        <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
          <Box sx={{ color: tone || "text.secondary", display: "flex" }}>{icon}</Box>
          <Typography variant="caption" sx={{ color: "text.secondary" }}>
            {label}
          </Typography>
        </Stack>
        <Typography variant="h4" sx={{ fontWeight: 700, fontVariantNumeric: "tabular-nums", lineHeight: 1.1 }}>
          {value}
        </Typography>
        {hint && (
          <Typography variant="caption" sx={{ color: "text.secondary", display: "block", mt: 0.5 }}>
            {hint}
          </Typography>
        )}
      </CardContent>
    </Card>
  );
}

function Panel({ title, subtitle, action, children }: any) {
  return (
    <Card variant="outlined" sx={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <CardContent sx={{ flex: 1, display: "flex", flexDirection: "column", p: { xs: 1.5, md: 2 } }}>
        <Stack
          direction={{ xs: "column", sm: "row" }}
          sx={{ mb: 1.5, gap: 1 }}
          alignItems={{ xs: "flex-start", sm: "center" }}
        >
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
              {title}
            </Typography>
            {subtitle && (
              <Typography variant="caption" sx={{ color: "text.secondary" }}>
                {subtitle}
              </Typography>
            )}
          </Box>
          {action}
        </Stack>
        <Box sx={{ flex: 1, minWidth: 0 }}>{children}</Box>
      </CardContent>
    </Card>
  );
}

export default function OpsDashboard() {
  const { getToken } = useAuth();
  const theme = useTheme();

  const [from, setFrom] = useState(iso(monthsAgo(6)));
  const [to, setTo] = useState(iso(new Date()));
  const [assetId, setAssetId] = useState("");

  const [stock, setStock] = useState<{ items: StockRow[]; totals: any } | null>(null);
  const [movements, setMovements] = useState<any[] | null>(null);
  const [revenue, setRevenue] = useState<any | null>(null);
  const [maintenance, setMaintenance] = useState<any | null>(null);
  const [mapData, setMapData] = useState<any | null>(null);
  const [error, setError] = useState("");

  const call = useCallback(
    async (path: string) => {
      const token = await getToken();
      if (!token) return null;
      const res = await request({ path, method: "GET" }, undefined, token);
      return (res as any)?.data ?? res;
    },
    [getToken],
  );

  // Stock, movements and the map don't depend on the date range — load once.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [s, m, g] = await Promise.all([
          call("/dashboard/ops/stock"),
          call("/dashboard/ops/movements?limit=12"),
          call("/dashboard/ops/map"),
        ]);
        if (!alive) return;
        setStock(s);
        setMovements(m || []);
        setMapData(g);
      } catch (e: any) {
        if (alive) setError(e?.message || "Could not load the dashboard");
      }
    })();
    return () => {
      alive = false;
    };
  }, [call]);

  // Revenue and field activity follow the filters.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const qs = `from=${from}&to=${to}`;
        const [r, mt] = await Promise.all([
          call(`/dashboard/ops/revenue?${qs}${assetId ? `&assetId=${assetId}` : ""}`),
          call(`/dashboard/ops/maintenance?${qs}`),
        ]);
        if (!alive) return;
        setRevenue(r);
        setMaintenance(mt);
      } catch (e: any) {
        if (alive) setError(e?.message || "Could not load revenue");
      }
    })();
    return () => {
      alive = false;
    };
  }, [call, from, to, assetId]);

  const revenueColumns = useMemo(
    () => (revenue?.series || []).map((s: any) => ({ month: s.month, values: { revenue: s.revenue } })),
    [revenue],
  );
  const maintenanceColumns = useMemo(() => {
    const byMonth = new Map<string, Record<string, number>>();
    for (const row of maintenance?.series || []) {
      const entry = byMonth.get(row.month) || {};
      entry[row.kind] = (entry[row.kind] || 0) + row.count;
      byMonth.set(row.month, entry);
    }
    return Array.from(byMonth.entries()).sort((a, b) => a[0].localeCompare(b[0])).map(([month, values]) => ({ month, values }));
  }, [maintenance]);

  const kindTotals = useMemo(() => {
    const t: Record<string, number> = {};
    for (const row of maintenance?.series || []) t[row.kind] = (t[row.kind] || 0) + row.count;
    return t;
  }, [maintenance]);

  const statusTotals = useMemo(() => {
    const t: Record<string, number> = {};
    for (const r of stock?.items || []) {
      for (const s of STOCK_STATUSES) t[s.key] = (t[s.key] || 0) + ((r as any)[s.key] || 0);
    }
    return t;
  }, [stock]);

  const serviceCount = kindTotals.SERVICE || 0;
  const loading = !stock && !error;

  return (
    <MainCard>
      <Box sx={{ px: { xs: 0.5, md: 0 } }}>
        <Stack
          direction={{ xs: "column", md: "row" }}
          spacing={1.5}
          alignItems={{ xs: "stretch", md: "flex-end" }}
          sx={{ mb: 2.5 }}
        >
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="h5" sx={{ fontWeight: 700 }}>
              Operations
            </Typography>
            <Typography variant="body2" sx={{ color: "text.secondary" }}>
              Stock, movements, revenue and field activity in one place.
            </Typography>
          </Box>
          {/* Filters live in one row above the charts and drive everything below. */}
          <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", rowGap: 1 }}>
            <TextField
              select
              size="small"
              label="Product"
              value={assetId}
              onChange={(e) => setAssetId(e.target.value)}
              // displayEmpty so the "All products" default is visible rather
              // than an empty box that reads as "nothing selected".
              SelectProps={{ displayEmpty: true }}
              InputLabelProps={{ shrink: true }}
              sx={{ minWidth: { xs: "100%", sm: 190 } }}
            >
              <MenuItem value="">All products</MenuItem>
              {(revenue?.items || []).map((i: any) => (
                <MenuItem key={i.assetId} value={i.assetId}>
                  {i.item}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              size="small"
              type="date"
              label="From"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              InputLabelProps={{ shrink: true }}
            />
            <TextField
              size="small"
              type="date"
              label="To"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              InputLabelProps={{ shrink: true }}
            />
          </Stack>
        </Stack>

        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        {loading ? (
          <Box sx={{ display: "flex", justifyContent: "center", py: 10 }}>
            <CircularProgress />
          </Box>
        ) : (
          <Grid container spacing={2}>
            {/* Headline figures */}
            <Grid item xs={6} md={3}>
              <StatTile
                label="Units tracked"
                value={stock?.totals?.units ?? 0}
                hint={`${(stock?.items || []).length} products`}
                icon={<InventoryOutlinedIcon fontSize="small" />}
              />
            </Grid>
            <Grid item xs={6} md={3}>
              <StatTile
                label="Out on rent"
                value={stock?.totals?.rental ?? 0}
                hint={`${stock?.totals?.instock ?? 0} still in stock`}
                icon={<LocalShippingOutlinedIcon fontSize="small" />}
                tone="primary.main"
              />
            </Grid>
            <Grid item xs={6} md={3}>
              <StatTile
                label="Revenue in period"
                value={revenue ? money(revenue.total) : "—"}
                hint={assetId ? "filtered to one product" : "all products"}
                icon={<PaidOutlinedIcon fontSize="small" />}
                tone="success.main"
              />
            </Grid>
            <Grid item xs={6} md={3}>
              <StatTile
                label="Service visits"
                value={serviceCount}
                hint={`${Object.values(kindTotals).reduce((a, b) => a + b, 0)} field jobs in total`}
                icon={<BuildOutlinedIcon fontSize="small" />}
                tone="warning.main"
              />
            </Grid>

            {/* Revenue over time */}
            <Grid item xs={12} lg={8}>
              <Panel
                title="Revenue"
                subtitle={
                  assetId
                    ? `${(revenue?.items || []).find((i: any) => i.assetId === assetId)?.item || "Product"} · invoiced in this period`
                    : "Invoiced in this period, by month"
                }
                action={
                  <Typography variant="h6" sx={{ fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
                    {revenue ? money(revenue.total) : "—"}
                  </Typography>
                }
              >
                <ColumnChart
                  data={revenueColumns}
                  series={[{ key: "revenue", label: "Revenue", slot: 0 }]}
                  format={money}
                  height={230}
                  emptyMessage="No invoices in this period"
                />
              </Panel>
            </Grid>

            {/* Revenue by product — the table view that carries every value */}
            <Grid item xs={12} lg={4}>
              <Panel title="By product" subtitle="Highest earning first">
                {(revenue?.items || []).length === 0 ? (
                  <Typography variant="body2" sx={{ color: "text.secondary", py: 4, textAlign: "center" }}>
                    Nothing invoiced in this period.
                  </Typography>
                ) : (
                  <Box sx={{ maxHeight: 250, overflowY: "auto" }}>
                    {(revenue?.items || []).slice(0, 10).map((i: any) => (
                      <Box
                        key={i.assetId}
                        onClick={() => setAssetId(assetId === i.assetId ? "" : i.assetId)}
                        sx={{
                          display: "flex",
                          alignItems: "center",
                          gap: 1,
                          py: 0.6,
                          cursor: "pointer",
                          borderRadius: 1,
                          px: 0.5,
                          bgcolor: assetId === i.assetId ? "action.selected" : "transparent",
                          "&:hover": { bgcolor: "action.hover" },
                        }}
                      >
                        <Typography variant="body2" sx={{ flex: 1, minWidth: 0, wordBreak: "break-word" }}>
                          {i.item}
                        </Typography>
                        <Typography variant="caption" sx={{ color: "text.secondary" }}>
                          {i.lines} lines
                        </Typography>
                        <Typography variant="body2" sx={{ fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
                          {money(i.revenue)}
                        </Typography>
                      </Box>
                    ))}
                  </Box>
                )}
              </Panel>
            </Grid>

            {/* Stock on hand */}
            <Grid item xs={12} lg={7}>
              <Panel
                title="Stock on hand"
                subtitle="Every unit, split by what it is doing right now"
                action={<Legend series={STOCK_STATUSES} counts={statusTotals} />}
              >
                <Box sx={{ maxHeight: 320, overflowY: "auto", pr: 0.5 }}>
                  <StockBars rows={(stock?.items || []).slice(0, 12)} />
                </Box>
              </Panel>
            </Grid>

            {/* Recent in/out */}
            <Grid item xs={12} lg={5}>
              <Panel title="Recent movements" subtitle="Units going out to site and coming back">
                {!movements?.length ? (
                  <Typography variant="body2" sx={{ color: "text.secondary", py: 4, textAlign: "center" }}>
                    No movements recorded yet.
                  </Typography>
                ) : (
                  <Box sx={{ maxHeight: 320, overflowY: "auto" }}>
                    {movements.map((m: any, idx: number) => {
                      const out = m.direction === "out";
                      return (
                        <Box key={idx}>
                          <Stack direction="row" spacing={1.25} alignItems="flex-start" sx={{ py: 1 }}>
                            <Box
                              sx={{
                                mt: 0.25,
                                width: 26,
                                height: 26,
                                borderRadius: "50%",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                flexShrink: 0,
                                bgcolor: out ? "primary.lighter" : "success.lighter",
                                color: out ? "primary.main" : "success.main",
                              }}
                            >
                              {out ? <NorthEastIcon sx={{ fontSize: 15 }} /> : <SouthWestIcon sx={{ fontSize: 15 }} />}
                            </Box>
                            <Box sx={{ flex: 1, minWidth: 0 }}>
                              <Typography variant="body2" sx={{ fontWeight: 600, wordBreak: "break-word" }}>
                                {m.asset}
                              </Typography>
                              <Typography variant="caption" sx={{ color: "text.secondary", display: "block" }}>
                                {m.sku}
                                {m.project ? ` · ${m.project}` : ""}
                              </Typography>
                            </Box>
                            <Box sx={{ textAlign: "right", flexShrink: 0 }}>
                              <Typography variant="caption" sx={{ fontWeight: 700, color: out ? "primary.main" : "success.main", display: "block" }}>
                                {out ? "Out" : "Back"}
                              </Typography>
                              <Typography variant="caption" sx={{ color: "text.secondary" }}>
                                {m.at ? new Date(m.at).toLocaleDateString("en-SG", { day: "2-digit", month: "short" }) : "—"}
                              </Typography>
                            </Box>
                          </Stack>
                          {idx < movements.length - 1 && <Divider />}
                        </Box>
                      );
                    })}
                  </Box>
                )}
              </Panel>
            </Grid>

            {/* Field activity */}
            <Grid item xs={12} lg={5}>
              <Panel
                title="Field activity"
                subtitle="How often the team is out on site"
                action={<Legend series={MSR_KINDS} counts={kindTotals} />}
              >
                <ColumnChart
                  data={maintenanceColumns}
                  series={MSR_KINDS as any}
                  height={200}
                  emptyMessage="No field jobs in this period"
                />
                {!!maintenance?.topUnits?.length && (
                  <Box sx={{ mt: 2 }}>
                    <Typography variant="caption" sx={{ color: "text.secondary", fontWeight: 700 }}>
                      Serviced most often
                    </Typography>
                    {maintenance.topUnits.slice(0, 4).map((u: any) => (
                      <Stack key={u.sku} direction="row" spacing={1} sx={{ mt: 0.5 }} alignItems="baseline">
                        <Typography variant="body2" sx={{ flex: 1, minWidth: 0, wordBreak: "break-word" }}>
                          {u.asset} <Box component="span" sx={{ color: "text.secondary" }}>{u.sku}</Box>
                        </Typography>
                        <Typography variant="body2" sx={{ fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
                          {u.visits}×
                        </Typography>
                      </Stack>
                    ))}
                  </Box>
                )}
              </Panel>
            </Grid>

            {/* Fleet map */}
            <Grid item xs={12} lg={7}>
              <Panel
                title="Where the fleet is"
                subtitle={`${mapData?.units?.length ?? 0} units positioned · ${mapData?.visits?.length ?? 0} field visits`}
                action={<Legend series={STOCK_STATUSES} />}
              >
                <FleetMap units={mapData?.units || []} visits={mapData?.visits || []} height={380} />
              </Panel>
            </Grid>
          </Grid>
        )}
      </Box>
    </MainCard>
  );
}
