"use client";
import React, { useMemo, useState } from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  Box,
  Button,
  Checkbox,
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

// Multi-select quotation picker (Biofuel DO "Our Ref" field): row clicks
// toggle checkmarks, "Use selected" returns them ALL — the field renders
// each as "QO… dated dd/mm/yyyy", comma-separated (guru 2026-09-02).
interface QuotationSelectDialogProps {
  open: boolean;
  onClose: () => void;
  onSelect: (quotations: any[]) => void;
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
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Free-text search across ALL displayed columns.
  const filtered = useMemo(() => {
    if (!searchTerm.trim()) return quotations;
    const term = searchTerm.toLowerCase();
    return quotations.filter((q) =>
      [q.name, q.config?.customerName, q.config?.referenceNo, dmy(q.config?.confirmedAt || q.createdAt)]
        .some((v) => String(v ?? "").toLowerCase().includes(term)),
    );
  }, [quotations, searchTerm]);

  const toggleRow = (q: any) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(q.id)) next.delete(q.id);
      else next.add(q.id);
      return next;
    });
  };

  const handleUseSelected = () => {
    const picked = quotations.filter((q) => selectedIds.has(q.id));
    if (picked.length) onSelect(picked);
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
                <TableCell padding="checkbox" />
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
                  onClick={() => toggleRow(q)}
                  selected={selectedIds.has(q.id)}
                  sx={{ cursor: "pointer" }}
                >
                  <TableCell padding="checkbox">
                    <Checkbox size="small" checked={selectedIds.has(q.id)} tabIndex={-1} />
                  </TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>{q.name}</TableCell>
                  <TableCell>{dmy(q.config?.confirmedAt || q.createdAt)}</TableCell>
                  <TableCell>{q.config?.referenceNo || "-"}</TableCell>
                </TableRow>
              ))}
              {filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4}>
                    <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>
                      No confirmed quotations for this customer.
                    </Typography>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
        <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mt: 1 }}>
          <Typography variant="caption" color="text.secondary">
            Showing {filtered.length} of {quotations.length} quotations
          </Typography>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
            <Typography variant="caption" color="text.secondary">
              Click rows to select one or more quotations
            </Typography>
            <Button size="small" variant="contained" disabled={selectedIds.size === 0} onClick={handleUseSelected}>
              Use {selectedIds.size || ""} selected
            </Button>
          </Box>
        </Box>
      </DialogContent>
    </Dialog>
  );
}
