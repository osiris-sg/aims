"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */

import React, { useEffect, useState } from "react";
import { Alert, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, FormControl, InputLabel, MenuItem, Select, Stack, TextField, Typography } from "@mui/material";
import { useAuth } from "@clerk/nextjs";
import { useTranslations } from "next-intl";
import { request } from "@/helpers/request";
import { useOrganizationFeatures } from "@/app/portal/hooks/useOrganizationFeatures";
import { isPresetRole, presetLabel } from "./rolePresets";

/**
 * "Add user" (multi-org users, 2026-11-02): an org admin adds a person to THIS
 * org by email + role. An existing AIMS login (in any org) becomes a member at
 * once; an email with no login gets one made for it the way users have always
 * been added, and (2026-11-03) that new login is emailed a "set your password"
 * link. The server answers the same either way, so this dialog never learns
 * whether the login existed or where else it is.
 */
export default function AddUserDialog({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const t = useTranslations("users.addUser");
  const tf = useTranslations("users.form");
  const { getToken } = useAuth();
  const { isRolePresetsEnabled } = useOrganizationFeatures();
  const [roles, setRoles] = useState<{ id: string; name: string; description?: string | null }[]>([]);
  const [email, setEmail] = useState("");
  const [roleIds, setRoleIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const visible = isRolePresetsEnabled ? roles.filter(isPresetRole) : roles;

  useEffect(() => {
    if (!open) return;
    setEmail("");
    setRoleIds([]);
    setError(null);
    setDone(null);
    (async () => {
      const token = await getToken();
      if (!token) return;
      const res: any = await request({ method: "GET", path: "/roles" }, {}, token);
      if (res?.success && res.data?.roles) setRoles(res.data.roles);
      else if (res?.success && Array.isArray(res.data)) setRoles(res.data);
    })();
  }, [open, getToken]);

  const submit = async () => {
    setError(null);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return setError(tf("emailInvalid"));
    if (!roleIds.length) return setError(isRolePresetsEnabled ? tf("selectOneRole") : t("pickRole"));
    setBusy(true);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      const res: any = await request({ method: "POST", path: "/users/members/add-by-email" }, { email: email.trim(), roleIds }, token);
      if (res?.success === false) {
        const m = res?.details?.message ?? res?.message;
        throw new Error((Array.isArray(m) ? m.join(". ") : m) || t("failed"));
      }
      setDone(res?.data?.message ?? res?.message ?? t("done"));
      onDone();
    } catch (e: any) {
      setError(e?.message || t("failed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{t("title")}</DialogTitle>
      <DialogContent>
        {done ? (
          <Alert severity="success" sx={{ mt: 1 }}>
            {done}
          </Alert>
        ) : (
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Typography variant="body2" color="text.secondary">
              {t("intro")}
            </Typography>
            <TextField label={tf("email")} type="email" value={email} onChange={(e) => setEmail(e.target.value)} size="small" fullWidth autoFocus />
            <FormControl size="small" fullWidth>
              <InputLabel id="add-by-email-roles">{isRolePresetsEnabled ? tf("role") : tf("selectRoles")}</InputLabel>
              <Select
                labelId="add-by-email-roles"
                label={isRolePresetsEnabled ? tf("role") : tf("selectRoles")}
                multiple={!isRolePresetsEnabled}
                value={isRolePresetsEnabled ? roleIds[0] ?? "" : roleIds}
                onChange={(e) => {
                  const v = e.target.value as any;
                  setRoleIds(Array.isArray(v) ? v : v ? [v] : []);
                }}
                renderValue={(sel: any) => (
                  <Stack direction="row" gap={0.5} flexWrap="wrap">
                    {(Array.isArray(sel) ? sel : [sel]).map((id: string) => {
                      const r = roles.find((x) => x.id === id);
                      return <Chip key={id} size="small" label={r ? presetLabel(r as any, tf) : id} />;
                    })}
                  </Stack>
                )}
              >
                {visible.map((r) => (
                  <MenuItem key={r.id} value={r.id}>
                    {presetLabel(r as any, tf)}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            {error && <Alert severity="warning">{error}</Alert>}
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        {done ? (
          <Button variant="contained" onClick={onClose}>
            {t("close")}
          </Button>
        ) : (
          <>
            <Button onClick={onClose}>{tf("cancel")}</Button>
            <Button variant="contained" onClick={submit} disabled={busy}>
              {busy ? <CircularProgress size={18} /> : t("submit")}
            </Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  );
}
