"use client";

import React, { useState, useMemo } from "react";
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

interface Customer {
  id: string;
  customerCode?: string;
  name: string;
  email?: string;
  phone?: string;
  address?: string;
}

interface CustomerSelectDialogProps {
  open: boolean;
  onClose: () => void;
  onSelectCustomer: (customer: Customer) => void;
  customers: Customer[];
}

type SearchMode = "code" | "name";

export default function CustomerSelectDialog({
  open,
  onClose,
  onSelectCustomer,
  customers,
}: CustomerSelectDialogProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [searchMode, setSearchMode] = useState<SearchMode>("code");

  // Filter customers based on search term and mode
  const filteredCustomers = useMemo(() => {
    if (!searchTerm.trim()) {
      return customers;
    }

    const term = searchTerm.toLowerCase();

    return customers.filter((customer) => {
      switch (searchMode) {
        case "code":
          return customer.customerCode?.toLowerCase().includes(term);
        case "name":
          return customer.name?.toLowerCase().includes(term);
        default:
          return true;
      }
    });
  }, [customers, searchTerm, searchMode]);

  const handleRowClick = (customer: Customer) => {
    onSelectCustomer(customer);
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
          Locate Customer
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
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            This combo box begins searching as soon as you begin typing the first character
          </Typography>

          {/* Search Input */}
          <TextField
            fullWidth
            placeholder="Search customers..."
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
              value="code"
              control={<Radio size="small" color="primary" />}
              label="Search By Code"
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
        <TableContainer component={Paper} sx={{ maxHeight: "calc(80vh - 250px)" }}>
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
                  Customer Code
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
                  Company Name
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
                  Phone
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
                  Email
                </TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {filteredCustomers.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} align="center" sx={{ py: 4 }}>
                    <Typography color="text.secondary">
                      {searchTerm ? "No customers found matching your search" : "No customers available"}
                    </Typography>
                  </TableCell>
                </TableRow>
              ) : (
                filteredCustomers.map((customer, index) => (
                  <TableRow
                    key={customer.id || index}
                    hover
                    onClick={() => handleRowClick(customer)}
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
                    <TableCell sx={{ fontWeight: 500, color: "secondary.main" }}>
                      {customer.customerCode || "-"}
                    </TableCell>
                    <TableCell>{customer.name || "-"}</TableCell>
                    <TableCell>{customer.phone || "-"}</TableCell>
                    <TableCell>{customer.email || "-"}</TableCell>
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
            Showing {filteredCustomers.length} of {customers.length} customers
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Click on a row to select a customer
          </Typography>
        </Box>
      </DialogContent>
    </Dialog>
  );
}
