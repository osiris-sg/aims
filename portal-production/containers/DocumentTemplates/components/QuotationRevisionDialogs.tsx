"use client";
// Save as revision (WCT group, guru 2026-11-23, flag enableQuotationRevisionOnSave).
// RevisionSaveDialog: saving an edited accepted quotation asks which number it is saved under,
// the next revision (<number>-R1…) or the current one. RevisionHistoryDialog: the live quotation
// and every version it replaced; a row opens that version (read-only).
import React, { useEffect, useState } from "react";
import { Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, List, ListItemButton, ListItemText, Stack, Typography } from "@mui/material";
import { useAuth } from "@clerk/nextjs";
import { request } from "@/helpers/request";
import { nextRevisionName } from "@/helpers/quotationRevision";

export function RevisionSaveDialog({ open, number, busy, onClose, onSave, onDiscard }: {
  open: boolean;
  number: string;
  busy: boolean;
  onClose: () => void;
  onSave: (asRevision: boolean) => void;
  /** Set when the dialog was opened by leaving the page: leave without saving. */
  onDiscard?: () => void;
}) {
  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth="xs" fullWidth data-testid="revision-save-dialog">
      <DialogTitle>Save changes</DialogTitle>
      <DialogContent>
        <Stack spacing={1.5} sx={{ pt: 0.5 }}>
          <Button variant="contained" size="large" disabled={busy} onClick={() => onSave(true)} data-testid="save-as-revision">
            Save as revision {nextRevisionName(number)}
          </Button>
          <Button variant="outlined" size="large" disabled={busy} onClick={() => onSave(false)} data-testid="save-as-current">
            Save to {number || "this quotation"}
          </Button>
        </Stack>
      </DialogContent>
      <DialogActions>
        {busy && <CircularProgress size={18} sx={{ mr: 1 }} />}
        {onDiscard && <Button color="error" onClick={onDiscard} disabled={busy} sx={{ mr: "auto" }} data-testid="revision-discard">Leave without saving</Button>}
        <Button onClick={onClose} disabled={busy}>Cancel</Button>
      </DialogActions>
    </Dialog>
  );
}

type Version = { id: string; name: string | null; revisionNumber: number; current: boolean; at: string };

const dmy = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

export function RevisionHistoryDialog({ open, documentId, onClose, onOpenVersion }: {
  open: boolean;
  documentId?: string;
  onClose: () => void;
  onOpenVersion: (id: string) => void;
}) {
  const { getToken } = useAuth();
  const [rows, setRows] = useState<Version[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!open || !documentId) return;
    let alive = true;
    setRows(null);
    setFailed(false);
    (async () => {
      try {
        const token = await getToken();
        const res: any = await request({ path: `/documents/${documentId}/revision-history`, method: "GET", quiet: true }, undefined, token ?? undefined);
        const list = res?.data ?? res;
        if (!alive) return;
        if (Array.isArray(list)) setRows(list);
        else setFailed(true);
      } catch {
        if (alive) setFailed(true);
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, documentId]);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth data-testid="revision-history-dialog">
      <DialogTitle>Revision history</DialogTitle>
      <DialogContent sx={{ px: 1 }}>
        {failed ? (
          <Typography variant="body2" color="error" sx={{ px: 2 }}>Could not load the revisions.</Typography>
        ) : !rows ? (
          <Box sx={{ display: "flex", justifyContent: "center", py: 3 }}><CircularProgress size={24} /></Box>
        ) : rows.length <= 1 ? (
          <Typography variant="body2" color="text.secondary" sx={{ px: 2 }}>No revisions yet.</Typography>
        ) : (
          <List disablePadding>
            {rows.map((r) => (
              <ListItemButton
                key={r.id}
                selected={r.id === documentId}
                onClick={() => { if (r.id !== documentId) onOpenVersion(r.id); }}
                data-testid="revision-row"
              >
                <ListItemText
                  primary={r.name || "(no number)"}
                  secondary={`${r.current ? "Saved" : "Replaced"} ${dmy(r.at)}`}
                  primaryTypographyProps={{ fontWeight: 600, sx: { fontVariantNumeric: "tabular-nums" } }}
                />
                {r.current && <Chip size="small" color="success" label="Current" />}
              </ListItemButton>
            ))}
          </List>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}
