"use client";

// WCT jobs calendar add (2026-11-04): a calendar note (leave, PTW, blockage, other). Not a job: no SiteClock, no
// billing. Add from an empty slot; click a note bar to edit or delete it.
// Note types (calendar style orgs, 2026-11-24): General (default), Site visit and Technician Site Visit join Leave,
// PTW and Blockage. A Technician Site Visit has a job's fields and shows on the calendar like a job.

import React, { useEffect, useState } from "react";
import { Alert, Autocomplete, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, MenuItem, Stack, Switch, TextField, useMediaQuery } from "@mui/material";
import { TSV_DURATIONS, TSV_TYPE, blankTsv, defaultNoteType, durationLabel, noteBody, noteTypeOptions, tsvFormOf, type CalendarNote, type NoteForm, type NoteType, type TsvForm } from "@/helpers/calendarAdd";
import { useCalendarApi, useCalendarStylePeople, useSiteClockWorkers } from "./calendarAddApi";
import DateInput from "@/components/DateInput";
import CustomerPicker from "@/components/CustomerPicker";
import type { PickerCustomer } from "@/app/portal/hooks/api/useCustomerPicker";
import { useOrganizationFeatures } from "@/app/portal/hooks/useOrganizationFeatures";

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
  // Calendar style orgs (WCT group): the extra note types and the Technician Site Visit's Salesperson list.
  const { features } = useOrganizationFeatures();
  const styled = features?.enableCalendarStyle === true;
  const people = useCalendarStylePeople(open && styled);
  const types = noteTypeOptions(styled);
  const [form, setForm] = useState<NoteForm>(() => blank(slot, styled));
  const [customer, setCustomer] = useState<PickerCustomer | null>(null);
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
            ...(note.type === TSV_TYPE ? { tsv: tsvFormOf(note) } : {}),
          }
        : blank(slot, styled),
    );
    setCustomer(note?.details?.customerId ? { id: note.details.customerId, name: note.details.customerName ?? "" } : null);
  }, [open, note, slot, styled]);

  const set = (patch: Partial<NoteForm>) => setForm((f) => ({ ...f, ...patch }));
  const tsv = form.type === TSV_TYPE ? form.tsv ?? blankTsv() : null;
  const setTsv = (patch: Partial<TsvForm>) => setForm((f) => ({ ...f, tsv: { ...(f.tsv ?? blankTsv()), ...patch } }));
  // A type the form doesn't list (e.g. a Site visit note opened after the calendar style was turned off) stays listed.
  const typeList = types.some((t) => t.value === form.type) ? types : [...types, ...noteTypeOptions(true).filter((t) => t.value === form.type)];
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
          {!tsv && <TextField label="Title" size="small" fullWidth required value={form.title} onChange={(e) => set({ title: e.target.value })} inputProps={{ maxLength: 120 }} autoFocus={!note} />}
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
            <TextField
              select
              label="Type"
              size="small"
              value={form.type}
              onChange={(e) => {
                const type = e.target.value as NoteType;
                set(type === TSV_TYPE ? { type, tsv: form.tsv ?? blankTsv(), endDate: form.startDate, ...(note?.type === TSV_TYPE ? {} : { allDay: false }) } : { type });
              }}
              sx={{ minWidth: 160 }}
              fullWidth={!!tsv}
              data-tour="calendar-note-type"
            >
              {typeList.map((t) => (
                <MenuItem key={t.value} value={t.value}>
                  <Stack direction="row" spacing={1} alignItems="center">
                    <Box sx={{ width: 10, height: 10, borderRadius: "2px", bgcolor: t.color }} />
                    <span>{t.label}</span>
                  </Stack>
                </MenuItem>
              ))}
            </TextField>
            {tsv ? null : workers.enabled ? (
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
          {tsv && (
            <>
              <CustomerPicker
                value={tsv.customerId}
                initialCustomer={customer}
                onChange={(c) => {
                  setCustomer(c);
                  setTsv({ customerId: c?.id ?? null, customerName: c?.name ?? "", ...(c && !tsv.siteAddress ? { siteAddress: c.address || "" } : {}) });
                }}
                label="Customer"
                size="small"
                fullWidth
              />
              <TextField label="Shop name" size="small" fullWidth value={tsv.shopName} onChange={(e) => setTsv({ shopName: e.target.value })} inputProps={{ maxLength: 120 }} />
              <TextField label="Site address" size="small" fullWidth value={tsv.siteAddress} onChange={(e) => setTsv({ siteAddress: e.target.value })} inputProps={{ maxLength: 500 }} />
              <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} alignItems={{ sm: "center" }}>
                <DateInput label="Date" size="small" value={form.startDate} onChange={(e) => set({ startDate: e.target.value, endDate: e.target.value })} InputLabelProps={{ shrink: true }} sx={{ flex: 1 }} />
                {!form.allDay && <TextField label="Time" type="time" size="small" value={form.startTime} onChange={(e) => set({ startTime: e.target.value })} InputLabelProps={{ shrink: true }} sx={{ flex: 1 }} />}
                {!form.allDay && (
                  <TextField select label="Duration" size="small" value={String(tsv.durationMin)} onChange={(e) => setTsv({ durationMin: Number(e.target.value) })} sx={{ flex: 1 }}>
                    {[...new Set([...TSV_DURATIONS, tsv.durationMin])]
                      .sort((a, b) => a - b)
                      .map((m) => (
                        <MenuItem key={m} value={String(m)}>
                          {durationLabel(m)}
                        </MenuItem>
                      ))}
                  </TextField>
                )}
                <FormControlLabel control={<Switch checked={form.allDay} onChange={(e) => set({ allDay: e.target.checked })} />} label="No specific time" sx={{ flexShrink: 0, mr: 0, whiteSpace: "nowrap" }} />
              </Stack>
              {workers.enabled ? (
                <Autocomplete
                  multiple
                  size="small"
                  options={workers.options}
                  groupBy={(o) => o.group}
                  value={tsv.workers.map((w) => workers.options.find((o) => o.id === w.id) ?? { id: w.id, name: w.name, employeeNo: null, group: "Current" })}
                  loading={workers.loading}
                  isOptionEqualToValue={(a, b) => a.id === b.id}
                  getOptionLabel={(o) => (o.employeeNo ? `${o.name} (${o.employeeNo})` : o.name)}
                  onChange={(_e, v) => setTsv({ workers: v.map((o) => ({ id: o.id, name: o.name })) })}
                  renderInput={(params) => <TextField {...params} label="Assigned workers" error={!!workers.error} />}
                />
              ) : null}
              <TextField label="Team / crew" size="small" fullWidth value={tsv.team} onChange={(e) => setTsv({ team: e.target.value })} inputProps={{ maxLength: 200 }} />
              {people.enabled && (
                <Autocomplete
                  size="small"
                  options={people.salespeople}
                  value={tsv.salesperson ? people.salespeople.find((p) => p.id === tsv.salesperson!.id) ?? { id: tsv.salesperson.id, name: tsv.salesperson.name } : null}
                  isOptionEqualToValue={(a, b) => a.id === b.id}
                  getOptionLabel={(o) => o.name}
                  onChange={(_e, o) => setTsv({ salesperson: o ? { id: o.id, name: o.name } : null })}
                  renderInput={(params) => <TextField {...params} label="Salesperson" />}
                />
              )}
            </>
          )}
          {!tsv && <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
            <DateInput label="Start date" size="small" value={form.startDate} onChange={(e) => set({ startDate: e.target.value, ...(form.endDate && form.endDate < e.target.value ? { endDate: e.target.value } : {}) })} InputLabelProps={{ shrink: true }} sx={{ flex: 1 }} />
            <DateInput label="End date" size="small" value={form.endDate} onChange={(e) => set({ endDate: e.target.value })} InputLabelProps={{ shrink: true }} sx={{ flex: 1 }} />
          </Stack>}
          {!tsv && <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} alignItems={{ sm: "center" }}>
            <FormControlLabel control={<Switch checked={form.allDay} onChange={(e) => set({ allDay: e.target.checked })} />} label="All day" />
            {!form.allDay && (
              <>
                <TextField label="From" type="time" size="small" value={form.startTime} onChange={(e) => set({ startTime: e.target.value })} InputLabelProps={{ shrink: true }} />
                <TextField label="To" type="time" size="small" value={form.endTime} onChange={(e) => set({ endTime: e.target.value })} InputLabelProps={{ shrink: true }} />
              </>
            )}
          </Stack>}
          <TextField label={tsv ? "Remarks" : "Remark"} size="small" fullWidth multiline minRows={2} value={form.remark} onChange={(e) => set({ remark: e.target.value })} />
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

function blank(slot: { date: string; time: string } | null | undefined, styled: boolean): NoteForm {
  const d = slot?.date ?? "";
  return { title: "", type: defaultNoteType(styled), staffId: null, staffName: null, startDate: d, endDate: d, allDay: true, startTime: slot?.time ?? "09:00", endTime: "17:00", remark: "" };
}
