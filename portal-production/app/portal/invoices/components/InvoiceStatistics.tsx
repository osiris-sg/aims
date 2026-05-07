"use client";

import React, { useMemo } from "react";
import { Box, Card, CardContent, Typography, Grid, Skeleton } from "@mui/material";
import TrendingUpIcon from "@mui/icons-material/TrendingUp";
import WarningIcon from "@mui/icons-material/Warning";
import ScheduleIcon from "@mui/icons-material/Schedule";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import moment from "moment";

interface InvoiceStatisticsProps {
  documents: any[];
  loading?: boolean;
}

export default function InvoiceStatistics({ documents, loading }: InvoiceStatisticsProps) {
  // Helper function to calculate amount from items if needed
  const calculateAmountFromItems = (items: any[]) => {
    if (!items || items.length === 0) return 0;

    return items.reduce((total, item) => {
      const quantity = item.quantity || 1;
      const price = item.price || item.unitPrice || 0;
      const tax = item.tax || 0;
      const itemTotal = quantity * price * (1 + tax / 100);
      return total + itemTotal;
    }, 0);
  };

  const statistics = useMemo(() => {
    if (!documents || documents.length === 0) {
      return {
        totalOutstanding: 0,
        overdue: 0,
        due: 0,
        paid: 0,
      };
    }

    const today = moment().startOf('day');
    let totalOutstanding = 0;
    let overdue = 0;
    let due = 0;
    let paid = 0;

    documents.forEach((doc) => {
      // Calculate amount from items or use a default totalAmount field
      const amount = doc.config?.totalAmount ||
                     doc.config?.amount ||
                     doc.amount ||
                     calculateAmountFromItems(doc.config?.items) ||
                     0;

      // Check payment status
      const isPaid = doc.status === 'paid' || doc.status === 'completed';
      const dueDate = doc.config?.dueDate ? moment(doc.config.dueDate) : null;

      if (isPaid) {
        paid += amount;
      } else {
        totalOutstanding += amount;

        // Check if overdue or due
        if (dueDate) {
          if (dueDate.isBefore(today)) {
            overdue += amount;
          } else {
            due += amount;
          }
        } else {
          // If no due date, consider it as due
          due += amount;
        }
      }
    });

    return {
      totalOutstanding,
      overdue,
      due,
      paid,
    };
  }, [documents]);

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-SG', {
      style: 'currency',
      currency: 'SGD',
      minimumFractionDigits: 2,
    }).format(amount);
  };

  const statsCards = [
    {
      title: "TOTAL OUTSTANDING",
      value: statistics.totalOutstanding,
      icon: <TrendingUpIcon />,
      color: "primary.main",
      bgColor: "surfaceTones.high",
    },
    {
      title: "OVERDUE",
      value: statistics.overdue,
      icon: <WarningIcon />,
      color: "customRed.main",
      bgColor: "customRed.light",
    },
    {
      title: "DUE",
      value: statistics.due,
      icon: <ScheduleIcon />,
      color: "customYellow.dark",
      bgColor: "customYellow.light",
    },
    {
      title: "PAID",
      value: statistics.paid,
      icon: <CheckCircleIcon />,
      color: "success.main",
      bgColor: "success.light",
    },
  ];

  if (loading) {
    return (
      <Box sx={{ mb: 3 }}>
        <Grid container spacing={2}>
          {[1, 2, 3, 4].map((item) => (
            <Grid item xs={12} sm={6} md={3} key={item}>
              <Card elevation={0} sx={{ border: 1, borderColor: "divider" }}>
                <CardContent>
                  <Skeleton variant="text" width="60%" height={20} />
                  <Skeleton variant="text" width="80%" height={40} />
                </CardContent>
              </Card>
            </Grid>
          ))}
        </Grid>
      </Box>
    );
  }

  return (
    <Box sx={{ mb: 3 }}>
      <Grid container spacing={2}>
        {statsCards.map((stat, index) => (
          <Grid item xs={12} sm={6} md={3} key={index}>
            <Card
              elevation={0}
              sx={{
                border: 1,
                borderColor: "divider",
                height: "100%",
                transition: "all 0.3s ease",
                "&:hover": {
                  boxShadow: 2,
                  transform: "translateY(-2px)",
                }
              }}
            >
              <CardContent>
                <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 1 }}>
                  <Typography
                    variant="caption"
                    sx={{
                      color: "text.secondary",
                      fontWeight: 500,
                      fontSize: "0.75rem",
                      letterSpacing: "0.5px"
                    }}
                  >
                    {stat.title}
                  </Typography>
                  <Box
                    sx={{
                      backgroundColor: stat.bgColor,
                      borderRadius: "50%",
                      p: 0.5,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    {React.cloneElement(stat.icon, {
                      sx: {
                        fontSize: 20,
                        color: stat.color
                      }
                    })}
                  </Box>
                </Box>
                <Typography
                  variant="h5"
                  sx={{
                    fontWeight: 600,
                    color: stat.color,
                    mt: 1
                  }}
                >
                  {formatCurrency(stat.value)}
                </Typography>
              </CardContent>
            </Card>
          </Grid>
        ))}
      </Grid>
    </Box>
  );
}