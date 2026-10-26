"use client";

import React, { useRef, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Stack, TextField, Typography } from "@mui/material";
import LinkIcon from "@mui/icons-material/Link";
import { request } from "@/helpers/request";
import { uploadImage } from "@/helpers/imageUploader";
import SignaturePadField, { type SignaturePadHandle } from "@/components/delivery/SignaturePadField";
import { SIGNATURE_FOLDER } from "../lib/signReports";

/**
 * CUSTOMER NOT HERE? SEND A SIGN LINK (2026-10-26).
 *
 * The remote alternative to the client pad: the technician signs THEIR half
 * here (a skipped report carries no signature at all), then gets a link the
 * customer opens without logging in (/guest/service-report/<token>). The
 * customer's signature completes the report(s) through the same sign endpoint
 * the on-site flow uses. Works for one report or a one-customer batch.
 */
export default function RemoteSignLinkButton({ reportIds, disabled }: { reportIds: string[]; disabled?: boolean }) {
  const { getToken } = useAuth();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<{ url: string; expiresAt: string | null } | null>(null);
  const [copied, setCopied] = useState(false);
  const padRef = useRef<SignaturePadHandle>(null);
  const linkRef = useRef<HTMLInputElement | null>(null);
  const canShare = typeof navigator !== "undefined" && typeof (navigator as any).share === "function";
  const n = reportIds.length;

  const mint = async () => {
    setError(null);
    if (!padRef.current || padRef.current.isEmpty()) return setError("Sign as the technician first.");
    setBusy(true);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      const blob = await (await fetch(padRef.current.toDataUrl())).blob();
      const techKey = await uploadImage({ blob, folderName: SIGNATURE_FOLDER, token });
      if (!techKey) throw new Error("Your signature could not be uploaded. Check the connection and try again.");
      const res: any = await request({ path: "/maintenance-reports/sign-link", method: "POST" }, { reportIds, techSignatureKey: techKey }, token);
      const body = res?.data ?? res;
      if (body?.success === false || !body?.path) throw new Error(body?.message || "Could not create the link");
      // Absolute URL off the public app host, as the DO share link does: the
      // field app runs in a WebView whose origin is not the public site.
      const base = (process.env.NEXT_PUBLIC_APP_URL || "https://app.ai-ms.io").replace(/\/$/, "");
      setLink({ url: `${base}${body.path}`, expiresAt: body.expiresAt ?? null });
    } catch (e: any) {
      setError(e?.message ?? "Could not create the link");
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.url);
    } catch {
      const el = linkRef.current;
      if (!el) return;
      el.focus();
      el.select();
      document.execCommand("copy");
    }
    setCopied(true);
  };
  const share = async () => {
    if (!link || !canShare) return;
    try {
      await (navigator as any).share({ text: `Please sign the service report${n === 1 ? "" : "s"}: ${link.url}` });
    } catch {
      /* dismissed */
    }
  };

  const close = () => {
    if (busy) return;
    setOpen(false);
    setLink(null);
    setCopied(false);
    setError(null);
  };

  return (
    <>
      <Button variant="outlined" startIcon={<LinkIcon />} disabled={disabled || !n} onClick={() => setOpen(true)} sx={{ minHeight: 48 }} data-tour="service-report-sign-link">
        Customer not here? Send sign link
      </Button>
      <Dialog open={open} onClose={close} fullWidth maxWidth="xs">
        <DialogTitle sx={{ fontWeight: 700 }}>{link ? "Send this link to the customer" : "Technician signature"}</DialogTitle>
        <DialogContent>
          {!link ? (
            <Stack spacing={1.5} sx={{ pt: 0.5 }}>
              <Typography variant="body2" color="text.secondary">
                Sign as the technician. The customer then signs {n === 1 ? "the report" : `all ${n} reports`} from the link, no login needed.
              </Typography>
              <SignaturePadField ref={padRef} />
              <Box>
                <Button size="small" onClick={() => padRef.current?.clear()} disabled={busy}>Clear</Button>
              </Box>
              {error && <Alert severity="error">{error}</Alert>}
            </Stack>
          ) : (
            <Stack spacing={1.5} sx={{ pt: 0.5 }}>
              <TextField inputRef={linkRef} value={link.url} fullWidth size="small" InputProps={{ readOnly: true }} onFocus={(e) => e.target.select()} />
              <Typography variant="caption" color="text.secondary">
                One use only.{link.expiresAt ? ` Expires ${new Date(link.expiresAt).toLocaleString()}.` : ""} The report stays in Pending Sign until the customer signs.
              </Typography>
              <Stack direction="row" spacing={1}>
                <Button variant="contained" onClick={copy}>{copied ? "Copied" : "Copy link"}</Button>
                {canShare && <Button variant="outlined" onClick={share}>Share</Button>}
              </Stack>
            </Stack>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={close} disabled={busy}>{link ? "Done" : "Cancel"}</Button>
          {!link && (
            <Button variant="contained" onClick={mint} disabled={busy}>
              {busy ? <CircularProgress size={20} color="inherit" /> : "Create link"}
            </Button>
          )}
        </DialogActions>
      </Dialog>
    </>
  );
}
