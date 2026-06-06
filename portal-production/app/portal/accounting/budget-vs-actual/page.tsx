"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Box,
  Button,
  Chip,
  CircularProgress,
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
  Typography,
} from "@mui/material";
import RefreshIcon from "@mui/icons-material/Refresh";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import Link from "next/link";
import { toast } from "react-toastify";
import { useAccountingApi } from "../_lib/api";

type Month = { month: number; budget: number; actual: number; variance: number; variancePct: number | null };

type Row = {
  accountId: string;
  code: string;
  name: string;
  accountType: string;
  months: Month[];
  totalBudget: number;
  totalActual: number;
  totalVariance: number;
  totalVariancePct: number | null;
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const fmt = (n: number) => {
  if (n === 0) return "—";
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const currentYear = () => new Date().getFullYear();

export default function BudgetVsActualPage() {
  const { request } = useAccountingApi();
  const [year, setYear] = useState(currentYear());
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<"YTD" | "MONTHLY">("YTD");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await request<{ rows: Row[] }>(`/budgets/report/${year}`);
      setRows(res.rows || []);
    } catch (e: any) {
      toast.error(e?.message || "Failed to load Budget vs Actual");
    } finally {
      setLoading(false);
    }
  }, [year, request]);

  useEffect(() => {
    load();
  }, [load]);

  const totals = rows.reduce(
    (s, r) => ({ budget: s.budget + r.totalBudget, actual: s.actual + r.totalActual }),
    { budget: 0, actual: 0 },
  );
  const totalVar = totals.actual - totals.budget;

  const topVariances = [...rows]
    .filter((r) => r.totalBudget !== 0)
    .sort((a, b) => Math.abs(b.totalVariance) - Math.abs(a.totalVariance))
    .slice(0, 3);

  return (
    <Box sx={{ p: 3, display: "flex", flexDirection: "column", gap: 2 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
        <Box>
          <Typography variant="h5" sx={{ fontWeight: 700 }}>
            Budget vs Actual — {year}
          </Typography>
          <Typography variant="body2" sx={{ color: "text.secondary" }}>
            Posted P&L activity compared to your stored budget.
          </Typography>
        </Box>
        <Stack direction="row" gap={1}>
          <TextField
            select
            size="small"
            label="View"
            value={viewMode}
            onChange={(e) => setViewMode(e.target.value as any)}
            sx={{ width: 130 }}
          >
            <MenuItem value="YTD">YTD totals</MenuItem>
            <MenuItem value="MONTHLY">Monthly</MenuItem>
          </TextField>
          <TextField
            select
            size="small"
            label="Year"
            value={year}
            onChange={(e) => setYear(parseInt(e.target.value, 10))}
            sx={{ width: 110 }}
          >
            {Array.from({ length: 5 }, (_, i) => currentYear() - 2 + i).map((y) => (
              <MenuItem key={y} value={y}>{y}</MenuItem>
            ))}
          </TextField>
          <Button startIcon={<RefreshIcon />} variant="outlined" size="small" onClick={load}>Refresh</Button>
          <Button startIcon={<OpenInNewIcon />} variant="outlined" size="small" component={Link} href="/portal/accounting/budget">
            Edit budgets
          </Button>
        </Stack>
      </Stack>

      <Stack direction="row" gap={2}>
        <Stat label="Total budget" value={fmt(totals.budget)} />
        <Stat label="Total actual" value={fmt(totals.actual)} />
        <Stat
          label="Variance"
          value={fmt(totalVar)}
          accent={totalVar === 0 ? "info" : totalVar > 0 ? "warning" : "success"}
        />
      </Stack>

      {topVariances.length > 0 && (
        <Paper variant="outlined" sx={{ p: 1.5 }}>
          <Typography variant="caption" sx={{ color: "text.secondary", textTransform: "uppercase", fontWeight: 700, fontSize: "0.65rem" }}>
            Top variances
          </Typography>
          <Stack gap={0.5} sx={{ mt: 0.5 }}>
            {topVariances.map((r) => (
              <Typography key={r.accountId} variant="body2">
                <strong>{r.code} {r.name}</strong>:{" "}
                {r.totalVariance > 0 ? "exceeded" : "under"} budget by{" "}
                <Box component="span" sx={{ fontFamily: "monospace", fontWeight: 600 }}>
                  {fmt(Math.abs(r.totalVariance))}
                </Box>
                {r.totalVariancePct !== null && (
                  <Box component="span" sx={{ ml: 1, color: "text.secondary", fontSize: "0.8125rem" }}>
                    ({r.totalVariancePct > 0 ? "+" : ""}{r.totalVariancePct.toFixed(0)}%)
                  </Box>
                )}
              </Typography>
            ))}
          </Stack>
        </Paper>
      )}

      <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: "70vh" }}>
        <Table size="small" stickyHeader>
          <TableHead>
            <TableRow>
              <TableCell sx={{ fontWeight: 700, position: "sticky", left: 0, bgcolor: "background.paper", zIndex: 3, minWidth: 240 }}>
                Account
              </TableCell>
              {viewMode === "MONTHLY" &&
                MONTHS.map((m) => (
                  <TableCell key={m} align="right" sx={{ fontWeight: 700, minWidth: 80 }}>{m}</TableCell>
                ))}
              <TableCell align="right" sx={{ fontWeight: 700 }}>Budget</TableCell>
              <TableCell align="right" sx={{ fontWeight: 700 }}>Actual</TableCell>
              <TableCell align="right" sx={{ fontWeight: 700 }}>Variance</TableCell>
              <TableCell align="right" sx={{ fontWeight: 700 }}>%</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loading && (
              <TableRow>
                <TableCell colSpan={viewMode === "MONTHLY" ? 17 : 5} align="center" sx={{ py: 4 }}>
                  <CircularProgress size={20} />
                </TableCell>
              </TableRow>
            )}
            {!loading && rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={viewMode === "MONTHLY" ? 17 : 5} align="center" sx={{ py: 4, color: "text.secondary" }}>
                  No P&L accounts.
                </TableCell>
              </TableRow>
            )}
            {!loading &&
              rows.map((r) => (
                <TableRow key={r.accountId} hover>
                  <TableCell sx={{ position: "sticky", left: 0, bgcolor: "background.paper", zIndex: 1 }}>
                    <Typography component="span" sx={{ fontFamily: "monospace", fontWeight: 600, mr: 1 }}>{r.code}</Typography>
                    <Typography component="span" variant="body2">{r.name}</Typography>
                  </TableCell>
                  {viewMode === "MONTHLY" &&
                    r.months.map((m) => (
                      <TableCell
                        key={m.month}
                        align="right"
                        sx={{
                          fontFamily: "monospace",
                          fontSize: "0.75rem",
                          color: m.variance > 0 ? "warning.main" : m.variance < 0 ? "success.main" : "text.secondary",
                        }}
                      >
                        {m.actual === 0 && m.budget === 0 ? "—" : `${m.actual.toFixed(0)}`}
                      </TableCell>
                    ))}
                  <TableCell align="right" sx={{ fontFamily: "monospace" }}>{fmt(r.totalBudget)}</TableCell>
                  <TableCell align="right" sx={{ fontFamily: "monospace", fontWeight: 600 }}>{fmt(r.totalActual)}</TableCell>
                  <TableCell
                    align="right"
                    sx={{
                      fontFamily: "monospace",
                      fontWeight: 600,
                      color: r.totalVariance === 0 ? "inherit" : r.totalVariance > 0 ? "warning.main" : "success.main",
                    }}
                  >
                    {r.totalVariance !== 0
                      ? `${r.totalVariance > 0 ? "+" : ""}${r.totalVariance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                      : "—"}
                  </TableCell>
                  <TableCell align="right" sx={{ fontFamily: "monospace", fontSize: "0.8125rem", color: "text.secondary" }}>
                    {r.totalVariancePct !== null
                      ? `${r.totalVariancePct > 0 ? "+" : ""}${r.totalVariancePct.toFixed(0)}%`
                      : "—"}
                  </TableCell>
                </TableRow>
              ))}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: "info" | "warning" | "success" }) {
  return (
    <Paper
      variant="outlined"
      sx={{
        p: 1.5,
        minWidth: 160,
        borderLeft: accent ? 3 : 0,
        borderLeftColor: accent ? `${accent}.main` : undefined,
      }}
    >
      <Typography variant="caption" sx={{ color: "text.secondary", textTransform: "uppercase", fontWeight: 700, fontSize: "0.65rem" }}>
        {label}
      </Typography>
      <Typography sx={{ fontFamily: "monospace", fontWeight: 700, fontSize: "1.125rem", mt: 0.25 }}>{value}</Typography>
    </Paper>
  );
}
