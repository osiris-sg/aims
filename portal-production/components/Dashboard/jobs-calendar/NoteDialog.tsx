"use client";

// WCT jobs calendar add (2026-11-04): a calendar note (leave, PTW, blockage, other). Not a job: no SiteClock, no
// billing. Add from an empty slot; click a note bar to edit or delete it.

import React, { useEffect, useState } from "react";
import { Alert, Autocomplete, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, MenuItem, Stack, Switch, TextField, useMediaQuery } from "@mui/material";
import { NOTE_TYPES, noteBody, type CalendarNote, type NoteForm, type NoteType } from "@/helpers/calendarAdd";
import { useCalendarApi, useSiteClockWorkers } from "./calendarAddApi";

export default function NoteDialog({
  open,
  onClose,
  onSaved,
  slot,
  note,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  slot?: { date: string; time: string } | null;
  /** Edit / delete this note. */
  note?: CalendarNote | null;
}) {
  const api = useCalendarApi();
  const phone = useMediaQuery((t: any) => t.breakpoints.down("sm"));
  const workers = useSiteClockWorkers(open);
  const [form, setForm] = useState<NoteForm>(() => blank(slot));
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setError("");
    setConfirmDelete(false);
    setForm(
      note
        ? {
            title: note.title,
            type: (note.type as NoteType) || "OTHER",
            staffId: note.staffId,
            staffName: note.staffName,
            startDate: note.startDate,
            endDate: note.endDate,
            allDay: note.allDay,
            startTime: note.startTime ?? "09:00",
            endTime: note.endTime ?? "17:00",
            remark: note.remark ?? "",
          }
        : blank(slot),
    );
  }, [open, note, slot]);

  const set = (patch: Partial<NoteForm>) => setForm((f) => ({ ...f, ...patch }));
  const staff = form.staffId ? workers.options.find((o) => o.id === form.staffId) ?? { id: form.staffId, name: form.staffName ?? "", employeeNo: null, group: "Current" } : null;

  const save = async () => {
    const { body, error: bad } = noteBody(form);
    if (!body) return setError(bad || "Check the form");
    setBusy(true);
    const res = note ? await api("PATCH", `/dashboard/jobs-calendar/notes/${note.id}`, body) : await api("POST", "/dashboard/jobs-calendar/notes", body);
    setBusy(false);
    if (!res.ok) return setError(res.message || "Couldn't save the note");
    onSaved();
  };

  const remove = async () => {
    if (!note) return;
    setBusy(true);
    const res = await api("DELETE", `/dashboard/jobs-calendar/notes/${note.id}`);
    setBusy(false);
    if (!res.ok) return setError(res.message || "Couldn't delete the note");
    onSaved();
  };

  return (
    <Dialog open={open} onClose={() => !busy && onClose()} fullWidth maxWidth="sm" fullScreen={phone}>
      <DialogTitle>{note ? "Edit note" : "New note"}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          <TextField label="Title" size="small" fullWidth required value={form.title} onChange={(e) => set({ title: e.target.value })} inputProps={{ maxLength: 120 }} autoFocus={!note} />
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
            <TextField select label="Type" size="small" value={form.type} onChange={(e) => set({ type: e.target.value as NoteType })} sx={{ minWidth: 160 }}>
              {NOTE_TYPES.map((t) => (
                <MenuItem key={t.value} value={t.value}>
                  <Stack direction="row" spacing={1} alignItems="center">
                    <Box sx={{ width: 10, height: 10, borderRadius: "2px", bgcolor: t.color }} />
                    <span>{t.label}</span>
                  </Stack>
                </MenuItem>
              ))}
            </TextField>
            {workers.enabled ? (
              <Autocomplete
                fullWidth
                size="small"
                options={workers.options}
                groupBy={(o) => o.group}
                value={staff}
                isOptionEqualToValue={(a, b) => a.id === b.id}
                getOptionLabel={(o) => o.name}
                onChange={(_e, o) => set({ staffId: o?.id ?? null, staffName: o?.name ?? null })}
                renderInput={(params) => <TextField {...params} label="Staff (optional)" />}
              />
            ) : (
              <TextField
                label="Staff (optional)"
                size="small"
                fullWidth
                value={form.staffName ?? ""}
                onChange={(e) => set({ staffId: null, staffName: e.target.value })}
              />
            )}
          </Stack>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
            <TextField label="Start date" type="date" size="small" value={form.startDate} onChange={(e) => set({ startDate: e.target.value, ...(form.endDate && form.endDate < e.target.value ? { endDate: e.target.value } : {}) })} InputLabelProps={{ shrink: true }} sx={{ flex: 1 }} />
            <TextField label="End date" type="date" size="small" value={form.endDate} onChange={(e) => set({ endDate: e.target.value })} InputLabelProps={{ shrink: true }} sx={{ flex: 1 }} />
          </Stack>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} alignItems={{ sm: "center" }}>
            <FormControlLabel control={<Switch checked={form.allDay} onChange={(e) => set({ allDay: e.target.checked })} />} label="All day" />
            {!form.allDay && (
              <>
                <TextField label="From" type="time" size="small" value={form.startTime} onChange={(e) => set({ startTime: e.target.value })} InputLabelProps={{ shrink: true }} />
                <TextField label="To" type="time" size="small" value={form.endTime} onChange={(e) => set({ endTime: e.target.value })} InputLabelProps={{ shrink: true }} />
              </>
            )}
          </Stack>
          <TextField label="Remark" size="small" fullWidth multiline minRows={2} value={form.remark} onChange={(e) => set({ remark: e.target.value })} />
          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        {note &&
          (confirmDelete ? (
            <Button color="error" variant="contained" onClick={() => void remove()} disabled={busy}>
              Delete note
            </Button>
          ) : (
            <Button color="error" onClick={() => setConfirmDelete(true)} disabled={busy}>
              Delete
            </Button>
          ))}
        <Box sx={{ flex: 1 }} />
        <Button onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button variant="contained" onClick={() => void save()} disabled={busy}>
          {busy ? "Saving…" : note ? "Save" : "Add note"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function blank(slot?: { date: string; time: string } | null): NoteForm {
  const d = slot?.date ?? "";
  return { title: "", type: "LEAVE", staffId: null, staffName: null, startDate: d, endDate: d, allDay: true, startTime: slot?.time ?? "09:00", endTime: "17:00", remark: "" };
}
