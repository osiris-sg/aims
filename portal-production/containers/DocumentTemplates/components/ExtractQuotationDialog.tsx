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
  quotations: QuotationDocument[];
  selectedCustomerId?: string;
  selectedCustomerName?: string;
}

type SearchMode = "number" | "name";

export default function ExtractQuotationDialog({
  open,
  onClose,
  onSelectQuotation,
  quotations,
  selectedCustomerId,
  selectedCustomerName,
}: ExtractQuotationDialogProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [searchMode, setSearchMode] = useState<SearchMode>("number");

  // Reset search when dialog opens
  useEffect(() => {
    if (open) {
      setSearchTerm("");
    }
  }, [open]);

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

  const handleRowClick = (quotation: QuotationDocument) => {
    onSelectQuotation(quotation);
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
                    width: "45%",
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
                  <TableCell colSpan={4} align="center" sx={{ py: 4 }}>
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
                filteredQuotations.map((quotation, index) => (
                  <TableRow
                    key={quotation.id || index}
                    hover
                    onClick={() => handleRowClick(quotation)}
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
            Showing {filteredQuotations.length} of {quotations.length} quotations
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Click on a row to extract quotation data
          </Typography>
        </Box>
      </DialogContent>
    </Dialog>
  );
}
