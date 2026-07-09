"use client";

import AccountingReportsView from "../_lib/AccountingReportsView";

// "General Ledger" section — Xero-style report tiles: GL Detail / GL Summary /
// Trial Balance / Audit Trail. (The old all-accounts browser still lives at
// /portal/accounting/general-ledger.)
export default function LedgerSectionPage() {
  return (
    <AccountingReportsView
      basePath="/portal/accounting/ledger"
      title="General Ledger"
      subtitle="Ledger, trial balance, journal, financial statements, GST, expense listing and bank reports."
      categories={["Ledger"]}
    />
  );
}
