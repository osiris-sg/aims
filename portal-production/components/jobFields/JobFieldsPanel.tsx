"use client";

import React, { useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { Alert, Box, Button, CircularProgress, Stack, Typography } from "@mui/material";
import { request } from "@/helpers/request";
import { JobFieldDef, changedValues, jobFieldProblem } from "@/helpers/jobFields";
import JobFieldsEditor from "./JobFieldsEditor";

/** Custom job fields (enableJobFields): the delivery page's "Job details" box (edit + Save). */
export default function JobFieldsPanel({ deliveryId, jobFields, onSaved }: { deliveryId: string; jobFields: { fields: JobFieldDef[]; values: Record<string, any> }; onSaved: () => void }) {
  const { getToken } = useAuth();
  const [values, setValues] = useState<Record<string, any>>(jobFields.values);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => setValues(jobFields.values), [jobFields.values]);
  const diff = changedValues(jobFields.values, values);
  const dirty = Object.keys(diff).length > 0;

  const save = async () => {
    const p = jobFields.fields.map((f) => jobFieldProblem(f, values[f.id], { checkRequired: false })).find(Boolean);
    if (p) return setError(p);
    setSaving(true);
    setError(null);
    try {
      const token = await getToken();
      const res = await request({ path: `/deliveries/${deliveryId}/job-fields`, method: "PUT" }, { values: diff }, token ?? undefined);
      if (res?.success === false) throw new Error(res?.message || "Could not save");
      setSaved(true);
      onSaved();
    } catch (e: any) {
      setError(e?.message || "Could not save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Box sx={{ border: 1, borderColor: "divider", borderRadius: 1.5, p: 2, my: 2 }} data-tour="job-fields-panel">
      <Stack direction="row" alignItems="center" sx={{ mb: 1.5 }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
          Job details
        </Typography>
        <Box sx={{ flex: 1 }} />
        <Button size="small" variant="contained" disableElevation disabled={!dirty || saving} onClick={() => void save()}>
          {saving ? <CircularProgress size={16} /> : "Save"}
        </Button>
      </Stack>
      {error && (
        <Alert severity="warning" sx={{ mb: 1 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      {saved && !dirty && !error && (
        <Typography variant="caption" color="success.main" component="div" sx={{ mb: 1 }}>
          Saved
        </Typography>
      )}
      <JobFieldsEditor fields={jobFields.fields} values={values} onChange={(v) => { setSaved(false); setValues(v); }} disabled={saving} />
    </Box>
  );
}
