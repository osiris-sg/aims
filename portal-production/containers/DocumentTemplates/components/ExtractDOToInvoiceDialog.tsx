"use client";

import React, { useState, useMemo, useEffect } from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  Box,
  TextField,
  RadioGroup,
  FormControlLabel,
  Radio,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  IconButton,
  Typography,
  InputAdornment,
} from "@mui/material";
import {
  Close as CloseIcon,
  Search as SearchIcon,
} from "@mui/icons-material";
import moment from "moment";

interface DeliveryOrderDocument {
  id: string;
  name: string;
  type: string;
  templateId: string;
  status?: string;
  createdAt: string;
  associated_customer?: string;
  customer?: { name?: string };
  customerName?: string;
  config?: {
    customerId?: string;
    customerCode?: string;
    customerName?: string;
    customerAddress?: string;
    customerEmail?: string;
    salesmanCode?: string;
    salesmanName?: string;
    poNo?: string;
    referenceNo?: string;
    items?: any[];
    [key: string]: any;
  };
}

interface ExtractDOToInvoiceDialogProps {
  open: boolean;
  onClose: () => void;
  onSelectDO: (deliveryOrder: DeliveryOrderDocument) => void;
  deliveryOrders: DeliveryOrderDocument[];
  selectedCustomerId?: string;
  selectedCustomerName?: string;
}

type SearchMode = "number" | "name";

export default function ExtractDOToInvoiceDialog({
  open,
  onClose,
  onSelectDO,
  deliveryOrders,
  selectedCustomerId,
  selectedCustomerName,
}: ExtractDOToInvoiceDialogProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [searchMode, setSearchMode] = useState<SearchMode>("number");

  // Reset search when dialog opens
  useEffect(() => {
    if (open) {
      setSearchTerm("");
    }
  }, [open]);

  // Filter delivery orders based on search term, mode, and selected customer
  const filteredDeliveryOrders = useMemo(() => {
    let filtered = deliveryOrders;

    // If a customer is already selected in Invoice, auto-filter to that customer's DOs
    if (selectedCustomerId) {
      filtered = filtered.filter(
        (d) => d.config?.customerId === selectedCustomerId
      );
    }

    // Apply search filter
    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase();
      filtered = filtered.filter((d) => {
        switch (searchMode) {
          case "number":
            return d.name?.toLowerCase().includes(term);
          case "name":
            const customerName = d.config?.customerName || "";
            return customerName.toLowerCase().includes(term);
          default:
            return true;
        }
      });
    }

    return filtered;
  }, [deliveryOrders, searchTerm, searchMode, selectedCustomerId]);

  const handleRowClick = (deliveryOrder: DeliveryOrderDocument) => {
    onSelectDO(deliveryOrder);
    setSearchTerm("");
    onClose();
  };

  const handleClose = () => {
    setSearchTerm("");
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      maxWidth="md"
      fullWidth
      PaperProps={{
        sx: {
          minHeight: "60vh",
          maxHeight: "80vh",
        },
      }}
    >
      <DialogTitle
        sx={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          bgcolor: "primary.main",
          color: "primary.contrastText",
          py: 1.5,
        }}
      >
        <Typography variant="h6" fontWeight={500}>
          Extract Delivery Order to Invoice
        </Typography>
        <IconButton onClick={handleClose} size="small" sx={{ color: "primary.contrastText" }}>
          <CloseIcon />
        </IconButton>
      </DialogTitle>

      <DialogContent sx={{ p: 0 }}>
        {/* Search Section */}
        <Box
          sx={{
            p: 2,
            bgcolor: "tertiary.light",
            borderBottom: "1px solid",
            borderColor: "divider",
          }}
        >
          {/* Show customer filter info if customer is selected */}
          {selectedCustomerName && (
            <Typography variant="body2" color="primary.main" sx={{ mb: 1, fontWeight: 500 }}>
              Showing delivery orders for: {selectedCustomerName}
            </Typography>
          )}

          {/* Search Input */}
          <TextField
            fullWidth
            placeholder="Search delivery orders..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            size="small"
            autoFocus
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon color="action" />
                </InputAdornment>
              ),
            }}
            sx={{
              mb: 1.5,
              bgcolor: "background.paper",
            }}
          />

          {/* Search Mode Radio Buttons */}
          <RadioGroup
            row
            value={searchMode}
            onChange={(e) => setSearchMode(e.target.value as SearchMode)}
          >
            <FormControlLabel
              value="number"
              control={<Radio size="small" color="primary" />}
              label="Search By Delivery Order Number"
              sx={{ mr: 3 }}
            />
            <FormControlLabel
              value="name"
              control={<Radio size="small" color="primary" />}
              label="Search By Name"
            />
          </RadioGroup>
        </Box>

        {/* Results Table */}
        <TableContainer component={Paper} sx={{ maxHeight: "calc(80vh - 280px)" }}>
          <Table stickyHeader size="small">
            <TableHead>
              <TableRow>
                <TableCell
                  sx={{
                    fontWeight: 600,
                    bgcolor: "grey.100",
                    borderBottom: 2,
                    borderColor: "primary.main",
                    width: "20%",
                  }}
                >
                  Delivery Order No.
                </TableCell>
                <TableCell
                  sx={{
                    fontWeight: 600,
                    bgcolor: "grey.100",
                    borderBottom: 2,
                    borderColor: "primary.main",
                    width: "15%",
                  }}
                >
                  Date
                </TableCell>
                <TableCell
                  sx={{
                    fontWeight: 600,
                    bgcolor: "grey.100",
                    borderBottom: 2,
                    borderColor: "primary.main",
                    width: "45%",
                  }}
                >
                  Name
                </TableCell>
                <TableCell
                  sx={{
                    fontWeight: 600,
                    bgcolor: "grey.100",
                    borderBottom: 2,
                    borderColor: "primary.main",
                    width: "20%",
                  }}
                >
                  Purchase Order No.
                </TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {filteredDeliveryOrders.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} align="center" sx={{ py: 4 }}>
                    <Typography color="text.secondary">
                      {searchTerm
                        ? "No delivery orders found matching your search"
                        : selectedCustomerId
                        ? "No delivery orders available for this customer"
                        : "No delivery orders available"}
                    </Typography>
                  </TableCell>
                </TableRow>
              ) : (
                filteredDeliveryOrders.map((deliveryOrder, index) => (
                  <TableRow
                    key={deliveryOrder.id || index}
                    hover
                    onClick={() => handleRowClick(deliveryOrder)}
                    sx={{
                      cursor: "pointer",
                      "&:hover": {
                        bgcolor: "secondary.light",
                      },
                      "&:nth-of-type(even)": {
                        bgcolor: "tertiary.light",
                      },
                    }}
                  >
                    <TableCell sx={{ fontWeight: 500, color: "primary.main" }}>
                      {deliveryOrder.name || "-"}
                    </TableCell>
                    <TableCell>
                      {deliveryOrder.createdAt ? moment(deliveryOrder.createdAt).format("DD/MM/YYYY") : "-"}
                    </TableCell>
                    <TableCell>
                      {deliveryOrder.config?.customerName ||
                       (deliveryOrder.associated_customer && deliveryOrder.associated_customer !== "N/A" ? deliveryOrder.associated_customer : null) ||
                       deliveryOrder.customer?.name ||
                       deliveryOrder.customerName ||
                       "-"}
                    </TableCell>
                    <TableCell>
                      {deliveryOrder.config?.poNo ||
                       deliveryOrder.config?.referenceNo ||
                       "-"}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableContainer>

        {/* Footer with count */}
        <Box
          sx={{
            p: 1.5,
            bgcolor: "tertiary.light",
            borderTop: "1px solid",
            borderColor: "divider",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <Typography variant="body2" color="text.secondary">
            Showing {filteredDeliveryOrders.length} of {deliveryOrders.length} delivery orders
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Click on a row to extract delivery order data
          </Typography>
        </Box>
      </DialogContent>
    </Dialog>
  );
}
