"use client";

import ComingSoon from "../_lib/ComingSoon";

export default function ProfitLossPage() {
  return (
    <ComingSoon
      title="Profit / Loss & Balance Sheet"
      description="Income statement and balance sheet built from posted journal entries."
      bullets={[
        "P&L: Revenue → Cost of Sales → Gross Profit → Expenses → Net Profit",
        "Balance Sheet: Assets / Liabilities / Equity",
        "Period vs. period comparison",
        "Drill-down from any line into the contributing accounts",
      ]}
    />
  );
}
