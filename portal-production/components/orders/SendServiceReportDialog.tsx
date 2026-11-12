"use client";

import React, { useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { Alert, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, TextField } from "@mui/material";
import { request } from "@/helpers/request";

/**
 * "Send service report to customer" (manual order flow, 2026-11-12): every
 * completed service report of the order goes out in one email, each as its PDF
 * (an uploaded one as stored) plus its photos file. Used from the order page
 * and offered after an order's invoice is sent.
 */
export default function SendServiceReportDialog({
  open,
  onClose,
  orderId,
  orderNumber,
  defaultEmail,
  intro,
  onSent,
}: {
  open: boolean;
  onClose: () => void;
  orderId: string;
  orderNumber?: string | null;
  defaultEmail?: string | null;
  /** Optional first line, e.g. after the invoice was sent. */
  intro?: string;
  onSent?: (r: { sentTo: string[]; reports: Array<number | null> }) => void;
}) {
  const { getToken } = useAuth();
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setTo(defaultEmail ?? "");
    setError(null);
  }, [open, defaultEmail]);

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      const res: any = await request({ path: `/maintenance-reports/orders/${orderId}/send-to-customer`, method: "POST" }, { to }, token);
      if (res?.success === false) throw new Error(res.message || "Could not send the service report");
      onSent?.(res?.data ?? res);
      onClose();
    } catch (e: any) {
      setError(e?.message ?? "Could not send the service report");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Send service report to customer</DialogTitle>
      <DialogContent>
        {intro && <DialogContentText sx={{ mb: 1.5 }}>{intro}</DialogContentText>}
        <DialogContentText sx={{ mb: 2 }}>
          The service report{orderNumber ? ` of order ${orderNumber}` : ""} is emailed as a PDF, with the photos file if there is one.
        </DialogContentText>
        <TextField size="small" label="Email to" value={to} onChange={(e) => setTo(e.target.value)} placeholder="customer@example.com" helperText="Several addresses: separate them with commas" fullWidth autoFocus />
        {error && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {error}
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          {intro ? "Not now" : "Cancel"}
        </Button>
        <Button variant="contained" onClick={() => void send()} disabled={busy || !to.trim()} startIcon={busy ? <CircularProgress size={16} color="inherit" /> : undefined}>
          Send
        </Button>
      </DialogActions>
    </Dialog>
  );
}
