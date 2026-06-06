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
import PrintIcon from "@mui/icons-material/Print";
import SearchIcon from "@mui/icons-material/Search";
import { toast } from "react-toastify";
import { useAccountingApi } from "../_lib/api";

type Bucket = { current: number; days30: number; days60: number; days90: number; days120Plus: number };
type SupplierRow = { supplierId: string; supplierName: string; outstanding: number; aging: Bucket };
type ApAgingReport = {
  asOfDate: string;
  suppliers: SupplierRow[];
  totals: Bucket;
  totalOutstanding: number;
};

const fmt = (n: number) =>
  n === 0 ? "—" : n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const BUCKETS: Array<{ key: keyof Bucket; label: string; severity: "success" | "info" | "warning" | "error" }> = [
  { key: "current", label: "Current (0-30)", severity: "success" },
  { key: "days30", label: "31-60", severity: "info" },
  { key: "days60", label: "61-90", severity: "info" },
  { key: "days90", label: "91-120", severity: "warning" },
  { key: "days120Plus", label: "120+", severity: "error" },
];

export default function APAgingPage() {
  const { request } = useAccountingApi();
  const [data, setData] = useState<ApAgingReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await request<ApAgingReport>("/bills/aging");
      setData(res);
    } catch (e: any) {
      toast.error(e?.message || "Failed to load AP aging");
    } finally {
      setLoading(false);
    }
  }, [request]);

  useEffect(() => {
    load();
  }, [load]);

  const suppliers = data?.suppliers || [];
  const totals = data?.totals;

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return suppliers;
    return suppliers.filter((s) => s.supplierName.toLowerCase().includes(q));
  }, [suppliers, search]);

  return (
    <Box sx={{ p: 3, display: "flex", flexDirection: "column", gap: 2 }}>
      <Box>
        <Typography variant="h5" sx={{ fontWeight: 700 }}>
          AP Aging Report
        </Typography>
        <Typography variant="body2" sx={{ color: "text.secondary" }}>
          What you owe suppliers, bucketed by days past due (or days since bill date if no due).
        </Typography>
      </Box>

      {totals && (
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: { xs: "1fr 1fr", sm: "repeat(5, 1fr)" },
            gap: 1.5,
          }}
        >
          {BUCKETS.map((b) => (
            <Paper
              key={b.key}
              variant="outlined"
              sx={{
                p: 1.5,
                borderRadius: 1.5,
                borderLeft: 3,
                borderLeftColor: `${b.severity}.main`,
              }}
            >
              <Typography
                variant="caption"
                sx={{
                  color: "text.secondary",
                  fontSize: "0.65rem",
                  textTransform: "uppercase",
                  fontWeight: 700,
                  letterSpacing: 0.5,
                }}
              >
                {b.label}
              </Typography>
              <Typography sx={{ fontFamily: "monospace", fontWeight: 700, fontSize: "1.125rem", mt: 0.25 }}>
                {fmt(totals[b.key])}
              </Typography>
            </Paper>
          ))}
        </Box>
      )}

      <Paper variant="outlined" sx={{ p: 1.5 }}>
        <Stack direction="row" gap={2} flexWrap="wrap" alignItems="center">
          <TextField
            size="small"
            label="Locate supplier"
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
          {data && (
            <Chip
              size="small"
              variant="outlined"
              label={`Total Owed: ${data.totalOutstanding.toLocaleString(undefined, { minimumFractionDigits: 2 })}`}
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
              <TableCell sx={{ fontWeight: 700 }}>Supplier</TableCell>
              <TableCell align="right" sx={{ fontWeight: 700 }}>Total Outstanding</TableCell>
              {BUCKETS.map((b) => (
                <TableCell key={b.key} align="right" sx={{ fontWeight: 700 }}>
                  {b.label}
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {loading && (
              <TableRow>
                <TableCell colSpan={7} align="center" sx={{ py: 4 }}>
                  <CircularProgress size={20} />
                </TableCell>
              </TableRow>
            )}
            {!loading && visible.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} align="center" sx={{ py: 4, color: "text.secondary" }}>
                  No outstanding supplier bills.
                </TableCell>
              </TableRow>
            )}
            {!loading &&
              visible.map((s) => {
                const worst = BUCKETS.slice().reverse().find((b) => s.aging[b.key] > 0);
                return (
                  <TableRow key={s.supplierId} hover>
                    <TableCell>
                      <Stack direction="row" gap={1} alignItems="center">
                        <Typography variant="body2" sx={{ fontWeight: 500 }}>{s.supplierName}</Typography>
                        {worst && worst.severity !== "success" && (
                          <Chip
                            size="small"
                            label={worst.label}
                            color={worst.severity}
                            variant="outlined"
                            sx={{ height: 18, fontSize: "0.65rem" }}
                          />
                        )}
                      </Stack>
                    </TableCell>
                    <TableCell align="right" sx={{ fontFamily: "monospace", fontWeight: 600 }}>
                      {fmt(s.outstanding)}
                    </TableCell>
                    {BUCKETS.map((b) => (
                      <TableCell
                        key={b.key}
                        align="right"
                        sx={{
                          fontFamily: "monospace",
                          color: s.aging[b.key] > 0 && b.severity === "error" ? "error.main" : "inherit",
                          fontWeight:
                            s.aging[b.key] > 0 && (b.severity === "warning" || b.severity === "error") ? 600 : 400,
                        }}
                      >
                        {fmt(s.aging[b.key])}
                      </TableCell>
                    ))}
                  </TableRow>
                );
              })}
            {!loading && totals && (
              <TableRow
                sx={{
                  "& td": {
                    borderTop: 2,
                    borderTopColor: "divider",
                    fontWeight: 700,
                    bgcolor: (t) => alpha(t.palette.text.primary, 0.02),
                  },
                }}
              >
                <TableCell sx={{ fontWeight: 700 }}>TOTALS</TableCell>
                <TableCell align="right" sx={{ fontFamily: "monospace", fontWeight: 700 }}>
                  {fmt(data?.totalOutstanding ?? 0)}
                </TableCell>
                {BUCKETS.map((b) => (
                  <TableCell key={b.key} align="right" sx={{ fontFamily: "monospace", fontWeight: 700 }}>
                    {fmt(totals[b.key])}
                  </TableCell>
                ))}
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  );
}
