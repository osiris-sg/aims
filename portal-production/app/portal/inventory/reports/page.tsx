"use client";

import React from "react";
import MainCard from "@/components/MainCard";
import { Box, Typography, Button, Grid, Card, CardContent, CardActions } from "@mui/material";
import AssessmentIcon from "@mui/icons-material/Assessment";
import ConstructionIcon from "@mui/icons-material/Construction";
import TrendingUpIcon from "@mui/icons-material/TrendingUp";
import InventoryIcon from "@mui/icons-material/Inventory";
import HistoryIcon from "@mui/icons-material/History";

const reportTypes = [
  {
    title: "Stock Summary",
    description: "Overview of current stock levels across all products",
    icon: InventoryIcon,
  },
  {
    title: "Stock Movement",
    description: "Track stock ins and outs over a period",
    icon: TrendingUpIcon,
  },
  {
    title: "Stock Valuation",
    description: "Value of inventory based on cost and quantity",
    icon: AssessmentIcon,
  },
  {
    title: "Transaction History",
    description: "Detailed log of all inventory transactions",
    icon: HistoryIcon,
  },
];

export default function InventoryReportsPage() {
  return (
    <MainCard>
      <Box sx={{ mb: 4 }}>
        <Typography variant="h4" gutterBottom>
          Inventory Reports
        </Typography>
        <Typography variant="body1" color="text.secondary">
          Generate and view various inventory reports to gain insights into your stock management.
        </Typography>
      </Box>

      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 4, color: "warning.main" }}>
        <ConstructionIcon />
        <Typography variant="body2" color="warning.main">
          Reports feature is coming soon
        </Typography>
      </Box>

      <Grid container spacing={3}>
        {reportTypes.map((report) => {
          const IconComponent = report.icon;
          return (
            <Grid item xs={12} sm={6} md={3} key={report.title}>
              <Card sx={{ height: "100%", display: "flex", flexDirection: "column", opacity: 0.7 }}>
                <CardContent sx={{ flexGrow: 1 }}>
                  <Box
                    sx={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      width: 56,
                      height: 56,
                      borderRadius: 2,
                      bgcolor: "primary.light",
                      mb: 2,
                    }}
                  >
                    <IconComponent sx={{ fontSize: 28, color: "primary.main" }} />
                  </Box>
                  <Typography variant="h6" gutterBottom>
                    {report.title}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {report.description}
                  </Typography>
                </CardContent>
                <CardActions>
                  <Button size="small" disabled>
                    Generate Report
                  </Button>
                </CardActions>
              </Card>
            </Grid>
          );
        })}
      </Grid>
    </MainCard>
  );
}
