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
} from "@mui/material";
import RefreshIcon from "@mui/icons-material/Refresh";
import PrintIcon from "@mui/icons-material/Print";
import SearchIcon from "@mui/icons-material/Search";
import { toast } from "react-toastify";
import { useAccountingApi } from "../_lib/api";

type Row = {
  accountId: string;
  code: string;
  name: string;
  category: "PNL" | "BALANCE_SHEET";
  normalBalance: "DEBIT" | "CREDIT";
  debit: number;
  credit: number;
  balance: number;
};

type TrialBalance = {
  asOfDate: string | null;
  rows: Row[];
  totalDebit: number;
  totalCredit: number;
  isBalanced: boolean;
};

const fmt = (n: number) =>
  n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function TrialBalancePage() {
  const { request } = useAccountingApi();
  const [data, setData] = useState<TrialBalance | null>(null);
  const [loading, setLoading] = useState(false);
  const [asOfDate, setAsOfDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [filter, setFilter] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const q = asOfDate ? `?asOfDate=${asOfDate}` : "";
      const res = await request<TrialBalance>(`/journal/reports/trial-balance${q}`);
      setData(res);
    } catch (e: any) {
      toast.error(e?.message || "Failed to load trial balance");
    } finally {
      setLoading(false);
    }
  }, [asOfDate, request]);

  useEffect(() => {
    load();
  }, [load]);

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return data?.rows || [];
    return (data?.rows || []).filter(
      (r) => r.code.toLowerCase().includes(q) || r.name.toLowerCase().includes(q),
    );
  }, [data, filter]);

  return (
    <Box sx={{ p: 3, display: "flex", flexDirection: "column", gap: 2 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center">
        <Box>
          <Typography variant="h5" sx={{ fontWeight: 700 }}>
            Trial Balance
          </Typography>
          <Typography variant="body2" sx={{ color: "text.secondary" }}>
            Net debit and credit per account from all posted journal entries.
          </Typography>
        </Box>
      </Stack>

      <Paper variant="outlined" sx={{ p: 1.5 }}>
        <Stack direction="row" gap={2} flexWrap="wrap" alignItems="center">
          <TextField
            size="small"
            type="date"
            label="As Of Date"
            InputLabelProps={{ shrink: true }}
            value={asOfDate}
            onChange={(e) => setAsOfDate(e.target.value)}
          />
          <TextField
            size="small"
            label="Locate"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            sx={{ minWidth: 240 }}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" />
                </InputAdornment>
              ),
            }}
          />
          <Box sx={{ flex: 1 }} />
          {data && (
            <Chip
              size="small"
              variant="outlined"
              label={data.isBalanced ? "Balanced ✓" : "OUT OF BALANCE ✗"}
              color={data.isBalanced ? "success" : "error"}
              sx={{ fontWeight: 700 }}
            />
          )}
          <Button startIcon={<PrintIcon />} variant="outlined" size="small" onClick={() => window.print()}>
            Print
          </Button>
          <Button startIcon={<RefreshIcon />} variant="outlined" size="small" onClick={load}>
            Refresh
          </Button>
        </Stack>
      </Paper>

      <TableContainer component={Paper} variant="outlined">
        <Table size="small" stickyHeader>
          <TableHead>
            <TableRow>
              <TableCell sx={{ fontWeight: 700, width: 120 }}>Code</TableCell>
              <TableCell sx={{ fontWeight: 700 }}>Name</TableCell>
              <TableCell sx={{ fontWeight: 700, width: 140 }}>Category</TableCell>
              <TableCell align="right" sx={{ fontWeight: 700, width: 140 }}>
                Debit
              </TableCell>
              <TableCell align="right" sx={{ fontWeight: 700, width: 140 }}>
                Credit
              </TableCell>
              <TableCell align="right" sx={{ fontWeight: 700, width: 140 }}>
                Balance
              </TableCell>
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
                  No posted activity yet.
                </TableCell>
              </TableRow>
            )}
            {!loading &&
              visible.map((r) => (
                <TableRow key={r.accountId} hover>
                  <TableCell sx={{ fontFamily: "monospace", fontWeight: 600 }}>{r.code}</TableCell>
                  <TableCell>{r.name}</TableCell>
                  <TableCell>
                    <Chip
                      size="small"
                      variant="outlined"
                      label={r.category === "PNL" ? "P&L" : "Balance Sheet"}
                    />
                  </TableCell>
                  <TableCell align="right" sx={{ fontFamily: "monospace" }}>
                    {fmt(r.debit)}
                  </TableCell>
                  <TableCell align="right" sx={{ fontFamily: "monospace" }}>
                    {fmt(r.credit)}
                  </TableCell>
                  <TableCell align="right" sx={{ fontFamily: "monospace", fontWeight: 600 }}>
                    {fmt(r.balance)}
                  </TableCell>
                </TableRow>
              ))}
            {!loading && data && (
              <TableRow>
                <TableCell colSpan={3} align="right" sx={{ fontWeight: 700 }}>
                  Totals
                </TableCell>
                <TableCell align="right" sx={{ fontWeight: 700, fontFamily: "monospace" }}>
                  {fmt(data.totalDebit)}
                </TableCell>
                <TableCell align="right" sx={{ fontWeight: 700, fontFamily: "monospace" }}>
                  {fmt(data.totalCredit)}
                </TableCell>
                <TableCell />
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  );
}
