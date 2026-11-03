"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */

import React, { useEffect, useState } from "react";
import { Alert, Box, Button, Checkbox, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, TextField, Typography } from "@mui/material";
import { useAuth } from "@clerk/nextjs";
import { toast } from "react-toastify";
import { request } from "@/helpers/request";

/**
 * "Delete login everywhere" (Osiris admin only, 2026-11-03). Removing someone
 * from an organisation never deletes their login (the Clerk instance is shared
 * with SiteClock). This is the only way to delete one: the server's check lists
 * what it affects (a SiteClock login, other organisations), and the admin types
 * the login's email / mobile to confirm.
 */
type Check = { userId: string; name: string; email: string | null; phone: string | null; siteclock: boolean; organizations: string[]; warnings: string[]; confirmWith: string };

const norm = (v: string) => v.replace(/\s+/g, "").toLowerCase();

export default function DeleteLoginDialog({ userId, onClose, onDeleted }: { userId: string | null; onClose: () => void; onDeleted: () => void }) {
  const { getToken } = useAuth();
  const [check, setCheck] = useState<Check | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setCheck(null);
    setError(null);
    setTyped("");
    setAck(false);
    if (!userId) return;
    (async () => {
      const token = await getToken();
      const res: any = await request({ method: "GET", path: `/users/${encodeURIComponent(userId)}/login-delete-check` }, {}, token ?? undefined);
      if (res?.success === false) setError(res?.message || "Could not check this login.");
      else setCheck(res?.data ?? res);
    })();
  }, [userId, getToken]);

  const ready = !!check && norm(typed) === norm(check.confirmWith) && (!check.warnings.length || ack);

  const remove = async () => {
    if (!check || !ready) return;
    setBusy(true);
    setError(null);
    try {
      const token = await getToken();
      const res: any = await request({ method: "POST", path: `/users/${encodeURIComponent(check.userId)}/delete-login` }, { confirm: typed, acknowledgeWarnings: ack }, token ?? undefined);
      if (res?.success === false) throw new Error(res?.message || "The login could not be deleted.");
      toast.success(`The login of ${check.name} was deleted.`);
      onDeleted();
      onClose();
    } catch (e: any) {
      setError(e?.message || "The login could not be deleted.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={!!userId} onClose={busy ? undefined : onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Delete login everywhere</DialogTitle>
      <DialogContent>
        {!check && !error && (
          <Box sx={{ display: "flex", justifyContent: "center", py: 3 }}>
            <CircularProgress size={24} />
          </Box>
        )}
        {check && (
          <Box sx={{ display: "flex", flexDirection: "column", gap: 2, mt: 1 }}>
            <Typography variant="body2">
              This deletes the sign-in of <b>{check.name}</b>
              {check.email ? ` (${check.email})` : check.phone ? ` (${check.phone})` : ""} for good. They are removed from every organisation and can no longer sign in. This cannot be undone.
            </Typography>
            {check.warnings.length > 0 && (
              <Alert severity="warning">
                {check.warnings.map((w) => (
                  <div key={w}>{w}</div>
                ))}
              </Alert>
            )}
            {check.warnings.length > 0 && <FormControlLabel control={<Checkbox checked={ack} onChange={(e) => setAck(e.target.checked)} />} label="I understand, delete it anyway" />}
            <TextField label={`Type ${check.confirmWith} to confirm`} value={typed} onChange={(e) => setTyped(e.target.value)} size="small" fullWidth autoComplete="off" />
          </Box>
        )}
        {error && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {error}
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy} color="inherit">
          Cancel
        </Button>
        <Button variant="contained" color="error" onClick={remove} disabled={!ready || busy}>
          {busy ? <CircularProgress size={18} /> : "Delete login"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
