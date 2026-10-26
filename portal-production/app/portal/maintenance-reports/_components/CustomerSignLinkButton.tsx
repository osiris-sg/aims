"use client";

import React, { useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack, TextField, Typography } from "@mui/material";
import LinkIcon from "@mui/icons-material/Link";
import { request } from "@/helpers/request";

/**
 * "Copy sign link" for an UNSIGNED service report (2026-10-26) — the portal
 * twin of the DO editor's share link. Mints (or reuses) a one-use token link
 * the customer signs without logging in (/guest/service-report/<token>).
 * The office cannot sign as the technician, so a report with no technician
 * signature is flagged: the field app's button captures it before minting.
 */
export default function CustomerSignLinkButton({ reportId, hasTechSignature }: { reportId: string; hasTechSignature: boolean }) {
  const { getToken } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<{ url: string; expiresAt: string | null } | null>(null);
  const [copied, setCopied] = useState(false);

  const base = (process.env.NEXT_PUBLIC_APP_URL || "https://app.ai-ms.io").replace(/\/$/, "");

  const mint = async () => {
    setError(null);
    setBusy(true);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      const res: any = await request({ path: "/maintenance-reports/sign-link", method: "POST" }, { reportIds: [reportId] }, token);
      const body = res?.data ?? res;
      if (body?.success === false || !body?.path) throw new Error(body?.message || "Could not create the sign link");
      const url = `${base}${body.path}`;
      setLink({ url, expiresAt: body.expiresAt ?? null });
      try {
        await navigator.clipboard.writeText(url);
        setCopied(true);
      } catch {
        setCopied(false); // the dialog still shows it for manual copy
      }
    } catch (e: any) {
      setError(e?.message ?? "Could not create the sign link");
    } finally {
      setBusy(false);
    }
  };

  const revoke = async () => {
    if (!window.confirm("Revoke the customer sign link? Anyone holding it will no longer be able to sign.")) return;
    setBusy(true);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      const res: any = await request({ path: `/maintenance-reports/${reportId}/sign-link/revoke`, method: "POST" }, {}, token);
      if (res?.success === false) throw new Error(res?.message || "Could not revoke the link");
      setLink(null);
    } catch (e: any) {
      setError(e?.message ?? "Could not revoke the link");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button variant="outlined" startIcon={<LinkIcon />} onClick={mint} disabled={busy} data-tour="service-report-sign-link">
        {busy && !link ? "Creating..." : "Copy sign link"}
      </Button>
      <Dialog open={!!link || !!error} onClose={() => { setLink(null); setError(null); }} fullWidth maxWidth="sm">
        <DialogTitle sx={{ fontWeight: 700 }}>Customer sign link</DialogTitle>
        <DialogContent>
          <Stack spacing={1.5} sx={{ pt: 0.5 }}>
            {error && <Alert severity="error">{error}</Alert>}
            {link && (
              <>
                <TextField value={link.url} fullWidth size="small" InputProps={{ readOnly: true }} onFocus={(e) => e.target.select()} />
                <Typography variant="caption" color="text.secondary">
                  {copied ? "Copied to the clipboard. " : ""}One use only.{link.expiresAt ? ` Expires ${new Date(link.expiresAt).toLocaleString()}.` : ""} Signing completes the report like an on-site signature.
                </Typography>
                {!hasTechSignature && (
                  <Alert severity="warning">
                    This report has no technician signature yet, so it will print without one. To include it, send the link from
                    the field app (Pending Sign, then Send sign link), which asks the technician to sign first.
                  </Alert>
                )}
              </>
            )}
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          {link && (
            <Button color="error" onClick={revoke} disabled={busy}>
              Revoke
            </Button>
          )}
          {link && (
            <Button onClick={async () => { try { await navigator.clipboard.writeText(link.url); setCopied(true); } catch { /* manual copy */ } }}>
              Copy
            </Button>
          )}
          <Button variant="contained" onClick={() => { setLink(null); setError(null); }}>
            Done
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
