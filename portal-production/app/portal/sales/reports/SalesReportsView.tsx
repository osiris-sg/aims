"use client";

// Sales → Reports directory (guru 2026-11-25). Same shape as the accounting
// reports view: cards grouped into sections, click one to open it in place.
// The legacy "Sales Report" menu, modernised; the Summary-By-X reports are
// live, the rest are being filled in.

import React, { useMemo, useState } from "react";
import { Alert, Box, Button, Card, CardActionArea, InputAdornment, TextField, Typography } from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
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
  render?: () => React.ReactNode;
};

const summary = (dimension: SalesDimension) => () => <SalesSummaryReport dimension={dimension} />;
const detailed = (dimension: SalesDimension) => () => <DetailedSalesReport dimension={dimension} />;
const listing = (type: ListingType) => () => <DocumentListingReport type={type} />;

const REPORTS: ReportEntry[] = [
  { key: "quotation-listing", label: "Quotation Listing", description: "Quotations for a period.", section: "Listings", render: listing("quotation") },
  { key: "do-listing", label: "Delivery Order Listing", description: "Delivery orders for a period.", section: "Listings", render: listing("do") },
  { key: "outstanding", label: "Outstanding — Transactions", description: "Unpaid invoices with balance due.", section: "Listings", render: listing("outstanding") },
  { key: "invoice-listing", label: "Invoice Listing", description: "Invoices for a period.", section: "Listings", render: listing("invoice") },

  { key: "sum-customer", label: "Sales Summary By Customer", description: "Total sales, cost, nett profit and profit % per customer.", section: "Summary & Analysis", render: summary("customer") },
  { key: "det-customer", label: "Detailed Sales Analysis By Customer", description: "Every sales line grouped by customer.", section: "Summary & Analysis", render: detailed("customer") },
  { key: "sum-salesman", label: "Sales Summary By Salesman", description: "Sales, cost and profit per salesman.", section: "Summary & Analysis", render: summary("salesman") },
  { key: "det-salesman", label: "Detailed Sales Analysis By Salesman", description: "Every sales line grouped by salesman.", section: "Summary & Analysis", render: detailed("salesman") },
  { key: "sum-product", label: "Sales Summary By Product", description: "Sales, cost and profit per product.", section: "Summary & Analysis", render: summary("product") },
  { key: "det-product", label: "Detailed Sales Analysis By Product", description: "Every sales line grouped by product.", section: "Summary & Analysis", render: detailed("product") },
  { key: "sum-category", label: "Sales Summary By Category", description: "Sales, cost and profit per product category.", section: "Summary & Analysis", render: summary("category") },
  { key: "det-category", label: "Detailed Sales Analysis By Category", description: "Every sales line grouped by category.", section: "Summary & Analysis", render: detailed("category") },

  { key: "last-sold", label: "Last Sold Report", description: "Each item's most recent sale.", section: "Items", render: () => <LastSoldReport /> },
  { key: "slow-moving", label: "Slow Moving Items Analysis", description: "Items with little or no recent sales.", section: "Items", render: () => <SlowMovingReport /> },
];

const SECTIONS = ["Listings", "Summary & Analysis", "Items"];

export default function SalesReportsView() {
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [search, setSearch] = useState("");

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

  const q = search.trim().toLowerCase();
  const match = (r: ReportEntry) => !q || r.label.toLowerCase().includes(q) || r.description.toLowerCase().includes(q);

  return (
    <Box sx={{ p: { xs: 1.5, md: 3 }, display: "flex", flexDirection: "column", gap: 2 }}>
      <Box>
        <Typography variant="h5" sx={{ fontWeight: 700 }}>Sales Reports</Typography>
        <Typography variant="body2" color="text.secondary">Listings, sales analysis and item reports.</Typography>
      </Box>
      <TextField
        size="small"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search reports"
        sx={{ maxWidth: 360 }}
        InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }}
      />
      {SECTIONS.map((section) => {
        const rows = REPORTS.filter((r) => r.section === section && match(r));
        if (!rows.length) return null;
        return (
          <Box key={section} sx={{ mb: 2 }}>
            <Typography variant="overline" sx={{ color: "text.secondary", fontWeight: 700, letterSpacing: "0.6px", mb: 1.5, display: "block" }}>
              {section}
            </Typography>
            <Box sx={{ display: "grid", gap: 1.5, gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr", md: "1fr 1fr 1fr" } }}>
              {rows.map((r) => (
                <Card key={r.key} variant="outlined" sx={{ borderRadius: 1.5, transition: "border-color 160ms ease, box-shadow 160ms ease", "&:hover": { borderColor: "primary.main", boxShadow: 1 }, opacity: r.render ? 1 : 0.6 }}>
                  <CardActionArea onClick={() => setSelectedKey(r.key)} sx={{ p: 2, display: "block" }}>
                    <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 0.5 }}>
                      {r.label}{!r.render && <Typography component="span" variant="caption" sx={{ ml: 1, color: "text.disabled" }}>soon</Typography>}
                    </Typography>
                    <Typography variant="body2" sx={{ color: "text.secondary", lineHeight: 1.4 }}>{r.description}</Typography>
                  </CardActionArea>
                </Card>
              ))}
            </Box>
          </Box>
        );
      })}
    </Box>
  );
}
