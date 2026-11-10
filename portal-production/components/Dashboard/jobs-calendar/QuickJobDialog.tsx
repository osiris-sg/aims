"use client";

// WCT jobs calendar add (2026-11-04): the quick "Job" form from an empty calendar slot, and its edit from the job
// page. No quotation: the job shows as "Untagged" until "Link to…" puts it under an order. The first worker is the
// SiteClock assignee; the others are listed in the SiteClock job's notes.

import React, { useEffect, useMemo, useState } from "react";
import { Alert, Autocomplete, Box, Button, Checkbox, Chip, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, MenuItem, Stack, TextField, Typography, useMediaQuery } from "@mui/material";
import CustomerPicker from "@/components/CustomerPicker";
import type { PickerCustomer } from "@/app/portal/hooks/api/useCustomerPicker";
import { PTW_OPTIONS, quickJobBody, sgtParts, type PtwStatus, type QuickJobForm } from "@/helpers/calendarAdd";
import { useCalendarApi, useSiteClockWorkers, type WorkerOption } from "./calendarAddApi";

const DURATIONS = [30, 60, 90, 120, 180, 240, 480];
const durLabel = (m: number) => (m % 60 === 0 ? `${m / 60} h` : m > 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`);

export interface QuickJobEdit {
  id: string;
  customer: PickerCustomer | null;
  siteAddress: string | null;
  scheduledFor: string | null;
  /** All-day job (2026-11-10): no specific time. */
  scheduledAllDay?: boolean;
  notes: string | null;
  ptwStatus: string | null;
  ptwRemark: string | null;
  workers: { id: string; name: string }[];
  durationMin: number | null;
}

export default function QuickJobDialog({
  open,
  onClose,
  onSaved,
  onDeleted,
  slot,
  edit,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: (id: string) => void;
  /** Edit only: the job was deleted. */
  onDeleted?: () => void;
  /** New job: the clicked day / time. */
  slot?: { date: string; time: string } | null;
  /** Edit an existing quick job. */
  edit?: QuickJobEdit | null;
}) {
  const api = useCalendarApi();
  const phone = useMediaQuery((t: any) => t.breakpoints.down("sm"));
  const workers = useSiteClockWorkers(open);
  const [form, setForm] = useState<QuickJobForm>(() => blank(slot));
  const [customer, setCustomer] = useState<PickerCustomer | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError("");
    setConfirmDelete(false);
    if (edit) {
      const p = sgtParts(edit.scheduledFor);
      setForm({
        customerId: edit.customer?.id ?? null,
        siteAddress: edit.siteAddress ?? "",
        date: p.date,
        time: edit.scheduledAllDay ? "09:00" : p.time,
        allDay: !!edit.scheduledAllDay,
        durationMin: edit.durationMin ?? 60,
        workers: edit.workers,
        remarks: edit.notes ?? "",
        ptwStatus: ((edit.ptwStatus as PtwStatus) || "NOT_NEEDED") as PtwStatus,
        ptwRemark: edit.ptwRemark ?? "",
      });
      setCustomer(edit.customer);
    } else {
      setForm(blank(slot));
      setCustomer(null);
    }
  }, [open, edit, slot]);

  const set = (patch: Partial<QuickJobForm>) => setForm((f) => ({ ...f, ...patch }));
  const chosen = useMemo<WorkerOption[]>(() => form.workers.map((w) => workers.options.find((o) => o.id === w.id) ?? { id: w.id, name: w.name, employeeNo: null, group: "Current" }), [form.workers, workers.options]);

  const save = async () => {
    const { body, error: bad } = quickJobBody(form);
    if (!body) return setError(bad || "Check the form");
    setSaving(true);
    setError("");
    const res = edit ? await api("PATCH", `/deliveries/quick-job/${edit.id}`, body) : await api<{ id: string }>("POST", "/deliveries/quick-job", body);
    setSaving(false);
    if (!res.ok) return setError(res.message || "Couldn't save the job");
    onSaved(edit?.id ?? (res.data as any)?.id);
  };

  const remove = async () => {
    if (!edit) return;
    setSaving(true);
    const res = await api("DELETE", `/deliveries/${edit.id}`);
    setSaving(false);
    if (!res.ok) return setError(res.message || "Couldn't delete the job");
    onDeleted?.();
  };

  return (
    <Dialog open={open} onClose={() => !saving && onClose()} fullWidth maxWidth="sm" fullScreen={phone}>
      <DialogTitle>{edit ? "Edit job" : "New job"}</DialogTitle>
      <DialogContent dividers>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          No quotation needed. The job shows as Untagged until you link it to a quotation, order, invoice or DO from its page.
        </Typography>
        <Stack spacing={2}>
          <CustomerPicker
            value={form.customerId}
            initialCustomer={customer}
            onChange={(c) => {
              setCustomer(c);
              set({ customerId: c?.id ?? null, ...(c && !form.siteAddress ? { siteAddress: (c as any).address || "" } : {}) });
            }}
            label="Customer"
            required
            size="small"
            fullWidth
          />
          <TextField label="Site / address" size="small" fullWidth value={form.siteAddress} onChange={(e) => set({ siteAddress: e.target.value })} />
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
            <TextField label="Date" type="date" size="small" value={form.date} onChange={(e) => set({ date: e.target.value })} InputLabelProps={{ shrink: true }} sx={{ flex: 1 }} />
            {!form.allDay && <TextField label="Time" type="time" size="small" value={form.time} onChange={(e) => set({ time: e.target.value })} InputLabelProps={{ shrink: true }} sx={{ flex: 1 }} />}
            {!form.allDay && <TextField select label="Duration" size="small" value={String(form.durationMin)} onChange={(e) => set({ durationMin: Number(e.target.value) })} sx={{ flex: 1 }}>
              {[...new Set([...DURATIONS, form.durationMin])].sort((a, b) => a - b).map((m) => (
                <MenuItem key={m} value={String(m)}>
                  {durLabel(m)}
                </MenuItem>
              ))}
            </TextField>}
            <FormControlLabel
              control={<Checkbox size="small" checked={!!form.allDay} onChange={(e) => set({ allDay: e.target.checked })} />}
              label="No specific time"
              sx={{ flexShrink: 0, mr: 0, whiteSpace: "nowrap" }}
            />
          </Stack>
          {workers.enabled ? (
            <Autocomplete
              multiple
              size="small"
              options={workers.options}
              groupBy={(o) => o.group}
              value={chosen}
              loading={workers.loading}
              isOptionEqualToValue={(a, b) => a.id === b.id}
              getOptionLabel={(o) => (o.employeeNo ? `${o.name} (${o.employeeNo})` : o.name)}
              onChange={(_e, v) => set({ workers: v.map((o) => ({ id: o.id, name: o.name })) })}
              renderTags={(value, getTagProps) =>
                value.map((o, i) => {
                  const { key, ...rest } = getTagProps({ index: i });
                  return <Chip key={key} size="small" label={i === 0 ? `${o.name} (lead)` : o.name} {...rest} />;
                })
              }
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="Assigned workers"
                  placeholder={form.workers.length ? "" : "None"}
                  helperText={workers.error || "The first worker gets the job in SiteClock; the others are listed in its notes."}
                  error={!!workers.error}
                />
              )}
            />
          ) : (
            <Typography variant="caption" color="text.secondary">
              SiteClock is not connected, so workers can't be assigned here.
            </Typography>
          )}
          <TextField label="Remarks" size="small" fullWidth multiline minRows={2} value={form.remarks} onChange={(e) => set({ remarks: e.target.value })} />
          <Box>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
              <TextField select label="PTW" size="small" value={form.ptwStatus} onChange={(e) => set({ ptwStatus: e.target.value as PtwStatus })} sx={{ minWidth: 170 }} data-tour="quick-job-ptw">
                {PTW_OPTIONS.map((o) => (
                  <MenuItem key={o.value} value={o.value}>
                    {o.label}
                  </MenuItem>
                ))}
              </TextField>
              {form.ptwStatus !== "NOT_NEEDED" && (
                <TextField label="PTW remark" size="small" fullWidth value={form.ptwRemark} onChange={(e) => set({ ptwRemark: e.target.value })} inputProps={{ maxLength: 300 }} />
              )}
            </Stack>
          </Box>
          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        {edit && onDeleted &&
          (confirmDelete ? (
            <Button color="error" variant="contained" onClick={() => void remove()} disabled={saving}>
              Delete job
            </Button>
          ) : (
            <Button color="error" onClick={() => setConfirmDelete(true)} disabled={saving}>
              Delete
            </Button>
          ))}
        <Box sx={{ flex: 1 }} />
        <Button onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button variant="contained" onClick={() => void save()} disabled={saving}>
          {saving ? "Saving…" : edit ? "Save" : "Add job"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function blank(slot?: { date: string; time: string } | null): QuickJobForm {
  return { customerId: null, siteAddress: "", date: slot?.date ?? "", time: slot?.time ?? "09:00", durationMin: 60, workers: [], remarks: "", ptwStatus: "NOT_NEEDED", ptwRemark: "" };
}
