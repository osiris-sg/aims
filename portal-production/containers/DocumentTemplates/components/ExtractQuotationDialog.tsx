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

interface QuotationDocument {
  id: string;
  name: string;
  type: string;
  templateId: string;
  status?: string;
  createdAt: string;
  customer?: { name?: string };
  customerName?: string;
  referenceNo?: string;
  poNo?: string;
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

interface ExtractQuotationDialogProps {
  open: boolean;
  onClose: () => void;
  onSelectQuotation: (quotation: QuotationDocument) => void;
  onSelectMultipleQuotations?: (quotations: QuotationDocument[]) => void;
  quotations: QuotationDocument[];
  selectedCustomerId?: string;
  selectedCustomerName?: string;
}

type SearchMode = "number" | "name";

export default function ExtractQuotationDialog({
  open,
  onClose,
  onSelectQuotation,
  onSelectMultipleQuotations,
  quotations,
  selectedCustomerId,
  selectedCustomerName,
}: ExtractQuotationDialogProps) {
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

  // Get customer ID from a quotation
  const getCustomerId = (quotationId: string): string | undefined => {
    const doc = quotations.find((q) => q.id === quotationId);
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
        const newQuotationCustomerId = getCustomerId(id);

        // If there are already selected quotations, check if the customer matches
        if (newSet.size > 0) {
          const firstSelectedId = Array.from(newSet)[0];
          const existingCustomerId = getCustomerId(firstSelectedId);

          if (newQuotationCustomerId !== existingCustomerId) {
            toast.error("Cannot select quotations from different customers");
            return prev; // Return unchanged set
          }
        }

        newSet.add(id);
      }
      return newSet;
    });
  };

  // Filter quotations based on search term, mode, and selected customer
  const filteredQuotations = useMemo(() => {
    let filtered = quotations;

    // If a customer is already selected in DO, auto-filter to that customer's quotations
    if (selectedCustomerId) {
      filtered = filtered.filter(
        (q) => q.config?.customerId === selectedCustomerId
      );
    }

    // Apply search filter
    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase();
      filtered = filtered.filter((q) => {
        switch (searchMode) {
          case "number":
            return q.name?.toLowerCase().includes(term);
          case "name":
            const customerName = q.config?.customerName || q.customer?.name || q.customerName || "";
            return customerName.toLowerCase().includes(term);
          default:
            return true;
        }
      });
    }

    return filtered;
  }, [quotations, searchTerm, searchMode, selectedCustomerId]);

  // Toggle select all visible rows (only if all have the same customer)
  const handleToggleSelectAll = () => {
    if (selectedIds.size === filteredQuotations.length && selectedIds.size > 0) {
      // Deselect all
      setSelectedIds(new Set());
    } else {
      // Check if all visible quotations have the same customer
      const customerIds = new Set(
        filteredQuotations.map((q) => q.config?.customerId).filter(Boolean)
      );

      if (customerIds.size > 1) {
        toast.error("Cannot select all - quotations have different customers");
        return;
      }

      setSelectedIds(new Set(filteredQuotations.map((q) => q.id)));
    }
  };

  // Check if all visible rows are selected
  const isAllSelected = filteredQuotations.length > 0 && selectedIds.size === filteredQuotations.length;
  const isIndeterminate = selectedIds.size > 0 && selectedIds.size < filteredQuotations.length;

  const handleRowClick = (quotation: QuotationDocument) => {
    // Toggle the checkbox
    handleToggleSelect(quotation.id);
  };

  const handleExtract = () => {
    const selectedQuotations = filteredQuotations.filter((q) => selectedIds.has(q.id));
    if (selectedQuotations.length === 0) return;

    if (selectedQuotations.length === 1) {
      // Single selection - use original callback
      onSelectQuotation(selectedQuotations[0]);
    } else if (onSelectMultipleQuotations) {
      // Multiple selection
      onSelectMultipleQuotations(selectedQuotations);
    } else {
      // Fallback to first item if multi-select callback not provided
      onSelectQuotation(selectedQuotations[0]);
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
          Extract Quotation to Delivery Order
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
              Showing quotations for: {selectedCustomerName}
            </Typography>
          )}

          {/* Search Input */}
          <TextField
            fullWidth
            placeholder="Search quotations..."
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
              label="Search By Quotation Number"
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
                  Quotation No.
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
                    width: "40%",
                  }}
                >
                  Customer Name
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
                  Reference No.
                </TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {filteredQuotations.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} align="center" sx={{ py: 4 }}>
                    <Typography color="text.secondary">
                      {searchTerm
                        ? "No quotations found matching your search"
                        : selectedCustomerId
                        ? "No quotations available for this customer"
                        : "No quotations available"}
                    </Typography>
                  </TableCell>
                </TableRow>
              ) : (
                filteredQuotations.map((quotation, index) => {
                  const isSelected = selectedIds.has(quotation.id);
                  return (
                    <TableRow
                      key={quotation.id || index}
                      hover
                      onClick={() => handleRowClick(quotation)}
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
                          onChange={() => handleToggleSelect(quotation.id)}
                        />
                      </TableCell>
                      <TableCell sx={{ fontWeight: 500, color: "primary.main" }}>
                        {quotation.name || "-"}
                      </TableCell>
                      <TableCell>
                        {quotation.createdAt ? moment(quotation.createdAt).format("DD/MM/YYYY") : "-"}
                      </TableCell>
                      <TableCell>
                        {quotation.config?.customerName ||
                         quotation.customer?.name ||
                         quotation.customerName ||
                         "-"}
                      </TableCell>
                      <TableCell>
                        {quotation.config?.referenceNo ||
                         quotation.config?.poNo ||
                         quotation.referenceNo ||
                         quotation.poNo ||
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
            Showing {filteredQuotations.length} of {quotations.length} quotations
            {selectedIds.size > 0 && (
              <Typography component="span" variant="body2" color="primary.main" fontWeight={500} sx={{ ml: 1 }}>
                ({selectedIds.size} selected)
              </Typography>
            )}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Select quotations to extract
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
