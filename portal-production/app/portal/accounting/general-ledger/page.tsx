"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Autocomplete,
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

type Account = {
  id: string;
  code: string;
  name: string;
  category: "PNL" | "BALANCE_SHEET";
  normalBalance: "DEBIT" | "CREDIT";
  isActive: boolean;
};

type LedgerRow = {
  journalEntryId: string;
  journalNumber: string;
  entryDate: string;
  type: string;
  reference?: string | null;
  description?: string | null;
  debit: number;
  credit: number;
  balance: number;
};

type Ledger = {
  account: { id: string; code: string; name: string; normalBalance: string };
  openingBalance: number;
  closingBalance: number;
  rows: LedgerRow[];
};

export default function GeneralLedgerPage() {
  const { request } = useAccountingApi();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [account, setAccount] = useState<Account | null>(null);
  const [data, setData] = useState<Ledger | null>(null);
  const [loading, setLoading] = useState(false);
  const [period, setPeriod] = useState({ startDate: "", endDate: "" });

  // Load chart of accounts once.
  useEffect(() => {
    (async () => {
      try {
        const list = await request<Account[]>("/accounting/accounts");
        const sorted = (list || []).sort((a, b) => a.code.localeCompare(b.code));
        setAccounts(sorted);
      } catch (e: any) {
        toast.error(e?.message || "Failed to load accounts");
      }
    })();
  }, [request]);

  const queryString = useMemo(() => {
    const p = new URLSearchParams();
    if (period.startDate) p.set("startDate", period.startDate);
    if (period.endDate) p.set("endDate", period.endDate);
    return p.toString();
  }, [period]);

  const load = useCallback(async () => {
    if (!account) return;
    setLoading(true);
    try {
      const res = await request<Ledger>(`/journal/reports/general-ledger/${account.id}?${queryString}`);
      setData(res);
    } catch (e: any) {
      toast.error(e?.message || "Failed to load ledger");
    } finally {
      setLoading(false);
    }
  }, [account, request, queryString]);

  useEffect(() => {
    if (account) load();
  }, [account, load]);

  return (
    <Box sx={{ p: 3, display: "flex", flexDirection: "column", gap: 2 }}>
      <Box>
        <Typography variant="h5" sx={{ fontWeight: 700 }}>
          General Ledger
        </Typography>
        <Typography variant="body2" sx={{ color: "text.secondary" }}>
          All posted activity for a single account, with running balance.
        </Typography>
      </Box>
      <Divider />

      <Paper sx={{ p: 2 }}>
        <Stack direction="row" gap={2} flexWrap="wrap" alignItems="center">
          <Autocomplete
            sx={{ minWidth: 360 }}
            size="small"
            options={accounts}
            value={account}
            onChange={(_, v) => setAccount(v)}
            getOptionLabel={(o) => `${o.code} — ${o.name}`}
            renderInput={(params) => <TextField {...params} label="Account" />}
          />
          <TextField
            size="small"
            type="date"
            label="From"
            InputLabelProps={{ shrink: true }}
            value={period.startDate}
            onChange={(e) => setPeriod((p) => ({ ...p, startDate: e.target.value }))}
          />
          <TextField
            size="small"
            type="date"
            label="To"
            InputLabelProps={{ shrink: true }}
            value={period.endDate}
            onChange={(e) => setPeriod((p) => ({ ...p, endDate: e.target.value }))}
          />
          <Button startIcon={<RefreshIcon />} onClick={load} variant="outlined" disabled={!account}>
            Refresh
          </Button>
        </Stack>
      </Paper>

      {!account && (
        <Typography variant="body2" sx={{ color: "text.secondary", textAlign: "center", p: 6 }}>
          Pick an account to drill into its posted activity.
        </Typography>
      )}

      {account && loading && (
        <Box sx={{ display: "flex", justifyContent: "center", p: 6 }}>
          <CircularProgress />
        </Box>
      )}

      {account && !loading && data && (
        <>
          <Stack direction="row" gap={3}>
            <Typography variant="body2">
              <strong>{data.account.code}</strong> — {data.account.name} ({data.account.normalBalance})
            </Typography>
            <Typography variant="body2"><strong>Opening:</strong> {data.openingBalance.toFixed(2)}</Typography>
            <Typography variant="body2"><strong>Closing:</strong> {data.closingBalance.toFixed(2)}</Typography>
          </Stack>

          <TableContainer component={Paper}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ fontWeight: 600 }}>Date</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Entry #</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Type</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Reference</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Description</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 600 }}>Debit</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 600 }}>Credit</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 600 }}>Balance</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                <TableRow>
                  <TableCell colSpan={7} sx={{ fontStyle: "italic", color: "text.secondary" }}>
                    Opening balance
                  </TableCell>
                  <TableCell align="right" sx={{ fontWeight: 600 }}>{data.openingBalance.toFixed(2)}</TableCell>
                </TableRow>
                {data.rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} align="center" sx={{ py: 4, color: "text.secondary" }}>
                      No activity in this period.
                    </TableCell>
                  </TableRow>
                )}
                {data.rows.map((r) => (
                  <TableRow key={`${r.journalEntryId}-${r.journalNumber}-${r.entryDate}`} hover>
                    <TableCell>{new Date(r.entryDate).toLocaleDateString()}</TableCell>
                    <TableCell sx={{ fontFamily: "monospace" }}>{r.journalNumber}</TableCell>
                    <TableCell>{r.type}</TableCell>
                    <TableCell>{r.reference}</TableCell>
                    <TableCell sx={{ maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {r.description}
                    </TableCell>
                    <TableCell align="right">{r.debit ? r.debit.toFixed(2) : ""}</TableCell>
                    <TableCell align="right">{r.credit ? r.credit.toFixed(2) : ""}</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 600 }}>{r.balance.toFixed(2)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </>
      )}
    </Box>
  );
}
