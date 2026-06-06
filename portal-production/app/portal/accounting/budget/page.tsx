"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  IconButton,
  InputAdornment,
  MenuItem,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
  alpha,
} from "@mui/material";
import RefreshIcon from "@mui/icons-material/Refresh";
import SaveIcon from "@mui/icons-material/Save";
import SearchIcon from "@mui/icons-material/Search";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import { toast } from "react-toastify";
import { useAccountingApi } from "../_lib/api";

// ---------------------------------------------------------------------------
// Spreadsheet-style budget editor. Rows = P&L accounts, columns = Jan-Dec.
// Edits tracked in a dirty map; single "Save all" sends bulk-upsert.
// ---------------------------------------------------------------------------

type AccountRow = {
  id: string;
  code: string;
  name: string;
  accountType: string;
  normalBalance: "DEBIT" | "CREDIT";
  budgets: Record<number, number>;
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const fmt = (n: number) => (n === 0 ? "" : n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

const currentYear = () => new Date().getFullYear();

export default function BudgetPage() {
  const { request } = useAccountingApi();
  const [year, setYear] = useState(currentYear());
  const [rows, setRows] = useState<AccountRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  // key = `${accountId}:${month}` → amount
  const [dirty, setDirty] = useState<Record<string, number>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setDirty({});
    try {
      const res = await request<{ accounts: AccountRow[] }>(`/budgets/${year}`);
      setRows(res.accounts || []);
    } catch (e: any) {
      toast.error(e?.message || "Failed to load budgets");
    } finally {
      setLoading(false);
    }
  }, [year, request]);

  useEffect(() => {
    load();
  }, [load]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => r.code.toLowerCase().includes(q) || r.name.toLowerCase().includes(q));
  }, [rows, search]);

  const setCell = (accountId: string, month: number, value: string) => {
    const key = `${accountId}:${month}`;
    const n = parseFloat(value);
    const original = rows.find((r) => r.id === accountId)?.budgets[month] ?? 0;
    setDirty((d) => {
      const next = { ...d };
      if (isNaN(n) && original === 0) {
        delete next[key];
      } else if (n === original) {
        delete next[key];
      } else {
        next[key] = isNaN(n) ? 0 : n;
      }
      return next;
    });
  };

  const dirtyCount = Object.keys(dirty).length;

  const totalsPerRow = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) {
      let total = 0;
      for (let mo = 1; mo <= 12; mo++) {
        const key = `${r.id}:${mo}`;
        total += dirty[key] !== undefined ? dirty[key] : r.budgets[mo] ?? 0;
      }
      m.set(r.id, total);
    }
    return m;
  }, [rows, dirty]);

  const save = async () => {
    if (dirtyCount === 0) return;
    setSaving(true);
    try {
      const items = Object.entries(dirty).map(([key, amount]) => {
        const [accountId, monthStr] = key.split(":");
        return { accountId, year, month: parseInt(monthStr, 10), amount };
      });
      await request("/budgets", { method: "PUT", body: JSON.stringify({ items }) });
      toast.success(`Saved ${items.length} budget cell${items.length === 1 ? "" : "s"}`);
      await load();
    } catch (e: any) {
      toast.error(e?.message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const copyFromLast = async () => {
    if (!confirm(`Copy budgets from ${year - 1} into ${year}? Existing ${year} budgets stay; missing months get filled.`)) return;
    try {
      await request("/budgets/copy", {
        method: "POST",
        body: JSON.stringify({ fromYear: year - 1, toYear: year, overwrite: false }),
      });
      toast.success("Copied");
      load();
    } catch (e: any) {
      toast.error(e?.message || "Copy failed");
    }
  };

  return (
    <Box sx={{ p: 3, display: "flex", flexDirection: "column", gap: 2 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
        <Box>
          <Typography variant="h5" sx={{ fontWeight: 700 }}>
            Budget — {year}
          </Typography>
          <Typography variant="body2" sx={{ color: "text.secondary" }}>
            Enter your monthly target per P&L account. Compared to actuals in the Reports tab.
          </Typography>
        </Box>
        <Stack direction="row" gap={1}>
          <TextField
            select
            size="small"
            label="Year"
            value={year}
            onChange={(e) => setYear(parseInt(e.target.value, 10))}
            sx={{ width: 110 }}
          >
            {Array.from({ length: 5 }, (_, i) => currentYear() - 2 + i).map((y) => (
              <MenuItem key={y} value={y}>
                {y}
              </MenuItem>
            ))}
          </TextField>
          <Button startIcon={<ContentCopyIcon />} variant="outlined" size="small" onClick={copyFromLast}>
            Copy from {year - 1}
          </Button>
          <Button startIcon={<RefreshIcon />} variant="outlined" size="small" onClick={load} disabled={saving || dirtyCount > 0}>
            Refresh
          </Button>
          <Button
            startIcon={saving ? <CircularProgress size={14} color="inherit" /> : <SaveIcon />}
            variant="contained"
            size="small"
            onClick={save}
            disabled={saving || dirtyCount === 0}
          >
            Save all
          </Button>
        </Stack>
      </Stack>

      <Paper variant="outlined" sx={{ p: 1.5 }}>
        <Stack direction="row" alignItems="center" gap={2}>
          <TextField
            size="small"
            placeholder="Find by code or name"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            sx={{ minWidth: 280 }}
            InputProps={{
              startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment>,
            }}
          />
          <Box sx={{ flex: 1 }} />
          {dirtyCount > 0 && (
            <Chip size="small" label={`${dirtyCount} unsaved cell${dirtyCount === 1 ? "" : "s"}`} color="warning" variant="outlined" />
          )}
        </Stack>
      </Paper>

      <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: "70vh" }}>
        <Table size="small" stickyHeader>
          <TableHead>
            <TableRow>
              <TableCell sx={{ fontWeight: 700, position: "sticky", left: 0, bgcolor: "background.paper", zIndex: 3, minWidth: 240 }}>
                Account
              </TableCell>
              {MONTHS.map((m) => (
                <TableCell key={m} align="right" sx={{ fontWeight: 700, minWidth: 90 }}>{m}</TableCell>
              ))}
              <TableCell align="right" sx={{ fontWeight: 700, minWidth: 100 }}>Total</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loading && (
              <TableRow>
                <TableCell colSpan={14} align="center" sx={{ py: 4 }}>
                  <CircularProgress size={20} />
                </TableCell>
              </TableRow>
            )}
            {!loading && visible.length === 0 && (
              <TableRow>
                <TableCell colSpan={14} align="center" sx={{ py: 4, color: "text.secondary" }}>
                  No P&L accounts found.
                </TableCell>
              </TableRow>
            )}
            {!loading &&
              visible.map((r) => (
                <TableRow key={r.id} hover>
                  <TableCell sx={{ position: "sticky", left: 0, bgcolor: "background.paper", zIndex: 1 }}>
                    <Typography component="span" sx={{ fontFamily: "monospace", fontWeight: 600, mr: 1 }}>{r.code}</Typography>
                    <Typography component="span" variant="body2">{r.name}</Typography>
                  </TableCell>
                  {MONTHS.map((_, i) => {
                    const m = i + 1;
                    const key = `${r.id}:${m}`;
                    const isDirty = dirty[key] !== undefined;
                    const value = isDirty ? dirty[key] : r.budgets[m] ?? 0;
                    return (
                      <TableCell
                        key={m}
                        align="right"
                        sx={{ p: 0.25, bgcolor: isDirty ? (t) => alpha(t.palette.warning.main, 0.08) : undefined }}
                      >
                        <TextField
                          size="small"
                          type="number"
                          defaultValue={r.budgets[m] ?? 0}
                          onChange={(e) => setCell(r.id, m, e.target.value)}
                          inputProps={{
                            step: "0.01",
                            min: 0,
                            style: { textAlign: "right", fontFamily: "monospace", padding: "4px 6px", fontSize: "0.8125rem" },
                          }}
                          sx={{ width: 80 }}
                        />
                      </TableCell>
                    );
                  })}
                  <TableCell
                    align="right"
                    sx={{ fontFamily: "monospace", fontWeight: 700, bgcolor: (t) => alpha(t.palette.text.primary, 0.02) }}
                  >
                    {fmt(totalsPerRow.get(r.id) ?? 0)}
                  </TableCell>
                </TableRow>
              ))}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  );
}
