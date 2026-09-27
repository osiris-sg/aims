"use client";

// The widget catalogue for the Operations dashboard.
//
// Every panel on the dashboard is an entry here, so adding a new one is a
// single registry entry rather than a change to the page. The page owns the
// data and passes it in as `ctx`; a widget only renders.
//
// `defaultW` is a span of 12 columns at md and up. Phones always get the full
// width — a 3-column stat tile at 390px is unreadable.

import React from "react";
import dynamic from "next/dynamic";
import { Box, Skeleton, Stack, Typography } from "@mui/material";
import InventoryOutlinedIcon from "@mui/icons-material/Inventory2Outlined";
import LocalShippingOutlinedIcon from "@mui/icons-material/LocalShippingOutlined";
import PaidOutlinedIcon from "@mui/icons-material/PaidOutlined";
import BuildOutlinedIcon from "@mui/icons-material/BuildOutlined";
import SouthWestIcon from "@mui/icons-material/SouthWest";
import NorthEastIcon from "@mui/icons-material/NorthEast";
import ColumnChart from "./ColumnChart";
import StockBars from "./StockBars";
import Legend from "./Legend";
import { MSR_KINDS, STOCK_STATUSES, money } from "./vizTokens";

const FleetMap = dynamic(() => import("./FleetMap"), {
  ssr: false,
  loading: () => <Skeleton variant="rectangular" height={340} sx={{ borderRadius: 1 }} />,
});

export interface WidgetCtx {
  stock: any;
  movements: any[] | null;
  revenue: any;
  maintenance: any;
  mapData: any;
  assetId: string;
  setAssetId: (id: string) => void;
  statusTotals: Record<string, number>;
  kindTotals: Record<string, number>;
  revenueColumns: any[];
  maintenanceColumns: any[];
}

export interface WidgetDef {
  id: string;
  /** Shown in the widget header and in the "Add widget" picker. */
  title: string;
  subtitle?: (ctx: WidgetCtx) => string;
  /** Short line in the picker explaining what the widget answers. */
  blurb: string;
  defaultW: number;
  /** A stat tile draws its own compact body with no header. */
  bare?: boolean;
  /** Right-aligned content in the widget header (legend, total…). */
  action?: (ctx: WidgetCtx) => React.ReactNode;
  render: (ctx: WidgetCtx) => React.ReactNode;
}

const Empty = ({ children }: any) => (
  <Typography variant="body2" sx={{ color: "text.secondary", py: 4, textAlign: "center" }}>
    {children}
  </Typography>
);

function StatBody({ label, value, hint, icon, tone }: any) {
  return (
    <Box>
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
    </Box>
  );
}

export const WIDGETS: WidgetDef[] = [
  {
    id: "stat.units",
    title: "Units tracked",
    blurb: "How many units exist, across how many products",
    defaultW: 3,
    bare: true,
    render: (c) => (
      <StatBody
        label="Units tracked"
        value={c.stock?.totals?.units ?? 0}
        hint={`${(c.stock?.items || []).length} products`}
        icon={<InventoryOutlinedIcon fontSize="small" />}
      />
    ),
  },
  {
    id: "stat.onrent",
    title: "Out on rent",
    blurb: "Units with a customer right now",
    defaultW: 3,
    bare: true,
    render: (c) => (
      <StatBody
        label="Out on rent"
        value={c.stock?.totals?.rental ?? 0}
        hint={`${c.stock?.totals?.instock ?? 0} still in stock`}
        icon={<LocalShippingOutlinedIcon fontSize="small" />}
        tone="primary.main"
      />
    ),
  },
  {
    id: "stat.revenue",
    title: "Revenue in period",
    blurb: "Invoiced total for the chosen range",
    defaultW: 3,
    bare: true,
    render: (c) => (
      <StatBody
        label="Revenue in period"
        value={c.revenue ? money(c.revenue.total) : "—"}
        hint={c.assetId ? "filtered to one product" : "all products"}
        icon={<PaidOutlinedIcon fontSize="small" />}
        tone="success.main"
      />
    ),
  },
  {
    id: "stat.service",
    title: "Service visits",
    blurb: "Maintenance visits in the chosen range",
    defaultW: 3,
    bare: true,
    render: (c) => (
      <StatBody
        label="Service visits"
        value={c.kindTotals.SERVICE || 0}
        hint={`${Object.values(c.kindTotals).reduce((a: any, b: any) => a + b, 0)} field jobs in total`}
        icon={<BuildOutlinedIcon fontSize="small" />}
        tone="warning.main"
      />
    ),
  },
  {
    id: "revenue.trend",
    title: "Revenue",
    blurb: "Invoiced amounts month by month",
    defaultW: 8,
    subtitle: (c) =>
      c.assetId
        ? `${(c.revenue?.items || []).find((i: any) => i.assetId === c.assetId)?.item || "Product"} · invoiced in this period`
        : "Invoiced in this period, by month",
    action: (c) => (
      <Typography variant="h6" sx={{ fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
        {c.revenue ? money(c.revenue.total) : "—"}
      </Typography>
    ),
    render: (c) => (
      <ColumnChart
        data={c.revenueColumns}
        series={[{ key: "revenue", label: "Revenue", slot: 0 }]}
        format={money}
        height={230}
        emptyMessage="No invoices in this period"
      />
    ),
  },
  {
    id: "revenue.byproduct",
    title: "By product",
    blurb: "Which products earn the most — click one to filter",
    defaultW: 4,
    subtitle: () => "Highest earning first",
    render: (c) =>
      !(c.revenue?.items || []).length ? (
        <Empty>Nothing invoiced in this period.</Empty>
      ) : (
        <Box sx={{ maxHeight: 250, overflowY: "auto" }}>
          {(c.revenue?.items || []).slice(0, 10).map((i: any) => (
            <Box
              key={i.assetId}
              onClick={() => c.setAssetId(c.assetId === i.assetId ? "" : i.assetId)}
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 1,
                py: 0.6,
                px: 0.5,
                cursor: "pointer",
                borderRadius: 1,
                bgcolor: c.assetId === i.assetId ? "action.selected" : "transparent",
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
      ),
  },
  {
    id: "stock.onhand",
    title: "Stock on hand",
    blurb: "Every unit, split by what it is doing right now",
    defaultW: 7,
    subtitle: () => "Every unit, split by what it is doing right now",
    action: (c) => <Legend series={STOCK_STATUSES} counts={c.statusTotals} />,
    render: (c) => (
      <Box sx={{ maxHeight: 320, overflowY: "auto", pr: 0.5 }}>
        <StockBars rows={(c.stock?.items || []).slice(0, 12)} />
      </Box>
    ),
  },
  {
    id: "movements.recent",
    title: "Recent movements",
    blurb: "Units going out to site and coming back",
    defaultW: 5,
    subtitle: () => "Units going out to site and coming back",
    render: (c) =>
      !c.movements?.length ? (
        <Empty>No movements recorded yet.</Empty>
      ) : (
        <Box sx={{ maxHeight: 320, overflowY: "auto" }}>
          {c.movements.map((m: any, idx: number) => {
            const out = m.direction === "out";
            return (
              <Stack key={idx} direction="row" spacing={1.25} alignItems="flex-start" sx={{ py: 1, borderBottom: idx < c.movements!.length - 1 ? 1 : 0, borderColor: "divider" }}>
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
            );
          })}
        </Box>
      ),
  },
  {
    id: "field.activity",
    title: "Field activity",
    blurb: "How often the team is out on site, and which units keep breaking",
    defaultW: 5,
    subtitle: () => "How often the team is out on site",
    action: (c) => <Legend series={MSR_KINDS} counts={c.kindTotals} />,
    render: (c) => (
      <>
        <ColumnChart data={c.maintenanceColumns} series={MSR_KINDS as any} height={200} emptyMessage="No field jobs in this period" />
        {!!c.maintenance?.topUnits?.length && (
          <Box sx={{ mt: 2 }}>
            <Typography variant="caption" sx={{ color: "text.secondary", fontWeight: 700 }}>
              Serviced most often
            </Typography>
            {c.maintenance.topUnits.slice(0, 4).map((u: any) => (
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
      </>
    ),
  },
  {
    id: "fleet.map",
    title: "Where the fleet is",
    blurb: "Map of every unit with a GPS position",
    defaultW: 7,
    subtitle: (c) => `${c.mapData?.units?.length ?? 0} units positioned · ${c.mapData?.visits?.length ?? 0} field visits`,
    action: () => <Legend series={STOCK_STATUSES} />,
    render: (c) => <FleetMap units={c.mapData?.units || []} visits={c.mapData?.visits || []} height={340} />,
  },
];

export const WIDGET_BY_ID = Object.fromEntries(WIDGETS.map((w) => [w.id, w])) as Record<string, WidgetDef>;

/** The arrangement a person sees before they customise anything. */
export const DEFAULT_LAYOUT: Array<{ id: string; w: number }> = WIDGETS.map((w) => ({ id: w.id, w: w.defaultW }));

/** Widths offered in the widget menu, as spans of 12. */
export const WIDTH_CHOICES = [
  { w: 3, label: "Quarter" },
  { w: 4, label: "Third" },
  { w: 6, label: "Half" },
  { w: 8, label: "Two thirds" },
  { w: 12, label: "Full width" },
];
