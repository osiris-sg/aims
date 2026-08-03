"use client";

// Accounts Payable workspace — AP twin of ARWorkspace (guru 2026-07-31,
// legacy AP screen): same table/cards/drill-in as AR, but the action buttons
// (Payment Voucher / Journal Voucher / Purchase Journal) and the report set
// (Payment Voucher Listing … Historical Listing) follow the legacy AP home.
// Reports arrive one-by-one from guru's screenshots — unbuilt ones show a
// hint instead of navigating.

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
  Typography,
  alpha,
} from "@mui/material";
import AssessmentOutlinedIcon from "@mui/icons-material/AssessmentOutlined";
import CloseIcon from "@mui/icons-material/Close";
import ReceiptLongOutlinedIcon from "@mui/icons-material/ReceiptLongOutlined";
import PostAddOutlinedIcon from "@mui/icons-material/PostAddOutlined";
import MenuBookOutlinedIcon from "@mui/icons-material/MenuBookOutlined";
import SearchIcon from "@mui/icons-material/Search";
import { toast } from "react-toastify";
import { useAccountingApi } from "./api";
import { useGetSuppliers } from "@/app/portal/hooks/api/useSuppliers";
import JournalEntryDialog from "./JournalEntryDialog";

const fmt = (n: number) =>
  (Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const unwrap = (r: any) => (r && typeof r === "object" && r.success !== undefined && r.data !== undefined ? r.data : r);
const dmy = (d: any) => (d ? new Date(d).toLocaleDateString("en-GB") : "—");
const todayISO = () => new Date().toISOString().slice(0, 10);
const monthStartISO = (iso: string) => `${iso.slice(0, 7)}-01`;

// Legacy AP home's report list (guru's screenshot 87). `tab` keys must match
// the REPORTS registry in AccountingReportsView; `hint` = not built yet.
const AP_REPORTS: { key: string; label: string; description: string; tab?: string; href?: string; hint?: string }[] = [
  // First report by guru's order (2026-08-01): the purchase journal IS the
  // bills list — link straight to the existing Bills page.
  { key: "purchase-journal-listing", label: "Purchase Journal Listing", description: "All supplier invoices (bills) — the purchase journal", href: "/portal/accounting/payables/purchase-journal" },
  { key: "pv-listing", label: "Payment Voucher Listing", description: "Payment vouchers for a period, grouped by paid-from bank account", tab: "pv-listing" },
  { key: "jv-listing", label: "Journal Voucher Listing", description: "Every journal line for a period — Unconfirmed and Confirmed vouchers", tab: "jv-listing" },
  { key: "creditor-statement", label: "Statement-Of-Accounts", description: "Legacy creditor statement — open items, running balance and monthly ageing", hint: "Being built — guru's spec next" },
  { key: "ap-summary-ageing", label: "Summary Ageing Analysis", description: "Outstanding per supplier bucketed by calendar month, with contact info", hint: "Being built — guru's spec next" },
  { key: "ap-detailed-ageing", label: "Detailed Ageing Analysis", description: "Every outstanding document per supplier, aged by calendar month with running balance", hint: "Being built — guru's spec next" },
  { key: "creditor-listing", label: "Creditor Listing", description: "Every creditor's balance as at a cut-off date — local and foreign amounts, DR/CR", hint: "Being built — guru's spec next" },
  { key: "ap-historical-listing", label: "Historical Listing", description: "Per-creditor transaction history for a period with BALANCE B/F and sub-totals", hint: "Being built — guru's spec next" },
];

type AgedRow = {
  contactId: string;
  contactName: string;
  buckets: number[];
  total: number;
  currency: string | null;
  foreignTotal: number | null;
};

type LedgerTx = {
  date: string;
  reference?: string;
  description: string;
  debit: number;
  credit: number;
  balance: number;
};

export default function APWorkspace() {
  const router = useRouter();
  const { request } = useAccountingApi();

  const [cutOff, setCutOff] = useState(todayISO());
  const [search, setSearch] = useState("");
  const [reportsOpen, setReportsOpen] = useState(false);
  const [selected, setSelected] = useState<{ id: string; name: string; code: string } | null>(null);
  const [jvOpen, setJvOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  // ---------- landing data ----------
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<AgedRow[]>([]);
  const [grandTotal, setGrandTotal] = useState(0);
  const [overdue, setOverdue] = useState(0);
  const [purchases, setPurchases] = useState(0);
  const [payments, setPayments] = useState(0);

  const { suppliers = [] } = useGetSuppliers({ limit: 1000 });
  const codeById = useMemo(() => {
    const m = new Map<string, string>();
    (suppliers || []).forEach((s: any) => m.set(s.id, s.supplierCode || ""));
    return m;
  }, [suppliers]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [agedRaw, invRepRaw, payRaw] = await Promise.all([
          request(`/statements/aged?side=payable&asOf=${cutOff}&level=summary`),
          request(`/statements/invoice-report?side=payable&from=${monthStartISO(cutOff)}&to=${cutOff}&level=summary`).catch(() => null),
          request(`/bills/payments-listing?from=${monthStartISO(cutOff)}&to=${cutOff}`).catch(() => null),
        ]);
        const aged = unwrap(agedRaw);
        const invRep = unwrap(invRepRaw);
        const payList: any[] = unwrap(payRaw) || [];
        if (cancelled) return;
        const agedRows: AgedRow[] = aged?.rows || [];
        setRows(agedRows);
        setGrandTotal(Number(aged?.grandTotal) || 0);
        setOverdue(agedRows.reduce((s, r) => s + r.total - (r.buckets?.[0] || 0), 0));
        setPurchases(Number(invRep?.totals?.gross) || 0);
        setPayments((Array.isArray(payList) ? payList : []).reduce((s, p) => s + (Number(p.amount) || 0), 0));
      } catch (e) {
        console.error("AP workspace load failed:", e);
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

  // ---------- drill-in (creditor ledger) ----------
  const [fromPeriod, setFromPeriod] = useState("");
  const [toPeriod, setToPeriod] = useState(todayISO());
  const [ledgerLoading, setLedgerLoading] = useState(false);
  const [ledger, setLedger] = useState<{ opening: number; txs: LedgerTx[]; totalDebit: number; totalCredit: number; closing: number } | null>(null);

  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    (async () => {
      setLedgerLoading(true);
      try {
        const res = unwrap(
          await request(`/statements/supplier-soa`, {
            method: "POST",
            body: JSON.stringify({
              supplierId: selected.id,
              ...(fromPeriod ? { startDate: fromPeriod } : {}),
              endDate: toPeriod,
              includeAging: false,
            }),
          })
        );
        if (cancelled) return;
        setLedger({
          opening: Number(res?.summary?.openingBalance) || 0,
          txs: res?.transactions || [],
          totalDebit: Number(res?.summary?.totalDebit) || 0,
          totalCredit: Number(res?.summary?.totalCredit) || 0,
          closing: Number(res?.summary?.closingBalance) || 0,
        });
      } catch (e) {
        console.error("Creditor ledger load failed:", e);
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
      <Typography sx={{ fontVariantNumeric: "tabular-nums", fontWeight: 700, fontSize: "1.25rem", mt: 0.5, color: tone || "text.primary" }}>
        {fmt(value)}
      </Typography>
    </Paper>
  );

  const headCellSx = { fontWeight: 700, fontSize: "0.7rem", letterSpacing: "0.08em", textTransform: "uppercase", color: "text.secondary" } as const;
  const monoRight = { fontVariantNumeric: "tabular-nums", textAlign: "right" } as const;
  const tightRowsSx = (t: any) => ({
    "& tbody td": {
      py: 0.5,
      borderBottom: `1px solid ${t.palette.mode === "dark" ? "rgba(255,255,255,0.32)" : "rgba(0,0,0,0.32)"}`,
    },
  });

  // =====================================================================
  // Drill-in: creditor transaction history (large dialog, like AR)
  // =====================================================================
  const creditorDialog = (
    <Dialog open={!!selected} onClose={() => setSelected(null)} fullWidth maxWidth="lg">
      <DialogContent sx={{ p: 3 }}>
        {selected && (
          <>
            <Stack direction="row" alignItems="center" gap={1.5} sx={{ mb: 2, flexWrap: "wrap" }}>
              <Box sx={{ mr: 2 }}>
                <Typography variant="h6" sx={{ fontWeight: 700, lineHeight: 1.1 }}>
                  {selected.name}
                </Typography>
                <Typography variant="caption" sx={{ color: "text.secondary", fontVariantNumeric: "tabular-nums" }}>
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
                <Typography component="span" sx={{ fontVariantNumeric: "tabular-nums", fontWeight: 700 }}>
                  {fmt(ledger?.opening ?? 0)}
                </Typography>
              </Paper>
              {/* Same spot as AR's Statement of Accounts button; deep-links into
                  the creditor SOA report once that report is built. */}
              <Button
                variant="outlined"
                startIcon={<ReceiptLongOutlinedIcon />}
                onClick={() => toast.info("Creditor Statement-Of-Accounts report is being built — guru's spec next")}
              >
                Statement of Accounts
              </Button>
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
                <Table size="small" stickyHeader sx={tightRowsSx}>
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
                        <TableCell sx={{ fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>{(t as any).reference || (t as any).billNumber || "—"}</TableCell>
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
                  <Typography sx={{ fontVariantNumeric: "tabular-nums", fontWeight: 700 }}>{fmt(x.value)}</Typography>
                </Box>
              ))}
            </Paper>
          </>
        )}
      </DialogContent>
    </Dialog>
  );

  // =====================================================================
  // Landing: supplier balances
  // =====================================================================
  return (
    <Box sx={{ px: 3, py: 3, maxWidth: 1400, mx: "auto", width: "100%" }}>
      <Stack direction={{ xs: "column", md: "row" }} gap={1.5} sx={{ mb: 2 }}>
        {card("Purchases (month)", purchases)}
        {card("Payables", grandTotal)}
        {card("Overdue", overdue, "error.main")}
        {card("Payments (month)", payments, "success.main")}
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
          {visibleRows.length} of {rows.length} suppliers with balances
        </Typography>
        <Box sx={{ flex: 1 }} />
        {/* Legacy AP home's actions. No separate Payment Voucher action —
            paying is the Record Payment step on the Purchase Journal
            (guru 2026-08-01). */}
        <Button variant="contained" startIcon={<PostAddOutlinedIcon />} onClick={() => setJvOpen(true)}>
          Journal Voucher
        </Button>
        <Button
          variant="contained"
          startIcon={<MenuBookOutlinedIcon />}
          onClick={() => router.push("/portal/accounting/payables/purchase-journal?new=1")}
        >
          Purchase Journal
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
          <Table size="small" stickyHeader sx={tightRowsSx}>
            <TableHead>
              <TableRow>
                <TableCell sx={{ ...headCellSx, width: 130 }}>Supplier Code</TableCell>
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
                  <TableCell sx={{ fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>{codeById.get(r.contactId) || "—"}</TableCell>
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
                      No suppliers with outstanding balances{search ? " match the search" : ""}.
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
          Click a supplier to view their transaction history
        </Typography>
        <Box sx={{ textAlign: "right" }}>
          <Typography variant="caption" sx={{ color: "text.secondary", textTransform: "uppercase", letterSpacing: "0.06em" }}>
            Total Payables{search ? " (filtered)" : ""}
          </Typography>
          <Typography sx={{ fontVariantNumeric: "tabular-nums", fontWeight: 700 }}>{fmt(search ? visibleTotal : grandTotal)}</Typography>
        </Box>
      </Paper>

      {/* ---------- Creditor ledger dialog ---------- */}
      {creditorDialog}

      {/* ---------- View Reports dialog ---------- */}
      <Dialog open={reportsOpen} onClose={() => setReportsOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          Payables Reports
          <IconButton size="small" onClick={() => setReportsOpen(false)}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </DialogTitle>
        <DialogContent dividers>
          <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" }, gap: 1.5 }}>
            {AP_REPORTS.map((r) => (
              <Paper
                key={r.key}
                variant="outlined"
                onClick={() => {
                  if (r.hint) {
                    toast.info(r.hint);
                    return;
                  }
                  setReportsOpen(false);
                  router.push(r.href || `/portal/accounting/payables?tab=${r.tab || r.key}`);
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
