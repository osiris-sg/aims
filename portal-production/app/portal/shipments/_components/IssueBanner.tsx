"use client";

// Round AR — the open general issues that apply to a shipment's step (e.g. step 4 COA): one compact warning per
// issue. Nothing when there are none.

import React from "react";
import { Alert, AlertTitle, Box, Typography } from "@mui/material";
import { useShipmentIssues } from "../_lib/hooks";

export default function IssueBanner({ shipmentId, docType }: { shipmentId: string; docType: string }) {
  const q = useShipmentIssues(shipmentId, docType);
  const rows = (q.data ?? []).filter((i) => i.status === "OPEN");
  if (!rows.length) return null;
  return (
    <Box data-tour="issue-banner" sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
      {rows.map((i) => {
        const party = [i.supplierName, i.customerName].filter(Boolean).join(" · ");
        return (
          <Alert key={i.id} severity="warning" variant="outlined" sx={{ py: 0.5 }}>
            <AlertTitle sx={{ mb: 0.25, fontWeight: 700 }}>
              {i.title}
              {i.effectiveFrom ? (
                <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                  from {i.effectiveFrom}
                </Typography>
              ) : null}
            </AlertTitle>
            {i.summaryEn && (
              <Typography variant="body2" sx={{ whiteSpace: "pre-wrap" }}>
                {i.summaryEn}
              </Typography>
            )}
            {i.summaryJa && (
              <Typography variant="caption" color="text.secondary" display="block" sx={{ whiteSpace: "pre-wrap" }}>
                {i.summaryJa}
              </Typography>
            )}
            {party && (
              <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.25 }}>
                Issue on {party}
              </Typography>
            )}
          </Alert>
        );
      })}
    </Box>
  );
}
