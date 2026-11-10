"use client";

import React, { useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { Alert, Box, Button, CircularProgress, Paper, Stack, TextField, Typography } from "@mui/material";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import { request } from "@/helpers/request";

// SiteClock "Skip" (completionMode sign_link, 2026-11-11): the job was finished
// without a signature. The office copies the DO's sign link (the same public
// /guest/do page Biofuel uses, with the signable RECEIVED BY box) and sends it
// to the customer; their signature there verifies the job.
export default function CustomerSignLink({ documentId, doName }: { documentId: string; doName?: string | null }) {
  const { getToken } = useAuth();
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const copy = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const token = await getToken();
      const res: any = await request({ path: `/documents/${documentId}/share-link`, method: "POST" }, {}, token ?? undefined);
      const body = res?.data ?? res;
      // Absolute link for the customer (the API's url is a bare path when PORTAL_URL is unset).
      const base = (process.env.NEXT_PUBLIC_APP_URL || "https://app.ai-ms.io").replace(/\/$/, "");
      const path = body?.path || (body?.token ? `/guest/do/${body.token}` : "");
      const full = path ? `${base}${path}` : body?.url ?? "";
      if (!full) throw new Error("No link was returned");
      setUrl(full);
      try {
        await navigator.clipboard.writeText(full);
        setMsg({ ok: true, text: "Copied. Send it to the customer (WhatsApp or email)." });
      } catch {
        setMsg({ ok: true, text: "Link ready. Copy it from the box below." });
      }
    } catch (e: any) {
      setMsg({ ok: false, text: e?.response?.data?.message || e?.message || "Could not get the sign link" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Paper variant="outlined" sx={{ p: 2, mb: 2 }} data-tour="customer-sign-link">
      <Typography variant="subtitle2" fontWeight={700}>Waiting for the customer&apos;s signature</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
        The job was finished without a signature. Send the customer the sign link for {doName || "the DO"}. When they sign it, the job is verified automatically.
      </Typography>
      <Stack direction="row" spacing={1} sx={{ mt: 1.5 }} alignItems="center">
        <Button variant="contained" size="small" onClick={() => void copy()} disabled={busy} startIcon={busy ? <CircularProgress size={14} /> : <ContentCopyIcon />}>
          Copy customer sign link
        </Button>
      </Stack>
      {url && (
        <Box sx={{ mt: 1.5 }}>
          <TextField size="small" fullWidth value={url} InputProps={{ readOnly: true }} onFocus={(e) => e.target.select()} />
        </Box>
      )}
      {msg && <Alert severity={msg.ok ? "success" : "error"} sx={{ mt: 1.5 }}>{msg.text}</Alert>}
    </Paper>
  );
}
