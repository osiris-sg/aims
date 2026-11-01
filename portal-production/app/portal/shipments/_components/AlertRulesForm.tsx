/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

// Alert rules: when reminders fall due (ETA − 14 days tax funding, ETA − 2
// days A/N, free time − 1 day), the default free days (Wan Hai DET 4 / DEM 10),
// when a step counts as stuck, and the daily digest e-mail (Japan time).

import React, { useEffect, useState } from "react";
import { Button, FormControlLabel, Grid2, Stack, Switch, TextField } from "@mui/material";
import { DEFAULT_ALERT_RULES, type AlertRules } from "../_lib/api";
import { useTradeMutation, useTradeSettings } from "../_lib/hooks";
import { toast } from "../_lib/toast";
import { useTranslations } from "next-intl";

// Labels: settings.alertRules.<field> in the catalogs.
const FIELDS: Array<keyof AlertRules> = ["taxFundingDaysBefore", "anDaysBefore", "detFreeDays", "demFreeDays", "freeTimeWarnDaysBefore", "stuckDays", "digestHourJst"];

export default function AlertRulesForm() {
  const t = useTranslations("settings.alertRules");
  const settings = useTradeSettings();
  const save = useTradeMutation((a, alertRules: Partial<AlertRules>) => a.updateSettings({ alertRules }));
  const [f, setF] = useState<AlertRules>(DEFAULT_ALERT_RULES);
  useEffect(() => {
    if (settings.data) setF({ ...DEFAULT_ALERT_RULES, ...(settings.data.alertRules ?? {}) });
  }, [settings.data]);
  return (
    <Stack spacing={2} data-tour="settings-alerts">
      <Grid2 container spacing={1.5}>
        {FIELDS.map((k) => (
          <Grid2 key={k} size={{ xs: 12, sm: 6 }}>
            <TextField fullWidth size="small" type="number" label={t(k)} value={f[k] as number} onChange={(e) => setF((x) => ({ ...x, [k]: Math.max(0, Math.round(Number(e.target.value) || 0)) }))} />
          </Grid2>
        ))}
      </Grid2>
      <FormControlLabel control={<Switch checked={f.digestEnabled} onChange={(e) => setF((x) => ({ ...x, digestEnabled: e.target.checked }))} />} label={t("digestEnabled")} />
      <Stack direction="row" justifyContent="flex-end">
        <Button
          variant="contained"
          disabled={save.isPending}
          onClick={async () => {
            try {
              await save.mutateAsync(f);
              toast.success(t("saved"));
            } catch (e: any) {
              toast.error(e?.message || t("couldNotSave"));
            }
          }}
        >
          {t("save")}
        </Button>
      </Stack>
    </Stack>
  );
}
