"use client";

// Send an invoice to the customer on WhatsApp (guru 2026-11-25). Reuses the
// same backend send path as the quotation sign-link flow — POST
// /documents/:id/sign-link/send with { via: "whatsapp" } — which, for an
// INVOICE, sends the pay/view link via the org's connected line (80537238 for
// Chong Aik) and, if the 24h window is closed or no line answers, hands back a
// wa.me link so the user still sends in one tap.

import React, { useCallback, useEffect, useState } from "react";
import { Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, InputAdornment, Stack, TextField, Typography } from "@mui/material";
import WhatsAppIcon from "@mui/icons-material/WhatsApp";
import { useAuth } from "@clerk/nextjs";
import { toast } from "react-toastify";

type Props = {
  open: boolean;
  documentId: string;
  documentNumber?: string | null;
  clientName?: string | null;
  clientPhone?: string | null;
  grandTotal?: number | null;
  onClose: () => void;
};

type SendResult = { sent: boolean; to: string; url?: string; message?: string; reason?: string; waHref?: string };

export default function InvoiceWhatsAppDialog({ open, documentId, documentNumber, clientName, clientPhone, grandTotal, onClose }: Props) {
  const { getToken } = useAuth();
  const [phone, setPhone] = useState("");
  const [sending, setSending] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setPhone(clientPhone || "");
    setSentTo(null);
  }, [open, clientPhone]);

  const call = useCallback(
    async <T = any,>(path: string, method: "POST" = "POST", body?: any): Promise<T> => {
      const token = await getToken();
      const headers: Record<string, string> = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
      if (typeof window !== "undefined") {
        const activeOrgId = window.sessionStorage.getItem("aims-admin-active-org");
        if (activeOrgId) headers["X-Active-Org-Id"] = activeOrgId;
      }
      const res = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_API_URL}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        const msg = json?.message?.message || json?.message || `Request failed (${res.status})`;
        throw new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
      }
      return (json?.data ?? json) as T;
    },
    [getToken],
  );

  const digitsOf = (s: string) => s.replace(/\D/g, "");

  const send = async () => {
    const to = digitsOf(phone);
    if (to.length < 8) {
      toast.error("Enter the customer's WhatsApp number");
      return;
    }
    setSending(true);
    try {
      const r = await call<SendResult>(`/documents/${documentId}/sign-link/send`, "POST", { via: "whatsapp", to });
      if (r.sent) {
        setSentTo(`+${r.to}`);
        toast.success(`Invoice sent to +${r.to} on WhatsApp`);
      } else if (r.waHref || r.url) {
        window.open(r.waHref || `https://wa.me/${to}?text=${encodeURIComponent(r.message || `Here is your invoice ${documentNumber || ""}: ${r.url || ""}`)}`, "_blank", "noreferrer");
        toast.info("Opened WhatsApp with the message ready to send.");
      } else {
        toast.error(r.reason || "Could not send");
      }
    } catch (e: any) {
      toast.error(e.message || "Could not send");
    } finally {
      setSending(false);
    }
  };

  const amount = Number(grandTotal) > 0 ? ` (S$ ${Number(grandTotal).toLocaleString("en-SG", { minimumFractionDigits: 2 })})` : "";

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs" PaperProps={{ sx: { borderRadius: 2 } }}>
      <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 1 }}>
        <WhatsAppIcon sx={{ color: "#25D366" }} /> Send invoice on WhatsApp
      </DialogTitle>
      <DialogContent dividers>
        <Stack gap={1.5}>
          <Typography variant="body2" color="text.secondary">
            {`Invoice ${documentNumber || ""}${amount}`}{clientName ? ` — ${clientName}` : ""}
          </Typography>
          <TextField
            label="Customer WhatsApp number"
            size="small"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="e.g. 9123 4567"
            fullWidth
            autoFocus
            InputProps={{ startAdornment: <InputAdornment position="start">+65</InputAdornment> }}
            helperText="Local numbers are sent as +65. The customer gets a link to view the invoice."
          />
          {sentTo && (
            <Box sx={{ color: "success.main", display: "flex", alignItems: "center", gap: 0.5 }}>
              <WhatsAppIcon fontSize="small" /> <Typography variant="body2">Sent to {sentTo}</Typography>
            </Box>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
        <Button variant="contained" onClick={send} disabled={sending} startIcon={sending ? <CircularProgress size={14} color="inherit" /> : <WhatsAppIcon />} sx={{ bgcolor: "#25D366", "&:hover": { bgcolor: "#1DA851" } }}>
          {sending ? "Sending…" : "Send"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
