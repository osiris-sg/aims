"use client";

// Sales → Inbox left the menu (round W, 2026-10-22): the Dashboard is the email home and the full two-tab
// view lives at /portal/shipments/dashboard?view=emails ("See all emails"). The old URL keeps working —
// bookmarks, guide links and WhatsApp replies land on the new sub-view.

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Box, CircularProgress } from "@mui/material";
import { SHIPMENTS_EMAILS } from "@/helpers/shipmentsNav";

export default function InboxRedirectPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace(SHIPMENTS_EMAILS);
  }, [router]);
  return (
    <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
      <CircularProgress />
    </Box>
  );
}
