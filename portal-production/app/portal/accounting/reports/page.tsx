"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Box, CircularProgress } from "@mui/material";

// RETIRED (guru 2026-10-24): every accounting report lives under General
// Ledger, Accounts Receivable or Accounts Payable. Old links and bookmarks
// (/portal/accounting/reports?tab=pl …) land in the General Ledger section,
// which resolves any ?tab= key from the full registry.
function ReportsRedirect() {
  const router = useRouter();
  const searchParams = useSearchParams();
  useEffect(() => {
    const qs = searchParams.toString();
    router.replace(`/portal/accounting/ledger${qs ? `?${qs}` : ""}`);
  }, [router, searchParams]);
  return (
    <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
      <CircularProgress size={28} />
    </Box>
  );
}

export default function ReportsPage() {
  return (
    <Suspense fallback={null}>
      <ReportsRedirect />
    </Suspense>
  );
}
