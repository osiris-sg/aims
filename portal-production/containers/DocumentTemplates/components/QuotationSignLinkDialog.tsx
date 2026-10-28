"use client";

// "Send for signature" for GENERIC quotations (WCT 2026-10-26): mints the
// client e-sign link (same /documents/:id/sign-link + public /sign/<token>
// flow the ID quotation uses), shows it with Copy, expiry and revoke, and
// shows the signed state once signed. Neutral copy — no project talk:
// signing a generic quotation only confirms it.
//
// SEND TO THE CUSTOMER (guru 2026-10-28, "send the link to the customer number
// or email them … also on the dashboard"): a WhatsApp number box and an email
// box, each prefilled from the document's Attention / customer, with its own
// Send button. WhatsApp goes out from the org's connected business line
// (POST /documents/:id/sign-link/send); when the org has no line connected the
// button falls back to opening WhatsApp with the message ready (wa.me).

import React, { useCallback, useEffect, useState } from "react";
import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Divider, IconButton, InputAdornment, Stack, TextField, Tooltip, Typography } from "@mui/material";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import WhatsAppIcon from "@mui/icons-material/WhatsApp";
import EmailOutlinedIcon from "@mui/icons-material/EmailOutlined";
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
  clientEmail?: string;
  grandTotal?: number;
  onClose: () => void;
}

interface SendResult {
  sent: boolean;
  via: "whatsapp" | "email";
  to: string;
  url: string;
  expiresAt: string | null;
  message: string;
  reason?: string;
  waHref?: string;
}

const fmtDate = (d?: string | null) => (d ? new Date(d).toLocaleDateString("en-SG", { day: "2-digit", month: "short", year: "numeric" }) : "");

// The API returns a relative path when PORTAL_URL isn't configured (dev); the
// portal always knows its own origin, so make the link absolute here.
const absolute = (url: string | null | undefined) => {
  if (!url) return "";
  if (/^https?:\/\//i.test(url)) return url;
  return typeof window !== "undefined" ? `${window.location.origin}${url.startsWith("/") ? "" : "/"}${url}` : url;
};

const digitsOf = (v: string) => {
  let d = (v || "").replace(/\D/g, "").replace(/^0+/, "");
  if (d.length === 8) d = `65${d}`;
  return d;
};

export default function QuotationSignLinkDialog({ open, documentId, documentNumber, clientName, clientPhone, clientEmail, grandTotal, onClose }: Props) {
  const { getToken } = useAuth();
  const [loading, setLoading] = useState(false);
  const [link, setLink] = useState<{ url: string; expiresAt: string | null } | null>(null);
  const [signed, setSigned] = useState<{ signedAt: string; signerName: string | null } | null>(null);
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState<"whatsapp" | "email" | null>(null);
  const [sentTo, setSentTo] = useState<string[]>([]);

  useEffect(() => {
    if (!open) return;
    setPhone(clientPhone || "");
    setEmail(clientEmail || "");
    setSentTo([]);
  }, [open, clientPhone, clientEmail]);

  const call = useCallback(
    async <T = any,>(path: string, method: "GET" | "POST" = "GET", body?: any): Promise<T> => {
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
  const fallbackMessage = `Hi ${clientName || ""}, please review and sign quotation ${documentNumber || ""}${amount} here: ${fullUrl}`;

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

  const send = async (via: "whatsapp" | "email") => {
    const to = via === "whatsapp" ? digitsOf(phone) : email.trim();
    if (via === "whatsapp" && to.length < 8) {
      toast.error("Enter the customer's WhatsApp number");
      return;
    }
    if (via === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
      toast.error("Enter the customer's email address");
      return;
    }
    setSending(via);
    try {
      const r = await call<SendResult>(`/documents/${documentId}/sign-link/send`, "POST", { via, to });
      if (r.url) setLink({ url: r.url, expiresAt: r.expiresAt });
      if (r.sent) {
        setSentTo((prev) => [...prev, via === "whatsapp" ? `+${r.to} on WhatsApp` : r.to]);
        toast.success(via === "whatsapp" ? `Sent to +${r.to} on WhatsApp` : `Emailed to ${r.to}`);
      } else if (via === "whatsapp" && r.reason === "no-line") {
        // No business line connected for this org: hand it to WhatsApp with the
        // message ready, so the user still sends it in one tap.
        window.open(r.waHref || `https://wa.me/${to}?text=${encodeURIComponent(r.message || fallbackMessage)}`, "_blank", "noreferrer");
        toast.info("No WhatsApp line is connected for this organisation — opened WhatsApp with the message ready to send.");
      } else {
        toast.error(r.reason || "Could not send");
      }
    } catch (e: any) {
      toast.error(e.message || "Could not send");
    } finally {
      setSending(null);
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

            <Stack spacing={1.25}>
              <Typography variant="subtitle2">Send to the customer</Typography>
              <Stack direction={{ xs: "column", sm: "row" }} spacing={1} alignItems={{ sm: "center" }}>
                <TextField
                  size="small"
                  fullWidth
                  label="WhatsApp number"
                  placeholder="e.g. 9123 4567"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  InputProps={{ startAdornment: <InputAdornment position="start"><WhatsAppIcon fontSize="small" sx={{ color: "success.main" }} /></InputAdornment> }}
                />
                <Button
                  variant="contained"
                  color="success"
                  onClick={() => send("whatsapp")}
                  disabled={!link || sending !== null}
                  sx={{ textTransform: "none", whiteSpace: "nowrap", minWidth: 150 }}
                >
                  {sending === "whatsapp" ? "Sending…" : "Send on WhatsApp"}
                </Button>
              </Stack>
              <Stack direction={{ xs: "column", sm: "row" }} spacing={1} alignItems={{ sm: "center" }}>
                <TextField
                  size="small"
                  fullWidth
                  label="Email"
                  placeholder="customer@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  InputProps={{ startAdornment: <InputAdornment position="start"><EmailOutlinedIcon fontSize="small" /></InputAdornment> }}
                />
                <Button
                  variant="outlined"
                  onClick={() => send("email")}
                  disabled={!link || sending !== null}
                  sx={{ textTransform: "none", whiteSpace: "nowrap", minWidth: 150 }}
                >
                  {sending === "email" ? "Sending…" : "Email the link"}
                </Button>
              </Stack>
              {sentTo.length > 0 && (
                <Alert severity="success" sx={{ py: 0 }}>
                  Sent to {sentTo.join(" and ")}. You will be notified when the customer signs.
                </Alert>
              )}
            </Stack>

            <Divider />

            <TextField
              size="small"
              fullWidth
              label="Sign link"
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
