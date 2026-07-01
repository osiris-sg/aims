"use client";

import AccountingReportsView from "../_lib/AccountingReportsView";

// "Accounts Payable" section — bills, AP aging, supplier statement, purchases.
export default function PayablesSectionPage() {
  return (
    <AccountingReportsView
      basePath="/portal/accounting/payables"
      title="Accounts Payable"
      subtitle="Supplier bills, aging, statements and purchase analysis."
      categories={["Payables"]}
    />
  );
}
