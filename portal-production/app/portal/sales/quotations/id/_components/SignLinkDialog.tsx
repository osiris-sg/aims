"use client";

// "Send for signature": mints the client e-sign link, shows it with Copy /
// WhatsApp share, expiry and revoke; shows the signed state once signed.

import React, { useEffect, useState } from "react";
import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, InputAdornment, Stack, TextField, Tooltip, Typography } from "@mui/material";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import WhatsAppIcon from "@mui/icons-material/WhatsApp";
import LinkOffIcon from "@mui/icons-material/LinkOff";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import { toast } from "react-toastify";
import { useIdQuoteApi } from "../_lib/api";

interface Props {
  open: boolean;
  documentId: string;
  documentNumber: string | null;
  clientName: string;
  clientPhone: string;
  grandTotal: number;
  onClose: () => void;
}

const fmtDate = (d?: string | null) => (d ? new Date(d).toLocaleDateString("en-SG", { day: "2-digit", month: "short", year: "numeric" }) : "");

// The API returns a relative path when PORTAL_URL isn't configured (dev); the
// portal always knows its own origin, so make the link absolute here.
const absolute = (url: string | null | undefined) => {
  if (!url) return "";
  if (/^https?:\/\//i.test(url)) return url;
  return typeof window !== "undefined" ? `${window.location.origin}${url.startsWith("/") ? "" : "/"}${url}` : url;
};

export default function SignLinkDialog({ open, documentId, documentNumber, clientName, clientPhone, grandTotal, onClose }: Props) {
  const api = useIdQuoteApi();
  const [loading, setLoading] = useState(false);
  const [link, setLink] = useState<{ url: string; expiresAt: string | null } | null>(null);
  const [signed, setSigned] = useState<{ signedAt: string; signerName: string | null } | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    api
      .signLinkStatus(documentId)
      .then(async (s) => {
        setSigned(s.signed);
        if (s.active) setLink(s.active);
        else if (!s.signed) setLink(await api.createSignLink(documentId));
      })
      .catch((e) => toast.error(e.message || "Could not create link"))
      .finally(() => setLoading(false));
  }, [open, documentId, api]);

  const fullUrl = absolute(link?.url);
  const message = `Hi ${clientName || ""}, please review and sign your renovation quotation ${documentNumber || ""} (S$ ${grandTotal.toLocaleString("en-SG", { minimumFractionDigits: 2 })}) here: ${fullUrl}`;
  const waHref = `https://wa.me/${(clientPhone || "").replace(/\D/g, "").replace(/^0/, "")}${clientPhone ? "" : ""}?text=${encodeURIComponent(message)}`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(fullUrl);
      toast.success("Link copied");
    } catch {
      toast.error("Copy failed — select the link and copy it manually");
    }
  };

  const revoke = async () => {
    try {
      await api.revokeSignLink(documentId);
      setLink(null);
      toast.success("Link revoked");
      const fresh = await api.createSignLink(documentId);
      setLink(fresh);
      toast.info("A new link was created");
    } catch (e: any) {
      toast.error(e.message || "Revoke failed");
    }
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm" PaperProps={{ sx: { borderRadius: 2 } }}>
      <DialogTitle>Send for client signature</DialogTitle>
      <DialogContent dividers>
        {signed ? (
          <Alert icon={<CheckCircleIcon fontSize="inherit" />} severity="success">
            Signed by <b>{signed.signerName || clientName}</b> on {fmtDate(signed.signedAt)}. The quotation is confirmed and linked to its project.
          </Alert>
        ) : (
          <Stack spacing={2}>
            <Typography variant="body2" sx={{ color: "text.secondary" }}>
              The client opens this link (no login), reads the quotation exactly as the PDF, draws their signature and accepts the T&amp;Cs. On signing, the quotation is confirmed, a project is created and management is notified.
            </Typography>
            <TextField
              size="small"
              fullWidth
              value={loading ? "Creating link…" : fullUrl}
              InputProps={{
                readOnly: true,
                endAdornment: (
                  <InputAdornment position="end">
                    <Tooltip title="Copy link">
                      <span>
                        <IconButton size="small" onClick={copy} disabled={!link}>
                          <ContentCopyIcon fontSize="small" />
                        </IconButton>
                      </span>
                    </Tooltip>
                  </InputAdornment>
                ),
                sx: { fontSize: 13 },
              }}
            />
            <Stack direction="row" spacing={1} alignItems="center">
              <Button variant="contained" color="success" startIcon={<WhatsAppIcon />} href={waHref} target="_blank" rel="noreferrer" disabled={!link} sx={{ textTransform: "none" }}>
                Share on WhatsApp
              </Button>
              <Button variant="outlined" startIcon={<LinkOffIcon />} onClick={revoke} disabled={!link} sx={{ textTransform: "none" }}>
                Revoke &amp; re-issue
              </Button>
              <Box sx={{ flex: 1 }} />
              {link?.expiresAt && (
                <Typography variant="caption" sx={{ color: "text.secondary" }}>
                  valid until {fmtDate(link.expiresAt)}
                </Typography>
              )}
            </Stack>
            <Typography variant="caption" sx={{ color: "text.disabled" }}>
              Any edit you make after sharing is what the client sees when they open the link — the page always renders the latest saved version.
            </Typography>
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}
