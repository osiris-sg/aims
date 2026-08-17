"use client";

import React, { useState, useMemo } from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  Box,
  Button,
  CircularProgress,
  Collapse,
  Stack,
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
  Add as AddIcon,
} from "@mui/icons-material";
import { toast } from "react-toastify";
import { useCreateCustomer } from "@/app/portal/hooks/api";

interface Customer {
  id: string;
  customerCode?: string;
  name: string;
  email?: string;
  phone?: string;
  address?: string;
  salesman?: {
    id: string;
    salesmanCode: string;
    userId: string;
  } | null;
}

interface CustomerSelectDialogProps {
  open: boolean;
  onClose: () => void;
  onSelectCustomer: (customer: Customer) => void;
  customers: Customer[];
}

export default function CustomerSelectDialog({
  open,
  onClose,
  onSelectCustomer,
  customers,
}: CustomerSelectDialogProps) {
  const [searchTerm, setSearchTerm] = useState("");

  // Quick-add: create a customer without leaving the picker (guru 2026-08-18).
  // The backend generates the customer code from the name; the new customer is
  // selected into the document immediately on success.
  const createCustomer = useCreateCustomer();
  const [addOpen, setAddOpen] = useState(false);
  const [draft, setDraft] = useState({ name: "", phone: "", email: "", address: "" });
  const openAddForm = () => {
    // Seed the name with whatever the user was searching for — the usual
    // trigger is "typed a name, no match".
    setDraft({ name: searchTerm.trim(), phone: "", email: "", address: "" });
    setAddOpen(true);
  };
  const submitNewCustomer = async () => {
    const name = draft.name.trim();
    if (!name) {
      toast.warn("Customer name is required");
      return;
    }
    try {
      const created = await createCustomer.mutateAsync({
        name,
        phone: draft.phone.trim() || null,
        email: draft.email.trim() || null,
        address: draft.address.trim() || null,
      } as any);
      toast.success(`Customer ${created?.customerCode ? `${created.customerCode} — ` : ""}${created?.name || name} created`);
      setAddOpen(false);
      setSearchTerm("");
      onSelectCustomer(created);
      onClose();
    } catch (e: any) {
      toast.error(e?.message || "Failed to create the customer");
    }
  };

  // Free-text search across ALL displayed columns (code, name, phone, email).
  const filteredCustomers = useMemo(() => {
    if (!searchTerm.trim()) {
      return customers;
    }

    const term = searchTerm.toLowerCase();

    return customers.filter((customer) =>
      [customer.customerCode, customer.name, customer.phone, customer.email]
        .some((v) => String(v ?? "").toLowerCase().includes(term)),
    );
  }, [customers, searchTerm]);

  const handleRowClick = (customer: Customer) => {
    onSelectCustomer(customer);
    setSearchTerm("");
    onClose();
  };

  const handleClose = () => {
    setSearchTerm("");
    setAddOpen(false);
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
          bgcolor: "#0a0a0a",
          color: "#fafafa",
          py: 1.5,
        }}
      >
        <Typography variant="h6" fontWeight={500}>
          Locate Customer
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
            This combo box begins searching as soon as you begin typing the first character
          </Typography>

          {/* Search Input + quick-add */}
          <Stack direction="row" gap={1} sx={{ mb: 1.5 }}>
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
              sx={{ bgcolor: "background.paper" }}
            />
            <Button
              variant="outlined"
              size="small"
              startIcon={<AddIcon />}
              onClick={() => (addOpen ? setAddOpen(false) : openAddForm())}
              sx={{ whiteSpace: "nowrap", flexShrink: 0 }}
            >
              New Customer
            </Button>
          </Stack>

          {/* Inline create form — code is auto-generated from the name. */}
          <Collapse in={addOpen}>
            <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2 }}>
              <Stack direction="row" gap={1} flexWrap="wrap" alignItems="center">
                <TextField
                  size="small"
                  label="Company name *"
                  value={draft.name}
                  onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                  sx={{ flex: "1 1 220px" }}
                  autoFocus
                />
                <TextField
                  size="small"
                  label="Phone"
                  value={draft.phone}
                  onChange={(e) => setDraft((d) => ({ ...d, phone: e.target.value }))}
                  sx={{ width: 140 }}
                />
                <TextField
                  size="small"
                  label="Email"
                  value={draft.email}
                  onChange={(e) => setDraft((d) => ({ ...d, email: e.target.value }))}
                  sx={{ flex: "1 1 180px" }}
                />
                <TextField
                  size="small"
                  label="Address"
                  value={draft.address}
                  onChange={(e) => setDraft((d) => ({ ...d, address: e.target.value }))}
                  sx={{ flex: "2 1 260px" }}
                />
                <Button
                  variant="contained"
                  size="small"
                  onClick={submitNewCustomer}
                  disabled={createCustomer.isPending || !draft.name.trim()}
                  startIcon={createCustomer.isPending ? <CircularProgress size={14} color="inherit" /> : undefined}
                  sx={{ whiteSpace: "nowrap" }}
                >
                  Create & select
                </Button>
              </Stack>
              <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.75 }}>
                The customer code is generated automatically. Full details (GST, currency, salesman, contacts) can be added later in Masterfiles.
              </Typography>
            </Paper>
          </Collapse>
        </Box>

        {/* Results Table */}
        <TableContainer component={Paper} sx={{ maxHeight: "calc(80vh - 250px)" }}>
          <Table stickyHeader size="small">
            <TableHead>
              <TableRow>
                <TableCell
                  sx={{
                    fontWeight: 600,
                    bgcolor: "surfaceTones.low",
                    borderBottom: 2,
                    borderColor: "divider",
                    width: "20%",
                  }}
                >
                  Customer Code
                </TableCell>
                <TableCell
                  sx={{
                    fontWeight: 600,
                    bgcolor: "surfaceTones.low",
                    borderBottom: 2,
                    borderColor: "divider",
                    width: "40%",
                  }}
                >
                  Company Name
                </TableCell>
                <TableCell
                  sx={{
                    fontWeight: 600,
                    bgcolor: "surfaceTones.low",
                    borderBottom: 2,
                    borderColor: "divider",
                    width: "20%",
                  }}
                >
                  Phone
                </TableCell>
                <TableCell
                  sx={{
                    fontWeight: 600,
                    bgcolor: "surfaceTones.low",
                    borderBottom: 2,
                    borderColor: "divider",
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
                    <Button
                      variant="outlined"
                      size="small"
                      startIcon={<AddIcon />}
                      onClick={openAddForm}
                      sx={{ mt: 1.5 }}
                    >
                      {searchTerm.trim() ? `Create “${searchTerm.trim()}” as a new customer` : "Create a new customer"}
                    </Button>
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
                        bgcolor: "surfaceTones.high",
                      },
                      "&:nth-of-type(even)": {
                        bgcolor: "surfaceTones.low",
                      },
                    }}
                  >
                    <TableCell sx={{ fontWeight: 500, color: "text.primary" }}>
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
            bgcolor: "surfaceTones.low",
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
