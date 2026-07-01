"use client";

import AccountingReportsView from "../_lib/AccountingReportsView";

// "Accounts Receivable" section — invoices, AR aging, customer statement, sales.
export default function ReceivablesSectionPage() {
  return (
    <AccountingReportsView
      basePath="/portal/accounting/receivables"
      title="Accounts Receivable"
      subtitle="Customer invoices, aging, statements and sales analysis."
      categories={["Receivables"]}
    />
  );
}
