"use client";

import React from "react";
import { Box, Grid, Card, CardContent, Typography, CardActionArea } from "@mui/material";
import { Assessment, TrendingUp } from "@mui/icons-material";
import { useRouter } from "next/navigation";

export default function ReportsPage() {
  const router = useRouter();

  const reports = [
    {
      title: "Price History",
      description: "View historical price data for inventory items and track price changes over time",
      icon: <TrendingUp sx={{ fontSize: 48 }} />,
      path: "/portal/reports/price-history",
      color: "#1976d2",
    },
    {
      title: "Statement of Account",
      description: "Generate customer statements showing invoices, payments, balances, and aging analysis",
      icon: <Assessment sx={{ fontSize: 48 }} />,
      path: "/portal/reports/statement-of-account",
      color: "#388e3c",
    },
  ];

  return (
    <Box>
      <Typography variant="h4" sx={{ mb: 1, fontWeight: "bold" }}>
        Reports
      </Typography>
      <Typography variant="body1" color="textSecondary" sx={{ mb: 4 }}>
        Select a report to view financial and operational insights
      </Typography>

      <Grid container spacing={3}>
        {reports.map((report, index) => (
          <Grid item xs={12} sm={6} md={4} key={index}>
            <Card
              sx={{
                height: "100%",
                transition: "transform 0.2s, box-shadow 0.2s",
                "&:hover": {
                  transform: "translateY(-4px)",
                  boxShadow: 4,
                },
              }}
            >
              <CardActionArea onClick={() => router.push(report.path)} sx={{ height: "100%" }}>
                <CardContent>
                  <Box
                    sx={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: report.color,
                      mb: 2,
                    }}
                  >
                    {report.icon}
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
        ))}
      </Grid>
    </Box>
  );
}
