"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  InputAdornment,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import PaymentIcon from "@mui/icons-material/Payment";
import { useAuth } from "@clerk/nextjs";
import { request } from "@/helpers/request";
import { toast } from "react-toastify";
import moment from "moment";
import AttachmentUploader, { Attachment } from "@/components/AttachmentUploader";

type ChartAccount = { id: string; code: string; name: string };

interface Props {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  bill: {
    id: string;
    billNumber: string;
    totalAmount: number;
    amountPaid: number;
    supplierName?: string;
  };
}

const PAYMENT_METHODS = [
  { value: "transfer", label: "Bank Transfer / TT" },
  { value: "cheque", label: "Cheque" },
  { value: "giro", label: "GIRO" },
  { value: "paynow", label: "PayNow" },
  { value: "cash", label: "Cash" },
  { value: "other", label: "Other" },
];

export default function RecordBillPaymentDialog({ open, onClose, onSuccess, bill }: Props) {
  const { getToken } = useAuth();
  const outstanding = useMemo(() => Math.max(0, bill.totalAmount - (bill.amountPaid || 0)), [bill]);

  const [amount, setAmount] = useState<string>("");
  const [paymentDate, setPaymentDate] = useState<string>(moment().format("YYYY-MM-DD"));
  const [paymentMethod, setPaymentMethod] = useState<string>("transfer");
  const [bankAccountId, setBankAccountId] = useState<string>("");
  const [reference, setReference] = useState<string>("");
  const [notes, setNotes] = useState<string>("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [bankAccounts, setBankAccounts] = useState<ChartAccount[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Load bank accounts on open. Re-use the existing bank-rec endpoint which
  // already filters to cash/bank accounts via JournalService.isCashOrBankAccount.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const token = await getToken();
        const res: any = await request(
          { path: "/bank-rec/accounts", method: "GET" },
          undefined,
          token!,
        );
        const list: ChartAccount[] = res?.data?.data || res?.data || [];
        if (!cancelled) {
          setBankAccounts(list);
          if (list.length && !bankAccountId) setBankAccountId(list[0].id);
        }
      } catch (e: any) {
        if (!cancelled) toast.error("Failed to load bank accounts");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, getToken]); // eslint-disable-line react-hooks/exhaustive-deps

  // Default amount to outstanding on open.
  useEffect(() => {
    if (open) {
      setAmount(outstanding.toFixed(2));
      setReference("");
      setNotes("");
      setAttachments([]);
      setPaymentDate(moment().format("YYYY-MM-DD"));
    }
  }, [open, outstanding]);

  const numericAmount = parseFloat(amount) || 0;
  const overOutstanding = numericAmount > outstanding + 0.01;
  const canSubmit = numericAmount > 0 && !overOutstanding && bankAccountId && paymentDate && paymentMethod;

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const token = await getToken();
      await request(
        { path: `/bills/${bill.id}/payments`, method: "POST" },
        {
          amount: numericAmount,
          paymentDate,
          paymentMethod,
          bankAccountId,
          reference: reference || undefined,
          notes: notes || undefined,
          attachments,
        },
        token!,
      );
      toast.success("Payment recorded");
      onSuccess();
      onClose();
    } catch (e: any) {
      const msg = e?.response?.data?.message || e?.message || "Failed to record payment";
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        <Stack direction="row" alignItems="center" gap={1}>
          <PaymentIcon color="primary" />
          <Box sx={{ flex: 1 }}>
            <Typography variant="h6" sx={{ fontWeight: 700 }}>
              Record Payment
            </Typography>
            <Typography variant="caption" sx={{ color: "text.secondary" }}>
              {bill.billNumber}{bill.supplierName ? ` · ${bill.supplierName}` : ""}
            </Typography>
          </Box>
          <IconButton onClick={onClose}>
            <CloseIcon />
          </IconButton>
        </Stack>
      </DialogTitle>
      <DialogContent dividers>
        <Stack gap={2.5}>
          {/* Summary band */}
          <Box sx={{ p: 1.5, bgcolor: "action.hover", borderRadius: 1 }}>
            <Stack direction="row" justifyContent="space-between">
              <Typography variant="body2" color="text.secondary">Bill total</Typography>
              <Typography variant="body2" sx={{ fontFamily: "monospace" }}>${bill.totalAmount.toFixed(2)}</Typography>
            </Stack>
            <Stack direction="row" justifyContent="space-between">
              <Typography variant="body2" color="text.secondary">Already paid</Typography>
              <Typography variant="body2" sx={{ fontFamily: "monospace" }}>${(bill.amountPaid || 0).toFixed(2)}</Typography>
            </Stack>
            <Stack direction="row" justifyContent="space-between" sx={{ mt: 0.5, pt: 0.5, borderTop: "1px solid", borderColor: "divider" }}>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>Outstanding</Typography>
              <Typography variant="body2" sx={{ fontWeight: 600, fontFamily: "monospace" }}>${outstanding.toFixed(2)}</Typography>
            </Stack>
          </Box>

          {loading && (
            <Box sx={{ display: "flex", justifyContent: "center", py: 2 }}>
              <CircularProgress size={20} />
            </Box>
          )}

          <Stack direction="row" gap={2}>
            <TextField
              fullWidth
              size="small"
              label="Payment amount"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              type="number"
              InputProps={{ startAdornment: <InputAdornment position="start">$</InputAdornment> }}
              error={overOutstanding}
              helperText={overOutstanding ? `Exceeds outstanding $${outstanding.toFixed(2)}` : " "}
            />
            <TextField
              fullWidth
              size="small"
              label="Payment date"
              type="date"
              value={paymentDate}
              onChange={(e) => setPaymentDate(e.target.value)}
              InputLabelProps={{ shrink: true }}
            />
          </Stack>

          <Stack direction="row" gap={2}>
            <TextField
              select
              fullWidth
              size="small"
              label="Payment method"
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value)}
            >
              {PAYMENT_METHODS.map((m) => (
                <MenuItem key={m.value} value={m.value}>{m.label}</MenuItem>
              ))}
            </TextField>
            <TextField
              select
              fullWidth
              size="small"
              label="From bank account"
              value={bankAccountId}
              onChange={(e) => setBankAccountId(e.target.value)}
              disabled={bankAccounts.length === 0}
            >
              {bankAccounts.map((b) => (
                <MenuItem key={b.id} value={b.id}>
                  {b.code} — {b.name}
                </MenuItem>
              ))}
            </TextField>
          </Stack>

          <TextField
            fullWidth
            size="small"
            label="Reference (cheque #, TT ref, PayNow ref)"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
          />

          <TextField
            fullWidth
            size="small"
            label="Notes (optional)"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            multiline
            rows={2}
          />

          {/* Attachments — cheque scan / bank TT advice / PayNow screenshot */}
          <AttachmentUploader
            folder={`bills/${bill.id}/payments`}
            value={attachments}
            onChange={setAttachments}
            label="Payment Proof"
            compact
          />

          {!loading && bankAccounts.length === 0 && (
            <Alert severity="warning">
              No cash/bank accounts found. Set one up in Settings → Accounting Setup before recording payments.
            </Alert>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={submit} disabled={!canSubmit || submitting}>
          {submitting ? <CircularProgress size={18} /> : "Record Payment"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
