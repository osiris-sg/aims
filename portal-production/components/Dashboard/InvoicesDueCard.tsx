"use client";
import React, {useEffect} from "react";
import { Box, Card, CardContent, Typography, CircularProgress, Alert, List, ListItem, ListItemText } from "@mui/material";
import AssignmentLateIcon from "@mui/icons-material/AssignmentLate";
import useInvoicesDue from "@/hooks/useInvoicesDue";
import moment from "moment";

export default function InvoicesDueCard() {
  const { invoicesData, loading, error } = useInvoicesDue();

  useEffect(() => {
    console.log("🔍 Invoices data:", invoicesData);
  }, [invoicesData]);

  return (
    <Card sx={{ height: "100%", display: "flex", flexDirection: "column", backgroundColor: "white" }}>
      <CardContent sx={{ flexGrow: 1 }}>
        <Box sx={{ display: "flex", alignItems: "center", mb: 2 }}>
          <AssignmentLateIcon sx={{ fontSize: "2rem", mr: 1, color: "error.main" }} />
          <Typography variant="h6" component="h2">
            Invoices Due
          </Typography>
        </Box>

        {loading && <CircularProgress />}

        {error && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {error}
          </Alert>
        )}

        {!loading && !error && invoicesData && (
          <Box>
            <Typography variant="h3" sx={{ mb: 1, fontWeight: "bold", color: "error.main" }}>
              {invoicesData.totalDue}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Invoices Due
            </Typography>

            {invoicesData.urgentInvoices && invoicesData.urgentInvoices.length > 0 && (
              <Box sx={{ mt: 2 }}>
                <Typography variant="body2" sx={{ mb: 1, fontWeight: "bold" }}>
                  Urgent (Due within 3 days):
                </Typography>
                <List dense>
                  {invoicesData.urgentInvoices.slice(0, 3).map((invoice, index) => (
                    <ListItem key={index} sx={{ py: 0.5, px: 0 }}>
                      <ListItemText
                        primary={<Typography variant="body2">{invoice.name}</Typography>}
                        secondary={
                          <Typography variant="caption" color="error">
                            Due: {moment(invoice.dueDate).format("DD/MM/YYYY")}
                          </Typography>
                        }
                      />
                    </ListItem>
                  ))}
                </List>
              </Box>
            )}
          </Box>
        )}
      </CardContent>
    </Card>
  );
}
