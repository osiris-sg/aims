"use client";

import { Suspense, useMemo } from "react";
import { Box, Paper, Tab, Tabs, CircularProgress } from "@mui/material";
import { useRouter, useSearchParams } from "next/navigation";
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

const TABS = [
  { key: "gl", label: "General Ledger", Component: GeneralLedgerPage },
  { key: "tb", label: "Trial Balance", Component: TrialBalancePage },
  { key: "pl", label: "P&L / Balance Sheet", Component: ProfitLossPage },
  { key: "cf", label: "Cash Flow", Component: CashFlowPage },
  // Money-owed workspace — same component as /portal/invoices. Surfaces the
  // AR tabs / outstanding / record-payment flow inside Accounting Reports too.
  { key: "ar", label: "Accounts Receivable", Component: InvoicesPage },
  { key: "ar-aging", label: "AR Aging", Component: ARAgingPage },
  // Money-out workspace — same component as /portal/inventory/bills.
  { key: "ap", label: "Accounts Payable", Component: BillsPage },
  { key: "ap-aging", label: "AP Aging", Component: APAgingPage },
  { key: "bankrec", label: "Bank Rec", Component: BankReconciliationPage },
  { key: "ba", label: "Budget vs Actual", Component: BudgetVsActualPage },
  { key: "gst", label: "GST", Component: GstPage },
  { key: "audit", label: "Audit Trail", Component: AuditTrailPage },
] as const;

type TabKey = (typeof TABS)[number]["key"];

function ReportsInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const raw = searchParams.get("tab");
  const current: TabKey = useMemo(() => {
    return (TABS.find((t) => t.key === raw)?.key ?? "gl") as TabKey;
  }, [raw]);

  const ActiveComponent = TABS.find((t) => t.key === current)?.Component ?? GeneralLedgerPage;

  const handleChange = (_: any, value: TabKey) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", value);
    router.replace(`/portal/accounting/reports?${params.toString()}`);
  };

  return (
    <Box sx={{ display: "flex", flexDirection: "column" }}>
      <Paper
        variant="outlined"
        sx={{
          borderRadius: 0,
          borderLeft: 0,
          borderRight: 0,
          borderTop: 0,
          position: "sticky",
          top: 0,
          zIndex: 5,
          bgcolor: "background.paper",
        }}
      >
        <Tabs
          value={current}
          onChange={handleChange}
          variant="scrollable"
          scrollButtons="auto"
          sx={{
            px: 2,
            "& .MuiTab-root": { textTransform: "none", fontWeight: 600, minHeight: 48 },
          }}
        >
          {TABS.map((t) => (
            <Tab key={t.key} value={t.key} label={t.label} />
          ))}
        </Tabs>
      </Paper>

      <ActiveComponent />
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
