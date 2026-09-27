"use client";

// Operations dashboard (Biofuel, guru 2026-09-26).
//
// A widget board: every panel is an entry in the widget catalogue, and each
// person arranges their own board — drag to reorder, resize, remove, and add
// back from the picker. The arrangement is saved against their membership of
// the org, so it follows them between devices rather than living in one
// browser.
//
// The date range and product filter sit above the board and drive the revenue
// and field-activity widgets together, so the whole board always describes the
// same period.

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogContent,
  DialogTitle,
  Grid,
  IconButton,
  MenuItem,
  Skeleton,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import TuneIcon from "@mui/icons-material/Tune";
import RestartAltIcon from "@mui/icons-material/RestartAlt";
import CloseIcon from "@mui/icons-material/Close";
import dynamic from "next/dynamic";
import MainCard from "@/components/MainCard";
import { useAuth } from "@clerk/nextjs";
import { request } from "@/helpers/request";
import WidgetFrame from "./ops/WidgetFrame";
import type { GridEntry } from "./ops/GridBoard";
import { DEFAULT_LAYOUT, WIDGETS, WIDGET_BY_ID, type WidgetCtx } from "./ops/widgets";
import { STOCK_STATUSES } from "./ops/vizTokens";

// The grid measures its own container, so it can only run in the browser.
const GridBoard = dynamic(() => import("./ops/GridBoard"), {
  ssr: false,
  loading: () => <Skeleton variant="rectangular" height={420} sx={{ borderRadius: 1 }} />,
});

type LayoutEntry = GridEntry;

// Layouts saved before the board became a real grid carry only { id, w }.
// Lay those out left-to-right at the widget's default height rather than
// throwing the arrangement away.
function toGrid(saved: any[]): LayoutEntry[] {
  let x = 0;
  let y = 0;
  let rowH = 0;
  return saved
    .filter((e) => e && WIDGET_BY_ID[e.id])
    .map((e) => {
      const def = WIDGET_BY_ID[e.id];
      const w = Math.min(Math.max(Number(e.w) || def.defaultW, 1), 12);
      const h = Number(e.h) || def.defaultH;
      if (typeof e.x === "number" && typeof e.y === "number") return { id: e.id, x: e.x, y: e.y, w, h };
      if (x + w > 12) {
        x = 0;
        y += rowH || h;
        rowH = 0;
      }
      const entry = { id: e.id, x, y, w, h };
      x += w;
      rowH = Math.max(rowH, h);
      return entry;
    });
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
const monthsAgo = (n: number) => {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return d;
};

export default function OpsDashboard() {
  const { getToken } = useAuth();

  const [from, setFrom] = useState(iso(monthsAgo(6)));
  const [to, setTo] = useState(iso(new Date()));
  const [assetId, setAssetId] = useState("");

  const [stock, setStock] = useState<any>(null);
  const [movements, setMovements] = useState<any[] | null>(null);
  const [revenue, setRevenue] = useState<any>(null);
  const [maintenance, setMaintenance] = useState<any>(null);
  const [mapData, setMapData] = useState<any>(null);
  const [error, setError] = useState("");

  const [layout, setLayout] = useState<LayoutEntry[] | null>(null);
  const [editing, setEditing] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  const call = useCallback(
    async (path: string, body?: any) => {
      const token = await getToken();
      if (!token) return null;
      const res = await request({ path, method: body ? "POST" : "GET" }, body, token);
      return (res as any)?.data ?? res;
    },
    [getToken],
  );

  // Layout + the parts that don't depend on the date range.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [s, m, g, l] = await Promise.all([
          call("/dashboard/ops/stock"),
          call("/dashboard/ops/movements?limit=12"),
          call("/dashboard/ops/map"),
          call("/dashboard/ops/layout"),
        ]);
        if (!alive) return;
        setStock(s);
        setMovements(m || []);
        setMapData(g);
        // A saved layout can name a widget that no longer exists (renamed or
        // retired) — drop those rather than crash on an unknown id.
        const saved: any[] | null = l?.layout ?? null;
        setLayout(saved && saved.length ? toGrid(saved) : toGrid(DEFAULT_LAYOUT));
      } catch (e: any) {
        if (alive) {
          setError(e?.message || "Could not load the dashboard");
          setLayout(toGrid(DEFAULT_LAYOUT));
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [call]);

  // Revenue + field activity follow the filters.
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

  // Persist the arrangement, debounced — a drag fires many updates and each one
  // would otherwise be a round trip.
  const saveTimer = useRef<any>(null);
  const persist = useCallback(
    (next: LayoutEntry[]) => {
      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        call("/dashboard/ops/layout", { layout: next }).catch(() => {
          /* a failed save must not interrupt the board; the next change retries */
        });
      }, 600);
    },
    [call],
  );

  const update = useCallback(
    (next: LayoutEntry[]) => {
      setLayout(next);
      persist(next);
    },
    [persist],
  );

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
    return [...byMonth.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([month, values]) => ({ month, values }));
  }, [maintenance]);
  const kindTotals = useMemo(() => {
    const t: Record<string, number> = {};
    for (const row of maintenance?.series || []) t[row.kind] = (t[row.kind] || 0) + row.count;
    return t;
  }, [maintenance]);
  const statusTotals = useMemo(() => {
    const t: Record<string, number> = {};
    for (const r of stock?.items || []) for (const s of STOCK_STATUSES) t[s.key] = (t[s.key] || 0) + ((r as any)[s.key] || 0);
    return t;
  }, [stock]);

  const ctx: WidgetCtx = {
    stock,
    movements,
    revenue,
    maintenance,
    mapData,
    assetId,
    setAssetId,
    statusTotals,
    kindTotals,
    revenueColumns,
    maintenanceColumns,
  };

  const placed = new Set((layout || []).map((l) => l.id));
  const available = WIDGETS.filter((w) => !placed.has(w.id));
  const loading = !stock && !error;

  return (
    <MainCard>
      {/* MainCard scrolls its content (overflowY: auto), and MUI's shrunk
          outlined labels float ~9px ABOVE their field's top border — as the
          first child, the filter row's "Product / From / To" labels overflowed
          past the scroll container and were clipped (guru 2026-09-28). A little
          top padding keeps them inside. */}
      <Box sx={{ pt: 1.5 }}>
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
              {editing
                ? "Drag a widget by its grip to move it, pull its bottom-right corner to resize, or remove it. Changes save by themselves."
                : "Stock, movements, revenue and field activity in one place."}
            </Typography>
          </Box>

          <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", rowGap: 1 }}>
            <TextField
              select
              size="small"
              label="Product"
              value={assetId}
              onChange={(e) => setAssetId(e.target.value)}
              SelectProps={{ displayEmpty: true }}
              InputLabelProps={{ shrink: true }}
              sx={{ minWidth: { xs: "100%", sm: 180 } }}
            >
              <MenuItem value="">All products</MenuItem>
              {(revenue?.items || []).map((i: any) => (
                <MenuItem key={i.assetId} value={i.assetId}>
                  {i.item}
                </MenuItem>
              ))}
            </TextField>
            <TextField size="small" type="date" label="From" value={from} onChange={(e) => setFrom(e.target.value)} InputLabelProps={{ shrink: true }} />
            <TextField size="small" type="date" label="To" value={to} onChange={(e) => setTo(e.target.value)} InputLabelProps={{ shrink: true }} />
            <Button
              size="small"
              variant={editing ? "contained" : "outlined"}
              startIcon={<TuneIcon />}
              onClick={() => setEditing((v) => !v)}
              sx={{ textTransform: "none", whiteSpace: "nowrap" }}
            >
              {editing ? "Done" : "Customise"}
            </Button>
          </Stack>
        </Stack>

        {editing && (
          <Stack direction="row" spacing={1} sx={{ mb: 2, flexWrap: "wrap", rowGap: 1 }} alignItems="center">
            <Button
              size="small"
              variant="outlined"
              startIcon={<AddIcon />}
              onClick={() => setPickerOpen(true)}
              sx={{ textTransform: "none" }}
              disabled={!available.length}
            >
              Add widget{available.length ? ` (${available.length})` : ""}
            </Button>
            <Button size="small" startIcon={<RestartAltIcon />} onClick={() => update(toGrid(DEFAULT_LAYOUT))} sx={{ textTransform: "none" }}>
              Reset to default
            </Button>
            <Typography variant="caption" sx={{ color: "text.secondary" }}>
              {(layout || []).length} of {WIDGETS.length} widgets shown
            </Typography>
          </Stack>
        )}

        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        {loading || !layout ? (
          <Box sx={{ display: "flex", justifyContent: "center", py: 10 }}>
            <CircularProgress />
          </Box>
        ) : layout.length === 0 ? (
          <Box sx={{ textAlign: "center", py: 8 }}>
            <Typography variant="body1" sx={{ mb: 1.5 }}>
              Your dashboard is empty.
            </Typography>
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              onClick={() => {
                setEditing(true);
                setPickerOpen(true);
              }}
              sx={{ textTransform: "none" }}
            >
              Add a widget
            </Button>
          </Box>
        ) : (
          <GridBoard entries={layout} editing={editing} onChange={update}>
            {(id) => {
              const def = WIDGET_BY_ID[id];
              if (!def) return null;
              return (
                <WidgetFrame
                  title={def.title}
                  subtitle={def.subtitle ? def.subtitle(ctx) : undefined}
                  action={def.action ? def.action(ctx) : undefined}
                  bare={def.bare}
                  editing={editing}
                  onRemove={() => update((layout || []).filter((l) => l.id !== id))}
                >
                  {def.render(ctx)}
                </WidgetFrame>
              );
            }}
          </GridBoard>
        )}

        <Dialog open={pickerOpen} onClose={() => setPickerOpen(false)} maxWidth="sm" fullWidth>
          <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <Box sx={{ flex: 1 }}>Add a widget</Box>
            <IconButton size="small" onClick={() => setPickerOpen(false)}>
              <CloseIcon fontSize="small" />
            </IconButton>
          </DialogTitle>
          <DialogContent dividers>
            {!available.length ? (
              <Typography variant="body2" sx={{ color: "text.secondary", py: 3, textAlign: "center" }}>
                Every widget is already on your dashboard.
              </Typography>
            ) : (
              available.map((w) => (
                <Box
                  key={w.id}
                  onClick={() => {
                    // New widgets land on a fresh row at the bottom.
                    const bottom = (layout || []).reduce((m, e) => Math.max(m, e.y + e.h), 0);
                    update([...(layout || []), { id: w.id, x: 0, y: bottom, w: w.defaultW, h: w.defaultH }]);
                    setPickerOpen(false);
                  }}
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    gap: 1.5,
                    p: 1.25,
                    borderRadius: 1,
                    cursor: "pointer",
                    "&:hover": { bgcolor: "action.hover" },
                  }}
                >
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {w.title}
                    </Typography>
                    <Typography variant="caption" sx={{ color: "text.secondary" }}>
                      {w.blurb}
                    </Typography>
                  </Box>
                  <Chip
                    size="small"
                    variant="outlined"
                    label={w.defaultW >= 12 ? "Full" : w.defaultW >= 7 ? "Wide" : w.defaultW >= 5 ? "Half" : "Small"}
                  />
                  <AddIcon fontSize="small" sx={{ color: "primary.main" }} />
                </Box>
              ))
            )}
          </DialogContent>
        </Dialog>
      </Box>
    </MainCard>
  );
}
