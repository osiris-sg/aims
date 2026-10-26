"use client";

// "Send for signature" for GENERIC quotations (WCT 2026-10-26): mints the
// client e-sign link (same /documents/:id/sign-link + public /sign/<token>
// flow the ID quotation uses), shows it with Copy / WhatsApp share, expiry
// and revoke, and shows the signed state once signed. Neutral copy — no
// project talk: signing a generic quotation only confirms it.

import React, { useCallback, useEffect, useState } from "react";
import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, InputAdornment, Stack, TextField, Tooltip, Typography } from "@mui/material";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import WhatsAppIcon from "@mui/icons-material/WhatsApp";
import LinkOffIcon from "@mui/icons-material/LinkOff";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import { useAuth } from "@clerk/nextjs";
import { toast } from "react-toastify";

interface Props {
  open: boolean;
  documentId: string;
  documentNumber: string | null;
  clientName?: string;
  clientPhone?: string;
  grandTotal?: number;
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

export default function QuotationSignLinkDialog({ open, documentId, documentNumber, clientName, clientPhone, grandTotal, onClose }: Props) {
  const { getToken } = useAuth();
  const [loading, setLoading] = useState(false);
  const [link, setLink] = useState<{ url: string; expiresAt: string | null } | null>(null);
  const [signed, setSigned] = useState<{ signedAt: string; signerName: string | null } | null>(null);

  const call = useCallback(
    async <T = any,>(path: string, method: "GET" | "POST" = "GET"): Promise<T> => {
      const token = await getToken();
      const headers: Record<string, string> = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
      if (typeof window !== "undefined") {
        const activeOrgId = window.sessionStorage.getItem("aims-admin-active-org");
        if (activeOrgId) headers["X-Active-Org-Id"] = activeOrgId;
      }
      const res = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_API_URL}${path}`, { method, headers });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        const msg = json?.message?.message || json?.message || `Request failed (${res.status})`;
        throw new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
      }
      return (json?.data ?? json) as T;
    },
    [getToken],
  );

  useEffect(() => {
    if (!open || !documentId) return;
    setLoading(true);
    call<{ active: { url: string; expiresAt: string | null } | null; signed: { signedAt: string; signerName: string | null } | null }>(`/documents/${documentId}/sign-link`)
      .then(async (s) => {
        setSigned(s.signed);
        if (s.active) setLink(s.active);
        else if (!s.signed) setLink(await call(`/documents/${documentId}/sign-link`, "POST"));
      })
      .catch((e) => toast.error(e.message || "Could not create link"))
      .finally(() => setLoading(false));
  }, [open, documentId, call]);

  const fullUrl = absolute(link?.url);
  const amount = Number(grandTotal) > 0 ? ` (S$ ${Number(grandTotal).toLocaleString("en-SG", { minimumFractionDigits: 2 })})` : "";
  const message = `Hi ${clientName || ""}, please review and sign quotation ${documentNumber || ""}${amount} here: ${fullUrl}`;
  const waHref = `https://wa.me/${(clientPhone || "").replace(/\D/g, "").replace(/^0/, "")}?text=${encodeURIComponent(message)}`;

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
      await call(`/documents/${documentId}/sign-link/revoke`, "POST");
      setLink(null);
      toast.success("Link revoked");
      const fresh = await call<{ url: string; expiresAt: string | null }>(`/documents/${documentId}/sign-link`, "POST");
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
            Signed by <b>{signed.signerName || clientName}</b> on {fmtDate(signed.signedAt)}. The quotation is confirmed.
          </Alert>
        ) : (
          <Stack spacing={2}>
            <Typography variant="body2" sx={{ color: "text.secondary" }}>
              The client opens this link (no login), reads the quotation exactly as the PDF, draws their signature and accepts the T&amp;Cs. On signing, the quotation is confirmed and the office is notified.
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
