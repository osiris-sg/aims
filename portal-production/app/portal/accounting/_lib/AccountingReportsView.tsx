"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import {
  Box,
  Button,
  Card,
  CardActionArea,
  CircularProgress,
  IconButton,
  InputAdornment,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import { useRouter, useSearchParams } from "next/navigation";
import SearchIcon from "@mui/icons-material/Search";
import StarIcon from "@mui/icons-material/Star";
import StarBorderIcon from "@mui/icons-material/StarBorder";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import { useOrganization } from "@/app/portal/hooks/useOrganization";
import { useOrganizationFeatures } from "@/app/portal/hooks/useOrganizationFeatures";

import CashFlowPage from "../cash-flow/page";
import BudgetVsActualPage from "../budget-vs-actual/page";
import InvoicesPage from "../../invoices/page";
import ARWorkspace from "./ARWorkspace";
import BillsPage from "../bills/page";
import BankReconciliationPage from "../bank-reconciliation/page";
import StatementOfAccountPage from "../../reports/statement-of-account/page";
import FixedAssetsPage from "../fixed-assets/page";
import RecurringPage from "../recurring/page";
import RecurringInvoicesView from "../recurring-invoices/RecurringInvoicesView";
import {
  AgedReceivablesSummary, AgedReceivablesDetail, AgedPayablesSummary, AgedPayablesDetail,
  ReceivableInvoices, ReceivableInvoiceDetail, PayableInvoices, PayableInvoiceDetail,
  ContactTransactionsSummary, IncomeExpensesByContact, DebtorStatement, AuditTrail, ReceiptListing, SummaryAgeing, DetailedAgeing, DebtorListing, HistoricalListing,
  GeneralLedgerDetail, GeneralLedgerSummary,
  AccountTransactions, ExpenseListing, TrialBalanceReport, JournalReport, BankSummary,
  ProfitLoss, BalanceSheet, ForeignBankListing, GSTReturn,
} from "./report-shell/entries";
import SupplierStatementPage from "../supplier-statement/page";
import SalesByCustomerPage from "../sales-by-customer/page";
import PurchasesBySupplierPage from "../purchases-by-supplier/page";

export type ReportCategory =
  | "Receivables"
  | "Payables"
  | "Ledger"
  | "Financial"
  | "Tax & Compliance"
  | "Assets & Other";

interface ReportEntry {
  key: string;
  label: string;
  description: string;
  category: ReportCategory;
  Component: React.ComponentType;
}

// Single source of truth for every accounting report. Keep `key` stable — it's
// used in the ?tab= URL param and in the favourites store. The sidebar splits
// these categories across separate section pages (General Ledger / AR / AP /
// Reports), but every section can deep-link to ANY report via ?tab= because the
// active-report lookup below scans this full list.
export const REPORTS: ReportEntry[] = [
  // Receivables
  // AR landing = customer-balance workspace (legacy AR screen, modern UI —
  // guru 2026-07-14); the invoice list stays reachable as "ar-invoices".
  { key: "ar", label: "Accounts Receivable", description: "Customer balances with drill-down transaction history", category: "Receivables", Component: ARWorkspace },
  { key: "ar-invoices", label: "Invoice List", description: "All invoices with payment status, tabs and quick payment recording", category: "Receivables", Component: InvoicesPage },
  { key: "ar-aging", label: "Aged Receivables Summary", description: "Outstanding invoices per customer, bucketed by age", category: "Receivables", Component: AgedReceivablesSummary },
  { key: "ar-aging-detail", label: "Aged Receivables Detail", description: "Every outstanding invoice, aged and grouped by customer", category: "Receivables", Component: AgedReceivablesDetail },
  { key: "receivable-invoices", label: "Receivable Invoice Summary", description: "Invoices for a period — gross, payments and balance per customer", category: "Receivables", Component: ReceivableInvoices },
  { key: "receivable-invoice-detail", label: "Receivable Invoice Detail", description: "Every invoice line item for a period, grouped by customer", category: "Receivables", Component: ReceivableInvoiceDetail },
  { key: "soa", label: "Customer Statement", description: "Per-customer statement of account", category: "Receivables", Component: StatementOfAccountPage },
  { key: "debtor-statement", label: "Debtor Statement", description: "Legacy statement-of-account — open items, running balance and monthly ageing", category: "Receivables", Component: DebtorStatement },
  { key: "receipt-listing", label: "Receipts Listing", description: "Official receipts for a period, grouped by deposit-to bank account", category: "Receivables", Component: ReceiptListing },
  { key: "summary-ageing", label: "Summary Ageing Analysis", description: "Outstanding per customer bucketed by calendar month, with customer contact info", category: "Receivables", Component: SummaryAgeing },
  { key: "detailed-ageing", label: "Detailed Ageing Analysis", description: "Every outstanding document per customer, aged by calendar month with running balance", category: "Receivables", Component: DetailedAgeing },
  { key: "debtor-listing", label: "Debtor Listing", description: "Every debtor's balance as at a cut-off date — local and foreign amounts, DR/CR", category: "Receivables", Component: DebtorListing },
  { key: "historical-listing", label: "Historical Listing", description: "Per-debtor transaction history for a period with BALANCE B/F and sub-totals", category: "Receivables", Component: HistoricalListing },
  { key: "sbc", label: "Sales by Customer", description: "Revenue breakdown by customer", category: "Receivables", Component: SalesByCustomerPage },
  { key: "contact-transactions", label: "Contact Transactions", description: "Opening, movement and closing balance for one contact", category: "Receivables", Component: ContactTransactionsSummary },
  { key: "income-expense-by-contact", label: "Income and Expenses by Contact", description: "Per-contact income and spend across comparison months", category: "Receivables", Component: IncomeExpensesByContact },
  { key: "recurring-invoices", label: "Recurring Invoices", description: "Scheduled customer invoices — drafts for review or fully automatic", category: "Receivables", Component: RecurringInvoicesView },

  // Payables
  { key: "ap", label: "Accounts Payable", description: "Bills owed to suppliers", category: "Payables", Component: BillsPage },
  { key: "ap-aging", label: "Aged Payables Summary", description: "Outstanding bills per supplier, bucketed by age", category: "Payables", Component: AgedPayablesSummary },
  { key: "ap-aging-detail", label: "Aged Payables Detail", description: "Every outstanding bill, aged and grouped by supplier", category: "Payables", Component: AgedPayablesDetail },
  { key: "payable-invoices", label: "Payable Invoice Summary", description: "Bills for a period — gross, payments and balance per supplier", category: "Payables", Component: PayableInvoices },
  { key: "payable-invoice-detail", label: "Payable Invoice Detail", description: "Every bill line item for a period, grouped by supplier", category: "Payables", Component: PayableInvoiceDetail },
  { key: "supp-soa", label: "Supplier Statement", description: "Per-supplier statement of account", category: "Payables", Component: SupplierStatementPage },
  { key: "pbs", label: "Purchases by Supplier", description: "Spend breakdown by supplier", category: "Payables", Component: PurchasesBySupplierPage },

  // Ledger
  { key: "gl", label: "General Ledger Detail", description: "Every posted line per account with running balance", category: "Ledger", Component: GeneralLedgerDetail },
  { key: "gl-summary", label: "General Ledger Summary", description: "Debit, credit and net movement per account for a period", category: "Ledger", Component: GeneralLedgerSummary },
  { key: "account-transactions", label: "Account Transactions", description: "Transactions for chosen accounts over a period", category: "Ledger", Component: AccountTransactions },
  { key: "tb", label: "Trial Balance", description: "Debits and credits across all accounts, with year comparison", category: "Ledger", Component: TrialBalanceReport },
  { key: "journal", label: "Journal Report", description: "Every posted journal with its balanced lines", category: "Ledger", Component: JournalReport },
  { key: "audit-trail", label: "Audit Trail", description: "Every posted journal line for a period, filterable by document prefix", category: "Ledger", Component: AuditTrail },

  // Financial statements & tax — live in the General Ledger section (guru:
  // mirror the legacy software's GL menu — GL / TB / Journal / GST / P&L+BS /
  // Expense Listing / Bank Rec all under one tab).
  { key: "pl", label: "Profit and Loss", description: "Income, cost of sales and expenses with period comparison", category: "Ledger", Component: ProfitLoss },
  { key: "bs", label: "Balance Sheet", description: "Assets, liabilities and equity as at a date, with year comparison", category: "Ledger", Component: BalanceSheet },
  { key: "expense-listing", label: "Expense Listing", description: "Every expense and purchase transaction for a period, by account", category: "Ledger", Component: ExpenseListing },
  { key: "gst", label: "GST", description: "GST details by tax code + F5 summary for the period", category: "Ledger", Component: GSTReturn },

  // Financial (remaining)
  { key: "cf", label: "Cash Flow", description: "Operating, investing and financing cash movements", category: "Financial", Component: CashFlowPage },
  { key: "ba", label: "Budget vs Actual", description: "Compare budgeted to actual amounts per account", category: "Financial", Component: BudgetVsActualPage },

  // Assets & Other
  { key: "fa", label: "Fixed Assets", description: "Fixed asset register and depreciation", category: "Assets & Other", Component: FixedAssetsPage },
  { key: "recurring", label: "Recurring", description: "Scheduled recurring invoices and bills", category: "Assets & Other", Component: RecurringPage },
  { key: "bankrec", label: "Bank Reconciliation", description: "Match bank statement lines to ledger entries", category: "Ledger", Component: BankReconciliationPage },
  { key: "bank-summary", label: "Bank Summary", description: "Opening balance, cash in and out, closing balance per bank account", category: "Ledger", Component: BankSummary },
  { key: "foreign-banks", label: "Foreign Bank Listing", description: "Foreign-currency bank accounts — foreign and local balances", category: "Ledger", Component: ForeignBankListing },
];

function favouritesStorageKey(orgId: string | undefined) {
  return `accounting-report-favourites:${orgId || "default"}`;
}

function useFavouriteReports(orgId: string | undefined) {
  const [favourites, setFavourites] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(favouritesStorageKey(orgId));
      if (raw) {
        const parsed = JSON.parse(raw) as string[];
        if (Array.isArray(parsed)) setFavourites(new Set(parsed));
      }
    } catch {
      // Ignore corrupted storage — fall back to empty set.
    }
  }, [orgId]);

  const persist = (next: Set<string>) => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(favouritesStorageKey(orgId), JSON.stringify(Array.from(next)));
    } catch {
      // Storage might be full / disabled — non-fatal, in-memory state still updates.
    }
  };

  const toggle = (key: string) => {
    setFavourites((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      persist(next);
      return next;
    });
  };

  return { favourites, toggle };
}

function ReportCard({
  report,
  isFavourite,
  onToggleFavourite,
  onOpen,
}: {
  report: ReportEntry;
  isFavourite: boolean;
  onToggleFavourite: () => void;
  onOpen: () => void;
}) {
  return (
    <Card
      variant="outlined"
      sx={{
        position: "relative",
        borderRadius: 1.5,
        transition: "border-color 160ms ease, box-shadow 160ms ease",
        "&:hover": { borderColor: "primary.main", boxShadow: 1 },
      }}
    >
      <CardActionArea onClick={onOpen} sx={{ p: 2, pr: 5, display: "block" }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 600, color: "text.primary", mb: 0.5 }}>
          {report.label}
        </Typography>
        <Typography variant="body2" sx={{ color: "text.secondary", lineHeight: 1.4 }}>
          {report.description}
        </Typography>
      </CardActionArea>
      <Tooltip title={isFavourite ? "Remove from favourites" : "Add to favourites"}>
        <IconButton
          size="small"
          onClick={(e) => {
            e.stopPropagation();
            onToggleFavourite();
          }}
          sx={{
            position: "absolute",
            top: 8,
            right: 8,
            color: isFavourite ? "warning.main" : "text.disabled",
            "&:hover": { color: isFavourite ? "warning.dark" : "warning.main" },
          }}
        >
          {isFavourite ? <StarIcon fontSize="small" /> : <StarBorderIcon fontSize="small" />}
        </IconButton>
      </Tooltip>
    </Card>
  );
}

function ReportSection({
  title,
  reports,
  favourites,
  onToggleFavourite,
  onOpen,
}: {
  title: string;
  reports: ReportEntry[];
  favourites: Set<string>;
  onToggleFavourite: (key: string) => void;
  onOpen: (key: string) => void;
}) {
  if (reports.length === 0) return null;
  return (
    <Box sx={{ mb: 4 }}>
      <Typography
        variant="overline"
        sx={{ color: "text.secondary", fontWeight: 700, letterSpacing: "0.6px", mb: 1.5, display: "block" }}
      >
        {title}
      </Typography>
      <Box
        sx={{
          display: "grid",
          gap: 1.5,
          gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr", lg: "1fr 1fr 1fr" },
        }}
      >
        {reports.map((r) => (
          <ReportCard
            key={r.key}
            report={r}
            isFavourite={favourites.has(r.key)}
            onToggleFavourite={() => onToggleFavourite(r.key)}
            onOpen={() => onOpen(r.key)}
          />
        ))}
      </Box>
    </Box>
  );
}

function ReportsInner({
  categories,
  basePath,
  title,
  subtitle,
}: {
  categories: ReportCategory[];
  basePath: string;
  title: string;
  subtitle?: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { organization } = useOrganization();
  const { isLegacyAccountingUxEnabled } = useOrganizationFeatures();
  const { favourites, toggle: toggleFavourite } = useFavouriteReports(organization?.id);

  const rawTab = searchParams.get("tab");
  // Legacy-UX-only reports: hidden from the directory (and unresolvable via
  // ?tab=) for orgs without the enableLegacyAccountingUx flag.
  const LEGACY_ONLY_REPORT_KEYS = ["debtor-statement", "audit-trail", "receipt-listing", "summary-ageing", "detailed-ageing", "debtor-listing", "historical-listing"];
  const visibleReports = useMemo(
    () => (isLegacyAccountingUxEnabled ? REPORTS : REPORTS.filter((r) => !LEGACY_ONLY_REPORT_KEYS.includes(r.key))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isLegacyAccountingUxEnabled],
  );
  // Active report scans the FULL (flag-filtered) registry, so any ?tab=
  // deep-link (e.g. the Hub anomaly links to ?tab=audit / ?tab=gst) resolves
  // from any section page.
  const activeReport = useMemo(() => visibleReports.find((r) => r.key === rawTab) || null, [visibleReports, rawTab]);

  // Legacy accounting UX (feature flag): entering the AR section lands straight
  // on the AR workspace (legacy software's "Accounts Receivable" home — KPIs +
  // customer balances), not the report directory. Reports stay reachable via
  // the workspace's View Reports dialog; ?tab= deep-links still win.
  const legacyLanding =
    !rawTab && isLegacyAccountingUxEnabled && categories.length === 1 && categories[0] === "Receivables"
      ? REPORTS.find((r) => r.key === "ar") || null
      : null;

  const [search, setSearch] = useState("");

  // (after all hooks) Legacy-UX landing takes over the AR directory view.
  if (legacyLanding && !activeReport) {
    const LandingComponent = legacyLanding.Component;
    return <LandingComponent />;
  }

  const openReport = (key: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", key);
    router.replace(`${basePath}?${params.toString()}`);
  };

  // An explicit ?back=<portal path> wins over the directory — set by pages
  // that deep-link into a report (e.g. the Official Receipt's side rail) so
  // Back returns to where the user actually came from. Validated to an
  // in-portal path so a crafted link can't redirect elsewhere.
  const backTarget = (() => {
    const b = searchParams.get("back");
    return b && b.startsWith("/portal") ? b : null;
  })();

  const goToDirectory = () => {
    if (backTarget) {
      router.push(backTarget);
      return;
    }
    const params = new URLSearchParams(searchParams.toString());
    params.delete("tab");
    const qs = params.toString();
    router.replace(`${basePath}${qs ? `?${qs}` : ""}`);
  };

  // Active report view: render the chosen report with a slim back/star header.
  if (activeReport) {
    const ActiveComponent = activeReport.Component;
    const isFavourite = favourites.has(activeReport.key);
    return (
      <Box sx={{ display: "flex", flexDirection: "column" }}>
        <Box
          sx={{
            position: "sticky",
            top: 0,
            zIndex: 5,
            bgcolor: "background.paper",
            borderBottom: 1,
            borderColor: "divider",
            px: 3,
            py: 1.5,
            display: "flex",
            alignItems: "center",
            gap: 1.5,
          }}
        >
          <Button
            size="small"
            startIcon={<ArrowBackIcon />}
            onClick={goToDirectory}
            sx={{ textTransform: "none", color: "text.secondary" }}
          >
            {backTarget ? "Back" : `Back to ${title}`}
          </Button>
          <Typography variant="subtitle1" sx={{ fontWeight: 600, flex: 1, color: "text.primary" }}>
            {activeReport.label}
          </Typography>
          <Tooltip title={isFavourite ? "Remove from favourites" : "Add to favourites"}>
            <IconButton size="small" onClick={() => toggleFavourite(activeReport.key)} sx={{ color: isFavourite ? "warning.main" : "text.disabled" }}>
              {isFavourite ? <StarIcon fontSize="small" /> : <StarBorderIcon fontSize="small" />}
            </IconButton>
          </Tooltip>
        </Box>
        <ActiveComponent />
      </Box>
    );
  }

  // Directory view: search + favourites + the categories assigned to this section.
  const term = search.trim().toLowerCase();
  const inSection = (r: ReportEntry) => categories.includes(r.category);
  const matches = (r: ReportEntry) =>
    !term ||
    r.label.toLowerCase().includes(term) ||
    r.description.toLowerCase().includes(term) ||
    r.category.toLowerCase().includes(term);

  const sectionReports = visibleReports.filter(inSection);
  const favouriteReports = sectionReports.filter((r) => favourites.has(r.key) && matches(r));

  const grouped = new Map<ReportCategory, ReportEntry[]>();
  for (const r of sectionReports) {
    if (!matches(r)) continue;
    if (!grouped.has(r.category)) grouped.set(r.category, []);
    grouped.get(r.category)!.push(r);
  }
  // Only show the category subtitle when the section spans more than one.
  const showCategoryTitles = categories.length > 1;

  const hasAnyMatch = favouriteReports.length > 0 || Array.from(grouped.values()).some((g) => g.length > 0);

  return (
    <Box sx={{ px: 3, py: 3, maxWidth: 1400, mx: "auto", width: "100%" }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 3, flexWrap: "wrap", gap: 2 }}>
        <Box>
          <Typography variant="h5" sx={{ fontWeight: 700 }}>
            {title}
          </Typography>
          <Typography variant="body2" sx={{ color: "text.secondary", mt: 0.5 }}>
            {subtitle || "Star the ones you use most so they show up at the top next time."}
          </Typography>
        </Box>
        <TextField
          size="small"
          placeholder="Find a report"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          sx={{ minWidth: { xs: "100%", sm: 320 } }}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon fontSize="small" sx={{ color: "text.secondary" }} />
              </InputAdornment>
            ),
          }}
        />
      </Stack>

      <ReportSection
        title={`Favourites${favouriteReports.length ? ` (${favouriteReports.length})` : ""}`}
        reports={favouriteReports}
        favourites={favourites}
        onToggleFavourite={toggleFavourite}
        onOpen={openReport}
      />

      {categories.map((cat) =>
        grouped.has(cat) ? (
          <ReportSection
            key={cat}
            title={showCategoryTitles ? cat : ""}
            reports={grouped.get(cat)!}
            favourites={favourites}
            onToggleFavourite={toggleFavourite}
            onOpen={openReport}
          />
        ) : null,
      )}

      {!hasAnyMatch && (
        <Box sx={{ textAlign: "center", py: 8, color: "text.secondary" }}>
          <Typography variant="body1">No reports match &quot;{search}&quot;.</Typography>
        </Box>
      )}
    </Box>
  );
}

// Shared section view. Each accounting sidebar section (General Ledger / AR / AP
// / Reports) renders this with its own category set + base path.
export default function AccountingReportsView(props: {
  categories: ReportCategory[];
  basePath: string;
  title: string;
  subtitle?: string;
}) {
  return (
    <Suspense
      fallback={
        <Box sx={{ display: "flex", justifyContent: "center", p: 8 }}>
          <CircularProgress />
        </Box>
      }
    >
      <ReportsInner {...props} />
    </Suspense>
  );
}
