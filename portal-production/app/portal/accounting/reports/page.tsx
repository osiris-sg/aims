"use client";

import AccountingReportsView from "../_lib/AccountingReportsView";

// "Reports" section — financial statements, tax, and the remaining reports that
// aren't part of the ledger / AR / AP sub-sections.
export default function ReportsPage() {
  return (
    <AccountingReportsView
      basePath="/portal/accounting/reports"
      title="Reports"
      subtitle="Financial statements, tax and other reports. Star the ones you use most."
      categories={["Financial", "Tax & Compliance", "Assets & Other"]}
    />
  );
}
