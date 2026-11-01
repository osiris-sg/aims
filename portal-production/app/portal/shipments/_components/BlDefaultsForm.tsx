/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

// Org-level B/L instruction defaults (consignee + notify party), shown in Org
// Settings → Shipping & documents. New contracts copy them; existing contracts
// keep their own text.

import React, { useEffect, useState } from "react";
import { Alert, Box, Button, Grid2, Stack, TextField } from "@mui/material";
import { useTradeMutation, useTradeSettings } from "../_lib/hooks";
import { toast } from "../_lib/toast";
import { useTranslations } from "next-intl";

export default function BlDefaultsForm() {
  const t = useTranslations("settings.blDefaults");
  const settings = useTradeSettings(true);
  const [dirty, setDirty] = useState(false);
  const [consignee, setConsignee] = useState("");
  const [notifyParty, setNotifyParty] = useState("");
  const [error, setError] = useState<string | null>(null);
  const save = useTradeMutation((api, body: { defaultConsignee: string | null; defaultNotifyParty: string | null }) => api.updateSettings(body));

  useEffect(() => {
    if (!settings.data || dirty) return;
    setConsignee(settings.data.defaultConsignee ?? "");
    setNotifyParty(settings.data.defaultNotifyParty ?? "");
    setError(null);
  }, [settings.data, dirty]);

  const submit = async () => {
    setError(null);
    try {
      await save.mutateAsync({ defaultConsignee: consignee.trim() || null, defaultNotifyParty: notifyParty.trim() || null });
      setDirty(false);
      toast.success(t("saved"));
    } catch (e: any) {
      setError(e?.message || t("couldNotSave"));
    }
  };

  const mono = { style: { fontFamily: "monospace", fontSize: 12.5 } };
  return (
    <Box>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}
        {settings.isError && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {(settings.error as Error)?.message || t("couldNotLoad")}
          </Alert>
        )}
        <Grid2 container spacing={2}>
          <Grid2 size={{ xs: 12, md: 6 }}>
            <TextField label={t("consignee")} fullWidth multiline minRows={7} value={consignee} onChange={(e) => (setDirty(true), setConsignee(e.target.value))} inputProps={mono} disabled={settings.isLoading} />
          </Grid2>
          <Grid2 size={{ xs: 12, md: 6 }}>
            <TextField label={t("notifyParty")} fullWidth multiline minRows={7} value={notifyParty} onChange={(e) => (setDirty(true), setNotifyParty(e.target.value))} inputProps={mono} disabled={settings.isLoading} />
          </Grid2>
        </Grid2>
        <Stack direction="row" justifyContent="flex-end" spacing={1} sx={{ mt: 2 }}>
          <Button onClick={() => setDirty(false)} disabled={save.isPending || !dirty}>
            {t("discard")}
          </Button>
          <Button variant="contained" onClick={submit} disabled={save.isPending || settings.isLoading}>
            {save.isPending ? t("saving") : t("save")}
          </Button>
        </Stack>
    </Box>
  );
}
