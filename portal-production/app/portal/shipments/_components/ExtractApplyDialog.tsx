"use client";

// After a B/L draft or arrival notice is dropped on its step row, the deal page
// reads it with AI and offers the values here: one row per field (current →
// from the document), ticked by default; Apply saves the ticked ones to the
// shipment. Nothing is saved without Apply.

import React, { useEffect, useState } from "react";
import { Alert, Box, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, Table, TableBody, TableCell, TableHead, TableRow, Typography } from "@mui/material";

export type ApplyRow = { key: string; label: string; current: string | null; next: string; value: unknown };

export default function ExtractApplyDialog({
  open,
  title,
  intro,
  warning,
  rows,
  extra,
  onClose,
  onApply,
}: {
  open: boolean;
  title: string;
  intro?: string;
  warning?: string | null;
  rows: ApplyRow[];
  /** Read-only facts from the document that have no shipment field (containers, charges collect). */
  extra?: React.ReactNode;
  onClose: () => void;
  onApply: (patch: Record<string, unknown>) => Promise<void>;
}) {
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setPicked(new Set(rows.map((r) => r.key)));
      setError(null);
    }
  }, [open, rows]);

  const toggle = (k: string) =>
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent dividers>
        {intro && (
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            {intro}
          </Typography>
        )}
        {warning && (
          <Alert severity="warning" sx={{ mb: 1.5 }}>
            {warning}
          </Alert>
        )}
        {rows.length ? (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell padding="checkbox" />
                <TableCell>Field</TableCell>
                <TableCell>Now</TableCell>
                <TableCell>From the document</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.key} hover sx={{ cursor: "pointer" }} onClick={() => toggle(r.key)}>
                  <TableCell padding="checkbox">
                    <Checkbox size="small" checked={picked.has(r.key)} />
                  </TableCell>
                  <TableCell>{r.label}</TableCell>
                  <TableCell sx={{ color: "text.secondary" }}>{r.current || "—"}</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>{r.next}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <Typography variant="body2">Nothing to fill — the shipment already has these values.</Typography>
        )}
        {extra && <Box sx={{ mt: 2 }}>{extra}</Box>}
        {error && (
          <Alert severity="error" sx={{ mt: 1.5 }}>
            {error}
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          {rows.length ? "Not now" : "Close"}
        </Button>
        {rows.length > 0 && (
          <Button
            variant="contained"
            disabled={busy || !picked.size}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await onApply(Object.fromEntries(rows.filter((r) => picked.has(r.key)).map((r) => [r.key, r.value])));
                onClose();
              } catch (e) {
                setError((e as Error)?.message || "Could not save");
              } finally {
                setBusy(false);
              }
            }}
          >
            Apply {picked.size} value{picked.size === 1 ? "" : "s"}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
