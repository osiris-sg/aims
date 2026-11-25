"use client";

// Inventory → Reports (guru 2026-11-25): the legacy system's "Inventory Report" menu,
// its ten reports in its own order and its own wording. Each card opens
// /portal/inventory/reports/<slug>, which runs it (see [report]/page.tsx).
//
// Same screen as Reports (/portal/reports) — guru 2026-11-25, "design the same ui as
// sales reports screen": h4 title over a one-line lead, then cards three across with a
// big centred icon, the report's name under it and what it answers under that, lifting
// on hover. Icon colours are theme tokens, so they hold up in dark mode (the Reports
// page's raw hexes do not).

import React from "react";
import { useRouter } from "next/navigation";
import { Box, Card, CardActionArea, CardContent, Grid, Typography } from "@mui/material";
import AssessmentIcon from "@mui/icons-material/Assessment";
import PendingActionsIcon from "@mui/icons-material/PendingActions";
import ShoppingCartIcon from "@mui/icons-material/ShoppingCart";
import SummarizeIcon from "@mui/icons-material/Summarize";
import FactCheckIcon from "@mui/icons-material/FactCheck";
import CategoryIcon from "@mui/icons-material/Category";
import SwapVertIcon from "@mui/icons-material/SwapVert";
import ChecklistIcon from "@mui/icons-material/Checklist";
import SellIcon from "@mui/icons-material/Sell";
import NotificationsActiveIcon from "@mui/icons-material/NotificationsActive";
import { REPORTS } from "@/helpers/inventoryReports";

const ART: Record<string, { icon: React.ElementType; color: string }> = {
  "stock-status": { icon: AssessmentIcon, color: "primary.main" },
  "unconfirmed-transactions": { icon: PendingActionsIcon, color: "warning.main" },
  "purchase-order-listing": { icon: ShoppingCartIcon, color: "info.main" },
  "purchase-summary-by-supplier": { icon: SummarizeIcon, color: "info.main" },
  "stock-analysis-by-supplier": { icon: FactCheckIcon, color: "secondary.main" },
  "stock-analysis-by-category": { icon: CategoryIcon, color: "secondary.main" },
  "stock-movement": { icon: SwapVertIcon, color: "success.main" },
  "stock-take-listing": { icon: ChecklistIcon, color: "success.main" },
  "last-buy-price": { icon: SellIcon, color: "primary.main" },
  "reorder-level": { icon: NotificationsActiveIcon, color: "error.main" },
};

export default function InventoryReportsPage() {
  const router = useRouter();
  return (
    <Box>
      <Typography variant="h4" sx={{ mb: 1, fontWeight: "bold" }}>
        Inventory Reports
      </Typography>
      <Typography variant="body1" color="textSecondary" sx={{ mb: 4 }}>
        Select a report to view your stock position and purchasing history
      </Typography>

      <Grid container spacing={3}>
        {REPORTS.map((report) => {
          const art = ART[report.slug];
          const Icon = art.icon;
          return (
            <Grid item xs={12} sm={6} md={4} key={report.slug}>
              <Card
                sx={{
                  height: "100%",
                  transition: "transform 0.2s, box-shadow 0.2s",
                  "&:hover": { transform: "translateY(-4px)", boxShadow: 4 },
                }}
              >
                <CardActionArea onClick={() => router.push(`/portal/inventory/reports/${report.slug}`)} sx={{ height: "100%" }}>
                  <CardContent>
                    <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", color: art.color, mb: 2 }}>
                      <Icon sx={{ fontSize: 48 }} />
                    </Box>
                    <Typography variant="h6" sx={{ fontWeight: "bold", mb: 1, textAlign: "center" }}>
                      {report.title}
                    </Typography>
                    <Typography variant="body2" color="textSecondary" sx={{ textAlign: "center" }}>
                      {report.description}
                    </Typography>
                  </CardContent>
                </CardActionArea>
              </Card>
            </Grid>
          );
        })}
      </Grid>
    </Box>
  );
}
