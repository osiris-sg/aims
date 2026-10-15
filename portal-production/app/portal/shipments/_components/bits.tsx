/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

// Small presentational pieces shared by the Shipments pages.

import React, { useState } from "react";
import { Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, LinearProgress, Paper, Typography } from "@mui/material";
import type { CurrentStep, Progress, RecordStatus } from "../_lib/api";
import { RECORD_STATUS } from "../_lib/format";

export const RecordStatusChip = ({ status }: { status: RecordStatus }) => {
  const s = RECORD_STATUS[status] ?? { label: status, color: "default" as const };
  // Outlined: filled info/secondary chips are light-on-light in the dark theme.
  return <Chip size="small" label={s.label} color={s.color} variant="outlined" />;
};

/** Bar + "x/y" (ongoing steps are already excluded by the backend). */
export const ProgressCell = ({ progress, width = 120 }: { progress?: Progress; width?: number | string }) => {
  const done = progress?.done ?? 0;
  const total = progress?.total ?? 0;
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 1, minWidth: 0 }}>
      <LinearProgress variant="determinate" value={pct} color={total && done === total ? "success" : "primary"} sx={{ width, height: 6, borderRadius: 3 }} />
      <Typography variant="caption" sx={{ color: "text.secondary", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
        {done}/{total}
      </Typography>
    </Box>
  );
};

/** "9. Send arrival notice …", "Completed" when every step is done, "—" with no steps. */
export const CurrentStepCell = ({ step, progress, maxWidth = 260 }: { step?: CurrentStep; progress?: Progress; maxWidth?: number | string }) => {
  if (!step) {
    return progress?.total ? (
      <Typography variant="body2" sx={{ color: "success.main", fontWeight: 600 }}>
        Completed
      </Typography>
    ) : (
      <Typography variant="body2" color="text.secondary">
        —
      </Typography>
    );
  }
  return (
    <Typography variant="body2" title={step.label} sx={{ maxWidth, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
      {step.label}
    </Typography>
  );
};

export const EmptyState = ({ title, action }: { title: string; action?: React.ReactNode }) => (
  <Paper variant="outlined" sx={{ p: { xs: 3, md: 5 }, textAlign: "center", borderStyle: "dashed" }}>
    <Typography variant="body1" sx={{ fontWeight: 600 }}>
      {title}
    </Typography>
    {action && <Box sx={{ mt: 2 }}>{action}</Box>}
  </Paper>
);

export const Field = ({ label, value }: { label: string; value: React.ReactNode }) => (
  <Box sx={{ minWidth: 0 }}>
    <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
      {label}
    </Typography>
    <Typography variant="body2" sx={{ wordBreak: "break-word", whiteSpace: "pre-wrap" }}>
      {value === null || value === undefined || value === "" ? "—" : value}
    </Typography>
  </Box>
);

/**
 * Confirm dialog that runs `onConfirm` and keeps itself open with the backend's
 * message if it throws (e.g. "reopen step X first").
 */
export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel = "Confirm",
  destructive,
  onClose,
  onConfirm,
}: {
  open: boolean;
  title: string;
  body?: React.ReactNode;
  confirmLabel?: string;
  destructive?: boolean;
  onClose: () => void;
  onConfirm: () => Promise<unknown>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const close = () => {
    if (busy) return;
    setError(null);
    onClose();
  };
  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
      setBusy(false);
      onClose();
    } catch (e: any) {
      setError(e?.message || "The action could not be completed");
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onClose={close} maxWidth="sm" fullWidth>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        {body && <DialogContentText component="div">{body}</DialogContentText>}
        {error && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {error}
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={close} disabled={busy}>
          Back
        </Button>
        <Button onClick={run} disabled={busy} variant="contained" color={destructive ? "error" : "primary"}>
          {busy ? "Working…" : confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
