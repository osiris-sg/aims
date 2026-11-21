"use client";

// Field > Plan > Upload schedule (SiteClock Jobs > Upload schedule @62b7d9d): get the template, upload a filled
// .xlsx / .csv, see per day what would be made and every problem, then add the jobs to the calendar. Admin only.
// Only "add": SiteClock's "replace the day" would delete calendar jobs in AIMS, so it is not offered.
import * as React from "react";
import { useAuth } from "@clerk/nextjs";
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack, Typography } from "@mui/material";
import { useFieldApi } from "../_lib/useField";

const apiBase = process.env.NEXT_PUBLIC_BACKEND_API_URL;

export default function UploadSchedule({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: (msg: string) => void }) {
  const { getToken } = useAuth();
  const { send } = useFieldApi();
  const [preview, setPreview] = React.useState<any | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const raw = async (path: string, init: RequestInit = {}) => {
    const headers: Record<string, string> = { Authorization: `Bearer ${await getToken()}` };
    const org = typeof window !== "undefined" ? window.sessionStorage.getItem("aims-admin-active-org") : null;
    if (org) headers["X-Active-Org-Id"] = org;
    const res = await fetch(`${apiBase}${path}`, { ...init, headers });
    if (!res.ok) {
      const j = await res.json().catch(() => null);
      throw new Error(j?.message || `Request failed (${res.status})`);
    }
    return res;
  };

  const template = async () => {
    setError(null);
    try {
      const blob = await (await raw("/field/jobs/import/template")).blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "field-schedule-template.xlsx";
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e: any) {
      setError(e?.message || "Could not get the template");
    }
  };

  const upload = async (file: File) => {
    setBusy(true);
    setError(null);
    setPreview(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const j = await (await raw("/field/jobs/import/preview", { method: "POST", body: fd })).json();
      setPreview(j?.data ?? j);
    } catch (e: any) {
      setError(e?.message || "Could not read the file");
    } finally {
      setBusy(false);
    }
  };

  const add = async () => {
    setBusy(true);
    setError(null);
    try {
      const out: any = await send("/field/jobs/import", "POST", { rows: preview.rows.filter((r: any) => r.date) });
      onDone(`${out.created} jobs added to the calendar.`);
      setPreview(null);
      onClose();
    } catch (e: any) {
      setError(e?.message || "Could not add the jobs");
    } finally {
      setBusy(false);
    }
  };

  const problems: string[] = preview?.problems ?? [];
  return (
    <Dialog open={open} onClose={() => !busy && onClose()} maxWidth="md" fullWidth>
      <DialogTitle>Upload schedule</DialogTitle>
      <DialogContent dividers>
        <Stack gap={2}>
          <Typography variant="body2">One row per job. The client must be a customer already in AIMS. Jobs are added to the calendar; nothing on it is removed.</Typography>
          <Stack direction="row" gap={1}>
            <Button variant="outlined" onClick={() => void template()}>Get the template</Button>
            <Button variant="outlined" component="label" disabled={busy}>
              Choose a file
              <input hidden type="file" accept=".xlsx,.csv" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void upload(f); }} />
            </Button>
          </Stack>
          {error && <Alert severity="error">{error}</Alert>}
          {problems.length > 0 && (
            <Alert severity="warning">
              Fix these in the file and upload it again:
              <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>{problems.map((p) => <li key={p}>{p}</li>)}</ul>
            </Alert>
          )}
          {preview?.days?.map((d: any) => (
            <Stack key={d.date} gap={0.5}>
              <Typography sx={{ fontWeight: 600 }}>{d.date}: {d.jobs.length} jobs, {d.workers} workers{d.existing ? ` (${d.existing} jobs already on the calendar stay)` : ""}</Typography>
              {d.jobs.map((j: any, i: number) => (
                <Typography key={i} variant="body2">
                  {j.time || "All day"} {j.title} at {j.where}, crew {j.crew}{j.warning ? `. Note: ${j.warning}` : ""}
                </Typography>
              ))}
            </Stack>
          ))}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant="contained" disableElevation disabled={busy || !preview || problems.length > 0 || !preview.days?.length} onClick={() => void add()}>
          Add the jobs
        </Button>
      </DialogActions>
    </Dialog>
  );
}
