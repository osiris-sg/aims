"use client";
import React from "react";
import { Box, Grid, Typography } from "@mui/material";
import MainCard from "@/components/MainCard";
import AssetsOverviewCard from "@/components/Dashboard/AssetsOverviewCard";
import InvoicesDueCard from "@/components/Dashboard/InvoicesDueCard";
import DeliveryOrdersCard from "@/components/Dashboard/DeliveryOrdersCard";
import ProjectsEndingCard from "@/components/Dashboard/ProjectsEndingCard";

export default function DashboardOverview() {
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
