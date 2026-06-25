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
import GeneralLedgerPage from "../general-ledger/page";
import TrialBalancePage from "../trial-balance/page";
import ProfitLossPage from "../profit-loss/page";
import GstPage from "../gst/page";
import AuditTrailPage from "../audit-trail/page";
import CashFlowPage from "../cash-flow/page";
import ARAgingPage from "../ar-aging/page";
import BudgetVsActualPage from "../budget-vs-actual/page";
import InvoicesPage from "../../invoices/page";
import BillsPage from "../../inventory/bills/page";
import APAgingPage from "../ap-aging/page";
import BankReconciliationPage from "../bank-reconciliation/page";
import StatementOfAccountPage from "../../reports/statement-of-account/page";
import FixedAssetsPage from "../fixed-assets/page";
import RecurringPage from "../recurring/page";
import SupplierStatementPage from "../supplier-statement/page";
import SalesByCustomerPage from "../sales-by-customer/page";
import PurchasesBySupplierPage from "../purchases-by-supplier/page";

type ReportCategory =
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

// Single source of truth for every report shown on this page. Keep `key` stable
// — it's used in the ?tab= URL param and in the favourites store.
const REPORTS: ReportEntry[] = [
  // Receivables
  { key: "ar", label: "Accounts Receivable", description: "Outstanding invoices and customer balances", category: "Receivables", Component: InvoicesPage },
  { key: "ar-aging", label: "AR Aging", description: "Outstanding invoices bucketed by days overdue", category: "Receivables", Component: ARAgingPage },
  { key: "soa", label: "Customer Statement", description: "Per-customer statement of account", category: "Receivables", Component: StatementOfAccountPage },
  { key: "sbc", label: "Sales by Customer", description: "Revenue breakdown by customer", category: "Receivables", Component: SalesByCustomerPage },

  // Payables
  { key: "ap", label: "Accounts Payable", description: "Bills owed to suppliers", category: "Payables", Component: BillsPage },
  { key: "ap-aging", label: "AP Aging", description: "Outstanding bills bucketed by days overdue", category: "Payables", Component: APAgingPage },
  { key: "supp-soa", label: "Supplier Statement", description: "Per-supplier statement of account", category: "Payables", Component: SupplierStatementPage },
  { key: "pbs", label: "Purchases by Supplier", description: "Spend breakdown by supplier", category: "Payables", Component: PurchasesBySupplierPage },

  // Ledger
  { key: "gl", label: "General Ledger", description: "All journal entries grouped by account", category: "Ledger", Component: GeneralLedgerPage },
  { key: "tb", label: "Trial Balance", description: "Debits and credits across all accounts", category: "Ledger", Component: TrialBalancePage },
  { key: "audit", label: "Audit Trail", description: "Chronological log of accounting changes", category: "Ledger", Component: AuditTrailPage },

  // Financial
  { key: "pl", label: "P&L / Balance Sheet", description: "Income statement and balance sheet", category: "Financial", Component: ProfitLossPage },
  { key: "cf", label: "Cash Flow", description: "Operating, investing and financing cash movements", category: "Financial", Component: CashFlowPage },
  { key: "ba", label: "Budget vs Actual", description: "Compare budgeted to actual amounts per account", category: "Financial", Component: BudgetVsActualPage },

  // Tax
  { key: "gst", label: "GST", description: "GST collected and paid for the period", category: "Tax & Compliance", Component: GstPage },

  // Assets & Other
  { key: "fa", label: "Fixed Assets", description: "Fixed asset register and depreciation", category: "Assets & Other", Component: FixedAssetsPage },
  { key: "recurring", label: "Recurring", description: "Scheduled recurring invoices and bills", category: "Assets & Other", Component: RecurringPage },
  { key: "bankrec", label: "Bank Reconciliation", description: "Match bank statement lines to ledger entries", category: "Assets & Other", Component: BankReconciliationPage },
];

const CATEGORY_ORDER: ReportCategory[] = [
  "Receivables",
  "Payables",
  "Ledger",
  "Financial",
  "Tax & Compliance",
  "Assets & Other",
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

function ReportsInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { organization } = useOrganization();
  const { favourites, toggle: toggleFavourite } = useFavouriteReports(organization?.id);

  const rawTab = searchParams.get("tab");
  const activeReport = useMemo(
    () => REPORTS.find((r) => r.key === rawTab) || null,
    [rawTab]
  );

  const [search, setSearch] = useState("");

  const openReport = (key: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", key);
    router.replace(`/portal/accounting/reports?${params.toString()}`);
  };

  const goToDirectory = () => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("tab");
    const qs = params.toString();
    router.replace(`/portal/accounting/reports${qs ? `?${qs}` : ""}`);
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
            All reports
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

  // Directory view: search + favourites + grouped sections.
  const term = search.trim().toLowerCase();
  const matches = (r: ReportEntry) =>
    !term ||
    r.label.toLowerCase().includes(term) ||
    r.description.toLowerCase().includes(term) ||
    r.category.toLowerCase().includes(term);

  const favouriteReports = REPORTS.filter((r) => favourites.has(r.key) && matches(r));
  const grouped: Record<ReportCategory, ReportEntry[]> = {
    Receivables: [],
    Payables: [],
    Ledger: [],
    Financial: [],
    "Tax & Compliance": [],
    "Assets & Other": [],
  };
  REPORTS.forEach((r) => {
    if (matches(r)) grouped[r.category].push(r);
  });

  const hasAnyMatch = favouriteReports.length > 0 || CATEGORY_ORDER.some((c) => grouped[c].length > 0);

  return (
    <Box sx={{ px: 3, py: 3, maxWidth: 1400, mx: "auto", width: "100%" }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 3, flexWrap: "wrap", gap: 2 }}>
        <Box>
          <Typography variant="h5" sx={{ fontWeight: 700 }}>
            Accounting Reports
          </Typography>
          <Typography variant="body2" sx={{ color: "text.secondary", mt: 0.5 }}>
            Star the ones you use most so they show up at the top next time.
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

      {favouriteReports.length === 0 && !term && (
        <Box
          sx={{
            mb: 4,
            mt: -2,
            p: 2,
            borderRadius: 1.5,
            border: 1,
            borderStyle: "dashed",
            borderColor: "divider",
            color: "text.secondary",
            display: "flex",
            alignItems: "center",
            gap: 1,
          }}
        >
          <StarBorderIcon fontSize="small" />
          <Typography variant="body2">
            No favourites yet — click the star on any report below to pin it here.
          </Typography>
        </Box>
      )}

      {CATEGORY_ORDER.map((cat) => (
        <ReportSection
          key={cat}
          title={cat}
          reports={grouped[cat]}
          favourites={favourites}
          onToggleFavourite={toggleFavourite}
          onOpen={openReport}
        />
      ))}

      {!hasAnyMatch && (
        <Box sx={{ textAlign: "center", py: 8, color: "text.secondary" }}>
          <Typography variant="body1">No reports match &quot;{search}&quot;.</Typography>
        </Box>
      )}
    </Box>
  );
}

export default function ReportsPage() {
  return (
    <Suspense
      fallback={
        <Box sx={{ display: "flex", justifyContent: "center", p: 8 }}>
          <CircularProgress />
        </Box>
      }
    >
      <ReportsInner />
    </Suspense>
  );
}
