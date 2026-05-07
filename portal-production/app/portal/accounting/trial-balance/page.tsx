"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Box,
  Button,
  CircularProgress,
  Divider,
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

export default function TrialBalancePage() {
  const { request } = useAccountingApi();
  const [data, setData] = useState<TrialBalance | null>(null);
  const [loading, setLoading] = useState(false);
  const [asOfDate, setAsOfDate] = useState("");

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
        <Stack direction="row" gap={1} alignItems="center">
          <TextField
            size="small"
            type="date"
            label="As of"
            InputLabelProps={{ shrink: true }}
            value={asOfDate}
            onChange={(e) => setAsOfDate(e.target.value)}
          />
          <Button startIcon={<RefreshIcon />} onClick={load} variant="outlined">
            Refresh
          </Button>
        </Stack>
      </Stack>
      <Divider />

      {loading && (
        <Box sx={{ display: "flex", justifyContent: "center", p: 6 }}>
          <CircularProgress />
        </Box>
      )}

      {!loading && data && (
        <>
          <Stack direction="row" gap={3}>
            <Typography variant="body2">
              <strong>Total Debit:</strong> {data.totalDebit.toFixed(2)}
            </Typography>
            <Typography variant="body2">
              <strong>Total Credit:</strong> {data.totalCredit.toFixed(2)}
            </Typography>
            <Typography variant="body2" sx={{ color: data.isBalanced ? "success.main" : "error.main", fontWeight: 600 }}>
              {data.isBalanced ? "Balanced ✓" : "OUT OF BALANCE ✗"}
            </Typography>
          </Stack>

          <TableContainer component={Paper}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ fontWeight: 600 }}>Code</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Name</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Category</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 600 }}>Debit</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 600 }}>Credit</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 600 }}>Balance</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {data.rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} align="center" sx={{ py: 4, color: "text.secondary" }}>
                      No posted activity yet.
                    </TableCell>
                  </TableRow>
                )}
                {data.rows.map((r) => (
                  <TableRow key={r.accountId} hover>
                    <TableCell sx={{ fontFamily: "monospace", fontWeight: 600 }}>{r.code}</TableCell>
                    <TableCell>{r.name}</TableCell>
                    <TableCell>{r.category === "PNL" ? "P&L" : "Balance Sheet"}</TableCell>
                    <TableCell align="right">{r.debit.toFixed(2)}</TableCell>
                    <TableCell align="right">{r.credit.toFixed(2)}</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 600 }}>{r.balance.toFixed(2)}</TableCell>
                  </TableRow>
                ))}
                <TableRow>
                  <TableCell colSpan={3} align="right" sx={{ fontWeight: 700 }}>Totals</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 700 }}>{data.totalDebit.toFixed(2)}</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 700 }}>{data.totalCredit.toFixed(2)}</TableCell>
                  <TableCell />
                </TableRow>
              </TableBody>
            </Table>
          </TableContainer>
        </>
      )}
    </Box>
  );
}
