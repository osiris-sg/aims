"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { Divider, List, ListItemButton, ListItemText } from "@mui/material";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import { ReportSummary } from "../lib/maintenanceReports";
import { ListCard, StatusChip } from "./fieldUi";

/**
 * Signed (completed) maintenance reports. Shared by /scan/reports ("Recently
 * completed") and the Maintenance home's Completed tab. A tap opens the
 * report's print screen.
 */
export function CompletedReportList({ reports }: { reports: ReportSummary[] }) {
  const router = useRouter();
  return (
    <ListCard>
    <List disablePadding>
      {reports.map((r, i) => (
        <React.Fragment key={r.id}>
        {i > 0 && <Divider component="li" sx={{ mx: 2 }} />}
        <ListItemButton
          onClick={() => router.push(`/scan/reports/${r.id}/print`)}
          sx={{ minHeight: 68, gap: 1 }}
        >
          <ListItemText
            primaryTypographyProps={{ fontWeight: 600 }}
            secondaryTypographyProps={{ fontSize: 12.5 }}
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
          <StatusChip label="SIGNED" tone="good" />
          <ChevronRightIcon sx={{ color: "text.disabled", mr: -0.5 }} />
        </ListItemButton>
        </React.Fragment>
      ))}
    </List>
    </ListCard>
  );
}
