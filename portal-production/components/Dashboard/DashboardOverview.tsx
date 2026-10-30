"use client";
import React from "react";
import { Box, Grid, Typography } from "@mui/material";
import MainCard, { MainCardEmbedContext } from "@/components/MainCard";
import AssetsOverviewCard from "@/components/Dashboard/AssetsOverviewCard";
import InvoicesDueCard from "@/components/Dashboard/InvoicesDueCard";
import DeliveryOrdersCard from "@/components/Dashboard/DeliveryOrdersCard";
import ProjectsEndingCard from "@/components/Dashboard/ProjectsEndingCard";
import IdDashboard from "@/components/Dashboard/IdDashboard";
import OpsDashboard from "@/components/Dashboard/OpsDashboard";
import JobsCalendar from "@/components/Dashboard/JobsCalendar";
import { useOrganizationFeatures } from "@/app/portal/hooks/useOrganizationFeatures";

export default function DashboardOverview() {
  const { isJobsCalendarEnabled } = useOrganizationFeatures();
  // Jobs calendar orgs (enableJobsCalendar, WCT): the calendar comes first and
  // the org's usual dashboard sections follow below it. Everyone else: as before.
  if (!isJobsCalendarEnabled) return <OrgDashboard />;
  return (
    <MainCard>
      <JobsCalendar />
      <MainCardEmbedContext.Provider value={true}>
        <OrgDashboard />
      </MainCardEmbedContext.Provider>
    </MainCard>
  );
}

function OrgDashboard() {
  // Interior-design orgs (enableIdQuotation) get the designer dashboard —
  // projects/leads/revenue-vs-target — instead of the rental cards.
  // Equipment-rental orgs (enableOpsDashboard) get the operations screen.
  const { isIdQuotationEnabled, isOpsDashboardEnabled, isLoading } = useOrganizationFeatures();
  if (isIdQuotationEnabled) return <IdDashboard />;
  if (isLoading) return null;
  if (isOpsDashboardEnabled) return <OpsDashboard />;
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
