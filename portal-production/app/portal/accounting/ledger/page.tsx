"use client";

import AccountingReportsView from "../_lib/AccountingReportsView";

// "General Ledger" section — ledger, trial balance, journal, financial
// statements (P&L, balance sheet, cash flow), GST, budgets, fixed assets and
// bank reports. With enableLegacyAccountingUx it lands on the GL home
// (GLWorkspace) whose "View Reports" dialog lists the same set.
export default function LedgerSectionPage() {
  return (
    <AccountingReportsView
      basePath="/portal/accounting/ledger"
      title="General Ledger"
      subtitle="Ledger, trial balance, journal, financial statements, cash flow, GST, budgets, fixed assets and bank reports."
      categories={["Ledger"]}
    />
  );
}
