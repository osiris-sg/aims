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
import CustomerPicker from "@/components/CustomerPicker";
import { useCustomerById } from "@/app/portal/hooks/api/useCustomerPicker";
import moment from "moment";
import { useTranslations } from "next-intl";

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
    // Editor-created vs imported invoices carry the customer at different
    // paths on config — allow both here without narrowing further.
    config?: { customerId?: string; customerName?: string; customerCode?: string; customer?: { id?: string; name?: string; customerCode?: string } };
  };
}

export default function RecordPaymentDialog({
  open,
  onClose,
  onSuccess,
  invoice,
}: RecordPaymentDialogProps) {
  const t = useTranslations("invoices.recordPayment");
  const { getToken } = useAuth();
  const createPaymentMutation = useCreatePayment();
  // The invoice's own customer, preloaded by id — never looked up in a capped
  // list (WCT has ~4,000 customers; the default page missed most of them and
  // left Customer empty, which disabled Record Payment).
  const invoiceCustId = invoice ? invoice.customerId ?? invoice.config?.customerId ?? invoice.config?.customer?.id ?? null : null;
  const { customer: invoiceCustomer } = useCustomerById(open ? invoiceCustId : null);

  // Form states
  const [selectedCustomer, setSelectedCustomer] = useState<any>(null);
  const [selectedInvoice, setSelectedInvoice] = useState<any>(null);
  const [amount, setAmount] = useState("");
  const [paymentDate, setPaymentDate] = useState(moment().format("YYYY-MM-DD"));
  const [paymentMethod, setPaymentMethod] = useState("cash");
  // "Deposit to" — which bank/cash GL account the money landed in. "" = let
  // the backend fall back to the org's defaults.
  const [depositAccount, setDepositAccount] = useState("");
  const [bankAccounts, setBankAccounts] = useState<Array<{ code: string; name: string }>>([]);
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
      // If invoice is provided, pre-select customer and invoice. Editor-created
      // invoices store the customer FLAT (config.customerId); imported ones use
      // the nested config.customer.{id} — read all of them.
      // Show the invoice's own customer at once; the full record (below)
      // replaces it when the lookup returns.
      if (invoiceCustId) {
        setSelectedCustomer(
          invoiceCustomer ?? {
            id: invoiceCustId,
            name: invoice.customerName || invoice.config?.customerName || invoice.config?.customer?.name || "",
            customerCode: invoice.config?.customerCode || invoice.config?.customer?.customerCode || null,
          },
        );
      }
      setSelectedInvoice(invoice);
      // Fetch payment summary for the invoice
      fetchInvoiceSummary(invoice.id);
    } else if (open) {
      // Reset form when opening without invoice
      resetForm();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, invoice]);

  // The full customer record arrived: swap it in for the preloaded stub.
  useEffect(() => {
    if (open && invoiceCustomer && selectedCustomer?.id === invoiceCustomer.id) setSelectedCustomer(invoiceCustomer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, invoiceCustomer]);

  // Load the org's bank/cash accounts for the "Deposit to" picker (once per open).
  useEffect(() => {
    if (!open || bankAccounts.length) return;
    (async () => {
      try {
        const token = await getToken();
        if (!token) return;
        const res: any = await request({ path: "/accounting/accounts", method: "GET" }, {}, token);
        const list: any[] = res?.data ?? res ?? [];
        const banks = list.filter((a) => {
          if (!a?.isActive) return false;
          if (a.accountType === "FOREIGN_BANK") return true;
          const n = String(a.name || "").toLowerCase();
          return a.accountType === "CURRENT_ASSET" && (/\bbank\b/.test(n) || /\bcash\b/.test(n));
        });
        setBankAccounts(banks.map((a) => ({ code: a.code, name: a.name })));
      } catch {
        /* picker stays empty — backend defaults still apply */
      }
    })();
  }, [open, bankAccounts.length, getToken]);

  const resetForm = () => {
    setSelectedCustomer(null);
    setSelectedInvoice(null);
    setAmount("");
    setPaymentDate(moment().format("YYYY-MM-DD"));
    setPaymentMethod("cash");
    setDepositAccount("");
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
            (config?.customer?.id === customerId || config?.customerId === customerId) &&
            doc.status === "pending_payment"
          );
        });
        setCustomerInvoices(invoices);
      }
    } catch (error) {
      console.error("Error fetching customer invoices:", error);
      toast.error(t("loadInvoicesFailed"));
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
        // The backend wraps every response in { success, data } (global
        // CustomResponseInterceptor), so the summary fields live under .data.
        const summary = response.data ?? response;
        setInvoiceSummary(summary);
        // Auto-populate the remaining balance (guard against a missing field).
        setAmount(Number(summary.remainingBalance ?? 0).toFixed(2));
      }
    } catch (error) {
      console.error("Error fetching invoice summary:", error);
      toast.error(t("loadDetailsFailed"));
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
      toast.error(t("fillRequired"));
      return;
    }

    // No overpayments — AIMS has no customer-credit handling, so a payment
    // above the remaining balance would silently overstate cash and AR relief
    // (mirrors the bills dialog's guard).
    const remaining = Number(invoiceSummary?.remainingBalance);
    if (Number.isFinite(remaining) && parseFloat(amount) > remaining + 0.005) {
      toast.error(t("exceedsBalance", { amount: remaining.toFixed(2) }));
      return;
    }

    const paymentData = {
      customerId: selectedCustomer.id,
      documentId: selectedInvoice.id,
      amount: parseFloat(amount),
      paymentDate,
      paymentMethod,
      cashAccountCode: depositAccount || undefined,
      reference: reference.trim() || undefined,
      notes: notes.trim() || undefined,
      attachments: attachments.length ? attachments : undefined,
    };

    try {
      await createPaymentMutation.mutateAsync(paymentData);
      toast.success(t("recorded"));
      onSuccess();
      onClose();
      resetForm();
    } catch (error: any) {
      console.error("Error creating payment:", error);
      toast.error(error.message || t("recordFailed"));
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      // Phone: recording a payment is a common on-the-go action, so the form
      // fills the screen instead of a cramped centred card.
      PaperProps={{
        sx: {
          m: { xs: 0, sm: 4 },
          width: { xs: "100%", sm: "auto" },
          maxWidth: { xs: "100%", sm: undefined },
          borderRadius: { xs: 0, sm: 1 },
          minHeight: { xs: "100%", sm: "auto" },
          maxHeight: { xs: "100%", sm: "calc(100% - 64px)" },
        },
      }}
    >
      <DialogTitle>
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <PaymentIcon color="primary" />
            <Typography variant="h6">{t("title")}</Typography>
          </Box>
          <IconButton onClick={onClose}>
            <CloseIcon />
          </IconButton>
        </Box>
      </DialogTitle>

      <DialogContent dividers>
        {/* Customer Selection */}
        <CustomerPicker
          value={selectedCustomer?.id ?? null}
          initialCustomer={selectedCustomer}
          onChange={(value) => handleCustomerChange(value)}
          label={t("customer")}
          required
          size="medium"
          disabled={!!invoiceCustId}
          sx={{ mt: 2, mb: 1 }}
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
              label={t("invoice")}
              margin="normal"
              required
              fullWidth
              // Only when the user is choosing: opened from an invoice, that
              // invoice is selected and the customer's list is never fetched.
              helperText={
                selectedCustomer && !selectedInvoice && !loadingInvoices && customerInvoices.length === 0
                  ? t("noUnpaid")
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
              {t("summary")}
            </Typography>
            <Box sx={{ mt: 1 }}>
              <Typography variant="body2">
                {t("invoiceAmount", { amount: invoiceSummary.invoiceAmount?.toFixed(2) ?? "" })}
              </Typography>
              <Typography variant="body2">
                {t("totalPaid", { amount: invoiceSummary.totalPaid?.toFixed(2) ?? "" })}
              </Typography>
              <Typography variant="body2" sx={{ fontWeight: 600, color: "primary.main" }}>
                {t("remaining", { amount: invoiceSummary.remainingBalance?.toFixed(2) ?? "" })}
              </Typography>
            </Box>
          </Alert>
        )}

        {/* Amount */}
        <TextField
          label={t("amount")}
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
              ? t("loadingDetails")
              : invoiceSummary
              ? t("amountHelp", { amount: invoiceSummary.remainingBalance?.toFixed(2) ?? "" })
              : ""
          }
          disabled={!selectedInvoice || loadingSummary}
        />

        {/* Payment Date */}
        <TextField
          label={t("date")}
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
          <InputLabel>{t("method")}</InputLabel>
          <Select
            value={paymentMethod}
            onChange={(e) => setPaymentMethod(e.target.value)}
            label={t("method")}
          >
            {PAYMENT_METHODS.map((method) => (
              <MenuItem key={method.value} value={method.value}>
                {t.has(`methods.${method.value}`) ? t(`methods.${method.value}`) : method.label}
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        {/* Deposit to — bank/cash GL account the payment lands in. Blank = org default. */}
        <FormControl fullWidth margin="normal">
          <InputLabel shrink>{t("depositTo")}</InputLabel>
          <Select
            value={depositAccount}
            onChange={(e) => setDepositAccount(e.target.value)}
            label={t("depositTo")}
            displayEmpty
            notched
          >
            <MenuItem value="">
              <em>{t("depositAuto")}</em>
            </MenuItem>
            {bankAccounts.map((a) => (
              <MenuItem key={a.code} value={a.code}>
                {a.code} — {a.name}
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        {/* Reference */}
        <TextField
          label={t("reference")}
          value={reference}
          onChange={(e) => setReference(e.target.value)}
          fullWidth
          margin="normal"
          placeholder={t("referencePlaceholder")}
        />

        {/* Notes */}
        <TextField
          label={t("notes")}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          fullWidth
          margin="normal"
          multiline
          rows={3}
          placeholder={t("notesPlaceholder")}
        />

        {/* Payment proof — deposit slip, bank screenshot, etc. */}
        <Box sx={{ mt: 2 }}>
          <AttachmentUploader
            folder={`payments/invoice-${selectedInvoice?.id || "new"}`}
            value={attachments}
            onChange={setAttachments}
            label={t("proof")}
            compact
          />
        </Box>
      </DialogContent>

      <DialogActions sx={{ p: 2 }}>
        <Button onClick={onClose} disabled={createPaymentMutation.isPending}>
          {t("cancel")}
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
          {createPaymentMutation.isPending ? t("recording") : t("title")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}