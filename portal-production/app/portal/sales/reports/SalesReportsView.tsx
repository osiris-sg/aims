"use client";

// Sales → Reports directory (guru 2026-11-25). The legacy "Sales Report" menu,
// modernised; click a card to open the report in place.
//
// Same screen as Inventory → Reports (guru 2026-11-26, "match the sales reports ui
// to inventory reports"): h4 title over a one-line lead, then cards three across
// with a big centred icon, the report's name under it and what it answers under
// that, lifting on hover. No search box and no section headings, like that page.
// Icon colours are theme tokens, so they hold up in dark mode.

import React, { useMemo, useState } from "react";
import { Alert, Box, Button, Card, CardActionArea, CardContent, Grid, Typography } from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import RequestQuoteIcon from "@mui/icons-material/RequestQuote";
import LocalShippingIcon from "@mui/icons-material/LocalShipping";
import PendingActionsIcon from "@mui/icons-material/PendingActions";
import ReceiptLongIcon from "@mui/icons-material/ReceiptLong";
import PeopleIcon from "@mui/icons-material/People";
import PersonSearchIcon from "@mui/icons-material/PersonSearch";
import BadgeIcon from "@mui/icons-material/Badge";
import ManageSearchIcon from "@mui/icons-material/ManageSearch";
import Inventory2Icon from "@mui/icons-material/Inventory2";
import FactCheckIcon from "@mui/icons-material/FactCheck";
import CategoryIcon from "@mui/icons-material/Category";
import SummarizeIcon from "@mui/icons-material/Summarize";
import HistoryIcon from "@mui/icons-material/History";
import HourglassBottomIcon from "@mui/icons-material/HourglassBottom";
import SalesSummaryReport, { type SalesDimension } from "./SalesSummaryReport";
import DetailedSalesReport from "./DetailedSalesReport";
import DocumentListingReport, { type ListingType } from "./DocumentListingReport";
import LastSoldReport from "./LastSoldReport";
import SlowMovingReport from "./SlowMovingReport";

type ReportEntry = {
  key: string;
  label: string;
  description: string;
  section: string;
  icon: React.ElementType;
  color: string;
  render?: () => React.ReactNode;
};

const summary = (dimension: SalesDimension) => () => <SalesSummaryReport dimension={dimension} />;
const detailed = (dimension: SalesDimension) => () => <DetailedSalesReport dimension={dimension} />;
const listing = (type: ListingType) => () => <DocumentListingReport type={type} />;

const REPORTS: ReportEntry[] = [
  { key: "quotation-listing", icon: RequestQuoteIcon, color: "primary.main", label: "Quotation Listing", description: "Quotations for a period.", section: "Listings", render: listing("quotation") },
  { key: "do-listing", icon: LocalShippingIcon, color: "info.main", label: "Delivery Order Listing", description: "Delivery orders for a period.", section: "Listings", render: listing("do") },
  { key: "outstanding", icon: PendingActionsIcon, color: "warning.main", label: "Outstanding — Transactions", description: "Unpaid invoices with balance due.", section: "Listings", render: listing("outstanding") },
  { key: "invoice-listing", icon: ReceiptLongIcon, color: "primary.main", label: "Invoice Listing", description: "Invoices for a period.", section: "Listings", render: listing("invoice") },

  { key: "sum-customer", icon: PeopleIcon, color: "secondary.main", label: "Sales Summary By Customer", description: "Total sales, cost, nett profit and profit % per customer.", section: "Summary & Analysis", render: summary("customer") },
  { key: "det-customer", icon: PersonSearchIcon, color: "secondary.main", label: "Detailed Sales Analysis By Customer", description: "Every sales line grouped by customer.", section: "Summary & Analysis", render: detailed("customer") },
  { key: "sum-salesman", icon: BadgeIcon, color: "info.main", label: "Sales Summary By Salesman", description: "Sales, cost and profit per salesman.", section: "Summary & Analysis", render: summary("salesman") },
  { key: "det-salesman", icon: ManageSearchIcon, color: "info.main", label: "Detailed Sales Analysis By Salesman", description: "Every sales line grouped by salesman.", section: "Summary & Analysis", render: detailed("salesman") },
  { key: "sum-product", icon: Inventory2Icon, color: "success.main", label: "Sales Summary By Product", description: "Sales, cost and profit per product.", section: "Summary & Analysis", render: summary("product") },
  { key: "det-product", icon: FactCheckIcon, color: "success.main", label: "Detailed Sales Analysis By Product", description: "Every sales line grouped by product.", section: "Summary & Analysis", render: detailed("product") },
  { key: "sum-category", icon: CategoryIcon, color: "secondary.main", label: "Sales Summary By Category", description: "Sales, cost and profit per product category.", section: "Summary & Analysis", render: summary("category") },
  { key: "det-category", icon: SummarizeIcon, color: "secondary.main", label: "Detailed Sales Analysis By Category", description: "Every sales line grouped by category.", section: "Summary & Analysis", render: detailed("category") },

  { key: "last-sold", icon: HistoryIcon, color: "primary.main", label: "Last Sold Report", description: "Each item's most recent sale.", section: "Items", render: () => <LastSoldReport /> },
  { key: "slow-moving", icon: HourglassBottomIcon, color: "error.main", label: "Slow Moving Items Analysis", description: "Items with little or no recent sales.", section: "Items", render: () => <SlowMovingReport /> },
];


export default function SalesReportsView() {
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const selected = useMemo(() => REPORTS.find((r) => r.key === selectedKey) || null, [selectedKey]);

  if (selected) {
    return (
      <Box sx={{ p: { xs: 1.5, md: 3 } }}>
        <Button startIcon={<ArrowBackIcon />} onClick={() => setSelectedKey(null)} sx={{ mb: 1 }}>
          All sales reports
        </Button>
        {selected.render ? selected.render() : <Alert severity="info">“{selected.label}” isn’t built yet — coming next.</Alert>}
      </Box>
    );
  }

  return (
    <Box>
      <Typography variant="h4" sx={{ mb: 1, fontWeight: "bold" }}>
        Sales Reports
      </Typography>
      <Typography variant="body1" color="textSecondary" sx={{ mb: 4 }}>
        Select a report to view your listings, sales analysis and item history
      </Typography>

      <Grid container spacing={3}>
        {REPORTS.map((r) => {
          const Icon = r.icon;
          return (
            <Grid item xs={12} sm={6} md={4} key={r.key}>
              <Card
                sx={{
                  height: "100%",
                  opacity: r.render ? 1 : 0.6,
                  transition: "transform 0.2s, box-shadow 0.2s",
                  "&:hover": { transform: "translateY(-4px)", boxShadow: 4 },
                }}
              >
                <CardActionArea onClick={() => setSelectedKey(r.key)} sx={{ height: "100%" }}>
                  <CardContent>
                    <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", color: r.color, mb: 2 }}>
                      <Icon sx={{ fontSize: 48 }} />
                    </Box>
                    <Typography variant="h6" sx={{ fontWeight: "bold", mb: 1, textAlign: "center" }}>
                      {r.label}
                      {!r.render && <Typography component="span" variant="caption" sx={{ ml: 1, color: "text.disabled" }}>soon</Typography>}
                    </Typography>
                    <Typography variant="body2" color="textSecondary" sx={{ textAlign: "center" }}>
                      {r.description}
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
