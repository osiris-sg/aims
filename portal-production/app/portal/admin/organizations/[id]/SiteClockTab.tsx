"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */

import React, { useCallback, useEffect, useState } from "react";
import { Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Divider, FormControlLabel, Stack, Switch, TextField, Typography } from "@mui/material";
import { useAuth } from "@clerk/nextjs";
import { toast } from "react-toastify";
import { request } from "@/helpers/request";
import { Conn, inboundKeyLabel, isConn, keyStoredLabel, secretsMissing, testResultText, unwrap } from "../_lib/siteclock-connection";

// ─────────────────────────────────────────────────────────────────────────────
// SiteClock tab (admin org detail page, OsirisAdmin only).
//
// The org's SiteClock connection: base URL, SiteClock company id, the sck_live_
// API key (write-only; only its last 4 characters ever come back), on/off and
// the default job length. Deliveries use it only when the org also has the
// enableSiteClockLink flag on (Settings → Feature Flags).
// Backend: src/siteclock/siteclock.admin.controller.ts.
// ─────────────────────────────────────────────────────────────────────────────

const fmt = (d?: string | null) =>
  d ? new Date(d).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "never";

export default function SiteClockTab({ organizationId }: { organizationId: string }) {
  const { getToken } = useAuth();
  const [conn, setConn] = useState<Conn | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [baseUrl, setBaseUrl] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [duration, setDuration] = useState("60");
  // Inline results: the save / test outcome stays on screen (a toast alone was missed).
  const [saveError, setSaveError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null);
  // The new inbound key, shown once in a dialog (never kept anywhere else).
  const [newKey, setNewKey] = useState<string | null>(null);

  const base = `/admin/organizations/${organizationId}/siteclock`;

  // Only a real connection payload ever fills the form (see _lib/siteclock-connection.ts).
  const fill = (c: Conn) => {
    if (!isConn(c)) throw new Error("Unexpected reply from the server");
    setConn(c);
    setBaseUrl(c.baseUrl ?? "https://api.siteclock.osiris.sg");
    setCompanyId(c.siteclockCompanyId ?? "");
    setEnabled(!!c.enabled);
    setDuration(String(c.defaultDurationMin ?? 60));
    setApiKey("");
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const token = await getToken();
      if (!token) return;
      const res: any = await request({ path: base, method: "GET" }, {}, token);
      fill(unwrap<Conn>(res, "Failed to load the SiteClock connection"));
    } catch (e: any) {
      toast.error(e?.message || "Failed to load the SiteClock connection");
    } finally {
      setLoading(false);
    }
  }, [getToken, base]);

  useEffect(() => {
    load();
  }, [load]);

  // A failed save keeps everything typed (key included) and shows the server's reason.
  const save = async () => {
    setBusy(true);
    setSaveError(null);
    setTestResult(null);
    try {
      const token = await getToken();
      if (!token) return;
      const res: any = await request(
        { path: base, method: "PUT" },
        {
          baseUrl: baseUrl.trim(),
          siteclockCompanyId: companyId.trim(),
          enabled,
          defaultDurationMin: Number(duration) || 60,
          ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
        },
        token,
      );
      const saved = unwrap<Conn>(res, "Save failed");
      fill(saved);
      toast.success(keyStoredLabel(saved) ? `SiteClock connection saved. ${keyStoredLabel(saved)}` : "SiteClock connection saved");
    } catch (e: any) {
      setSaveError(e?.message || "Save failed");
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    setBusy(true);
    setTestResult(null);
    try {
      const token = await getToken();
      if (!token) return;
      const res: any = await request({ path: `${base}/test`, method: "GET" }, {}, token);
      setTestResult(testResultText(unwrap(res, "Test failed")));
      // Refresh the "last successful call" / last error without touching what is typed.
      const again: any = await request({ path: base, method: "GET" }, {}, token);
      const c = again?.success === false ? null : unwrap<Conn>(again);
      if (isConn(c)) setConn(c);
    } catch (e: any) {
      setTestResult({ ok: false, text: e?.message || "Test failed" });
    } finally {
      setBusy(false);
    }
  };

  // Inbound key (SiteClock → AIMS, job photos): generate / rotate shows it once; revoke stops SiteClock's calls.
  const generateKey = async () => {
    if (conn?.inboundKey && !window.confirm("Rotate the SiteClock key? The current key stops working at once, so paste the new one into SiteClock straight away.")) return;
    setBusy(true);
    try {
      const token = await getToken();
      if (!token) return;
      const res: any = await request({ path: `${base}/inbound-key`, method: "POST" }, {}, token);
      const { key, ...c } = unwrap<Conn & { key: string }>(res, "Could not generate the key");
      if (isConn(c)) setConn(c);
      setNewKey(key);
    } catch (e: any) {
      toast.error(e?.message || "Could not generate the key");
    } finally {
      setBusy(false);
    }
  };

  const revokeKey = async () => {
    if (!window.confirm("Revoke the SiteClock key? SiteClock can no longer send job photos to AIMS until a new key is generated.")) return;
    setBusy(true);
    try {
      const token = await getToken();
      if (!token) return;
      const res: any = await request({ path: `${base}/inbound-key`, method: "DELETE" }, {}, token);
      const c = unwrap<Conn>(res, "Could not revoke the key");
      if (isConn(c)) setConn(c);
      toast.success("SiteClock key revoked");
    } catch (e: any) {
      toast.error(e?.message || "Could not revoke the key");
    } finally {
      setBusy(false);
    }
  };

  const copyKey = async () => {
    try {
      await navigator.clipboard.writeText(newKey ?? "");
      toast.success("Key copied");
    } catch {
      toast.error("Copy failed: select the key and copy it");
    }
  };

  if (loading) return <Box sx={{ p: 3 }}><CircularProgress size={24} /></Box>;

  return (
    <Box sx={{ p: 2, maxWidth: 640 }}>
      <Typography variant="h6" gutterBottom>SiteClock</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Puts scheduled deliveries on a SiteClock worker&apos;s schedule. Also needs the enableSiteClockLink feature flag (Settings tab).
      </Typography>
      {secretsMissing(conn) && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          AIMS_SECRETS_KEY is not set on the server, so a key can&apos;t be stored or used yet.
        </Alert>
      )}
      {conn?.lastError && <Alert severity="error" sx={{ mb: 2 }}>Last error: {conn.lastError}</Alert>}
      <Stack spacing={2}>
        <TextField label="SiteClock API base URL" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} size="small" fullWidth />
        <TextField label="SiteClock company id" value={companyId} onChange={(e) => setCompanyId(e.target.value)} size="small" fullWidth />
        <TextField
          label="API key"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          size="small"
          fullWidth
          type="password"
          autoComplete="off"
          placeholder={conn?.connected ? `Saved key ends in ${conn.apiKeyLast4} (leave blank to keep it)` : "sck_live_…"}
          InputLabelProps={{ shrink: true }}
          helperText={keyStoredLabel(conn) ?? "No key stored yet"}
        />
        <TextField
          label="Default job length (minutes)"
          value={duration}
          onChange={(e) => setDuration(e.target.value.replace(/[^0-9]/g, ""))}
          size="small"
          sx={{ width: 240 }}
        />
        <FormControlLabel control={<Switch checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />} label="Enabled" />
        {conn?.connected && (
          <Typography variant="caption" color="text.secondary">Last successful call: {fmt(conn.lastOkAt)}</Typography>
        )}
        {saveError && <Alert severity="error">Not saved: {saveError}</Alert>}
        {testResult && <Alert severity={testResult.ok ? "success" : "error"}>{testResult.text}</Alert>}
        <Stack direction="row" spacing={1}>
          <Button variant="contained" onClick={save} disabled={busy}>Save</Button>
          <Button variant="outlined" onClick={test} disabled={busy || !conn?.connected}>Test connection</Button>
        </Stack>
      </Stack>

      <Divider sx={{ my: 3 }} />
      <Typography variant="subtitle1" fontWeight={700} gutterBottom>Inbound key (SiteClock to AIMS)</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
        SiteClock sends job photos to AIMS with this key. Paste it into SiteClock&apos;s settings for this company. AIMS keeps only a fingerprint of it, so it is shown once.
      </Typography>
      <Typography variant="body2" sx={{ mb: 1.5 }}>{inboundKeyLabel(conn, fmt) ?? "No key yet"}</Typography>
      <Stack direction="row" spacing={1} data-tour="siteclock-inbound-key">
        <Button variant="contained" onClick={generateKey} disabled={busy || !conn?.connected}>
          {conn?.inboundKey ? "Rotate key" : "Generate SiteClock key"}
        </Button>
        {conn?.inboundKey && (
          <Button variant="outlined" color="error" onClick={revokeKey} disabled={busy}>Revoke</Button>
        )}
      </Stack>
      {!conn?.connected && <Typography variant="caption" color="text.secondary">Save the connection first.</Typography>}

      <Dialog open={!!newKey} onClose={() => setNewKey(null)} maxWidth="sm" fullWidth>
        <DialogTitle>SiteClock key</DialogTitle>
        <DialogContent>
          <Alert severity="warning" sx={{ mb: 2 }}>Copy it now. It is not shown again; if it is lost, rotate the key.</Alert>
          <TextField value={newKey ?? ""} fullWidth size="small" InputProps={{ readOnly: true, sx: { fontFamily: "monospace" } }} onFocus={(e) => e.target.select()} />
        </DialogContent>
        <DialogActions>
          <Button onClick={copyKey}>Copy</Button>
          <Button variant="contained" onClick={() => setNewKey(null)}>Done</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
