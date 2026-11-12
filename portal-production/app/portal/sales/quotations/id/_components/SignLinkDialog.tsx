"use client";

// "Send for signature": mints the client e-sign link, shows it with Copy /
// WhatsApp share, an "Email the link" box (guru 2026-11-13: the server emails
// the link, prefilled with the client's email), expiry and revoke; shows the
// signed state once signed.

import React, { useEffect, useState } from "react";
import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, InputAdornment, Stack, TextField, Tooltip, Typography } from "@mui/material";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import WhatsAppIcon from "@mui/icons-material/WhatsApp";
import LinkOffIcon from "@mui/icons-material/LinkOff";
import EmailOutlinedIcon from "@mui/icons-material/EmailOutlined";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import { toast } from "react-toastify";
import { useIdQuoteApi } from "../_lib/api";
import { SIGN_LINK_WORDING, type SignLinkWording } from "@/helpers/signLinkWording";

interface Props {
  open: boolean;
  documentId: string;
  documentNumber: string | null;
  clientName: string;
  clientPhone: string;
  /** Prefills the "Email the link" box; the user can change it. */
  clientEmail?: string;
  grandTotal: number;
  /** "vo" = a variation order link (Mike 2026-11-07): same flow, VO wording; signing confirms the VO and adds its net to the contract sum. */
  kind?: "quotation" | "vo";
  /** Quotation wording: "ciel" (default, unchanged) or "wct" (WCT group, 2026-11-13). */
  wording?: SignLinkWording;
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

export default function SignLinkDialog({ open, documentId, documentNumber, clientName, clientPhone, clientEmail = "", grandTotal, kind = "quotation", wording = "ciel", onClose }: Props) {
  const isVo = kind === "vo";
  const w = SIGN_LINK_WORDING[wording];
  const api = useIdQuoteApi();
  const [loading, setLoading] = useState(false);
  const [link, setLink] = useState<{ url: string; expiresAt: string | null } | null>(null);
  const [signed, setSigned] = useState<{ signedAt: string; signerName: string | null } | null>(null);
  const [email, setEmail] = useState(clientEmail);
  const [emailing, setEmailing] = useState(false);
  const [emailedTo, setEmailedTo] = useState<string[]>([]);
  useEffect(() => {
    if (open) setEmail(clientEmail);
  }, [open, clientEmail]);

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
  const message = isVo
    ? `Hi ${clientName || ""}, please review and sign variation order ${documentNumber || ""} (net S$ ${grandTotal.toLocaleString("en-SG", { minimumFractionDigits: 2 })}) here: ${fullUrl}`
    : w.message(clientName, documentNumber || "", grandTotal, fullUrl);
  const waHref = `https://wa.me/${(clientPhone || "").replace(/\D/g, "").replace(/^0/, "")}${clientPhone ? "" : ""}?text=${encodeURIComponent(message)}`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(fullUrl);
      toast.success("Link copied");
    } catch {
      toast.error(w.copyFailed);
    }
  };

  const emailLink = async () => {
    const to = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
      toast.error("Enter the client's email address");
      return;
    }
    setEmailing(true);
    try {
      const r = await api.sendSignLink(documentId, { via: "email", to });
      if (r.url) setLink({ url: r.url, expiresAt: r.expiresAt });
      if (r.sent) {
        setEmailedTo((prev) => [...prev, r.to]);
        toast.success(`Emailed to ${r.to}`);
      } else toast.error(r.reason || "Could not send the email");
    } catch (e: any) {
      toast.error(e.message || "Could not send the email");
    } finally {
      setEmailing(false);
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
            Signed by <b>{signed.signerName || clientName}</b> on {fmtDate(signed.signedAt)}.{" "}
            {isVo ? "The variation order is confirmed and its net amount is on the contract sum." : w.signed}
          </Alert>
        ) : (
          <Stack spacing={2}>
            <Typography variant="body2" sx={{ color: "text.secondary" }}>
              {isVo
                ? "The homeowner opens this link (no login), reads the variation order exactly as the printed sheet, and draws their signature. On signing, the VO is confirmed, its net amount is added to the contract sum, and management is notified."
                : w.intro}
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
            <Stack direction={{ xs: "column", sm: "row" }} spacing={1} alignItems={{ sm: "center" }}>
              <TextField
                size="small"
                fullWidth
                label="Email"
                placeholder="client@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                InputProps={{ startAdornment: <InputAdornment position="start"><EmailOutlinedIcon fontSize="small" /></InputAdornment> }}
                data-testid="sign-link-email"
              />
              <Button variant="outlined" onClick={emailLink} disabled={!link || emailing} sx={{ textTransform: "none", whiteSpace: "nowrap" }} data-testid="sign-link-email-send">
                {emailing ? "Sending…" : "Email the link"}
              </Button>
            </Stack>
            {emailedTo.length > 0 && (
              <Typography variant="caption" sx={{ color: "success.main" }}>
                Emailed to {emailedTo.join(", ")}
              </Typography>
            )}
            <Typography variant="caption" sx={{ color: "text.disabled" }}>
              {w.footer}
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
