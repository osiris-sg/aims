"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { Chip, List, ListItemButton, ListItemText } from "@mui/material";
import { ReportSummary } from "../lib/maintenanceReports";

/**
 * Signed (completed) maintenance reports. Shared by /scan/reports ("Recently
 * completed") and the Maintenance home's Completed tab. A tap opens the
 * report's print screen.
 */
export function CompletedReportList({ reports }: { reports: ReportSummary[] }) {
  const router = useRouter();
  return (
    <List dense sx={{ border: 1, borderColor: "divider", borderRadius: 1, p: 0 }}>
      {reports.map((r) => (
        <ListItemButton
          key={r.id}
          onClick={() => router.push(`/scan/reports/${r.id}/print`)}
          sx={{ minHeight: 64 }}
        >
          <ListItemText
            primary={
              <>
                {r.reportNumber != null && <strong>#{r.reportNumber}</strong>}
                {r.reportNumber != null && "  "}
                {r.serviceData?.customerName || "No customer"}
              </>
            }
            secondary={[
              r.serviceData?.model || r.asset?.name,
              r.serviceData?.serial || r.inventory?.sku,
              r.serviceData?.serviceDate,
            ]
              .filter(Boolean)
              .join(" · ")}
          />
          <Chip size="small" label="Signed" color="success" variant="outlined" />
        </ListItemButton>
      ))}
    </List>
  );
}
