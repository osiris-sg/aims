"use client";

import React, { useState, useEffect } from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Button,
  Box,
  Typography,
  Alert,
  CircularProgress,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Autocomplete,
  InputAdornment,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import IconButton from "@mui/material/IconButton";
import PaymentIcon from "@mui/icons-material/Payment";
import { useAuth } from "@clerk/nextjs";
import { request } from "@/helpers/request";
import { toast } from "react-toastify";
import { useCreatePayment, PAYMENT_METHODS } from "@/app/portal/hooks/api/usePayments";
import AttachmentUploader, { Attachment } from "@/components/AttachmentUploader";
import { useGetCustomers } from "@/app/portal/hooks/api";
import moment from "moment";

interface RecordPaymentDialogProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  invoice?: {
    id: string;
    name: string;
    customerId?: string;
    customerName?: string;
    amount?: number;
    status?: string;
  };
}

export default function RecordPaymentDialog({
  open,
  onClose,
  onSuccess,
  invoice,
}: RecordPaymentDialogProps) {
  const { getToken } = useAuth();
  const createPaymentMutation = useCreatePayment();
  const { customers, isLoading: customersLoading } = useGetCustomers();

  // Form states
  const [selectedCustomer, setSelectedCustomer] = useState<any>(null);
  const [selectedInvoice, setSelectedInvoice] = useState<any>(null);
  const [amount, setAmount] = useState("");
  const [paymentDate, setPaymentDate] = useState(moment().format("YYYY-MM-DD"));
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [customerInvoices, setCustomerInvoices] = useState<any[]>([]);
  const [loadingInvoices, setLoadingInvoices] = useState(false);
  const [invoiceSummary, setInvoiceSummary] = useState<any>(null);
  const [loadingSummary, setLoadingSummary] = useState(false);

  // Initialize form when invoice is provided
  useEffect(() => {
    if (open && invoice) {
      // If invoice is provided, pre-select customer and invoice
      const customer = customers?.find((c: any) => c.id === invoice.customerId);
      if (customer) {
        setSelectedCustomer(customer);
      }
      setSelectedInvoice(invoice);
      // Fetch payment summary for the invoice
      fetchInvoiceSummary(invoice.id);
    } else if (open) {
      // Reset form when opening without invoice
      resetForm();
    }
  }, [open, invoice, customers]);

  const resetForm = () => {
    setSelectedCustomer(null);
    setSelectedInvoice(null);
    setAmount("");
    setPaymentDate(moment().format("YYYY-MM-DD"));
    setPaymentMethod("cash");
    setReference("");
    setNotes("");
    setCustomerInvoices([]);
    setInvoiceSummary(null);
  };

  // Fetch invoices when customer is selected
  const fetchCustomerInvoices = async (customerId: string) => {
    setLoadingInvoices(true);
    try {
      const token = await getToken();
      if (!token) return;

      const response = await request(
        {
          path: "/documents",
          method: "POST",
        },
        { organizationId: selectedCustomer.organizationId },
        token
      );

      if (response.success) {
        // Filter for invoices of this customer with status 'pending_payment'
        const invoices = response.data.filter((doc: any) => {
          const config = doc.config as any;
          return (
            (doc.type === "INVOICE" || doc.type === "TI" || doc.type === "TI2") &&
            config?.customer?.id === customerId &&
            doc.status === "pending_payment"
          );
        });
        setCustomerInvoices(invoices);
      }
    } catch (error) {
      console.error("Error fetching customer invoices:", error);
      toast.error("Failed to load customer invoices");
    } finally {
      setLoadingInvoices(false);
    }
  };

  // Fetch invoice payment summary
  const fetchInvoiceSummary = async (documentId: string) => {
    setLoadingSummary(true);
    try {
      const token = await getToken();
      if (!token) return;

      const response = await request(
        {
          path: `/documents/${documentId}/payment-summary`,
          method: "GET",
        },
        {},
        token
      );

      if (response.success) {
        setInvoiceSummary(response);
        // Auto-populate the remaining balance
        setAmount(response.remainingBalance.toFixed(2));
      }
    } catch (error) {
      console.error("Error fetching invoice summary:", error);
      toast.error("Failed to load invoice details");
    } finally {
      setLoadingSummary(false);
    }
  };

  // Handle customer selection
  const handleCustomerChange = (customer: any) => {
    setSelectedCustomer(customer);
    setSelectedInvoice(null);
    setInvoiceSummary(null);
    setAmount("");
    if (customer) {
      fetchCustomerInvoices(customer.id);
    } else {
      setCustomerInvoices([]);
    }
  };

  // Handle invoice selection
  const handleInvoiceChange = (invoice: any) => {
    setSelectedInvoice(invoice);
    if (invoice) {
      fetchInvoiceSummary(invoice.id);
    } else {
      setInvoiceSummary(null);
      setAmount("");
    }
  };

  // Handle form submission
  const handleSubmit = async () => {
    // Validate required fields
    if (!selectedCustomer || !selectedInvoice || !amount || parseFloat(amount) <= 0) {
      toast.error("Please fill all required fields");
      return;
    }

    const paymentData = {
      customerId: selectedCustomer.id,
      documentId: selectedInvoice.id,
      amount: parseFloat(amount),
      paymentDate,
      paymentMethod,
      reference: reference.trim() || undefined,
      notes: notes.trim() || undefined,
      attachments: attachments.length ? attachments : undefined,
    };

    try {
      await createPaymentMutation.mutateAsync(paymentData);
      toast.success("Payment recorded successfully!");
      onSuccess();
      onClose();
      resetForm();
    } catch (error: any) {
      console.error("Error creating payment:", error);
      toast.error(error.message || "Failed to record payment");
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <PaymentIcon color="primary" />
            <Typography variant="h6">Record Payment</Typography>
          </Box>
          <IconButton onClick={onClose}>
            <CloseIcon />
          </IconButton>
        </Box>
      </DialogTitle>

      <DialogContent dividers>
        {/* Customer Selection */}
        <Autocomplete
          value={selectedCustomer}
          onChange={(_, value) => handleCustomerChange(value)}
          options={customers || []}
          getOptionLabel={(option) => option.name || ""}
          loading={customersLoading}
          disabled={!!invoice?.customerId}
          renderInput={(params) => (
            <TextField
              {...params}
              label="Customer"
              margin="normal"
              required
              fullWidth
              InputProps={{
                ...params.InputProps,
                endAdornment: (
                  <>
                    {customersLoading ? <CircularProgress size={20} /> : null}
                    {params.InputProps.endAdornment}
                  </>
                ),
              }}
            />
          )}
        />

        {/* Invoice Selection */}
        <Autocomplete
          value={selectedInvoice}
          onChange={(_, value) => handleInvoiceChange(value)}
          options={customerInvoices}
          getOptionLabel={(option) => `${option.name || ""} - ${option.status}`}
          loading={loadingInvoices}
          disabled={!selectedCustomer || !!invoice?.id}
          renderInput={(params) => (
            <TextField
              {...params}
              label="Invoice"
              margin="normal"
              required
              fullWidth
              helperText={
                selectedCustomer && customerInvoices.length === 0
                  ? "No unpaid invoices found for this customer"
                  : ""
              }
              InputProps={{
                ...params.InputProps,
                endAdornment: (
                  <>
                    {loadingInvoices ? <CircularProgress size={20} /> : null}
                    {params.InputProps.endAdornment}
                  </>
                ),
              }}
            />
          )}
        />

        {/* Invoice Summary */}
        {invoiceSummary && (
          <Alert severity="info" sx={{ mt: 2, mb: 2 }}>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              Invoice Summary
            </Typography>
            <Box sx={{ mt: 1 }}>
              <Typography variant="body2">
                Invoice Amount: SGD {invoiceSummary.invoiceAmount?.toFixed(2)}
              </Typography>
              <Typography variant="body2">
                Total Paid: SGD {invoiceSummary.totalPaid?.toFixed(2)}
              </Typography>
              <Typography variant="body2" sx={{ fontWeight: 600, color: "primary.main" }}>
                Remaining Balance: SGD {invoiceSummary.remainingBalance?.toFixed(2)}
              </Typography>
            </Box>
          </Alert>
        )}

        {/* Amount */}
        <TextField
          label="Payment Amount"
          type="number"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          fullWidth
          required
          margin="normal"
          InputProps={{
            startAdornment: <InputAdornment position="start">SGD</InputAdornment>,
          }}
          helperText={
            loadingSummary
              ? "Loading invoice details..."
              : invoiceSummary
              ? `Enter amount to pay (max: SGD ${invoiceSummary.remainingBalance?.toFixed(2)})`
              : ""
          }
          disabled={!selectedInvoice || loadingSummary}
        />

        {/* Payment Date */}
        <TextField
          label="Payment Date"
          type="date"
          value={paymentDate}
          onChange={(e) => setPaymentDate(e.target.value)}
          fullWidth
          required
          margin="normal"
          InputLabelProps={{
            shrink: true,
          }}
        />

        {/* Payment Method */}
        <FormControl fullWidth margin="normal" required>
          <InputLabel>Payment Method</InputLabel>
          <Select
            value={paymentMethod}
            onChange={(e) => setPaymentMethod(e.target.value)}
            label="Payment Method"
          >
            {PAYMENT_METHODS.map((method) => (
              <MenuItem key={method.value} value={method.value}>
                {method.label}
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        {/* Reference */}
        <TextField
          label="Reference Number (Optional)"
          value={reference}
          onChange={(e) => setReference(e.target.value)}
          fullWidth
          margin="normal"
          placeholder="e.g., Check number, Transaction ID"
        />

        {/* Notes */}
        <TextField
          label="Notes (Optional)"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          fullWidth
          margin="normal"
          multiline
          rows={3}
          placeholder="Additional notes about this payment"
        />

        {/* Payment proof — deposit slip, bank screenshot, etc. */}
        <Box sx={{ mt: 2 }}>
          <AttachmentUploader
            folder={`payments/invoice-${selectedInvoice?.id || "new"}`}
            value={attachments}
            onChange={setAttachments}
            label="Payment Proof"
            compact
          />
        </Box>
      </DialogContent>

      <DialogActions sx={{ p: 2 }}>
        <Button onClick={onClose} disabled={createPaymentMutation.isPending}>
          Cancel
        </Button>
        <Button
          variant="contained"
          onClick={handleSubmit}
          disabled={
            !selectedCustomer ||
            !selectedInvoice ||
            !amount ||
            parseFloat(amount) <= 0 ||
            createPaymentMutation.isPending
          }
          startIcon={
            createPaymentMutation.isPending ? <CircularProgress size={20} /> : <PaymentIcon />
          }
        >
          {createPaymentMutation.isPending ? "Recording..." : "Record Payment"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}