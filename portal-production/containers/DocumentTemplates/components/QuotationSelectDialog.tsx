"use client";
import React, { useMemo, useState } from "react";
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
  InputAdornment,
  Typography,
} from "@mui/material";
import { Search as SearchIcon, Close as CloseIcon } from "@mui/icons-material";

// Single-select quotation picker — same look as the extract dialog, but a
// row click selects one quotation (used by the Biofuel DO "Our Ref" field).
interface QuotationSelectDialogProps {
  open: boolean;
  onClose: () => void;
  onSelect: (quotation: any) => void;
  quotations: any[];
  customerName?: string;
}

const dmy = (d: any) => (d ? new Date(d).toLocaleDateString("en-GB") : "-");

export default function QuotationSelectDialog({
  open,
  onClose,
  onSelect,
  quotations,
  customerName,
}: QuotationSelectDialogProps) {
  const [searchTerm, setSearchTerm] = useState("");

  // Free-text search across ALL displayed columns.
  const filtered = useMemo(() => {
    if (!searchTerm.trim()) return quotations;
    const term = searchTerm.toLowerCase();
    return quotations.filter((q) =>
      [q.name, q.config?.customerName, q.config?.referenceNo, dmy(q.config?.confirmedAt || q.createdAt)]
        .some((v) => String(v ?? "").toLowerCase().includes(term)),
    );
  }, [quotations, searchTerm]);

  const handleRowClick = (q: any) => {
    onSelect(q);
    setSearchTerm("");
    onClose();
  };

  const handleClose = () => {
    setSearchTerm("");
    onClose();
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", bgcolor: "#000", color: "#fff" }}>
        Select Quotation
        <IconButton size="small" onClick={handleClose} sx={{ color: "#fff" }}>
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>
      <DialogContent sx={{ pt: 2 }}>
        {customerName && (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1, mb: 1 }}>
            Showing confirmed quotations for: {customerName}
          </Typography>
        )}
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
          sx={{ mb: 1.5, bgcolor: "background.paper" }}
        />
        <TableContainer component={Paper} sx={{ maxHeight: "50vh" }}>
          <Table stickyHeader size="small">
            <TableHead>
              <TableRow>
                <TableCell>Quotation No.</TableCell>
                <TableCell>Confirmed Date</TableCell>
                <TableCell>Reference No.</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {filtered.map((q) => (
                <TableRow
                  key={q.id}
                  hover
                  onClick={() => handleRowClick(q)}
                  sx={{ cursor: "pointer" }}
                >
                  <TableCell sx={{ fontWeight: 600 }}>{q.name}</TableCell>
                  <TableCell>{dmy(q.config?.confirmedAt || q.createdAt)}</TableCell>
                  <TableCell>{q.config?.referenceNo || "-"}</TableCell>
                </TableRow>
              ))}
              {filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={3}>
                    <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>
                      No confirmed quotations for this customer.
                    </Typography>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
        <Box sx={{ display: "flex", justifyContent: "space-between", mt: 1 }}>
          <Typography variant="caption" color="text.secondary">
            Showing {filtered.length} of {quotations.length} quotations
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Click on a row to select
          </Typography>
        </Box>
      </DialogContent>
    </Dialog>
  );
}
