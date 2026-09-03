"use client";
import React from "react";
import { Box, Grid, Typography } from "@mui/material";
import MainCard from "@/components/MainCard";
import AssetsOverviewCard from "@/components/Dashboard/AssetsOverviewCard";
import InvoicesDueCard from "@/components/Dashboard/InvoicesDueCard";
import DeliveryOrdersCard from "@/components/Dashboard/DeliveryOrdersCard";
import ProjectsEndingCard from "@/components/Dashboard/ProjectsEndingCard";
import IdDashboard from "@/components/Dashboard/IdDashboard";
import { useOrganizationFeatures } from "@/app/portal/hooks/useOrganizationFeatures";

export default function DashboardOverview() {
  // Interior-design orgs (enableIdQuotation) get the designer dashboard —
  // projects/leads/revenue-vs-target — instead of the rental cards.
  const { isIdQuotationEnabled, isLoading } = useOrganizationFeatures();
  if (isIdQuotationEnabled) return <IdDashboard />;
  if (isLoading) return null;
  return (
    <MainCard>
      <Box sx={{ width: "100%", height: "100%" }}>
        <Typography variant="h4" sx={{ mb: 3, fontWeight: "bold" }}>
          Dashboard Overview
        </Typography>

        <Grid container spacing={3} sx={{ height: "calc(100% - 80px)" }}>
          <Grid item xs={12} md={6}>
            <AssetsOverviewCard />
          </Grid>

          <Grid item xs={12} md={6}>
            <InvoicesDueCard />
          </Grid>

          <Grid item xs={12} md={6}>
            <DeliveryOrdersCard />
          </Grid>

          <Grid item xs={12} md={6}>
            <ProjectsEndingCard />
          </Grid>
        </Grid>
      </Box>
    </MainCard>
  );
}
