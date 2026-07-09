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
  Chip,
} from "@mui/material";
import {
  Close as CloseIcon,
  Search as SearchIcon,
} from "@mui/icons-material";
import moment from "moment";

interface Document {
  id: string;
  name: string;
  documentType: string;
  templateId: string;
  status?: string;
  createdAt: string;
  config?: {
    customerName?: string;
    currency?: string;
    totalAmount?: number;
    nettTotal?: number;
    poNo?: string;
    doNo?: string;
    [key: string]: any;
  };
}

interface LocateDocumentDialogProps {
  open: boolean;
  onClose: () => void;
  onSelectDocument: (doc: Document) => void;
  documents: Document[];
  documentLabel: string; // e.g., "Invoice", "Quotation"
}

export default function LocateDocumentDialog({
  open,
  onClose,
  onSelectDocument,
  documents,
  documentLabel,
}: LocateDocumentDialogProps) {
  const [searchTerm, setSearchTerm] = useState("");

  // Free-text search across ALL columns (number, customer, P/O, D/O).
  const filteredDocuments = useMemo(() => {
    if (!searchTerm.trim()) {
      return documents;
    }

    const term = searchTerm.toLowerCase();

    return documents.filter((doc) =>
      [doc.name, doc.config?.customerName, doc.config?.poNo, doc.config?.doNo]
        .some((v) => String(v ?? "").toLowerCase().includes(term)),
    );
  }, [documents, searchTerm]);

  const handleRowClick = (doc: Document) => {
    onSelectDocument(doc);
    setSearchTerm("");
    onClose();
  };

  const handleClose = () => {
    setSearchTerm("");
    onClose();
  };

  const getStatusColor = (status?: string) => {
    switch (status) {
      case "confirmed":
        return "success";
      case "pending_payment":
        return "warning";
      case "paid":
        return "info";
      case "draft":
      default:
        return "default";
    }
  };

  const formatCurrency = (amount?: number, currency?: string) => {
    if (amount === undefined || amount === null) return "-";
    const curr = currency || "SGD";
    return `${curr} ${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      maxWidth="lg"
      fullWidth
      PaperProps={{
        sx: {
          minHeight: "70vh",
          maxHeight: "85vh",
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
          Locate {documentLabel}
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
          <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: "block" }}>
            Search begins as you type
          </Typography>

          {/* Search Input */}
          <TextField
            fullWidth
            placeholder={`Search ${documentLabel.toLowerCase()}s...`}
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
        <TableContainer component={Paper} sx={{ maxHeight: "calc(85vh - 250px)" }}>
          <Table stickyHeader size="small">
            <TableHead>
              <TableRow>
                <TableCell
                  sx={{
                    fontWeight: 600,
                    bgcolor: "surfaceTones.low",
                    borderBottom: 2,
                    borderColor: "divider",
                    width: "15%",
                  }}
                >
                  {documentLabel} No.
                </TableCell>
                <TableCell
                  sx={{
                    fontWeight: 600,
                    bgcolor: "surfaceTones.low",
                    borderBottom: 2,
                    borderColor: "divider",
                    width: "12%",
                  }}
                >
                  Date
                </TableCell>
                <TableCell
                  sx={{
                    fontWeight: 600,
                    bgcolor: "surfaceTones.low",
                    borderBottom: 2,
                    borderColor: "divider",
                    width: "25%",
                  }}
                >
                  Customer Name
                </TableCell>
                <TableCell
                  align="right"
                  sx={{
                    fontWeight: 600,
                    bgcolor: "surfaceTones.low",
                    borderBottom: 2,
                    borderColor: "divider",
                    width: "15%",
                  }}
                >
                  Total Amount
                </TableCell>
                <TableCell
                  sx={{
                    fontWeight: 600,
                    bgcolor: "surfaceTones.low",
                    borderBottom: 2,
                    borderColor: "divider",
                    width: "12%",
                  }}
                >
                  P/O No.
                </TableCell>
                <TableCell
                  sx={{
                    fontWeight: 600,
                    bgcolor: "surfaceTones.low",
                    borderBottom: 2,
                    borderColor: "divider",
                    width: "12%",
                  }}
                >
                  D/O No.
                </TableCell>
                <TableCell
                  align="center"
                  sx={{
                    fontWeight: 600,
                    bgcolor: "surfaceTones.low",
                    borderBottom: 2,
                    borderColor: "divider",
                    width: "10%",
                  }}
                >
                  Status
                </TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {filteredDocuments.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} align="center" sx={{ py: 4 }}>
                    <Typography color="text.secondary">
                      {searchTerm
                        ? `No ${documentLabel.toLowerCase()}s found matching your search`
                        : `No ${documentLabel.toLowerCase()}s available`}
                    </Typography>
                  </TableCell>
                </TableRow>
              ) : (
                filteredDocuments.map((doc, index) => (
                  <TableRow
                    key={doc.id || index}
                    hover
                    onClick={() => handleRowClick(doc)}
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
                    <TableCell sx={{ fontWeight: 500, color: "text.primary" }}>
                      {doc.name || "-"}
                    </TableCell>
                    <TableCell>
                      {doc.createdAt ? moment(doc.createdAt).format("DD/MM/YYYY") : "-"}
                    </TableCell>
                    <TableCell>{doc.config?.customerName || "-"}</TableCell>
                    <TableCell align="right">
                      {formatCurrency(
                        doc.config?.nettTotal || doc.config?.totalAmount,
                        doc.config?.currency
                      )}
                    </TableCell>
                    <TableCell>{doc.config?.poNo || "-"}</TableCell>
                    <TableCell>{doc.config?.doNo || "-"}</TableCell>
                    <TableCell align="center">
                      <Chip
                        label={doc.status || "draft"}
                        size="small"
                        color={getStatusColor(doc.status)}
                        sx={{
                          fontWeight: 500,
                          fontSize: "0.7rem",
                          textTransform: "capitalize",
                        }}
                      />
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
            bgcolor: "surfaceTones.low",
            borderTop: "1px solid",
            borderColor: "divider",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <Typography variant="body2" color="text.secondary">
            Showing {filteredDocuments.length} of {documents.length} {documentLabel.toLowerCase()}s
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Click on a row to open the {documentLabel.toLowerCase()}
          </Typography>
        </Box>
      </DialogContent>
    </Dialog>
  );
}
