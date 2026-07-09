"use client";

import React, { useState, useMemo } from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  Box,
  TextField,
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

interface Salesman {
  id: string;
  salesmanCode: string;
  name: string;
  email?: string;
}

interface SalesmanSelectDialogProps {
  open: boolean;
  onClose: () => void;
  onSelectSalesman: (salesman: Salesman) => void;
  salesmen: Salesman[];
}

export default function SalesmanSelectDialog({
  open,
  onClose,
  onSelectSalesman,
  salesmen,
}: SalesmanSelectDialogProps) {
  const [searchTerm, setSearchTerm] = useState("");

  // Extract salesmen array - handle both direct array and response object with data property
  const salesmenArray = useMemo(() => {
    if (Array.isArray(salesmen)) {
      return salesmen;
    }
    // Handle case where full API response is passed: {success, message, data: [...]}
    if (salesmen && typeof salesmen === 'object' && 'data' in salesmen && Array.isArray((salesmen as any).data)) {
      return (salesmen as any).data;
    }
    return [];
  }, [salesmen]);

  // Filter salesmen based on search term and mode
  const filteredSalesmen = useMemo(() => {
    // Ensure salesmen is an array
    const salesmenList = salesmenArray;

    if (!searchTerm.trim()) {
      return salesmenList;
    }

    const term = searchTerm.toLowerCase();

    // Free-text search across ALL displayed columns.
    return salesmenList.filter((salesman: Salesman) =>
      [salesman.salesmanCode, salesman.name, salesman.email]
        .some((v) => String(v ?? "").toLowerCase().includes(term)),
    );
  }, [salesmenArray, searchTerm]);

  // Ensure we have a valid count for display
  const totalCount = salesmenArray.length;

  const handleRowClick = (salesman: Salesman) => {
    onSelectSalesman(salesman);
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
      maxWidth="sm"
      fullWidth
      PaperProps={{
        sx: {
          minHeight: "50vh",
          maxHeight: "70vh",
        },
      }}
    >
      <DialogTitle
        sx={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          bgcolor: "#0a0a0a",
          color: "#fafafa",
          py: 1.5,
        }}
      >
        <Typography variant="h6" fontWeight={500}>
          Locate Salesman
        </Typography>
        <IconButton onClick={handleClose} size="small" sx={{ color: "#fafafa" }}>
          <CloseIcon />
        </IconButton>
      </DialogTitle>

      <DialogContent sx={{ p: 0 }}>
        {/* Search Section */}
        <Box
          sx={{
            p: 2,
            bgcolor: "surfaceTones.low",
            borderBottom: "1px solid",
            borderColor: "divider",
          }}
        >
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            Search for a salesman by code or name
          </Typography>

          {/* Search Input */}
          <TextField
            fullWidth
            placeholder="Search salesmen..."
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

        </Box>

        {/* Results Table */}
        <TableContainer component={Paper} sx={{ maxHeight: "calc(70vh - 250px)" }}>
          <Table stickyHeader size="small">
            <TableHead>
              <TableRow>
                <TableCell
                  sx={{
                    fontWeight: 600,
                    bgcolor: "surfaceTones.low",
                    borderBottom: 2,
                    borderColor: "divider",
                    width: "25%",
                  }}
                >
                  Salesman Code
                </TableCell>
                <TableCell
                  sx={{
                    fontWeight: 600,
                    bgcolor: "surfaceTones.low",
                    borderBottom: 2,
                    borderColor: "divider",
                    width: "45%",
                  }}
                >
                  Name
                </TableCell>
                <TableCell
                  sx={{
                    fontWeight: 600,
                    bgcolor: "surfaceTones.low",
                    borderBottom: 2,
                    borderColor: "divider",
                    width: "30%",
                  }}
                >
                  Email
                </TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {filteredSalesmen.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={3} align="center" sx={{ py: 4 }}>
                    <Typography color="text.secondary">
                      {searchTerm ? "No salesmen found matching your search" : "No salesmen available"}
                    </Typography>
                  </TableCell>
                </TableRow>
              ) : (
                filteredSalesmen.map((salesman: Salesman, index: number) => (
                  <TableRow
                    key={salesman.id || index}
                    hover
                    onClick={() => handleRowClick(salesman)}
                    sx={{
                      cursor: "pointer",
                      "&:hover": {
                        bgcolor: "surfaceTones.high",
                      },
                      "&:nth-of-type(even)": {
                        bgcolor: "surfaceTones.low",
                      },
                    }}
                  >
                    <TableCell sx={{ fontWeight: 500, color: "secondary.main" }}>
                      {salesman.salesmanCode || "-"}
                    </TableCell>
                    <TableCell>{salesman.name || "-"}</TableCell>
                    <TableCell>{salesman.email || "-"}</TableCell>
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
            bgcolor: "surfaceTones.low",
            borderTop: "1px solid",
            borderColor: "divider",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <Typography variant="body2" color="text.secondary">
            Showing {filteredSalesmen.length} of {totalCount} salesmen
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Click on a row to select a salesman
          </Typography>
        </Box>
      </DialogContent>
    </Dialog>
  );
}
