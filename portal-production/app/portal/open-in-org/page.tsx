"use client";

// Open a document in another company of the group (WCT group, 2026-11-23): a BC Air order's cross-company invoice
// pill links here for a person who belongs to that company. The tab switches to that company (the same switch as the
// header's company picker) and opens the document; the server still checks the membership on every call.
import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { CircularProgress, Stack, Typography } from "@mui/material";
import { ACTIVE_ORG_KEY } from "@/helpers/multiOrg";
import { safeOpenInOrg } from "@/helpers/crossOrg";

export default function OpenInOrgPage() {
  const params = useSearchParams();
  useEffect(() => {
    const target = safeOpenInOrg(params.get("org"), params.get("to"));
    if (!target) return void window.location.replace("/portal");
    try {
      window.sessionStorage.setItem(ACTIVE_ORG_KEY, target.org);
    } catch {
      /* no sessionStorage: the document opens in the current company and the server answers */
    }
    window.location.replace(target.to);
  }, [params]);
  return (
    <Stack alignItems="center" spacing={1.5} sx={{ py: 8 }}>
      <CircularProgress size={22} />
      <Typography variant="body2" color="text.secondary">
        Opening in the other company
      </Typography>
    </Stack>
  );
}
