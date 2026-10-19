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

const FIELDS: Array<[keyof AlertRules, string]> = [
  ["taxFundingDaysBefore", "Fund import tax — days before ETA"],
  ["anDaysBefore", "Arrival Notice expected — days before ETA"],
  ["detFreeDays", "Detention free days (default per shipment)"],
  ["demFreeDays", "Demurrage free days (default per shipment)"],
  ["freeTimeWarnDaysBefore", "Warn before free time ends — days"],
  ["stuckDays", "A step is stuck after — days unchanged (0 = off)"],
  ["digestHourJst", "Daily digest — hour (Japan time, 0–23)"],
];

export default function AlertRulesForm() {
  const settings = useTradeSettings();
  const save = useTradeMutation((a, alertRules: Partial<AlertRules>) => a.updateSettings({ alertRules }));
  const [f, setF] = useState<AlertRules>(DEFAULT_ALERT_RULES);
  useEffect(() => {
    if (settings.data) setF({ ...DEFAULT_ALERT_RULES, ...(settings.data.alertRules ?? {}) });
  }, [settings.data]);
  return (
    <Stack spacing={2} data-tour="settings-alerts">
      <Grid2 container spacing={1.5}>
        {FIELDS.map(([k, label]) => (
          <Grid2 key={k} size={{ xs: 12, sm: 6 }}>
            <TextField fullWidth size="small" type="number" label={label} value={f[k] as number} onChange={(e) => setF((x) => ({ ...x, [k]: Math.max(0, Math.round(Number(e.target.value) || 0)) }))} />
          </Grid2>
        ))}
      </Grid2>
      <FormControlLabel control={<Switch checked={f.digestEnabled} onChange={(e) => setF((x) => ({ ...x, digestEnabled: e.target.checked }))} />} label="Send the daily digest e-mail to staff (AIMS users of this org)" />
      <Stack direction="row" justifyContent="flex-end">
        <Button
          variant="contained"
          disabled={save.isPending}
          onClick={async () => {
            try {
              await save.mutateAsync(f);
              toast.success("Alert rules saved");
            } catch (e: any) {
              toast.error(e?.message || "Could not save");
            }
          }}
        >
          Save
        </Button>
      </Stack>
    </Stack>
  );
}
