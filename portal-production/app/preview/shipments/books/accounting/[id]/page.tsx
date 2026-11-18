"use client";

// Round BW — an order's Accounting tab from the fixture (lotPreview keyed by order id), for the round report.
import { Box, Typography } from "@mui/material";
import { useParams, useSearchParams } from "next/navigation";
import AccountingPreview from "@/app/portal/shipments/_components/AccountingPreview";

export default function PreviewAccounting() {
  const { id } = useParams<{ id: string }>();
  // ?admin=1: show it as ADH Admin sees it (the Invoice #1 "Type" button).
  const admin = useSearchParams()?.get("admin") === "1";
  return (
    <Box sx={{ p: { xs: 1.5, md: 3 }, maxWidth: 1200, mx: "auto" }}>
      <Typography variant="h5" sx={{ fontWeight: 800, mb: 2 }}>
        Order #15 · Accounting
      </Typography>
      <AccountingPreview orderId={id} adminOverride={admin || undefined} />
    </Box>
  );
}
