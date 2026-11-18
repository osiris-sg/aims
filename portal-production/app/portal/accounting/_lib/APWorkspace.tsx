"use client";

// Accounts Payable workspace — AP twin of ARWorkspace (guru 2026-07-31,
// legacy AP screen): same table/cards/drill-in as AR, but the action buttons
// (Payment Voucher / Journal Voucher / Purchase Journal) and the report set
// (Payment Voucher Listing … Historical Listing) follow the legacy AP home.
// Reports arrive one-by-one from guru's screenshots — unbuilt ones show a
// hint instead of navigating.

import React, { useEffect, useMemo, useState, useRef } from "react";
import TableTotalsRow from "./TableTotalsRow";
import { useRouter, useSearchParams } from "next/navigation";
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
  useMediaQuery,
} from "@mui/material";
import AssessmentOutlinedIcon from "@mui/icons-material/AssessmentOutlined";
import CloseIcon from "@mui/icons-material/Close";
import ReceiptLongOutlinedIcon from "@mui/icons-material/ReceiptLongOutlined";
import PostAddOutlinedIcon from "@mui/icons-material/PostAddOutlined";
import MenuBookOutlinedIcon from "@mui/icons-material/MenuBookOutlined";
import SearchIcon from "@mui/icons-material/Search";
import CompareArrowsIcon from "@mui/icons-material/CompareArrows";
import ManualOffsetDialog from "@/containers/DocumentTemplates/components/ManualOffsetDialog";
import { toast } from "react-toastify";
import { useAccountingApi } from "./api";
import { clickableRowSx, sourceHref } from "./open-source";
import { useGetSuppliers } from "@/app/portal/hooks/api/useSuppliers";
import { useOrganization } from "@/app/portal/hooks/useOrganization";
import { useOrganizationFeatures } from "@/app/portal/hooks/useOrganizationFeatures";
import JournalEntryDialog from "./JournalEntryDialog";
import { todayIso } from "@/helpers/orgToday";
import { ReportPrintExportButton, type ReportExportModel } from "./report-export";
import { formatShortDate } from "./report-doc";
import { useOpenVoucher } from "./VoucherListPage";
import { onReportDate } from "./report-shell/reportDate";
import { FiscalYearButton } from "./report-shell/DateRangeSelect";
import DateInput from "@/components/DateInput";
import { useListKeyboardNav } from "@/helpers/useListKeyboardNav";

// Width of the action-button rail beside the AR / AP / GL home table.
const RAIL_WIDTH = 220;

const fmt = (n: number) =>
  (Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const unwrap = (r: any) => (r && typeof r === "object" && r.success !== undefined && r.data !== undefined ? r.data : r);
const dmy = (d: any) => (d ? new Date(d).toLocaleDateString("en-GB") : "—");
const todayISO = () => todayIso();
const monthStartISO = (iso: string) => `${iso.slice(0, 7)}-01`;
// The KPI cards read the YEAR to the cut-off (guru 2026-11-11: the GL home's
// Revenue is year-to-date, so Sales / Purchases / Receipts / Payments agree with it).
const yearStartISO = (iso: string) => `${iso.slice(0, 4)}-01-01`;

// Legacy AP home's report list (guru's screenshot 87). `tab` keys must match
// the REPORTS registry in AccountingReportsView; `hint` = not built yet.
const AP_REPORTS: { key: string; label: string; description: string; tab?: string; href?: string; hint?: string }[] = [
  // First report by guru's order (2026-08-01): the purchase journal IS the
  // bills list — link straight to the existing Bills page.
  { key: "purchase-journal-listing", label: "Purchase Journal Listing", description: "All supplier invoices (bills) — the purchase journal", href: "/portal/accounting/payables/purchase-journal" },
  { key: "pv-listing", label: "Payment Voucher Listing", description: "Payment vouchers for a period, grouped by paid-from bank account", tab: "pv-listing" },
  { key: "jv-listing", label: "Journal Voucher Listing", description: "Every journal line for a period — Unconfirmed and Confirmed vouchers", tab: "jv-listing" },
  { key: "creditor-statement", label: "Statement-Of-Accounts", description: "Legacy creditor statement — open items, running balance and monthly ageing", tab: "creditor-statement" },
  { key: "ap-summary-ageing", label: "Summary Ageing Analysis", description: "Outstanding per supplier bucketed by calendar month, with contact info", tab: "ap-summary-ageing" },
  { key: "ap-detailed-ageing", label: "Detailed Ageing Analysis", description: "Every outstanding document per supplier, aged by calendar month with running balance", tab: "ap-detailed-ageing" },
  { key: "creditor-listing", label: "Creditor Listing", description: "Every creditor's balance as at a cut-off date — local and foreign amounts, DR/CR", tab: "creditor-listing" },
  { key: "ap-historical-listing", label: "Historical Listing", description: "Per-creditor transaction history for a period with BALANCE B/F and sub-totals", tab: "ap-historical-listing" },
];

type AgedRow = {
  contactId: string;
  contactName: string;
  // Master-file code, resolved by the aged endpoint. The client-side lookup
  // below is only a fallback: it fetches the contact list with limit=1000,
  // which left every contact past the cap showing "—" (guru 2026-10-23).
  contactCode?: string | null;
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
  const openVoucher = useOpenVoucher();
  const { organization } = useOrganization();
  const { isPurchaseJournalGridEnabled, isDocumentListViewEnabled } = useOrganizationFeatures();
  // Phone: the creditor-ledger dialog goes full-screen below sm
  const phoneDialog = useMediaQuery((t: any) => t.breakpoints.down("sm"));

  const [cutOff, setCutOff] = useState(todayISO());
  const [search, setSearch] = useState("");
  const [reportsOpen, setReportsOpen] = useState(false);
  const [selected, setSelected] = useState<{ id: string; name: string; code: string } | null>(null);
  // Manual Offset from the ledger drawer (guru 2026-11-11, "right next to the
  // Statement of Accounts button"): offsets this party's open credits against
  // its open debits, then the ledger and balances reload.
  const [manualOffsetOpen, setManualOffsetOpen] = useState(false);
  const [ledgerTick, setLedgerTick] = useState(0);
  // Deep link back into the ledger (?contact=<id>&fromPeriod=&toPeriod=) —
  // set as ?from= on whatever a ledger row opened, so Back lands here with
  // the same contact drawer open (guru 2026-11-06).
  const searchParams = useSearchParams();
  const reopenedRef = useRef(false);
  const contactReturnPath = () => {
    const q = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
    if (selected) q.set("contact", selected.id);
    else q.delete("contact");
    if (fromPeriod) q.set("fromPeriod", fromPeriod);
    else q.delete("fromPeriod");
    q.set("toPeriod", toPeriod);
    return `${typeof window !== "undefined" ? window.location.pathname : "/portal/accounting/payables"}?${q.toString()}`;
  };
  const openLedgerRow = (t: any) => {
    const href = sourceHref(
      { documentId: t.docId || t.documentId || null, documentType: t.docTypeKey || null, templateId: t.templateId || null, journalEntryId: t.journalEntryId || null },
      contactReturnPath(),
    );
    if (href) router.push(href);
  };
  const [jvOpen, setJvOpen] = useState(false);
  // Journal Voucher = the legacy J/V document editor since 2026-11-09 (JournalEntryDialog stays mounted but unused).
  const [refreshKey, setRefreshKey] = useState(0);

  // ---------- landing data ----------
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<AgedRow[]>([]);
  // Contacts with unapplied credit notes (guru 2026-11-11): their row is
  // tinted so the user knows which one to click and offset.
  const [openCredits, setOpenCredits] = useState<Record<string, number>>({});
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
        const [agedRaw, creditsRaw, invRepRaw, payRaw] = await Promise.all([
          request(`/statements/aged?side=payable&asOf=${cutOff}&level=summary`),
          request(`/statements/open-credits?side=payable`).catch(() => null),
          // Same Purchases figure as the GL home's Cost Of Sales tile: the P&L's year-to-cut-off column.
          request(`/journal/reports/profit-loss?cutOffDate=${cutOff}&closingStock=0`).catch(() => null),
          request(`/bills/payments-listing?from=${yearStartISO(cutOff)}&to=${cutOff}`).catch(() => null),
        ]);
        const aged = unwrap(agedRaw);
        const pl = unwrap(invRepRaw);
        const ytd = (sec: any) => {
          const vals = sec?.subtotal?.values;
          return Array.isArray(vals) && vals.length ? Number(vals[vals.length - 1]) || 0 : 0;
        };
        const payList: any[] = unwrap(payRaw) || [];
        if (cancelled) return;
        const agedRows: AgedRow[] = aged?.rows || [];
        setRows(agedRows);
        const credits = unwrap(creditsRaw);
        setOpenCredits(credits && typeof credits === "object" ? credits : {});
        setGrandTotal(Number(aged?.grandTotal) || 0);
        setOverdue(agedRows.reduce((s, r) => s + r.total - (r.buckets?.[0] || 0), 0));
        setPurchases(ytd(pl?.cogs));
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
      [r.contactName, r.contactCode, codeById.get(r.contactId)].some((v) => String(v ?? "").toLowerCase().includes(term))
    );
  }, [rows, search, codeById]);
  const visibleTotal = visibleRows.reduce((s, r) => s + r.total, 0);

  // The home table printed as the legacy CREDITOR LISTING document (guru 2026-11-16).
  const homeExportModel = (): ReportExportModel => {
    const rows = visibleRows.map((r) => [
      r.contactCode || codeById.get(r.contactId) || "",
      r.contactName,
      fmt(r.total),
      r.currency || "SGD",
      r.currency ? fmt(r.foreignTotal || 0) : fmt(r.total),
    ]);
    rows.push(["TOTAL", search.trim() ? "(FILTERED)" : "", fmt(search ? visibleTotal : grandTotal), "", ""]);
    return {
      title: "Creditor Listing",
      orgName: organization?.name || "",
      metaLines: [`Cut-Off-Date : ${formatShortDate(cutOff)}`],
      tables: [{ headers: ["Supplier Code", "Name", "Amount", "Curr", "Foreign Amount"], rows, boldRows: [rows.length - 1] }],
    };
  };

  // ---------- drill-in (creditor ledger) ----------
  // From period opens on the FIRST OF THE MONTH of the cut-off (guru 2026-11-11), never blank.
  const [fromPeriod, setFromPeriod] = useState(() => monthStartISO(todayISO()));
  const [toPeriod, setToPeriod] = useState(todayISO());
  const [ledgerLoading, setLedgerLoading] = useState(false);
  const [ledger, setLedger] = useState<{ opening: number; txs: LedgerTx[]; totalDebit: number; totalCredit: number; closing: number } | null>(null);

  useEffect(() => {
    if (reopenedRef.current || !rows.length) return;
    const contactId = searchParams.get("contact");
    if (!contactId) return;
    const r = rows.find((x) => x.contactId === contactId);
    if (!r) return;
    reopenedRef.current = true;
    const f = searchParams.get("fromPeriod");
    const t = searchParams.get("toPeriod");
    if (f) setFromPeriod(f);
    if (t) setToPeriod(t);
    setSelected({ id: r.contactId, name: r.contactName, code: r.contactCode || codeById.get(r.contactId) || "" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, searchParams]);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request, selected, fromPeriod, toPeriod, ledgerTick]);

  // ---------- shared bits ----------
  const card = (label: string, value: number, tone?: string) => (
    <Paper variant="outlined" sx={{ p: 2, flex: 1, minWidth: 180, borderRadius: 2 }}>
      <Typography sx={{ color: "text.secondary", letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 700, fontSize: "0.9rem", lineHeight: 1.3 }}>
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
  // The balances table walks without the mouse too (guru 2026-11-18): keys
  // in the Locate box — or anywhere on the page while no dialog is open —
  // move the highlight; Enter opens the highlighted row's ledger.
  const openMainRow = (r: (typeof visibleRows)[number]) => {
    setFromPeriod(monthStartISO(cutOff));
    setToPeriod(cutOff);
    setSelected({ id: r.contactId, name: r.contactName, code: r.contactCode || codeById.get(r.contactId) || "" });
  };
  const mainNav = useListKeyboardNav(visibleRows, openMainRow);
  const mainNavKey = mainNav.handleKeyDown;
  useEffect(() => {
    if (selected) return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (document.querySelector('[role="dialog"]')) return;
      mainNavKey(e as unknown as React.KeyboardEvent);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [selected, mainNavKey]);

  // The ledger rows walk without the mouse (guru 2026-11-18): ↑↓ move the
  // highlight, Enter opens the line's document — keys typed into the period
  // boxes are left alone.
  const ledgerNavRows = ledger?.txs || [];
  const ledgerNav = useListKeyboardNav(ledgerNavRows, (t) => openLedgerRow(t));
  // Nothing in the dialog holds focus (no search box), so the keys are read
  // at document level while it is open.
  const ledgerNavKey = ledgerNav.handleKeyDown;
  useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      ledgerNavKey(e as unknown as React.KeyboardEvent);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [selected, ledgerNavKey]);
  const creditorDialog = (
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
                  {selected.code || "—"}
                </Typography>
              </Box>
              <DateInput
                size="small"
                label="From period"
                InputLabelProps={{ shrink: true }}
                value={fromPeriod}
                onChange={onReportDate(setFromPeriod, true)}
              />
              <DateInput
                size="small"
                label="To period"
                InputLabelProps={{ shrink: true }}
                value={toPeriod}
                onChange={onReportDate(setToPeriod, true)}
              />
              <FiscalYearButton from={fromPeriod} to={toPeriod} onPick={(f, t) => { setFromPeriod(f); setToPeriod(t); }} />
              <Box sx={{ flex: 1 }} />
              <Paper variant="outlined" sx={{ px: 1.5, py: 0.75, borderRadius: 2 }}>
                <Typography variant="caption" sx={{ color: "text.secondary", mr: 1 }}>
                  Balance B/F
                </Typography>
                <Typography component="span" sx={{ fontVariantNumeric: "tabular-nums", fontWeight: 700 }}>
                  {fmt(ledger?.opening ?? 0)}
                </Typography>
              </Paper>
              {/* Same spot as AR's Statement of Accounts button — deep-links into
                  the creditor SOA report with this supplier + period prefilled. */}
              <Button variant="outlined" startIcon={<CompareArrowsIcon />} onClick={() => setManualOffsetOpen(true)}>
                Manual Offset
              </Button>
              <Button
                variant="outlined"
                startIcon={<ReceiptLongOutlinedIcon />}
                onClick={() =>
                  router.push(
                    `/portal/accounting/payables?tab=creditor-statement&contactId=${selected.id}&asOf=${cutOff}`,
                  )
                }
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
                {/* Phone: ledger table scrolls inside its container */}
                <Table size="small" stickyHeader sx={[{ minWidth: 700 }, tightRowsSx]}>
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
                      <TableRow key={i} ref={ledgerNav.setRowRef(i)} hover selected={i === ledgerNav.activeIndex} onMouseEnter={() => ledgerNav.setActiveIndex(i)} sx={{ ...clickableRowSx, "&.Mui-selected, &.Mui-selected:hover": { bgcolor: "primary.main", "& .MuiTableCell-root": { color: "primary.contrastText" } } }} onClick={() => openLedgerRow(t)} title="Open the document behind this line">
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
                  <TableTotalsRow
                    note="Total"
                    noteColSpan={3}
                    cells={[
                      { label: "Total Debit", value: fmt(ledger?.totalDebit ?? 0) },
                      { label: "Total Credit", value: fmt(ledger?.totalCredit ?? 0) },
                      { label: "Balance", value: fmt(ledger?.closing ?? 0) },
                    ]}
                  />
                </Table>
              </TableContainer>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );

  // =====================================================================
  // Landing: supplier balances
  // =====================================================================
  return (
    <Box sx={{ px: { xs: 1.5, md: 3 }, py: 3, maxWidth: 1640, mx: "auto", width: "100%" }}>
      {/* KPI cards start at the table's left edge, like the filter row (guru 2026-11-16). */}
      <Stack direction={{ xs: "column", md: "row" }} gap={1.5} sx={{ mb: 2, pl: { xs: 0, md: `${RAIL_WIDTH + 16}px` } }}>
        {card("Purchases", purchases)}
        {card("Payables", grandTotal)}
        {card("Overdue", overdue, "error.main")}
        {card("Payments", payments, "success.main")}
      </Stack>

      {/* Filters row, indented by the rail's width so it starts at the table's
          left edge (guru 2026-11-16); the action buttons live in the rail. */}
      <Stack direction="row" gap={1.5} alignItems="center" sx={{ mb: 1.5, flexWrap: "wrap", pl: { xs: 0, md: `${RAIL_WIDTH + 16}px` } }}>
        <DateInput
          size="small"
          label="Cut-off date"
          InputLabelProps={{ shrink: true }}
          value={cutOff}
          onChange={onReportDate(setCutOff)}
        />
        <TextField
          size="small"
          placeholder="Locate by name or code…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={mainNav.handleKeyDown}
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
          {visibleRows.length} of {rows.length} suppliers with balances
        </Typography>
        <Box sx={{ flex: 1 }} />
        {/* Print / Export sits at the RIGHT end of the filter row, over the
            table's right edge (guru 2026-11-16). GL: the legacy TRIAL BALANCE
            as at the cut-off; AR / AP: the DEBTOR / CREDITOR LISTING. */}
        <ReportPrintExportButton size="medium" getModel={homeExportModel} />
      </Stack>

      {/* Action buttons stacked in a rail to the LEFT of the table, in its
          margin (guru 2026-11-16) — not a row above it. Phones: rail on top. */}
      <Box sx={{ display: "flex", flexDirection: { xs: "column", md: "row" }, gap: 2, alignItems: "flex-start" }}>
      <Stack gap={1} sx={{ width: { xs: "100%", md: RAIL_WIDTH }, flexShrink: 0, "& .MuiButton-root": { justifyContent: "flex-start", whiteSpace: "nowrap" } }}>
        {/* Legacy AP home's actions. No separate Payment Voucher action —
            paying is the Record Payment step on the Purchase Journal
            (guru 2026-08-01). */}
        {/* Payment Voucher — the legacy AP home's primary action, now a real
            document (AP twin of the Official Receipt, guru 2026-10-21). It and
            Journal Voucher follow enableDocumentListView (guru 2026-11-16):
            ON → the list; OFF → a fresh voucher opens straight away. */}
        <Button
          data-tour="ap-payment-voucher"
          data-hotkey="new"
          variant="contained"
          startIcon={<ReceiptLongOutlinedIcon />}
          onClick={() => void openVoucher("payment-voucher")}
        >
          Payment Voucher
        </Button>
        {/* Spend Money retired 2026-11-09: the Payment Voucher now takes direct
            GL lines (bank charges, fees) as well as supplier invoices. */}
        <Button variant="contained" startIcon={<PostAddOutlinedIcon />} onClick={() => void openVoucher("journal-voucher")}>
          Journal Voucher
        </Button>
        {/* Same rule as the PV and J/V buttons (guru 2026-11-18: "docs is
            document list view false → go to the document creating"):
            enableDocumentListView ON → the Purchase Journal LIST; OFF → straight
            into creating: the full-page Dr/Cr journal editor on the latest entry
            when enablePurchaseJournalGrid is on (Chong Aik, 2026-11-16), else
            the list with the New Supplier Invoice dialog already open (?new=1). */}
        <Button
          variant="contained"
          startIcon={<MenuBookOutlinedIcon />}
          onClick={() =>
            router.push(
              isDocumentListViewEnabled
                ? "/portal/accounting/payables/purchase-journal"
                : isPurchaseJournalGridEnabled
                ? `/portal/accounting/payables/purchase-journal/entry/latest?from=${encodeURIComponent("/portal/accounting/payables")}`
                : `/portal/accounting/payables/purchase-journal?new=1&from=${encodeURIComponent("/portal/accounting/payables")}`,
            )
          }
        >
          Purchase Journal
        </Button>
        <Button variant="outlined" startIcon={<AssessmentOutlinedIcon />} onClick={() => setReportsOpen(true)}>
          View Reports
        </Button>
      </Stack>
      <Box sx={{ flex: 1, minWidth: 0, width: "100%" }}>
      {loading ? (
        <Box sx={{ display: "flex", justifyContent: "center", p: 6 }}>
          <CircularProgress />
        </Box>
      ) : (
        <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 2, maxHeight: "58vh" }}>
          {/* Phone: balances table scrolls inside its container */}
          <Table size="small" stickyHeader sx={[{ minWidth: 700 }, tightRowsSx]}>
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
              {visibleRows.map((r, i) => (
                <TableRow
                  key={r.contactId}
                  ref={mainNav.setRowRef(i)}
                  hover
                  selected={i === mainNav.activeIndex}
                  onMouseEnter={() => mainNav.setActiveIndex(i)}
                  onClick={() => openMainRow(r)}
                  title={openCredits[r.contactId] ? `Credit notes to offset: ${fmt(openCredits[r.contactId])} — open the ledger and press Manual Offset` : undefined}
                  sx={(theme) => ({
                    cursor: "pointer",
                    "&.Mui-selected, &.Mui-selected:hover": { bgcolor: "primary.main", "& .MuiTableCell-root": { color: "primary.contrastText" } },
                    ...(openCredits[r.contactId]
                      ? {
                          bgcolor: alpha(theme.palette.warning.main, theme.palette.mode === "dark" ? 0.16 : 0.12),
                          "&:hover": { bgcolor: alpha(theme.palette.warning.main, theme.palette.mode === "dark" ? 0.24 : 0.2) },
                          "& > td:first-of-type": { boxShadow: `inset 3px 0 0 ${theme.palette.warning.main}` },
                        }
                      : {}),
                  })}
                >
                  <TableCell sx={{ fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>{r.contactCode || codeById.get(r.contactId) || "—"}</TableCell>
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
            <TableTotalsRow
              note="Click a supplier to view their transaction history"
              noteColSpan={2}
              cells={[
                { label: `Total Payables${search ? " (filtered)" : ""}`, value: fmt(search ? visibleTotal : grandTotal) },
                { colSpan: 2 },
              ]}
            />
          </Table>
        </TableContainer>
      )}

      </Box>
      </Box>

      {/* ---------- Creditor ledger dialog ---------- */}
      {creditorDialog}
      <ManualOffsetDialog
        open={manualOffsetOpen && !!selected}
        onClose={() => setManualOffsetOpen(false)}
        customer={selected ? { id: selected.id, name: selected.name, supplierCode: selected.code } : null}
        party="supplier"
        onSaved={() => {
          setLedgerTick((t) => t + 1);
          setRefreshKey((k) => k + 1);
        }}
      />

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
