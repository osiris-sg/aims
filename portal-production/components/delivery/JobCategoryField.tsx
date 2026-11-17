"use client";

// Job category (WCT group, 2026-11-17; helpers/jobCategory.ts): the job page's pick, saved on change.
// Rendered only when the API sends run.jobCategory (orgs with the job_category field).

import React, { useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { CircularProgress, MenuItem, Stack, TextField } from "@mui/material";
import { toast } from "react-toastify";
import { request } from "@/helpers/request";

export interface RunJobCategory {
  value: string;
  options: string[];
  defaultValue: string;
}

export default function JobCategoryField({ deliveryId, category, disabled, onSaved }: { deliveryId: string; category: RunJobCategory; disabled?: boolean; onSaved?: () => void }) {
  const { getToken } = useAuth();
  const [value, setValue] = useState(category.value);
  const [saving, setSaving] = useState(false);
  useEffect(() => setValue(category.value), [category.value]);
  // A stored pick no longer on the list still shows (as itself) until it is changed.
  const options = category.options.includes(value) ? category.options : [value, ...category.options];

  const save = async (next: string) => {
    const before = value;
    setValue(next);
    setSaving(true);
    try {
      const token = await getToken();
      const res: any = await request({ path: `/deliveries/${deliveryId}/category`, method: "PUT" }, { category: next }, token ?? undefined);
      if (res?.success === false) throw new Error(res?.message || "Could not save the job category");
      onSaved?.();
    } catch (e: any) {
      setValue(before);
      toast.error(e?.message || "Could not save the job category");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Stack direction="row" spacing={1} alignItems="center" sx={{ my: 1.5, maxWidth: 320 }}>
      <TextField
        select
        required
        fullWidth
        size="small"
        label="Job category"
        value={value}
        disabled={disabled || saving}
        onChange={(e) => void save(e.target.value)}
        data-tour="job-category"
      >
        {options.map((o) => (
          <MenuItem key={o} value={o}>
            {o}
          </MenuItem>
        ))}
      </TextField>
      {saving && <CircularProgress size={16} />}
    </Stack>
  );
}
