"use client";

// Accounts Receivable workspace — modern take on the legacy AR screen
// (guru, 2026-07-14): landing = per-customer balance list with money cards and
// a cut-off date; clicking a customer drills into their ledger (the legacy
// "Debtor Historical Listing": running-balance transactions for a period);
// every AR report is reachable from a "View Reports" dialog.

import React, { useEffect, useMemo, useState, useRef } from "react";
import TableTotalsRow from "./TableTotalsRow";
import { useRouter, useSearchParams } from "next/navigation";
import { useOrganizationFeatures } from "@/app/portal/hooks/useOrganizationFeatures";
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
  useMediaQuery,
} from "@mui/material";
import AssessmentOutlinedIcon from "@mui/icons-material/AssessmentOutlined";
import CloseIcon from "@mui/icons-material/Close";
import ReceiptLongOutlinedIcon from "@mui/icons-material/ReceiptLongOutlined";
import PostAddOutlinedIcon from "@mui/icons-material/PostAddOutlined";
import AccountBalanceWalletOutlinedIcon from "@mui/icons-material/AccountBalanceWalletOutlined";
import SearchIcon from "@mui/icons-material/Search";
import CompareArrowsIcon from "@mui/icons-material/CompareArrows";
import ManualOffsetDialog from "@/containers/DocumentTemplates/components/ManualOffsetDialog";
import { toast } from "react-toastify";
import { useAccountingApi } from "./api";
import { clickableRowSx, sourceHref } from "./open-source";
import { useCustomersByIds } from "@/app/portal/hooks/api/useCustomerPicker";
import { useOrganization } from "@/app/portal/hooks/useOrganization";
import JournalEntryDialog from "./JournalEntryDialog";
import { todayIso } from "@/helpers/orgToday";
import { ReportPrintExportButton, type ReportExportModel } from "./report-export";
import { formatShortDate } from "./report-doc";
import { useOpenVoucher } from "./VoucherListPage";
import { onReportDate } from "./report-shell/reportDate";

// Width of the action-button rail beside the AR / AP / GL home table.
const RAIL_WIDTH = 220;

const fmt = (n: number) =>
  (Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
// The statements endpoints return their own {success,data} envelope INSIDE the
// global response interceptor's envelope — useAccountingApi unwraps one layer,
// this peels the second when present.
const unwrap = (r: any) => (r && typeof r === "object" && r.success !== undefined && r.data !== undefined ? r.data : r);
const dmy = (d: any) => (d ? new Date(d).toLocaleDateString("en-GB") : "—");
const todayISO = () => todayIso();
const monthStartISO = (iso: string) => `${iso.slice(0, 7)}-01`;
// The KPI cards read the YEAR to the cut-off (guru 2026-11-11: the GL home's
// Revenue is year-to-date, so Sales / Purchases / Receipts / Payments agree with it).
const yearStartISO = (iso: string) => `${iso.slice(0, 4)}-01-01`;

// AR reports offered in the View Reports dialog — the LEGACY AR home's report
// set (screenshot 57), replacing the old Xero-flavoured list (guru 2026-07-20).
// `tab` keys must match the REPORTS registry in AccountingReportsView; `href`
// entries navigate elsewhere in the portal; `hint` entries just explain.
const AR_REPORTS: { key: string; label: string; description: string; tab?: string; href?: string; hint?: string }[] = [
  { key: "receipt-listing", label: "Receipt Listing", description: "Official receipts for a period, grouped by deposit-to bank account", tab: "receipt-listing" },
  { key: "jv-listing", label: "Journal Voucher Listing", description: "Every journal line for a period — Unconfirmed and Confirmed vouchers", tab: "jv-listing" },
  { key: "debtor-statement", label: "Statement-Of-Accounts", description: "Legacy statement — open items, running balance and monthly ageing", tab: "debtor-statement" },
  { key: "summary-ageing", label: "Summary Ageing Analysis", description: "Outstanding per customer bucketed by calendar month, with contact info", tab: "summary-ageing" },
  { key: "detailed-ageing", label: "Detailed Ageing Analysis", description: "Every outstanding document per customer, aged by calendar month with running balance", tab: "detailed-ageing" },
  { key: "debtor-listing", label: "Debtor Listing", description: "Every debtor's balance as at a cut-off date — local and foreign amounts, DR/CR", tab: "debtor-listing" },
  { key: "historical-listing", label: "Historical Listing", description: "Per-debtor transaction history for a period with BALANCE B/F and sub-totals", tab: "historical-listing" },
  // Restored 2026-09-30: the AR home replaced the report directory, which
  // left Recurring Invoices reachable only by a ?tab= deep link, so it
  // belongs on this dialog.
  { key: "recurring-invoices", label: "Recurring Invoices", description: "Scheduled customer invoices — drafts for review or fully automatic", tab: "recurring-invoices" },
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
  const { isSpendMoneyEnabled } = useOrganizationFeatures();
  const { request } = useAccountingApi();
  const openVoucher = useOpenVoucher();
  const { organization } = useOrganization();
  // Phone: the debtor-ledger dialog goes full-screen below sm
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
    return `${typeof window !== "undefined" ? window.location.pathname : "/portal/accounting/receivables"}?${q.toString()}`;
  };
  const openLedgerRow = (t: any) => {
    const href = sourceHref(
      { documentId: t.docId || t.documentId || null, documentType: t.docTypeKey || null, templateId: t.templateId || null, journalEntryId: t.journalEntryId || null },
      contactReturnPath(),
    );
    if (href) router.push(href);
  };
  // Legacy AR home's two primary actions (header buttons, Option A).
  const [jvOpen, setJvOpen] = useState(false);
  // Journal Voucher = the legacy J/V document editor since 2026-11-09 (JournalEntryDialog stays mounted but unused).
  // Bump to reload the landing data (e.g. after a receipt / JV is recorded).
  const [refreshKey, setRefreshKey] = useState(0);

  // ---------- landing data ----------
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<AgedRow[]>([]);
  // Contacts with unapplied credit notes (guru 2026-11-11): their row is
  // tinted so the user knows which one to click and offset.
  const [openCredits, setOpenCredits] = useState<Record<string, number>>({});
  const [grandTotal, setGrandTotal] = useState(0);
  const [overdue, setOverdue] = useState(0);
  const [sales, setSales] = useState(0);
  const [receipts, setReceipts] = useState(0);

  // Codes for the customers on screen (rows without contactCode), by id —
  // never a capped "first 1000 customers" list.
  const { byId: customersById } = useCustomersByIds(rows.filter((r) => !r.contactCode).map((r) => r.contactId));
  const codeById = useMemo(() => {
    const m = new Map<string, string>();
    customersById.forEach((c, id) => m.set(id, c.customerCode || ""));
    return m;
  }, [customersById]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [agedRaw, creditsRaw, invRepRaw, payments] = await Promise.all([
          request(`/statements/aged?side=receivable&asOf=${cutOff}&level=summary`),
          request(`/statements/open-credits?side=receivable`).catch(() => null),
          // Same Sales figure as the GL home's Revenue tile: the P&L's year-to-cut-off column.
          request(`/journal/reports/profit-loss?cutOffDate=${cutOff}&closingStock=0`).catch(() => null),
          request(`/payments/total?startDate=${yearStartISO(cutOff)}&endDate=${cutOff}`).catch(() => null),
        ]);
        const aged = unwrap(agedRaw);
        const pl = unwrap(invRepRaw);
        const ytd = (sec: any) => {
          const vals = sec?.subtotal?.values;
          return Array.isArray(vals) && vals.length ? Number(vals[vals.length - 1]) || 0 : 0;
        };
        if (cancelled) return;
        const agedRows: AgedRow[] = aged?.rows || [];
        setRows(agedRows);
        const credits = unwrap(creditsRaw);
        setOpenCredits(credits && typeof credits === "object" ? credits : {});
        setGrandTotal(Number(aged?.grandTotal) || 0);
        // Overdue = everything outside the "Current" bucket (index 0).
        setOverdue(agedRows.reduce((s, r) => s + r.total - (r.buckets?.[0] || 0), 0));
        setSales(ytd(pl?.sales));
        // Money received this year to the cut-off, summed on the server
        // (cashless manual offsets excluded there).
        setReceipts(Number(unwrap(payments)?.total) || 0);
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
      [r.contactName, r.contactCode, codeById.get(r.contactId)].some((v) => String(v ?? "").toLowerCase().includes(term))
    );
  }, [rows, search, codeById]);
  const visibleTotal = visibleRows.reduce((s, r) => s + r.total, 0);

  // The home table printed as the legacy DEBTOR LISTING document (guru 2026-11-16).
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
      title: "Debtor Listing",
      orgName: organization?.name || "",
      metaLines: [`Cut-Off-Date : ${formatShortDate(cutOff)}`],
      tables: [{ headers: ["Customer Code", "Name", "Amount", "Curr", "Foreign Amount"], rows, boldRows: [rows.length - 1] }],
    };
  };

  // ---------- drill-in (debtor ledger) ----------
  // From period opens on the FIRST OF THE MONTH of the cut-off (guru 2026-11-11), never blank.
  const [fromPeriod, setFromPeriod] = useState(() => monthStartISO(todayISO()));
  const [toPeriod, setToPeriod] = useState(todayISO());
  const [ledgerLoading, setLedgerLoading] = useState(false);
  const [ledger, setLedger] = useState<{ opening: number; txs: SoaTx[]; totalDebit: number; totalCredit: number; closing: number } | null>(null);

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

  // =====================================================================
  // Drill-in: legacy "Debtor Historical Listing"
  // =====================================================================
  // Debtor ledger — opens as a LARGE DIALOG over the balances list instead of
  // swapping the page away (guru 2026-07-31).
  const debtorDialog = (
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
          <TextField
            size="small"
            type="date"
            label="From period"
            InputLabelProps={{ shrink: true }}
            value={fromPeriod}
            onChange={onReportDate(setFromPeriod, true)}
          />
          <TextField
            size="small"
            type="date"
            label="To period"
            InputLabelProps={{ shrink: true }}
            value={toPeriod}
            onChange={onReportDate(setToPeriod, true)}
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
          <Button variant="outlined" startIcon={<CompareArrowsIcon />} onClick={() => setManualOffsetOpen(true)}>
            Manual Offset
          </Button>
          <Button
            variant="outlined"
            startIcon={<ReceiptLongOutlinedIcon />}
            // Deep-link into the legacy Statement-Of-Accounts report with this
            // customer + period prefilled and auto-loaded (guru 2026-07-31).
            onClick={() =>
              router.push(
                `/portal/accounting/receivables?tab=debtor-statement&contactId=${selected.id}&asOf=${toPeriod}`
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
                  <TableCell sx={headCellSx}>Remarks</TableCell>
                  <TableCell sx={{ ...headCellSx, textAlign: "right", width: 130 }}>Debit</TableCell>
                  <TableCell sx={{ ...headCellSx, textAlign: "right", width: 130 }}>Credit</TableCell>
                  <TableCell sx={{ ...headCellSx, textAlign: "right", width: 140 }}>Balance</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {(ledger?.txs || []).map((t, i) => (
                  <TableRow key={i} hover sx={clickableRowSx} onClick={() => openLedgerRow(t)} title="Open the document behind this line">
                    <TableCell sx={{ fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>{t.reference || "—"}</TableCell>
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
  // Landing: customer balances
  // =====================================================================
  return (
    // Same page frame as the other accounting pages (e.g. Bills): padded and
    // width-capped instead of edge-to-edge.
    <Box sx={{ px: { xs: 1.5, md: 3 }, py: 3, maxWidth: 1640, mx: "auto", width: "100%" }}>
      {/* KPI cards start at the table's left edge, like the filter row (guru 2026-11-16). */}
      <Stack direction={{ xs: "column", md: "row" }} gap={1.5} sx={{ mb: 2, pl: { xs: 0, md: `${RAIL_WIDTH + 16}px` } }}>
        {card("Sales", sales)}
        {card("Receivables", grandTotal)}
        {card("Overdue", overdue, "error.main")}
        {card("Receipts", receipts, "success.main")}
      </Stack>

      {/* Filters row, indented by the rail's width so it starts at the table's
          left edge (guru 2026-11-16); the action buttons live in the rail. */}
      <Stack direction="row" gap={1.5} alignItems="center" sx={{ mb: 1.5, flexWrap: "wrap", pl: { xs: 0, md: `${RAIL_WIDTH + 16}px` } }}>
        <TextField
          size="small"
          type="date"
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
          {visibleRows.length} of {rows.length} customers with balances
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
        {/* Legacy AR home's two primary actions, modernised into header buttons.
            Official Receipt / Journal Voucher follow enableDocumentListView
            (guru 2026-11-16): ON → the list; OFF → a fresh voucher opens. */}
        <Button
          data-tour="ar-official-receipt"
          data-hotkey="new"
          variant="contained"
          startIcon={<ReceiptLongOutlinedIcon />}
          onClick={() => void openVoucher("receipt")}
        >
          Official Receipt
        </Button>
        {/* Receive Money (enableSpendMoney): money in with NO customer invoice
            behind it — interest, a refund, a grant. */}
        {isSpendMoneyEnabled && (
          <Button
            data-tour="ar-receive-money"
            variant="contained"
            startIcon={<AccountBalanceWalletOutlinedIcon />}
            onClick={() => router.push("/portal/accounting/receivables?tab=receive-money&new=1")}
          >
            Receive Money
          </Button>
        )}
        <Button variant="contained" startIcon={<PostAddOutlinedIcon />} onClick={() => void openVoucher("journal-voucher")}>
          Journal Voucher
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
          {/* Tight rows + dashed separators (guru 2026-07-28). */}
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
                    setFromPeriod(monthStartISO(cutOff));
                    setToPeriod(cutOff);
                    setSelected({ id: r.contactId, name: r.contactName, code: r.contactCode || codeById.get(r.contactId) || "" });
                  }}
                  title={openCredits[r.contactId] ? `Credit notes to offset: ${fmt(openCredits[r.contactId])} — open the ledger and press Manual Offset` : undefined}
                  sx={(theme) => ({
                    cursor: "pointer",
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
                      No customers with outstanding balances{search ? " match the search" : ""}.
                    </Typography>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
            <TableTotalsRow
              note="Click a customer to view their transaction history"
              noteColSpan={2}
              cells={[
                { label: `Total Receivables${search ? " (filtered)" : ""}`, value: fmt(search ? visibleTotal : grandTotal) },
                { colSpan: 2 },
              ]}
            />
          </Table>
        </TableContainer>
      )}

      </Box>
      </Box>

      {/* ---------- Debtor ledger dialog ---------- */}
      {debtorDialog}
      <ManualOffsetDialog
        open={manualOffsetOpen && !!selected}
        onClose={() => setManualOffsetOpen(false)}
        customer={selected ? { id: selected.id, name: selected.name, customerCode: selected.code } : null}
        onSaved={() => {
          setLedgerTick((t) => t + 1);
          setRefreshKey((k) => k + 1);
        }}
      />

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
