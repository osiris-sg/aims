"use client";

// Retired (guru 2026-10-13, report standardisation): this was a second GL
// home — same KPI tiles + account balance table as the new General Ledger
// workspace, but with its own one-off Print (raw page) and an "Excel" button
// that really produced a CSV. The sidebar's "General Ledger" submenu now
// lands on the standard GL home (legacy-home layout, standard Print/Export).
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Box, CircularProgress } from "@mui/material";

export default function GeneralLedgerRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/portal/accounting/ledger?tab=gl-home");
  }, [router]);
  return (
    <Box sx={{ display: "flex", justifyContent: "center", p: 6 }}>
      <CircularProgress size={24} />
    </Box>
  );
}
