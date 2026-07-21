"use client";

// Accounts Receivable workspace — modern take on the legacy AR screen
// (guru, 2026-07-14): landing = per-customer balance list with money cards and
// a cut-off date; clicking a customer drills into their ledger (the legacy
// "Debtor Historical Listing": running-balance transactions for a period);
// every AR report is reachable from a "View Reports" dialog.

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Box,
  Button,
  CircularProgress,
  Dialog,
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
  Tooltip,
  Typography,
  alpha,
} from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import AssessmentOutlinedIcon from "@mui/icons-material/AssessmentOutlined";
import CloseIcon from "@mui/icons-material/Close";
import ReceiptLongOutlinedIcon from "@mui/icons-material/ReceiptLongOutlined";
import PostAddOutlinedIcon from "@mui/icons-material/PostAddOutlined";
import SearchIcon from "@mui/icons-material/Search";
import { toast } from "react-toastify";
import { useAccountingApi } from "./api";
import { useGetCustomers } from "@/app/portal/hooks/api";
import JournalEntryDialog from "./JournalEntryDialog";

const fmt = (n: number) =>
  (Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
// The statements endpoints return their own {success,data} envelope INSIDE the
// global response interceptor's envelope — useAccountingApi unwraps one layer,
// this peels the second when present.
const unwrap = (r: any) => (r && typeof r === "object" && r.success !== undefined && r.data !== undefined ? r.data : r);
const dmy = (d: any) => (d ? new Date(d).toLocaleDateString("en-GB") : "—");
const todayISO = () => new Date().toISOString().slice(0, 10);
const monthStartISO = (iso: string) => `${iso.slice(0, 7)}-01`;

// AR reports offered in the View Reports dialog — the LEGACY AR home's report
// set (screenshot 57), replacing the old Xero-flavoured list (guru 2026-07-20).
// `tab` keys must match the REPORTS registry in AccountingReportsView; `href`
// entries navigate elsewhere in the portal; `hint` entries just explain.
const AR_REPORTS: { key: string; label: string; description: string; tab?: string; href?: string; hint?: string }[] = [
  { key: "receipt-listing", label: "Receipt Listing", description: "Official receipts for a period, grouped by deposit-to bank account", tab: "receipt-listing" },
  { key: "journal", label: "Journal Voucher Listing", description: "Every posted journal with its balanced lines", tab: "journal" },
  { key: "debtor-statement", label: "Statement-Of-Accounts", description: "Legacy statement — open items, running balance and monthly ageing", tab: "debtor-statement" },
  { key: "summary-ageing", label: "Summary Ageing Analysis", description: "Outstanding per customer bucketed by calendar month, with contact info", tab: "summary-ageing" },
  { key: "detailed-ageing", label: "Detailed Ageing Analysis", description: "Every outstanding document per customer, aged by calendar month with running balance", tab: "detailed-ageing" },
  { key: "debtor-listing", label: "Debtor Listing", description: "Every debtor's balance as at a cut-off date — local and foreign amounts, DR/CR", tab: "debtor-listing" },
  { key: "historical-listing", label: "Historical Listing", description: "Per-debtor transaction history for a period with BALANCE B/F and sub-totals", tab: "historical-listing" },
];

type AgedRow = {
  contactId: string;
  contactName: string;
  buckets: number[];
  total: number;
  currency: string | null;
  foreignTotal: number | null;
};

type SoaTx = {
  date: string;
  reference: string;
  description: string;
  transactionType: string;
  debit: number;
  credit: number;
  balance: number;
};

export default function ARWorkspace() {
  const router = useRouter();
  const { request } = useAccountingApi();

  const [cutOff, setCutOff] = useState(todayISO());
  const [search, setSearch] = useState("");
  const [reportsOpen, setReportsOpen] = useState(false);
  const [selected, setSelected] = useState<{ id: string; name: string; code: string } | null>(null);
  // Legacy AR home's two primary actions (header buttons, Option A).
  const [jvOpen, setJvOpen] = useState(false);
  const [openingReceipt, setOpeningReceipt] = useState(false);
  // Bump to reload the landing data (e.g. after a receipt / JV is recorded).
  const [refreshKey, setRefreshKey] = useState(0);

  // ---------- landing data ----------
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<AgedRow[]>([]);
  const [grandTotal, setGrandTotal] = useState(0);
  const [overdue, setOverdue] = useState(0);
  const [sales, setSales] = useState(0);
  const [receipts, setReceipts] = useState(0);

  const { customers = [] } = useGetCustomers({ limit: 1000 });
  const codeById = useMemo(() => {
    const m = new Map<string, string>();
    (customers || []).forEach((c: any) => m.set(c.id, c.customerCode || ""));
    return m;
  }, [customers]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [agedRaw, invRepRaw, payments] = await Promise.all([
          request(`/statements/aged?side=receivable&asOf=${cutOff}&level=summary`),
          request(`/statements/invoice-report?side=receivable&from=${monthStartISO(cutOff)}&to=${cutOff}&level=summary`).catch(() => null),
          request(`/payments?limit=2000`).catch(() => null),
        ]);
        const aged = unwrap(agedRaw);
        const invRep = unwrap(invRepRaw);
        if (cancelled) return;
        const agedRows: AgedRow[] = aged?.rows || [];
        setRows(agedRows);
        setGrandTotal(Number(aged?.grandTotal) || 0);
        // Overdue = everything outside the "Current" bucket (index 0).
        setOverdue(agedRows.reduce((s, r) => s + r.total - (r.buckets?.[0] || 0), 0));
        setSales(Number(invRep?.totals?.gross) || 0);
        const payList: any[] = Array.isArray(payments) ? payments : payments?.docs || payments?.payments || [];
        const mStart = new Date(monthStartISO(cutOff));
        const mEnd = new Date(cutOff);
        mEnd.setHours(23, 59, 59, 999);
        setReceipts(
          payList.reduce((s, p) => {
            // Manual Offsets create cashless 'offset' payment rows — they
            // settle invoices but are NOT money received this month.
            if (p.paymentMethod === "offset") return s;
            const d = p.paymentDate ? new Date(p.paymentDate) : null;
            return d && d >= mStart && d <= mEnd ? s + (Number(p.amount) || 0) : s;
          }, 0)
        );
      } catch (e) {
        console.error("AR workspace load failed:", e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [request, cutOff, refreshKey]);

  const visibleRows = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter((r) =>
      [r.contactName, codeById.get(r.contactId)].some((v) => String(v ?? "").toLowerCase().includes(term))
    );
  }, [rows, search, codeById]);
  const visibleTotal = visibleRows.reduce((s, r) => s + r.total, 0);

  // ---------- drill-in (debtor ledger) ----------
  const [fromPeriod, setFromPeriod] = useState("");
  const [toPeriod, setToPeriod] = useState(todayISO());
  const [ledgerLoading, setLedgerLoading] = useState(false);
  const [ledger, setLedger] = useState<{ opening: number; txs: SoaTx[]; totalDebit: number; totalCredit: number; closing: number } | null>(null);

  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    (async () => {
      setLedgerLoading(true);
      try {
        const res = unwrap(
          await request(`/statements/soa`, {
            method: "POST",
            body: JSON.stringify({
              customerId: selected.id,
              ...(fromPeriod ? { startDate: fromPeriod } : {}),
              endDate: toPeriod,
              format: "json",
            }),
          })
        );
        if (cancelled) return;
        setLedger({
          opening: Number(res?.statement?.openingBalance) || 0,
          txs: res?.transactions || [],
          totalDebit: Number(res?.statement?.totalDebit) || 0,
          totalCredit: Number(res?.statement?.totalCredit) || 0,
          closing: Number(res?.statement?.currentBalance) || 0,
        });
      } catch (e) {
        console.error("Debtor ledger load failed:", e);
        if (!cancelled) setLedger(null);
      } finally {
        if (!cancelled) setLedgerLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [request, selected, fromPeriod, toPeriod]);

  // ---------- shared bits ----------
  const card = (label: string, value: number, tone?: string) => (
    <Paper variant="outlined" sx={{ p: 2, flex: 1, minWidth: 180, borderRadius: 2 }}>
      <Typography variant="caption" sx={{ color: "text.secondary", letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 700 }}>
        {label}
      </Typography>
      <Typography sx={{ fontFamily: "monospace", fontWeight: 700, fontSize: "1.25rem", mt: 0.5, color: tone || "text.primary" }}>
        {fmt(value)}
      </Typography>
    </Paper>
  );

  const headCellSx = { fontWeight: 700, fontSize: "0.7rem", letterSpacing: "0.08em", textTransform: "uppercase", color: "text.secondary" } as const;
  const monoRight = { fontFamily: "monospace", textAlign: "right" } as const;

  // =====================================================================
  // Drill-in: legacy "Debtor Historical Listing"
  // =====================================================================
  if (selected) {
    return (
      <Box sx={{ px: 3, py: 3, maxWidth: 1400, mx: "auto", width: "100%" }}>
        <Stack direction="row" alignItems="center" gap={1.5} sx={{ mb: 2, flexWrap: "wrap" }}>
          <IconButton onClick={() => setSelected(null)} size="small">
            <ArrowBackIcon />
          </IconButton>
          <Box sx={{ mr: 2 }}>
            <Typography variant="h6" sx={{ fontWeight: 700, lineHeight: 1.1 }}>
              {selected.name}
            </Typography>
            <Typography variant="caption" sx={{ color: "text.secondary", fontFamily: "monospace" }}>
              {selected.code || "—"}
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
            <Typography component="span" sx={{ fontFamily: "monospace", fontWeight: 700 }}>
              {fmt(ledger?.opening ?? 0)}
            </Typography>
          </Paper>
          <Button
            variant="outlined"
            startIcon={<ReceiptLongOutlinedIcon />}
            onClick={() => router.push(`/portal/accounting/receivables?tab=soa`)}
          >
            Statement of Accounts
          </Button>
        </Stack>

        {ledgerLoading ? (
          <Box sx={{ display: "flex", justifyContent: "center", p: 6 }}>
            <CircularProgress />
          </Box>
        ) : (
          <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 2, maxHeight: "62vh" }}>
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow>
                  <TableCell sx={headCellSx}>Reference</TableCell>
                  <TableCell sx={{ ...headCellSx, width: 110 }}>Date</TableCell>
                  <TableCell sx={headCellSx}>Remarks</TableCell>
                  <TableCell sx={{ ...headCellSx, textAlign: "right", width: 130 }}>Debit</TableCell>
                  <TableCell sx={{ ...headCellSx, textAlign: "right", width: 130 }}>Credit</TableCell>
                  <TableCell sx={{ ...headCellSx, textAlign: "right", width: 140 }}>Balance</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {(ledger?.txs || []).map((t, i) => (
                  <TableRow key={i} hover>
                    <TableCell sx={{ fontFamily: "monospace", fontWeight: 600 }}>{t.reference || "—"}</TableCell>
                    <TableCell sx={{ whiteSpace: "nowrap" }}>{dmy(t.date)}</TableCell>
                    <TableCell>{t.description || ""}</TableCell>
                    <TableCell sx={monoRight}>{t.debit ? fmt(t.debit) : ""}</TableCell>
                    <TableCell sx={monoRight}>{t.credit ? fmt(t.credit) : ""}</TableCell>
                    <TableCell sx={{ ...monoRight, fontWeight: 600 }}>{fmt(t.balance)}</TableCell>
                  </TableRow>
                ))}
                {(ledger?.txs || []).length === 0 && (
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
          {[
            { label: "Total Debit", value: ledger?.totalDebit ?? 0 },
            { label: "Total Credit", value: ledger?.totalCredit ?? 0 },
            { label: "Balance", value: ledger?.closing ?? 0 },
          ].map((x) => (
            <Box key={x.label} sx={{ textAlign: "right" }}>
              <Typography variant="caption" sx={{ color: "text.secondary", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                {x.label}
              </Typography>
              <Typography sx={{ fontFamily: "monospace", fontWeight: 700 }}>{fmt(x.value)}</Typography>
            </Box>
          ))}
        </Paper>
      </Box>
    );
  }

  // =====================================================================
  // Landing: customer balances
  // =====================================================================
  return (
    // Same page frame as the other accounting pages (e.g. Bills): padded and
    // width-capped instead of edge-to-edge.
    <Box sx={{ px: 3, py: 3, maxWidth: 1400, mx: "auto", width: "100%" }}>
      <Stack direction={{ xs: "column", md: "row" }} gap={1.5} sx={{ mb: 2 }}>
        {card("Sales (month)", sales)}
        {card("Receivables", grandTotal)}
        {card("Overdue", overdue, "error.main")}
        {card("Receipts (month)", receipts, "success.main")}
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
          placeholder="Locate by name or code…"
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
        <Typography variant="caption" sx={{ color: "text.secondary" }}>
          {visibleRows.length} of {rows.length} customers with balances
        </Typography>
        <Box sx={{ flex: 1 }} />
        {/* Legacy AR home's two primary actions, modernised into header buttons.
            Official Receipt opens the real document editor on the latest saved
            receipt (legacy behaviour), or a fresh OR-numbered shell when none. */}
        <Button
          variant="contained"
          startIcon={openingReceipt ? <CircularProgress size={16} color="inherit" /> : <ReceiptLongOutlinedIcon />}
          disabled={openingReceipt}
          onClick={async () => {
            setOpeningReceipt(true);
            try {
              const list: any[] = unwrap(await request(`/receipts`)) || [];
              let target = list.find((r: any) => r.customerId); // latest saved
              if (!target) {
                target = unwrap(await request(`/receipts`, { method: "POST", body: JSON.stringify({}) }));
              }
              if (target?.id) {
                router.push(`/portal/accounting/receipts/${target.id}?from=/portal/accounting/receivables`);
              }
            } catch (e: any) {
              toast.error(e?.message || "Couldn't open receipts");
              setOpeningReceipt(false);
            }
          }}
        >
          Official Receipt
        </Button>
        <Button variant="contained" startIcon={<PostAddOutlinedIcon />} onClick={() => setJvOpen(true)}>
          Journal Voucher
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
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell sx={{ ...headCellSx, width: 130 }}>Customer Code</TableCell>
                <TableCell sx={headCellSx}>Name</TableCell>
                <TableCell sx={{ ...headCellSx, textAlign: "right", width: 150 }}>Amount</TableCell>
                <TableCell sx={{ ...headCellSx, width: 70 }}>Curr</TableCell>
                <TableCell sx={{ ...headCellSx, textAlign: "right", width: 160 }}>Foreign Amount</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {visibleRows.map((r) => (
                <TableRow
                  key={r.contactId}
                  hover
                  onClick={() => {
                    setToPeriod(cutOff);
                    setSelected({ id: r.contactId, name: r.contactName, code: codeById.get(r.contactId) || "" });
                  }}
                  sx={{ cursor: "pointer" }}
                >
                  <TableCell sx={{ fontFamily: "monospace", fontWeight: 600 }}>{codeById.get(r.contactId) || "—"}</TableCell>
                  <TableCell>{r.contactName}</TableCell>
                  <TableCell sx={{ ...monoRight, fontWeight: 600 }}>{fmt(r.total)}</TableCell>
                  <TableCell>{r.currency || "SGD"}</TableCell>
                  <TableCell sx={monoRight}>{r.currency ? fmt(r.foreignTotal || 0) : fmt(r.total)}</TableCell>
                </TableRow>
              ))}
              {visibleRows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5}>
                    <Typography variant="body2" sx={{ color: "text.secondary", py: 2, textAlign: "center" }}>
                      No customers with outstanding balances{search ? " match the search" : ""}.
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
          Click a customer to view their transaction history
        </Typography>
        <Box sx={{ textAlign: "right" }}>
          <Typography variant="caption" sx={{ color: "text.secondary", textTransform: "uppercase", letterSpacing: "0.06em" }}>
            Total Receivables{search ? " (filtered)" : ""}
          </Typography>
          <Typography sx={{ fontFamily: "monospace", fontWeight: 700 }}>{fmt(search ? visibleTotal : grandTotal)}</Typography>
        </Box>
      </Paper>

      {/* ---------- View Reports dialog ---------- */}
      <Dialog open={reportsOpen} onClose={() => setReportsOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          Receivables Reports
          <IconButton size="small" onClick={() => setReportsOpen(false)}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </DialogTitle>
        <DialogContent dividers>
          <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" }, gap: 1.5 }}>
            {AR_REPORTS.map((r) => (
              <Paper
                key={r.key}
                variant="outlined"
                onClick={() => {
                  if (r.hint) {
                    toast.info(r.hint);
                    return;
                  }
                  setReportsOpen(false);
                  router.push(r.href || `/portal/accounting/receivables?tab=${r.tab || r.key}`);
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

      {/* ---------- Journal Voucher (manual journal entry) ---------- */}
      <JournalEntryDialog
        open={jvOpen}
        onClose={() => setJvOpen(false)}
        onCreated={() => {
          setJvOpen(false);
          setRefreshKey((k) => k + 1);
        }}
      />
    </Box>
  );
}
