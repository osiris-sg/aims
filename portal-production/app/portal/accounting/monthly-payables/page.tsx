"use client";

// Stand-alone route for the outgoing-payments sheet. The sheet itself lives in
// MonthlyPayablesSheet.tsx because AccountingReportsView renders it as the
// Accounts Payable landing with a `reportsHref` — and a Next.js route page may
// only take `params`/`searchParams`, so the component can't be the page.
import MonthlyPayablesSheet from "./MonthlyPayablesSheet";

export default function MonthlyPayablesPage() {
  return <MonthlyPayablesSheet />;
}
