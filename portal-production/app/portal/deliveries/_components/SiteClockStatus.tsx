"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */

import React, { useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { Alert, Box, Button, Chip, CircularProgress, IconButton, Paper, Stack, Tooltip, Typography } from "@mui/material";
import RefreshIcon from "@mui/icons-material/Refresh";
import { request } from "@/helpers/request";

// SiteClock link (WCT 2026-10-30): how a run's SiteClock job stands, on the
// Deliveries list (chip) and the delivery page (card). Only rendered when the
// API attached a `siteclock` view to the run (flagged orgs with a link).

export interface SiteClockView {
  workerId: string | null;
  workerName: string | null;
  durationMin: number;
  syncState: "PENDING" | "SYNCED" | "FAILED" | string;
  lastPushedStatus: string | null;
  lastError: string | null;
  lastSyncedAt: string | null;
  attempts: number;
}

const STATUS_LABEL: Record<string, string> = {
  SCHEDULED: "Scheduled",
  IN_PROGRESS: "In progress",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

const fmt = (d: string | null) =>
  d ? new Date(d).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "not yet";

function useRetry(deliveryId: string, onDone?: () => void) {
  const { getToken } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const retry = async () => {
    setBusy(true);
    setError(null);
    try {
      const token = await getToken();
      if (!token) return;
      const res: any = await request({ path: `/deliveries/${deliveryId}/siteclock/sync`, method: "POST" }, {}, token);
      const r = res?.data ?? res;
      if (r?.ok === false) setError(r.error ?? "SiteClock didn't take the job");
      onDone?.();
    } catch (e: any) {
      setError(e?.message || "Retry failed");
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, retry };
}

/** Compact chip for the Deliveries list (stops row clicks). */
export function SiteClockChip({ deliveryId, view, onChanged }: { deliveryId: string; view: SiteClockView; onChanged?: () => void }) {
  const { busy, retry } = useRetry(deliveryId, onChanged);
  if (!view.workerId && view.syncState !== "FAILED") return null;
  if (view.syncState === "FAILED") {
    return (
      <Stack direction="row" spacing={0.5} alignItems="center" sx={{ mt: 0.5 }} onClick={(e) => e.stopPropagation()}>
        <Tooltip title={view.lastError ?? "SiteClock didn't take the job"}>
          <Chip size="small" color="warning" label="Not synced" />
        </Tooltip>
        <Tooltip title="Retry now">
          <span>
            <IconButton size="small" aria-label="Retry SiteClock sync" disabled={busy} onClick={(e) => { e.stopPropagation(); void retry(); }}>
              {busy ? <CircularProgress size={14} /> : <RefreshIcon fontSize="small" />}
            </IconButton>
          </span>
        </Tooltip>
      </Stack>
    );
  }
  const status = view.lastPushedStatus && view.lastPushedStatus !== "SCHEDULED" ? ` · ${STATUS_LABEL[view.lastPushedStatus] ?? view.lastPushedStatus}` : "";
  return (
    <Tooltip title={view.syncState === "PENDING" ? "Sending to SiteClock…" : `In SiteClock since ${fmt(view.lastSyncedAt)}`}>
      <Chip size="small" variant="outlined" sx={{ mt: 0.5, maxWidth: 220 }} label={`SiteClock · ${view.workerName ?? "worker"}${status}`} onClick={(e) => e.stopPropagation()} />
    </Tooltip>
  );
}

/** Card for the delivery page. */
export function SiteClockCard({
  deliveryId,
  view,
  scheduledFor,
  onChanged,
}: {
  deliveryId: string;
  view: SiteClockView;
  scheduledFor: string | null;
  onChanged?: () => void;
}) {
  const { busy, error, retry } = useRetry(deliveryId, onChanged);
  const start = scheduledFor ? new Date(scheduledFor) : null;
  const end = start ? new Date(start.getTime() + view.durationMin * 60_000) : null;
  const t = (d: Date) => d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  const window = start && end ? `${start.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}, ${t(start)} to ${t(end)}` : "No date set";
  const state =
    view.syncState === "FAILED" ? { label: "Not synced", color: "warning" as const }
    : view.syncState === "PENDING" ? { label: "Sending…", color: "default" as const }
    : { label: STATUS_LABEL[view.lastPushedStatus ?? ""] ?? "Synced", color: "success" as const };
  return (
    <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
        <Typography variant="subtitle2" fontWeight={700}>SiteClock</Typography>
        <Chip size="small" label={state.label} color={state.color} />
      </Stack>
      <Stack spacing={0.5}>
        <Typography variant="body2">
          <Box component="span" sx={{ color: "text.secondary" }}>Worker: </Box>
          {view.workerName ?? (view.workerId ? "Unknown worker" : "None (job cancelled)")}
        </Typography>
        <Typography variant="body2">
          <Box component="span" sx={{ color: "text.secondary" }}>Window: </Box>
          {window}
        </Typography>
        <Typography variant="body2" color="text.secondary">Last sync: {fmt(view.lastSyncedAt)}</Typography>
      </Stack>
      {view.syncState === "FAILED" && view.lastError && (
        <Alert severity="warning" sx={{ mt: 1.5 }}>
          {view.lastError}
          {view.attempts > 1 ? ` (${view.attempts} tries)` : ""}
        </Alert>
      )}
      {error && <Alert severity="error" sx={{ mt: 1.5 }}>{error}</Alert>}
      {view.syncState !== "SYNCED" && (
        <Button size="small" startIcon={busy ? <CircularProgress size={14} /> : <RefreshIcon />} disabled={busy} onClick={() => void retry()} sx={{ mt: 1 }}>
          Retry
        </Button>
      )}
    </Paper>
  );
}
