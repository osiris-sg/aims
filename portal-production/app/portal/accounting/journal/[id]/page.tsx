"use client";

// /portal/accounting/journal/{id} — the old read-only journal page. Every
// journal now opens on the J/V editor like any other accounting document
// (guru 2026-11-23): a manual journal is adopted into a voucher on first open,
// any other posting shows read-only. Old links (bookmarks, AIMEE answers,
// ?from= trails) land here and move on, keeping their query string.

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { Box, CircularProgress } from "@mui/material";

export default function JournalEntryPage() {
  const params = useParams();
  const router = useRouter();
  const id = String(params.id || "");

  useEffect(() => {
    if (!id) return;
    router.replace(`/portal/accounting/journal-vouchers/${id}${window.location.search}`);
  }, [id, router]);

  return (
    <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
      <CircularProgress />
    </Box>
  );
}
