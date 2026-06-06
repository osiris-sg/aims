"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  InputAdornment,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
  alpha,
} from "@mui/material";
import RefreshIcon from "@mui/icons-material/Refresh";
import SaveIcon from "@mui/icons-material/Save";
import SearchIcon from "@mui/icons-material/Search";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import { useAuth } from "@clerk/nextjs";
import { toast } from "react-toastify";

// ---------------------------------------------------------------------------
// Grid editor for per-asset cost prices. Powers the "Closing Stock" line on
// the P&L and (once wired) the perpetual inventory → GL postings.
//
// Users edit cells inline; dirty rows are tracked locally. "Save all" sends
// a single PATCH /accounting/cost-prices with the changed rows.
// ---------------------------------------------------------------------------

type Row = {
  assetId: string;
  code: string;
  name: string;
  isTracked: boolean;
  quantity: number;
  costPrice: number;
  value: number;
  missingCost: boolean;
};

type ClosingStockResult = {
  asOfDate: string;
  total: number;
  itemCount: number;
  itemsWithMissingCost: number;
  items: Row[];
};

const fmt = (n: number) =>
  n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function InventoryCostTab() {
  const { getToken } = useAuth();
  const apiBase = process.env.NEXT_PUBLIC_BACKEND_API_URL;

  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  // Map of assetId → edited costPrice (only entries with pending changes).
  const [dirty, setDirty] = useState<Record<string, number>>({});
  const [summary, setSummary] = useState<{ total: number; itemCount: number; itemsWithMissingCost: number } | null>(null);

  const authedFetch = useCallback(
    async (path: string, init?: RequestInit) => {
      const token = await getToken();
      return fetch(`${apiBase}${path}`, {
        ...init,
        headers: {
          ...(init?.headers || {}),
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
      });
    },
    [apiBase, getToken],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await authedFetch("/accounting/closing-stock");
      if (!res.ok) throw new Error(await res.text());
      const json = await res.json();
      const data: ClosingStockResult = json?.data ?? json;
      setRows(data.items || []);
      setSummary({ total: data.total, itemCount: data.itemCount, itemsWithMissingCost: data.itemsWithMissingCost });
      setDirty({});
    } catch (e: any) {
      toast.error(e?.message || "Failed to load inventory cost");
    } finally {
      setLoading(false);
    }
  }, [authedFetch]);

  useEffect(() => {
    load();
  }, [load]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => r.code.toLowerCase().includes(q) || r.name.toLowerCase().includes(q));
  }, [rows, search]);

  const dirtyCount = Object.keys(dirty).length;

  // Live total reflects unsaved edits so the user sees the impact before saving.
  const liveTotal = useMemo(() => {
    return rows.reduce((s, r) => {
      const cost = dirty[r.assetId] !== undefined ? dirty[r.assetId] : r.costPrice;
      return s + r.quantity * cost;
    }, 0);
  }, [rows, dirty]);

  const setRowCost = (assetId: string, value: string) => {
    const n = parseFloat(value);
    setDirty((d) => {
      const next = { ...d };
      const original = rows.find((r) => r.assetId === assetId)?.costPrice ?? 0;
      if (isNaN(n)) {
        delete next[assetId];
      } else if (n === original) {
        delete next[assetId];
      } else {
        next[assetId] = n;
      }
      return next;
    });
  };

  const saveAll = async () => {
    if (dirtyCount === 0) return;
    setSaving(true);
    try {
      const updates = Object.entries(dirty).map(([assetId, costPrice]) => ({ assetId, costPrice }));
      const res = await authedFetch("/accounting/cost-prices", {
        method: "PATCH",
        body: JSON.stringify({ updates }),
      });
      if (!res.ok) throw new Error(await res.text());
      toast.success(`Saved ${updates.length} cost price${updates.length === 1 ? "" : "s"}`);
      await load();
    } catch (e: any) {
      toast.error(e?.message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
      {/* Header */}
      <Box>
        <Typography variant="h6" sx={{ fontWeight: 700 }}>
          Inventory Cost Prices
        </Typography>
        <Typography variant="body2" sx={{ color: "text.secondary" }}>
          What you pay per unit. Drives the Closing Stock figure on the P&L and inventory valuation.
        </Typography>
      </Box>

      {/* KPI strip */}
      {summary && (
        <Stack direction="row" gap={2} flexWrap="wrap">
          <Stat label="Items with stock" value={summary.itemCount.toString()} />
          <Stat label="Total valuation (live)" value={fmt(liveTotal)} accent="primary" />
          {summary.itemsWithMissingCost > 0 && (
            <Stat
              label="Missing cost"
              value={summary.itemsWithMissingCost.toString()}
              accent="warning"
              icon={<WarningAmberIcon sx={{ fontSize: "0.875rem" }} />}
            />
          )}
        </Stack>
      )}

      {/* Toolbar */}
      <Paper variant="outlined" sx={{ p: 1.5 }}>
        <Stack direction="row" gap={2} alignItems="center" flexWrap="wrap">
          <TextField
            size="small"
            placeholder="Find by SKU or name"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            sx={{ minWidth: 280 }}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" />
                </InputAdornment>
              ),
            }}
          />
          <Box sx={{ flex: 1 }} />
          {dirtyCount > 0 && (
            <Chip size="small" label={`${dirtyCount} unsaved change${dirtyCount === 1 ? "" : "s"}`} color="warning" variant="outlined" />
          )}
          <Button startIcon={<RefreshIcon />} variant="outlined" size="small" onClick={load} disabled={saving || dirtyCount > 0}>
            Refresh
          </Button>
          <Button
            startIcon={saving ? <CircularProgress size={14} color="inherit" /> : <SaveIcon />}
            variant="contained"
            size="small"
            onClick={saveAll}
            disabled={saving || dirtyCount === 0}
          >
            Save all
          </Button>
        </Stack>
      </Paper>

      {/* Grid */}
      <TableContainer component={Paper} variant="outlined">
        <Table size="small" stickyHeader>
          <TableHead>
            <TableRow>
              <TableCell sx={{ fontWeight: 700, width: 140 }}>SKU</TableCell>
              <TableCell sx={{ fontWeight: 700 }}>Name</TableCell>
              <TableCell align="center" sx={{ fontWeight: 700, width: 90 }}>Mode</TableCell>
              <TableCell align="right" sx={{ fontWeight: 700, width: 100 }}>Qty</TableCell>
              <TableCell align="right" sx={{ fontWeight: 700, width: 160 }}>Cost / unit</TableCell>
              <TableCell align="right" sx={{ fontWeight: 700, width: 140 }}>Line value</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loading && (
              <TableRow>
                <TableCell colSpan={6} align="center" sx={{ py: 4 }}>
                  <CircularProgress size={20} />
                </TableCell>
              </TableRow>
            )}
            {!loading && visible.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} align="center" sx={{ py: 4, color: "text.secondary" }}>
                  No assets with on-hand stock.
                </TableCell>
              </TableRow>
            )}
            {!loading &&
              visible.map((r) => {
                const isDirty = dirty[r.assetId] !== undefined;
                const liveCost = isDirty ? dirty[r.assetId] : r.costPrice;
                const lineValue = r.quantity * liveCost;
                return (
                  <TableRow
                    key={r.assetId}
                    hover
                    sx={{
                      bgcolor: isDirty ? (t) => alpha(t.palette.warning.main, 0.06) : undefined,
                    }}
                  >
                    <TableCell sx={{ fontFamily: "monospace", fontWeight: 600 }}>{r.code}</TableCell>
                    <TableCell>{r.name}</TableCell>
                    <TableCell align="center">
                      <Chip size="small" variant="outlined" label={r.isTracked ? "Tracked" : "Qty"} sx={{ fontSize: "0.65rem", height: 18 }} />
                    </TableCell>
                    <TableCell align="right" sx={{ fontFamily: "monospace" }}>
                      {r.quantity}
                    </TableCell>
                    <TableCell align="right">
                      <TextField
                        size="small"
                        type="number"
                        defaultValue={r.costPrice}
                        onChange={(e) => setRowCost(r.assetId, e.target.value)}
                        inputProps={{
                          step: "0.01",
                          min: 0,
                          style: { textAlign: "right", fontFamily: "monospace", padding: "4px 8px" },
                        }}
                        sx={{ width: 130 }}
                      />
                    </TableCell>
                    <TableCell
                      align="right"
                      sx={{
                        fontFamily: "monospace",
                        fontWeight: 600,
                        color: r.missingCost && !isDirty ? "warning.main" : "inherit",
                      }}
                    >
                      {fmt(lineValue)}
                    </TableCell>
                  </TableRow>
                );
              })}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  );
}

function Stat({
  label,
  value,
  accent,
  icon,
}: {
  label: string;
  value: string;
  accent?: "primary" | "warning";
  icon?: React.ReactNode;
}) {
  return (
    <Paper
      variant="outlined"
      sx={{
        p: 1.5,
        borderRadius: 1.5,
        minWidth: 180,
        borderLeft: accent ? 3 : 0,
        borderLeftColor: accent ? `${accent}.main` : undefined,
      }}
    >
      <Typography
        variant="caption"
        sx={{
          color: "text.secondary",
          textTransform: "uppercase",
          fontSize: "0.65rem",
          fontWeight: 700,
          letterSpacing: 0.5,
          display: "flex",
          alignItems: "center",
          gap: 0.5,
        }}
      >
        {icon}
        {label}
      </Typography>
      <Typography sx={{ fontFamily: "monospace", fontWeight: 700, fontSize: "1.125rem", mt: 0.25 }}>
        {value}
      </Typography>
    </Paper>
  );
}
