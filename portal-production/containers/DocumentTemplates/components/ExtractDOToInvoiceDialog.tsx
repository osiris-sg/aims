"use client";

import React, { useState, useMemo, useEffect } from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Box,
  TextField,
  RadioGroup,
  FormControlLabel,
  Radio,
  Checkbox,
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
  Button,
} from "@mui/material";
import {
  Close as CloseIcon,
  Search as SearchIcon,
} from "@mui/icons-material";
import moment from "moment";
import { toast } from "react-toastify";

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
  onSelectMultipleDOs?: (deliveryOrders: DeliveryOrderDocument[]) => void;
  deliveryOrders: DeliveryOrderDocument[];
  selectedCustomerId?: string;
  selectedCustomerName?: string;
}

type SearchMode = "number" | "name";

export default function ExtractDOToInvoiceDialog({
  open,
  onClose,
  onSelectDO,
  onSelectMultipleDOs,
  deliveryOrders,
  selectedCustomerId,
  selectedCustomerName,
}: ExtractDOToInvoiceDialogProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [searchMode, setSearchMode] = useState<SearchMode>("number");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Reset search and selection when dialog opens
  useEffect(() => {
    if (open) {
      setSearchTerm("");
      setSelectedIds(new Set());
    }
  }, [open]);

  // Get customer ID from a delivery order
  const getCustomerId = (doId: string): string | undefined => {
    const doc = deliveryOrders.find((d) => d.id === doId);
    return doc?.config?.customerId;
  };

  // Toggle selection for a single row with customer validation
  const handleToggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const newSet = new Set(prev);

      if (newSet.has(id)) {
        // Deselecting - always allow
        newSet.delete(id);
      } else {
        // Selecting - check customer consistency
        const newDoCustomerId = getCustomerId(id);

        // If there are already selected DOs, check if the customer matches
        if (newSet.size > 0) {
          const firstSelectedId = Array.from(newSet)[0];
          const existingCustomerId = getCustomerId(firstSelectedId);

          if (newDoCustomerId !== existingCustomerId) {
            toast.error("Cannot select delivery orders from different customers");
            return prev; // Return unchanged set
          }
        }

        newSet.add(id);
      }
      return newSet;
    });
  };

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

  // Toggle select all visible rows (only if all have the same customer)
  const handleToggleSelectAll = () => {
    if (selectedIds.size === filteredDeliveryOrders.length && selectedIds.size > 0) {
      // Deselect all
      setSelectedIds(new Set());
    } else {
      // Check if all visible DOs have the same customer
      const customerIds = new Set(
        filteredDeliveryOrders.map((d) => d.config?.customerId).filter(Boolean)
      );

      if (customerIds.size > 1) {
        toast.error("Cannot select all - delivery orders have different customers");
        return;
      }

      setSelectedIds(new Set(filteredDeliveryOrders.map((d) => d.id)));
    }
  };

  // Check if all visible rows are selected
  const isAllSelected = filteredDeliveryOrders.length > 0 && selectedIds.size === filteredDeliveryOrders.length;
  const isIndeterminate = selectedIds.size > 0 && selectedIds.size < filteredDeliveryOrders.length;

  const handleRowClick = (deliveryOrder: DeliveryOrderDocument) => {
    // If multi-select is enabled, toggle the checkbox instead
    handleToggleSelect(deliveryOrder.id);
  };

  const handleExtract = () => {
    const selectedDOs = filteredDeliveryOrders.filter((d) => selectedIds.has(d.id));
    if (selectedDOs.length === 0) return;

    if (selectedDOs.length === 1) {
      // Single selection - use original callback
      onSelectDO(selectedDOs[0]);
    } else if (onSelectMultipleDOs) {
      // Multiple selection
      onSelectMultipleDOs(selectedDOs);
    } else {
      // Fallback to first item if multi-select callback not provided
      onSelectDO(selectedDOs[0]);
    }
    setSearchTerm("");
    setSelectedIds(new Set());
    onClose();
  };

  const handleClose = () => {
    setSearchTerm("");
    setSelectedIds(new Set());
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
                  padding="checkbox"
                  sx={{
                    bgcolor: "grey.100",
                    borderBottom: 2,
                    borderColor: "primary.main",
                    width: "5%",
                  }}
                >
                  <Checkbox
                    indeterminate={isIndeterminate}
                    checked={isAllSelected}
                    onChange={handleToggleSelectAll}
                    size="small"
                  />
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
                  <TableCell colSpan={5} align="center" sx={{ py: 4 }}>
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
                filteredDeliveryOrders.map((deliveryOrder, index) => {
                  const isSelected = selectedIds.has(deliveryOrder.id);
                  return (
                    <TableRow
                      key={deliveryOrder.id || index}
                      hover
                      onClick={() => handleRowClick(deliveryOrder)}
                      selected={isSelected}
                      sx={{
                        cursor: "pointer",
                        "&:hover": {
                          bgcolor: "secondary.light",
                        },
                        "&:nth-of-type(even)": {
                          bgcolor: isSelected ? "primary.light" : "tertiary.light",
                        },
                        "&.Mui-selected": {
                          bgcolor: "primary.light",
                          "&:hover": {
                            bgcolor: "primary.light",
                          },
                        },
                      }}
                    >
                      <TableCell padding="checkbox">
                        <Checkbox
                          checked={isSelected}
                          size="small"
                          onClick={(e) => e.stopPropagation()}
                          onChange={() => handleToggleSelect(deliveryOrder.id)}
                        />
                      </TableCell>
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
                  );
                })
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
            {selectedIds.size > 0 && (
              <Typography component="span" variant="body2" color="primary.main" fontWeight={500} sx={{ ml: 1 }}>
                ({selectedIds.size} selected)
              </Typography>
            )}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Select delivery orders to extract
          </Typography>
        </Box>
      </DialogContent>

      <DialogActions sx={{ px: 2, py: 1.5, borderTop: "1px solid", borderColor: "divider" }}>
        <Button variant="outlined" onClick={handleClose}>
          Cancel
        </Button>
        <Button
          variant="contained"
          onClick={handleExtract}
          disabled={selectedIds.size === 0}
        >
          Extract {selectedIds.size > 0 ? `(${selectedIds.size})` : ""}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
