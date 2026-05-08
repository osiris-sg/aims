"use client";

import ComingSoon from "../_lib/ComingSoon";

export default function ExpenseListingPage() {
  return (
    <ComingSoon
      title="Expense Listing"
      description="Detailed listing of every posted expense entry across the period."
      bullets={[
        "Filter by expense account, supplier, project, or date range",
        "Group by category with subtotals",
        "Drill into the source document (bill / payment voucher / journal)",
        "CSV / PDF export",
      ]}
    />
  );
}
