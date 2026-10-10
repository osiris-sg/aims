"use client";

// General Ledger workspace — modern take on the legacy GL home screen
// (guru 2026-10-10, screenshot of A's Premier "General Ledger"): grouped KPI
// tiles (Revenue / Cost Of Sales / Expenses / Cash Flow), a cut-off date, and
// the all-accounts balance table (net Debit/Credit per account) with Locate
// and a TOTAL footer; clicking an account invokes its detailed ledger
// (running balance for a period). Reports live in a View Reports dialog —
// same pattern as ARWorkspace / APWorkspace.

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Autocomplete,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
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
  useMediaQuery,
} from "@mui/material";
import AccountBalanceWalletOutlinedIcon from "@mui/icons-material/AccountBalanceWalletOutlined";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import AssessmentOutlinedIcon from "@mui/icons-material/AssessmentOutlined";
import CloseIcon from "@mui/icons-material/Close";
import PaymentsOutlinedIcon from "@mui/icons-material/PaymentsOutlined";
import PrintIcon from "@mui/icons-material/Print";
import SearchIcon from "@mui/icons-material/Search";
import { toast } from "react-toastify";
import { useAccountingApi } from "./api";
import { useOrganization } from "@/app/portal/hooks/useOrganization";
import { PaperSheet, ReportHeader, ReportPrintCss, fmt as docFmt, formatShortDate } from "./report-doc";

const fmt = (n: number) =>
  (Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const unwrap = (r: any) => (r && typeof r === "object" && r.success !== undefined && r.data !== undefined ? r.data : r);
const dmy = (d: any) => (d ? new Date(d).toLocaleDateString("en-GB") : "—");
const todayISO = () => new Date().toISOString().slice(0, 10);
const monthStartISO = (iso: string) => `${iso.slice(0, 7)}-01`;

// The legacy GL home's left rail, as a View Reports dialog (same convention
// as AR_REPORTS / AP_REPORTS). `tab` keys must match the REPORTS registry.
// Legacy rail order first (Trial Balance … Foreign Bank Listing), then the
// modern extras. Trial Balance and Profit/(Loss) & BS open their printable
// paper-document pages; the rest resolve as ?tab= keys in the REPORTS registry.
const GL_REPORTS: { key: string; label: string; description: string; tab?: string; href?: string }[] = [
  { key: "trial-balance", label: "Trial Balance", description: "Printable trial balance document — net balance per account, as at a date", href: "/portal/accounting/trial-balance" },
  { key: "audit-trail", label: "Audit Trail", description: "Every posted journal line for a period, filterable by document prefix", tab: "audit-trail" },
  { key: "gst", label: "Goods & Services Tax", description: "GST details by tax code + F5 summary for the period", tab: "gst" },
  { key: "pnl-bs", label: "Profit/(Loss) & Balance Sheet", description: "Printable income statement and balance sheet documents", href: "/portal/accounting/profit-loss" },
  { key: "expense-listing", label: "Expense Listing", description: "Every expense and purchase transaction for a period, by account", tab: "expense-listing" },
  { key: "bank-rec", label: "Bank Reconciliation", description: "Match bank statement lines to ledger entries", href: "/portal/accounting/bank-reconciliation" },
  { key: "foreign-banks", label: "Foreign Bank Listing", description: "Foreign-currency bank accounts — foreign and local balances", tab: "foreign-banks" },
  { key: "jv-listing", label: "Journal Voucher Listing", description: "Every journal line for a period — Unconfirmed and Confirmed vouchers", tab: "jv-listing" },
  { key: "gl-detail", label: "General Ledger Detail", description: "Every posted line per account with running balance", tab: "gl" },
  { key: "gl-summary", label: "General Ledger Summary", description: "Debit, credit and net movement per account for a period", tab: "gl-summary" },
  { key: "account-transactions", label: "Account Transactions", description: "Transactions for chosen accounts over a period", tab: "account-transactions" },
  { key: "journal", label: "Journal Report", description: "Every posted journal with its balanced lines", tab: "journal" },
  { key: "bank-summary", label: "Bank Summary", description: "Opening balance, cash in and out, closing balance per bank account", tab: "bank-summary" },
];

type TbRow = {
  accountId: string;
  code: string;
  name: string;
  debit: number;
  credit: number;
};

type LedgerRow = {
  journalNumber: string;
  entryDate: string;
  reference?: string | null;
  description?: string | null;
  debit: number;
  credit: number;
  balance: number;
};

// Legacy tile groups: each card carries two label/value lines.
type TileLine = { label: string; value: number };

// ---- Printable GENERAL LEDGER document (legacy print flow) ----
type GlDocGroup = {
  accountId: string;
  code: string;
  name: string;
  openingBalance?: number;
  closingBalance?: number;
  rows: Array<{
    date: string;
    reference?: string | null;
    journalNumber?: string | null;
    description?: string | null;
    debit: number;
    credit: number;
    runningBalance: number;
  }>;
  totalDebit: number;
  totalCredit: number;
};
type GlDoc = {
  fromDate: string;
  toDate: string;
  fromAccount: string;
  toAccount: string;
  groups: GlDocGroup[];
  truncated?: boolean;
};

export default function GLWorkspace() {
  const router = useRouter();
  const { request } = useAccountingApi();
  const { organization } = useOrganization();
  const phoneDialog = useMediaQuery((t: any) => t.breakpoints.down("sm"));

  const [cutOff, setCutOff] = useState(todayISO());
  const [search, setSearch] = useState("");
  const [reportsOpen, setReportsOpen] = useState(false);

  // ---------- landing data ----------
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<TbRow[]>([]);
  const [tiles, setTiles] = useState<{ title: string; lines: TileLine[] }[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [tbRaw, plRaw, payments, billPays] = await Promise.all([
          request(`/journal/reports/trial-balance?asOfDate=${cutOff}`),
          request(`/journal/reports/profit-loss?cutOffDate=${cutOff}&closingStock=0`).catch(() => null),
          request(`/payments?limit=2000`).catch(() => null),
          request(`/bills/payments-listing?from=${monthStartISO(cutOff)}&to=${cutOff}`).catch(() => null),
        ]);
        if (cancelled) return;
        const tb = unwrap(tbRaw);
        setRows(tb?.rows || []);

        // Tiles follow the legacy grouping. P&L figures use the YTD column
        // (current financial year to the cut-off); cash flow is month-to-date.
        const pl = unwrap(plRaw);
        const ytd = (s: any) => {
          const vals = s?.subtotal?.values;
          return Array.isArray(vals) && vals.length ? Number(vals[vals.length - 1]) || 0 : 0;
        };
        const payList: any[] = Array.isArray(payments) ? payments : (payments as any)?.docs || (payments as any)?.payments || [];
        const mStart = new Date(monthStartISO(cutOff));
        const mEnd = new Date(cutOff);
        mEnd.setHours(23, 59, 59, 999);
        const receipts = payList.reduce((s, p) => {
          if (p.paymentMethod === "offset") return s; // cashless manual offsets
          const d = p.paymentDate ? new Date(p.paymentDate) : null;
          return d && d >= mStart && d <= mEnd ? s + (Number(p.amount) || 0) : s;
        }, 0);
        const billPayList: any[] = unwrap(billPays) || [];
        const paid = (Array.isArray(billPayList) ? billPayList : []).reduce(
          (s, p) => s + (Number(p.amount) || 0),
          0,
        );
        setTiles([
          { title: "Revenue", lines: [{ label: "Sales", value: ytd(pl?.sales) }, { label: "Income", value: ytd(pl?.otherIncome) }] },
          { title: "Cost Of Sales", lines: [{ label: "Purchases", value: ytd(pl?.cogs) }, { label: "Opening Stock", value: Number(pl?.openingStock) || 0 }] },
          { title: "Expenses", lines: [{ label: "Expenses", value: ytd(pl?.expenses) }, { label: "Taxation", value: ytd(pl?.tax) }] },
          { title: "Cash Flow", lines: [{ label: "Receipts (month)", value: receipts }, { label: "Payments (month)", value: paid }] },
        ]);
      } catch (e) {
        console.error("GL workspace load failed:", e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [request, cutOff]);

  // Legacy table convention: NET balance per account, shown in its column.
  const netRows = useMemo(
    () =>
      rows.map((r) => {
        const net = Math.round(((r.debit || 0) - (r.credit || 0)) * 100) / 100;
        return { ...r, netDebit: net > 0 ? net : 0, netCredit: net < 0 ? -net : 0 };
      }),
    [rows],
  );
  const visibleRows = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return netRows;
    return netRows.filter((r) => [r.code, r.name].some((v) => String(v ?? "").toLowerCase().includes(term)));
  }, [netRows, search]);
  const totals = useMemo(
    () => ({
      debit: netRows.reduce((s, r) => s + r.netDebit, 0),
      credit: netRows.reduce((s, r) => s + r.netCredit, 0),
    }),
    [netRows],
  );

  // ---------- drill-in (account ledger — the legacy "invoke General Ledger") ----------
  const [selected, setSelected] = useState<{ id: string; code: string; name: string } | null>(null);
  const [fromPeriod, setFromPeriod] = useState("");
  const [toPeriod, setToPeriod] = useState(todayISO());
  const [ledgerLoading, setLedgerLoading] = useState(false);
  const [ledger, setLedger] = useState<{ opening: number; closing: number; rows: LedgerRow[] } | null>(null);

  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    (async () => {
      setLedgerLoading(true);
      try {
        const params = new URLSearchParams();
        if (fromPeriod) params.set("startDate", fromPeriod);
        if (toPeriod) params.set("endDate", toPeriod);
        const res = unwrap(await request(`/journal/reports/general-ledger/${selected.id}?${params.toString()}`));
        if (cancelled) return;
        setLedger({
          opening: Number(res?.openingBalance) || 0,
          closing: Number(res?.closingBalance) || 0,
          rows: res?.rows || [],
        });
      } catch (e) {
        console.error("Account ledger load failed:", e);
        if (!cancelled) setLedger(null);
      } finally {
        if (!cancelled) setLedgerLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [request, selected, fromPeriod, toPeriod]);

  // ---------- print flow (legacy: Print → filter dialog → document) ----------
  const sortedCodes = useMemo(
    () => [...netRows].sort((a, b) => a.code.localeCompare(b.code)),
    [netRows],
  );
  const [printOpen, setPrintOpen] = useState(false);
  const [printFrom, setPrintFrom] = useState(""); // dates, set when dialog opens
  const [printTo, setPrintTo] = useState("");
  const [printFromAcc, setPrintFromAcc] = useState("");
  const [printToAcc, setPrintToAcc] = useState("");
  const [printLoading, setPrintLoading] = useState(false);
  const [glDoc, setGlDoc] = useState<GlDoc | null>(null);

  const openPrintDialog = () => {
    setPrintFrom(monthStartISO(cutOff));
    setPrintTo(cutOff);
    setPrintFromAcc(sortedCodes[0]?.code || "");
    setPrintToAcc(sortedCodes[sortedCodes.length - 1]?.code || "");
    setPrintOpen(true);
  };

  const runPrintReport = async () => {
    const lo = printFromAcc || sortedCodes[0]?.code || "";
    const hi = printToAcc || sortedCodes[sortedCodes.length - 1]?.code || "";
    const ids = sortedCodes
      .filter((r) => r.code.localeCompare(lo) >= 0 && r.code.localeCompare(hi) <= 0)
      .map((r) => r.accountId);
    if (ids.length === 0) {
      toast.info("No accounts in that range");
      return;
    }
    setPrintLoading(true);
    try {
      const params = new URLSearchParams();
      if (printFrom) params.set("startDate", printFrom);
      params.set("endDate", printTo || cutOff);
      params.set("accountIds", ids.join(","));
      params.set("includeOpening", "1");
      const res = unwrap(await request(`/journal/reports/gl-detail?${params.toString()}`));
      setGlDoc({
        fromDate: printFrom,
        toDate: printTo || cutOff,
        fromAccount: lo,
        toAccount: hi,
        groups: res?.groups || [],
        truncated: !!res?.truncated,
      });
      setPrintOpen(false);
    } catch (e: any) {
      toast.error(e?.message || "Failed to build the General Ledger report");
    } finally {
      setPrintLoading(false);
    }
  };

  const headCellSx = { fontWeight: 700, fontSize: "0.7rem", letterSpacing: "0.08em", textTransform: "uppercase", color: "text.secondary" } as const;
  const monoRight = { fontVariantNumeric: "tabular-nums", textAlign: "right" } as const;

  // =====================================================================
  // Drill-in dialog: per-account ledger with running balance
  // =====================================================================
  const accountDialog = (
    <Dialog open={!!selected} onClose={() => setSelected(null)} fullWidth maxWidth="lg" fullScreen={phoneDialog}>
      <DialogContent sx={{ p: { xs: 1.5, md: 3 } }}>
        {selected && (
          <>
            <Stack direction="row" alignItems="center" gap={1.5} sx={{ mb: 2, flexWrap: "wrap" }}>
              <Box sx={{ mr: 2 }}>
                <Typography variant="h6" sx={{ fontWeight: 700, lineHeight: 1.1 }}>
                  {selected.name}
                </Typography>
                <Typography variant="caption" sx={{ color: "text.secondary", fontVariantNumeric: "tabular-nums" }}>
                  {selected.code}
                </Typography>
              </Box>
              <TextField
                size="small"
                type="date"
                label="From period"
                InputLabelProps={{ shrink: true }}
                value={fromPeriod}
                onChange={(e) => setFromPeriod(e.target.value)}
              />
              <TextField
                size="small"
                type="date"
                label="To period"
                InputLabelProps={{ shrink: true }}
                value={toPeriod}
                onChange={(e) => setToPeriod(e.target.value)}
              />
              <Box sx={{ flex: 1 }} />
              <Paper variant="outlined" sx={{ px: 1.5, py: 0.75, borderRadius: 2 }}>
                <Typography variant="caption" sx={{ color: "text.secondary", mr: 1 }}>
                  Balance B/F
                </Typography>
                <Typography component="span" sx={{ fontVariantNumeric: "tabular-nums", fontWeight: 700 }}>
                  {fmt(ledger?.opening ?? 0)}
                </Typography>
              </Paper>
              <IconButton onClick={() => setSelected(null)} size="small">
                <CloseIcon fontSize="small" />
              </IconButton>
            </Stack>

            {ledgerLoading ? (
              <Box sx={{ display: "flex", justifyContent: "center", p: 6 }}>
                <CircularProgress />
              </Box>
            ) : (
              <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 2, maxHeight: "55vh" }}>
                {/* Phone: ledger table scrolls inside its container */}
                <Table size="small" stickyHeader sx={(t) => ({
                  minWidth: 700,
                  "& tbody td": {
                    py: 0.5,
                    borderBottom: `1px solid ${t.palette.mode === "dark" ? "rgba(255,255,255,0.32)" : "rgba(0,0,0,0.32)"}`,
                  },
                })}>
                  <TableHead>
                    <TableRow>
                      <TableCell sx={headCellSx}>Reference</TableCell>
                      <TableCell sx={{ ...headCellSx, width: 110 }}>Date</TableCell>
                      <TableCell sx={headCellSx}>Description</TableCell>
                      <TableCell sx={{ ...headCellSx, textAlign: "right", width: 130 }}>Debit</TableCell>
                      <TableCell sx={{ ...headCellSx, textAlign: "right", width: 130 }}>Credit</TableCell>
                      <TableCell sx={{ ...headCellSx, textAlign: "right", width: 140 }}>Balance</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {(ledger?.rows || []).map((t, i) => (
                      <TableRow key={i} hover>
                        <TableCell sx={{ fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>
                          {t.reference || t.journalNumber || "—"}
                        </TableCell>
                        <TableCell sx={{ whiteSpace: "nowrap" }}>{dmy(t.entryDate)}</TableCell>
                        <TableCell>{t.description || ""}</TableCell>
                        <TableCell sx={monoRight}>{t.debit ? fmt(t.debit) : ""}</TableCell>
                        <TableCell sx={monoRight}>{t.credit ? fmt(t.credit) : ""}</TableCell>
                        <TableCell sx={{ ...monoRight, fontWeight: 600 }}>{fmt(t.balance)}</TableCell>
                      </TableRow>
                    ))}
                    {(ledger?.rows || []).length === 0 && (
                      <TableRow>
                        <TableCell colSpan={6}>
                          <Typography variant="body2" sx={{ color: "text.secondary", py: 2, textAlign: "center" }}>
                            No transactions in this period.
                          </Typography>
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </TableContainer>
            )}

            <Paper
              variant="outlined"
              sx={(t) => ({
                mt: 1.5,
                p: 1.5,
                borderRadius: 2,
                display: "flex",
                justifyContent: "flex-end",
                gap: 4,
                bgcolor: alpha(t.palette.text.primary, 0.03),
              })}
            >
              <Box sx={{ textAlign: "right" }}>
                <Typography variant="caption" sx={{ color: "text.secondary", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                  Closing Balance
                </Typography>
                <Typography sx={{ fontVariantNumeric: "tabular-nums", fontWeight: 700 }}>{fmt(ledger?.closing ?? 0)}</Typography>
              </Box>
            </Paper>
          </>
        )}
      </DialogContent>
    </Dialog>
  );

  // =====================================================================
  // Print preview: the page shows ONLY the paper document (so the browser's
  // print renders just the report, same as the Trial Balance / P&L pages).
  // =====================================================================
  if (glDoc) {
    return (
      <Box sx={{ px: { xs: 1.5, md: 3 }, py: 3, maxWidth: 1400, mx: "auto", width: "100%" }}>
        <Stack direction="row" gap={1.5} alignItems="center" sx={{ mb: 2 }} className="no-print">
          <Button startIcon={<ArrowBackIcon />} variant="outlined" size="small" onClick={() => setGlDoc(null)}>
            Back
          </Button>
          <Typography variant="h6" sx={{ fontWeight: 700 }}>
            General Ledger
          </Typography>
          {glDoc.truncated && (
            <Typography variant="caption" sx={{ color: "warning.main" }}>
              Large report — showing the first 5,000 lines. Narrow the range for a complete print.
            </Typography>
          )}
          <Box sx={{ flex: 1 }} />
          <Button startIcon={<PrintIcon />} variant="contained" size="small" onClick={() => window.print()}>
            Print
          </Button>
        </Stack>
        <PaperSheet>
          <GeneralLedgerDocument doc={glDoc} organization={organization} />
        </PaperSheet>
        <ReportPrintCss />
      </Box>
    );
  }

  // =====================================================================
  // Landing: KPI tile groups + account balances
  // =====================================================================
  return (
    <Box sx={{ px: { xs: 1.5, md: 3 }, py: 3, maxWidth: 1400, mx: "auto", width: "100%" }}>
      <Stack direction={{ xs: "column", md: "row" }} gap={1.5} sx={{ mb: 2 }}>
        {tiles.map((tile) => (
          <Paper key={tile.title} variant="outlined" sx={{ p: 2, flex: 1, minWidth: 220, borderRadius: 2 }}>
            <Typography
              variant="caption"
              sx={{ color: "text.secondary", letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 700 }}
            >
              {tile.title}
            </Typography>
            {tile.lines.map((l) => (
              <Stack key={l.label} direction="row" justifyContent="space-between" sx={{ mt: 0.5 }}>
                <Typography variant="body2" sx={{ color: "text.secondary" }}>
                  {l.label}
                </Typography>
                <Typography sx={{ fontVariantNumeric: "tabular-nums", fontWeight: 700 }}>{fmt(l.value)}</Typography>
              </Stack>
            ))}
          </Paper>
        ))}
        {tiles.length === 0 && !loading && (
          <Paper variant="outlined" sx={{ p: 2, flex: 1, borderRadius: 2 }}>
            <Typography variant="body2" sx={{ color: "text.secondary" }}>
              No posted activity yet.
            </Typography>
          </Paper>
        )}
      </Stack>

      <Stack direction="row" gap={1.5} alignItems="center" sx={{ mb: 1.5, flexWrap: "wrap" }}>
        <TextField
          size="small"
          type="date"
          label="Cut-off date"
          InputLabelProps={{ shrink: true }}
          value={cutOff}
          onChange={(e) => e.target.value && setCutOff(e.target.value)}
        />
        <TextField
          size="small"
          placeholder="Locate by code or description…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          sx={{ minWidth: { xs: "100%", sm: 280 } }}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon fontSize="small" />
              </InputAdornment>
            ),
          }}
        />
        <Typography variant="caption" sx={{ color: "text.secondary" }}>
          {visibleRows.length} of {netRows.length} accounts
        </Typography>
        <Box sx={{ flex: 1 }} />
        {/* Legacy GL home's two module shortcuts — jump to the AR / AP homes. */}
        <Button
          variant="contained"
          startIcon={<AccountBalanceWalletOutlinedIcon />}
          onClick={() => router.push("/portal/accounting/receivables")}
        >
          Accounts Receivable
        </Button>
        <Button
          variant="contained"
          startIcon={<PaymentsOutlinedIcon />}
          onClick={() => router.push("/portal/accounting/payables")}
        >
          Accounts Payable
        </Button>
        <Button variant="outlined" startIcon={<PrintIcon />} onClick={openPrintDialog}>
          Print
        </Button>
        <Button variant="outlined" startIcon={<AssessmentOutlinedIcon />} onClick={() => setReportsOpen(true)}>
          View Reports
        </Button>
      </Stack>

      {loading ? (
        <Box sx={{ display: "flex", justifyContent: "center", p: 6 }}>
          <CircularProgress />
        </Box>
      ) : (
        <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 2, maxHeight: "58vh" }}>
          {/* Phone: balances table scrolls inside its container */}
          <Table size="small" stickyHeader sx={(t) => ({
            minWidth: 700,
            "& tbody td": {
              py: 0.5,
              borderBottom: `1px solid ${t.palette.mode === "dark" ? "rgba(255,255,255,0.32)" : "rgba(0,0,0,0.32)"}`,
            },
          })}>
            <TableHead>
              <TableRow>
                <TableCell sx={{ ...headCellSx, width: 120 }}>Account</TableCell>
                <TableCell sx={headCellSx}>Description</TableCell>
                <TableCell sx={{ ...headCellSx, textAlign: "right", width: 150 }}>Debit</TableCell>
                <TableCell sx={{ ...headCellSx, textAlign: "right", width: 150 }}>Credit</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {visibleRows.map((r) => (
                <TableRow
                  key={r.accountId}
                  hover
                  onClick={() => {
                    setFromPeriod("");
                    setToPeriod(cutOff);
                    setSelected({ id: r.accountId, code: r.code, name: r.name });
                  }}
                  sx={{ cursor: "pointer" }}
                >
                  <TableCell sx={{ fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>{r.code}</TableCell>
                  <TableCell>{r.name}</TableCell>
                  <TableCell sx={monoRight}>{r.netDebit ? fmt(r.netDebit) : ""}</TableCell>
                  <TableCell sx={monoRight}>{r.netCredit ? fmt(r.netCredit) : ""}</TableCell>
                </TableRow>
              ))}
              {visibleRows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4}>
                    <Typography variant="body2" sx={{ color: "text.secondary", py: 2, textAlign: "center" }}>
                      No accounts{search ? " match the search" : " with posted activity"}.
                    </Typography>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      <Paper
        variant="outlined"
        sx={(t) => ({
          mt: 1.5,
          p: 1.5,
          borderRadius: 2,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          bgcolor: alpha(t.palette.text.primary, 0.03),
        })}
      >
        <Typography variant="caption" sx={{ color: "text.secondary" }}>
          Click an account to view its general ledger
        </Typography>
        <Stack direction="row" gap={4}>
          {[
            { label: "Total Debit", value: totals.debit },
            { label: "Total Credit", value: totals.credit },
          ].map((x) => (
            <Box key={x.label} sx={{ textAlign: "right" }}>
              <Typography variant="caption" sx={{ color: "text.secondary", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                {x.label}
              </Typography>
              <Typography sx={{ fontVariantNumeric: "tabular-nums", fontWeight: 700 }}>{fmt(x.value)}</Typography>
            </Box>
          ))}
        </Stack>
      </Paper>

      {/* ---------- Account ledger dialog ---------- */}
      {accountDialog}

      {/* ---------- Print filter dialog (legacy GENERAL LEDGER prompt) ---------- */}
      <Dialog open={printOpen} onClose={() => setPrintOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontWeight: 700 }}>General Ledger</DialogTitle>
        <DialogContent dividers>
          <Stack gap={2} sx={{ mt: 0.5 }}>
            <TextField
              size="small"
              type="date"
              label="From Date"
              InputLabelProps={{ shrink: true }}
              value={printFrom}
              onChange={(e) => setPrintFrom(e.target.value)}
            />
            <TextField
              size="small"
              type="date"
              label="To Date"
              InputLabelProps={{ shrink: true }}
              value={printTo}
              onChange={(e) => setPrintTo(e.target.value)}
            />
            <Autocomplete
              size="small"
              options={sortedCodes.map((r) => r.code)}
              value={printFromAcc || null}
              onChange={(_, v) => setPrintFromAcc(v || "")}
              renderInput={(p) => <TextField {...p} label="From Account No." />}
              renderOption={(props, code) => {
                const acc = sortedCodes.find((r) => r.code === code);
                return (
                  <li {...props} key={code}>
                    <Typography variant="body2" sx={{ fontVariantNumeric: "tabular-nums", fontWeight: 600, mr: 1 }}>
                      {code}
                    </Typography>
                    <Typography variant="body2" sx={{ color: "text.secondary" }} noWrap>
                      {acc?.name}
                    </Typography>
                  </li>
                );
              }}
            />
            <Autocomplete
              size="small"
              options={sortedCodes.map((r) => r.code)}
              value={printToAcc || null}
              onChange={(_, v) => setPrintToAcc(v || "")}
              renderInput={(p) => <TextField {...p} label="To Account No." />}
              renderOption={(props, code) => {
                const acc = sortedCodes.find((r) => r.code === code);
                return (
                  <li {...props} key={code}>
                    <Typography variant="body2" sx={{ fontVariantNumeric: "tabular-nums", fontWeight: 600, mr: 1 }}>
                      {code}
                    </Typography>
                    <Typography variant="body2" sx={{ color: "text.secondary" }} noWrap>
                      {acc?.name}
                    </Typography>
                  </li>
                );
              }}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPrintOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            disabled={printLoading}
            startIcon={printLoading ? <CircularProgress size={16} color="inherit" /> : <PrintIcon />}
            onClick={runPrintReport}
          >
            OK
          </Button>
        </DialogActions>
      </Dialog>

      {/* ---------- View Reports dialog ---------- */}
      <Dialog open={reportsOpen} onClose={() => setReportsOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          General Ledger Reports
          <IconButton size="small" onClick={() => setReportsOpen(false)}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </DialogTitle>
        <DialogContent dividers>
          <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" }, gap: 1.5 }}>
            {GL_REPORTS.map((r) => (
              <Paper
                key={r.key}
                variant="outlined"
                onClick={() => {
                  setReportsOpen(false);
                  router.push(r.href || `/portal/accounting/ledger?tab=${r.tab || r.key}`);
                }}
                sx={(t) => ({
                  p: 2,
                  borderRadius: 2,
                  cursor: "pointer",
                  transition: "border-color 120ms ease, background-color 120ms ease",
                  "&:hover": { borderColor: "primary.main", bgcolor: alpha(t.palette.primary.main, 0.05) },
                })}
              >
                <Typography variant="body1" sx={{ fontWeight: 700 }}>
                  {r.label}
                </Typography>
                <Typography variant="body2" sx={{ color: "text.secondary", mt: 0.5 }}>
                  {r.description}
                </Typography>
              </Paper>
            ))}
          </Box>
        </DialogContent>
      </Dialog>

    </Box>
  );
}

// =====================================================================
// GENERAL LEDGER paper document (legacy print, screenshot 2026-10-10):
// per-account sections with a BALANCE B/F row, Date / Reference / Remarks /
// X-Reference / Debit / Credit / Balance columns, SUB-TOTAL per account.
// Credit balances print in parentheses (docFmt).
// =====================================================================
const GL_GRID = "72px 95px 1fr 90px 95px 95px 100px";

function GlDocRow({
  cells,
  bold,
  topRule,
  bottomRule,
}: {
  cells: [string, string, string, string, string, string, string];
  bold?: boolean;
  topRule?: boolean;
  bottomRule?: boolean;
}) {
  return (
    <Box
      sx={{
        display: "grid",
        gridTemplateColumns: GL_GRID,
        columnGap: "6px",
        py: 0.2,
        fontSize: "0.75rem",
        fontWeight: bold ? 700 : 400,
        ...(topRule && { borderTop: "1px solid #000" }),
        ...(bottomRule && { borderBottom: "3px double #000" }),
      }}
    >
      <Box>{cells[0]}</Box>
      <Box>{cells[1]}</Box>
      <Box sx={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{cells[2]}</Box>
      <Box sx={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{cells[3]}</Box>
      <Box sx={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{cells[4]}</Box>
      <Box sx={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{cells[5]}</Box>
      <Box sx={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{cells[6]}</Box>
    </Box>
  );
}

function GeneralLedgerDocument({ doc, organization }: { doc: GlDoc; organization: any }) {
  return (
    <Box>
      <ReportHeader organization={organization} date={doc.toDate} title="GENERAL LEDGER" />

      {/* Filter meta lines, like the legacy print header */}
      <Box sx={{ display: "flex", gap: 4, fontSize: "0.8125rem" }}>
        <Box sx={{ flex: 1 }}>
          From Date : <Box component="span" sx={{ fontWeight: 600 }}>{formatShortDate(doc.fromDate || doc.toDate)}</Box>
        </Box>
        <Box sx={{ flex: 1 }}>
          To Date : <Box component="span" sx={{ fontWeight: 600 }}>{formatShortDate(doc.toDate)}</Box>
        </Box>
      </Box>
      <Box sx={{ display: "flex", gap: 4, fontSize: "0.8125rem", mb: 0.5 }}>
        <Box sx={{ flex: 1 }}>
          From Account : <Box component="span" sx={{ fontWeight: 600 }}>{doc.fromAccount}</Box>
        </Box>
        <Box sx={{ flex: 1 }}>
          To Account : <Box component="span" sx={{ fontWeight: 600 }}>{doc.toAccount}</Box>
        </Box>
        <Box>Page No : 1</Box>
      </Box>

      {/* Column header rule */}
      <Box sx={{ borderTop: "1px solid #000", borderBottom: "1px solid #000", py: 0.4, mb: 0.5 }}>
        <GlDocRow cells={["Date", "Reference", "Remarks", "X-Reference", "Debit", "Credit", "Balance"]} bold />
      </Box>

      {doc.groups.length === 0 && (
        <Box sx={{ py: 3, textAlign: "center", color: "#555" }}>No activity in this range.</Box>
      )}

      {doc.groups.map((g) => {
        const opening = g.openingBalance ?? 0;
        const subDebit = g.totalDebit + (opening > 0 ? opening : 0);
        const subCredit = g.totalCredit + (opening < 0 ? -opening : 0);
        const closing = g.closingBalance ?? 0;
        return (
          <Box key={g.accountId} sx={{ mb: 1.25, breakInside: "avoid" }}>
            <Box sx={{ display: "flex", gap: 2, fontSize: "0.8125rem", fontWeight: 700, py: 0.4 }}>
              <Box sx={{ width: 72 }}>{g.code}</Box>
              <Box>{g.name.toUpperCase()}</Box>
            </Box>
            {doc.fromDate && (
              <GlDocRow
                cells={[
                  formatShortDate(doc.fromDate),
                  "BALANCE B/F",
                  "BALANCE B/F",
                  "",
                  opening > 0 ? docFmt(opening) : "",
                  opening < 0 ? docFmt(-opening) : "",
                  docFmt(opening),
                ]}
              />
            )}
            {g.rows.map((r, i) => (
              <GlDocRow
                key={i}
                cells={[
                  formatShortDate(r.date),
                  r.reference || r.journalNumber || "",
                  r.description || "",
                  r.journalNumber || "",
                  r.debit ? docFmt(r.debit) : "",
                  r.credit ? docFmt(r.credit) : "",
                  docFmt(r.runningBalance),
                ]}
              />
            ))}
            <GlDocRow
              cells={["", "", "", "SUB-TOTAL", subDebit ? docFmt(subDebit) : "", subCredit ? docFmt(subCredit) : "", docFmt(closing)]}
              bold
              topRule
            />
          </Box>
        );
      })}
    </Box>
  );
}
