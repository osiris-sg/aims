"use client";
import React from "react";
import { Box, Card, CardContent, Typography, CircularProgress, Alert, List, ListItem, ListItemText, Button } from "@mui/material";
import LocalShippingIcon from "@mui/icons-material/LocalShipping";
import useDeliveryOrders from "@/hooks/useDeliveryOrders";
import moment from "moment";
import { useRouter } from "next/navigation";

export default function DeliveryOrdersCard() {
  const { deliveryOrdersData, loading, error } = useDeliveryOrders();
  const router = useRouter();

  const handleCreateInvoice = (orderId: string) => {
    // Navigate to invoice creation with pre-filled delivery order
    router.push(`/portal/invoices/create?deliveryOrderId=${orderId}`);
  };

  return (
    <Card sx={{ height: "100%", display: "flex", flexDirection: "column", backgroundColor: "white" }}>
      <CardContent sx={{ flexGrow: 1 }}>
        <Box sx={{ display: "flex", alignItems: "center", mb: 2 }}>
          <LocalShippingIcon sx={{ fontSize: "2rem", mr: 1, color: "warning.main" }} />
          <Typography variant="h6" component="h2">
            Pending Invoice Creation
          </Typography>
        </Box>

        {loading && <CircularProgress />}

        {error && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {error}
          </Alert>
        )}

        {!loading && !error && deliveryOrdersData && (
          <Box>
            <Typography variant="h3" sx={{ mb: 1, fontWeight: "bold", color: "warning.main" }}>
              {deliveryOrdersData.totalPending}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Completed Delivery Orders
            </Typography>

            {deliveryOrdersData.pendingOrders && deliveryOrdersData.pendingOrders.length > 0 && (
              <Box sx={{ mt: 2 }}>
                <Typography variant="body2" sx={{ mb: 1, fontWeight: "bold" }}>
                  Recent Completed Orders:
                </Typography>
                <List dense>
                  {deliveryOrdersData.pendingOrders.slice(0, 3).map((order, index) => (
                    <ListItem key={index} sx={{ py: 0.5, px: 0, flexDirection: "column", alignItems: "flex-start" }}>
                      <ListItemText
                        primary={<Typography variant="body2">{order.name}</Typography>}
                        secondary={
                          <Typography variant="caption" color="text.secondary">
                            Customer: {order.customerName} | Completed: {moment(order.completedDate).format("DD/MM/YYYY")}
                          </Typography>
                        }
                      />
                      <Button size="small" variant="outlined" onClick={() => handleCreateInvoice(order.id)} sx={{ mt: 0.5, fontSize: "0.75rem" }}>
                        Create Invoice
                      </Button>
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
