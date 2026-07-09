"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";

// Recurring Invoices now lives under Accounting → Accounts Receivable.
// This route only redirects there (preserving e.g. ?fromInvoice= from the
// "Confirm & make recurring" flow).
function RedirectToReceivables() {
  const router = useRouter();
  const searchParams = useSearchParams();
  useEffect(() => {
    const q = new URLSearchParams(searchParams?.toString() || "");
    q.set("tab", "recurring-invoices");
    router.replace(`/portal/accounting/receivables?${q.toString()}`);
  }, [router, searchParams]);
  return null;
}

export default function RecurringInvoicesRedirectPage() {
  return (
    <Suspense fallback={null}>
      <RedirectToReceivables />
    </Suspense>
  );
}
