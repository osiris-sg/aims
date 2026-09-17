"use client";

import React, { useMemo, useState } from "react";
import {
  Box,
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  InputAdornment,
  MenuItem,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import { Close as CloseIcon, Search as SearchIcon } from "@mui/icons-material";

/**
 * Sale Order picker for the schedule-delivery dialog — same shape as the
 * "Locate Customer" dialog (searchable table, click a row to select).
 *
 * A Sale Order is a Document of type SALES_ORDER. In this fleet they are named
 * SO-<customer PO number> with the PO repeated in
 * config.documentInfo.referenceNo as "Customer PO …", so the three columns below
 * are the ONLY populated fields. Date, project and amount are deliberately NOT
 * shown: every one of the 75 existing Sale Orders has them blank, so they would
 * render as a column of dashes.
 *
 * The customer filter is a real need rather than polish — Qingjian entities
 * dominate the list, and several of them differ only in their suffix.
 */

export interface SaleOrderRow {
  id: string;
  name: string; // SO-GC-PO2512032
  customerName: string; // resolved server-side (associated_customer)
  customerPo: string; // config.documentInfo.referenceNo
}

/** Pull the display columns out of a /documents/paginated row. */
export function toSaleOrderRow(d: any): SaleOrderRow {
  const cfg = d?.config ?? {};
  const info = cfg.documentInfo ?? {};
  // Same fallback chain the rest of the app uses for a document's reference
  // (CLAUDE.md: config.referenceNo is canonical, legacy keys kept for old rows).
  const ref =
    info.referenceNo ?? cfg.referenceNo ?? info.reference ?? cfg.reference ?? cfg.xeroReference ?? "";
  return {
    id: String(d?.id ?? ""),
    name: String(d?.name ?? ""),
    customerName: String(d?.associated_customer ?? cfg.customerName ?? cfg.customer?.name ?? ""),
    customerPo: String(ref ?? ""),
  };
}

interface Props {
  open: boolean;
  onClose: () => void;
  rows: SaleOrderRow[];
  loading?: boolean;
  onSelect: (row: SaleOrderRow) => void;
  /** Rendered under the table — the upload entry point lives here. */
  footerAction?: React.ReactNode;
}

const HEAD_SX = {
  fontWeight: 600,
  bgcolor: "surfaceTones.low",
  borderBottom: 2,
  borderColor: "divider",
} as const;

export default function SaleOrderSelectDialog({ open, onClose, rows, loading, onSelect, footerAction }: Props) {
  const [searchTerm, setSearchTerm] = useState("");
  const [customerFilter, setCustomerFilter] = useState("");

  const customers = useMemo(() => {
    const names = new Set<string>();
    for (const r of rows) if (r.customerName) names.add(r.customerName);
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }, [rows]);

  const filtered = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    return rows.filter((r) => {
      if (customerFilter && r.customerName !== customerFilter) return false;
      if (!term) return true;
      return [r.name, r.customerName, r.customerPo].some((v) => String(v ?? "").toLowerCase().includes(term));
    });
  }, [rows, searchTerm, customerFilter]);

  const handleClose = () => {
    setSearchTerm("");
    setCustomerFilter("");
    onClose();
  };

  const handleRowClick = (row: SaleOrderRow) => {
    onSelect(row);
    setSearchTerm("");
    setCustomerFilter("");
    onClose();
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", pb: 1 }}>
        <Typography variant="h6" component="span">
          Locate Sale Order
        </Typography>
        <IconButton onClick={handleClose} size="small" aria-label="Close">
          <CloseIcon />
        </IconButton>
      </DialogTitle>

      <DialogContent dividers sx={{ p: 0 }}>
        <Box sx={{ p: 2, pb: 1.5 }}>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
            <TextField
              autoFocus
              fullWidth
              size="small"
              placeholder="Search by Sale Order No, customer or customer PO"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon fontSize="small" />
                  </InputAdornment>
                ),
              }}
            />
            <TextField
              select
              size="small"
              label="Customer"
              value={customerFilter}
              onChange={(e) => setCustomerFilter(e.target.value)}
              sx={{ minWidth: { sm: 260 } }}
            >
              <MenuItem value="">All customers</MenuItem>
              {customers.map((c) => (
                <MenuItem key={c} value={c}>
                  {c}
                </MenuItem>
              ))}
            </TextField>
          </Stack>
        </Box>

        <TableContainer component={Paper} elevation={0} sx={{ maxHeight: 420 }}>
          <Table stickyHeader size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={{ ...HEAD_SX, width: "28%" }}>Sale Order No</TableCell>
                <TableCell sx={{ ...HEAD_SX, width: "44%" }}>Customer</TableCell>
                <TableCell sx={{ ...HEAD_SX, width: "28%" }}>Customer PO</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={3} align="center" sx={{ py: 4 }}>
                    <Typography color="text.secondary">Loading Sale Orders…</Typography>
                  </TableCell>
                </TableRow>
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={3} align="center" sx={{ py: 4 }}>
                    <Typography color="text.secondary">
                      {searchTerm || customerFilter
                        ? "No Sale Orders match your search"
                        : "No Sale Orders yet — upload one below"}
                    </Typography>
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((r) => (
                  <TableRow
                    key={r.id}
                    hover
                    onClick={() => handleRowClick(r)}
                    sx={{
                      cursor: "pointer",
                      "&:hover": { bgcolor: "surfaceTones.high" },
                      "&:nth-of-type(even)": { bgcolor: "surfaceTones.low" },
                    }}
                  >
                    <TableCell sx={{ fontWeight: 500, color: "text.primary" }}>{r.name || "-"}</TableCell>
                    <TableCell>{r.customerName || "-"}</TableCell>
                    <TableCell>{r.customerPo || "-"}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableContainer>

        <Box
          sx={{
            p: 1.5,
            bgcolor: "surfaceTones.low",
            borderTop: "1px solid",
            borderColor: "divider",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 1,
            flexWrap: "wrap",
          }}
        >
          <Typography variant="body2" color="text.secondary">
            Showing {filtered.length} of {rows.length} Sale Orders
          </Typography>
          <Stack direction="row" spacing={1} alignItems="center">
            <Typography variant="caption" color="text.secondary">
              Click a row to select
            </Typography>
            {footerAction}
          </Stack>
        </Box>
      </DialogContent>
    </Dialog>
  );
}
