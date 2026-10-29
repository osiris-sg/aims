"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */

import React, { useCallback, useEffect, useState } from "react";
import { Alert, Box, Button, CircularProgress, FormControlLabel, Stack, Switch, TextField, Typography } from "@mui/material";
import { useAuth } from "@clerk/nextjs";
import { toast } from "react-toastify";
import { request } from "@/helpers/request";

// ─────────────────────────────────────────────────────────────────────────────
// SiteClock tab (admin org detail page, OsirisAdmin only).
//
// The org's SiteClock connection: base URL, SiteClock company id, the sck_live_
// API key (write-only; only its last 4 characters ever come back), on/off and
// the default job length. Deliveries use it only when the org also has the
// enableSiteClockLink flag on (Settings → Feature Flags).
// Backend: src/siteclock/siteclock.admin.controller.ts.
// ─────────────────────────────────────────────────────────────────────────────

interface Conn {
  connected: boolean;
  secretsReady: boolean;
  baseUrl?: string;
  siteclockCompanyId?: string;
  apiKeyLast4?: string;
  enabled?: boolean;
  defaultDurationMin?: number;
  lastOkAt?: string | null;
  lastError?: string | null;
}

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

  const base = `/admin/organizations/${organizationId}/siteclock`;

  const fill = (c: Conn) => {
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
      fill(res?.data ?? res);
    } catch (e: any) {
      toast.error(e?.message || "Failed to load the SiteClock connection");
    } finally {
      setLoading(false);
    }
  }, [getToken, base]);

  useEffect(() => {
    load();
  }, [load]);

  const save = async () => {
    setBusy(true);
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
      fill(res?.data ?? res);
      toast.success("SiteClock connection saved");
    } catch (e: any) {
      toast.error(e?.response?.data?.message || e?.message || "Save failed");
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    setBusy(true);
    try {
      const token = await getToken();
      if (!token) return;
      const res: any = await request({ path: `${base}/test`, method: "GET" }, {}, token);
      const r = res?.data ?? res;
      if (r?.ok) toast.success(`Connected: ${r.teams} team(s) in SiteClock`);
      else toast.error(`SiteClock said: ${r?.error ?? "unknown error"}`);
      load();
    } catch (e: any) {
      toast.error(e?.message || "Test failed");
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <Box sx={{ p: 3 }}><CircularProgress size={24} /></Box>;

  return (
    <Box sx={{ p: 2, maxWidth: 640 }}>
      <Typography variant="h6" gutterBottom>SiteClock</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Puts scheduled deliveries on a SiteClock worker&apos;s schedule. Also needs the enableSiteClockLink feature flag (Settings tab).
      </Typography>
      {conn && !conn.secretsReady && (
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
        <Stack direction="row" spacing={1}>
          <Button variant="contained" onClick={save} disabled={busy}>Save</Button>
          <Button variant="outlined" onClick={test} disabled={busy || !conn?.connected}>Test connection</Button>
        </Stack>
      </Stack>
    </Box>
  );
}
