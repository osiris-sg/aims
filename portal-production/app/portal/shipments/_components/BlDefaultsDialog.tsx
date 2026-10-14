/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

// Org-level B/L instruction defaults (consignee + notify party). New contracts
// copy them; existing contracts keep their own text.

import React, { useEffect, useState } from "react";
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, Grid2, TextField } from "@mui/material";
import { useTradeMutation, useTradeSettings } from "../_lib/hooks";
import { toast } from "../_lib/toast";

export default function BlDefaultsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const settings = useTradeSettings(open);
  const [consignee, setConsignee] = useState("");
  const [notifyParty, setNotifyParty] = useState("");
  const [error, setError] = useState<string | null>(null);
  const save = useTradeMutation((api, body: { defaultConsignee: string | null; defaultNotifyParty: string | null }) => api.updateSettings(body));

  useEffect(() => {
    if (!open || !settings.data) return;
    setConsignee(settings.data.defaultConsignee ?? "");
    setNotifyParty(settings.data.defaultNotifyParty ?? "");
    setError(null);
  }, [open, settings.data]);

  const submit = async () => {
    setError(null);
    try {
      await save.mutateAsync({ defaultConsignee: consignee.trim() || null, defaultNotifyParty: notifyParty.trim() || null });
      toast.success("B/L instruction defaults saved");
      onClose();
    } catch (e: any) {
      setError(e?.message || "Could not save the defaults");
    }
  };

  const mono = { style: { fontFamily: "monospace", fontSize: 12.5 } };
  return (
    <Dialog open={open} onClose={() => !save.isPending && onClose()} maxWidth="md" fullWidth>
      <DialogTitle>B/L instruction defaults</DialogTitle>
      <DialogContent dividers>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}
        {settings.isError && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {(settings.error as Error)?.message || "Could not load the defaults"}
          </Alert>
        )}
        <Grid2 container spacing={2}>
          <Grid2 size={{ xs: 12, md: 6 }}>
            <TextField label="Default consignee" fullWidth multiline minRows={7} value={consignee} onChange={(e) => setConsignee(e.target.value)} inputProps={mono} disabled={settings.isLoading} />
          </Grid2>
          <Grid2 size={{ xs: 12, md: 6 }}>
            <TextField label="Default notify party" fullWidth multiline minRows={7} value={notifyParty} onChange={(e) => setNotifyParty(e.target.value)} inputProps={mono} disabled={settings.isLoading} />
          </Grid2>
        </Grid2>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={save.isPending}>
          Cancel
        </Button>
        <Button variant="contained" onClick={submit} disabled={save.isPending || settings.isLoading}>
          {save.isPending ? "Saving…" : "Save defaults"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
