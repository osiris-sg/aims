"use client";

// WCT jobs calendar add (2026-11-04): the quick "Job" form from an empty calendar slot, and its edit from the job
// page. No quotation: the job shows as a purple Misc job until "Link to…" puts it under an order. The first worker is the
// SiteClock assignee; the others are listed in the SiteClock job's notes.
// Quotation (2026-11-17, withQuotation: the calendar's New job): an optional first field, searched on the server by
// QO number, customer or Subject. Picking one fills Customer, Site and (when empty) Remarks; on save the job goes
// under the quotation's order (and its DO), or waits for the order until the quotation is signed.

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Alert, Autocomplete, Box, Button, Checkbox, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, MenuItem, Stack, TextField, Tooltip, Typography, useMediaQuery } from "@mui/material";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import CustomerPicker from "@/components/CustomerPicker";
import type { PickerCustomer } from "@/app/portal/hooks/api/useCustomerPicker";
import { ptwOptions, quickJobBody, sgtParts, type PtwStatus, type QuickJobForm } from "@/helpers/calendarAdd";
import { useCalendarApi, useCalendarStylePeople, useSiteClockWorkers, type WorkerOption } from "./calendarAddApi";
import JobStyleFields from "./JobStyleFields";
import { applyQuotationPick, doOptionLabel, needsDoPick, quotationLabel, quotationRow, quotationSearchPath, type QuotationDetail, type QuotationOption } from "@/helpers/quickJobQuotation";
import { categoryShown, type JobCategoryDef } from "@/helpers/jobCategory";
import DateInput from "@/components/DateInput";

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
  /** Job category (WCT group): the job's pick (blank = the default). */
  category?: string | null;
}

export default function QuickJobDialog({
  open,
  onClose,
  onSaved,
  onDeleted,
  slot,
  edit,
  withQuotation = false,
  initialQuotationId = null,
}: {
  open: boolean;
  onClose: () => void;
  /** result (new job): where it went (orderNumber / doName), for the toast. */
  onSaved: (id: string, result?: { orderNumber?: string | null; doName?: string | null; quotationName?: string | null }) => void;
  /** Edit only: the job was deleted. */
  onDeleted?: () => void;
  /** New job: the clicked day / time. */
  slot?: { date: string; time: string } | null;
  /** Edit an existing quick job. */
  edit?: QuickJobEdit | null;
  /** New job only: the optional Quotation field (the calendar's add). */
  withQuotation?: boolean;
  /** New job with Quotation: picked when the dialog opens (the order page's Add job, 2026-11-17): Customer, Site and the DO follow. */
  initialQuotationId?: string | null;
}) {
  const api = useCalendarApi();
  const phone = useMediaQuery((t: any) => t.breakpoints.down("sm"));
  const workers = useSiteClockWorkers(open);
  const [form, setForm] = useState<QuickJobForm>(() => blank(slot));
  const [customer, setCustomer] = useState<PickerCustomer | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const quotationOn = withQuotation && !edit;
  const [quotation, setQuotation] = useState<QuotationDetail | null>(null);
  const [quotationBusy, setQuotationBusy] = useState(false);
  // Job category (WCT group): the org's list, null for every other org (no field shown, nothing sent).
  const [categoryDef, setCategoryDef] = useState<JobCategoryDef | null>(null);
  const editCategory = edit?.category ?? null;
  useEffect(() => {
    if (!open) return;
    let live = true;
    void api<JobCategoryDef | null>("GET", "/deliveries/job-category").then((res) => {
      if (!live) return;
      const def = res.ok && res.data && Array.isArray(res.data.options) && res.data.options.length ? res.data : null;
      setCategoryDef(def);
      if (def) setForm((f) => ({ ...f, category: f.category && def.options.includes(f.category) ? f.category : categoryShown(def, editCategory) }));
    });
    return () => {
      live = false;
    };
  }, [open, api, editCategory]);

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
        category: edit.category ?? null,
      });
      setCustomer(edit.customer);
    } else {
      setForm(blank(slot));
      setCustomer(null);
    }
    setQuotation(null);
  }, [open, edit, slot]);

  // Calendar style (enableCalendarStyle; disabled for every other org: no fields shown, nothing sent).
  const people = useCalendarStylePeople(open);
  const editId = edit?.id ?? null;
  useEffect(() => {
    if (!open || !people.loaded || !people.enabled) return;
    if (!editId) {
      setForm((f) => ({ ...f, style: f.style ?? { salesperson: people.defaultSalesperson, ptwApplicant: people.defaultApplicant, cod: false, sticker: false } }));
      return;
    }
    let live = true;
    void api<any>("GET", `/deliveries/${editId}/style`).then((res) => {
      if (!live) return;
      const d = res.ok ? res.data : null;
      const person = (id: string | null | undefined, name: string | null | undefined) => (id ? { id, name: name || people.applicants.find((p) => p.id === id)?.name || id } : null);
      setForm((f) => ({
        ...f,
        style: { salesperson: person(d?.salespersonId, d?.salespersonName), ptwApplicant: person(d?.ptwApplicantId, d?.ptwApplicantName) ?? people.defaultApplicant, cod: !!d?.cod, sticker: !!d?.sticker },
      }));
    });
    return () => {
      live = false;
    };
  }, [open, people.loaded, people.enabled, people.defaultSalesperson, people.defaultApplicant, people.applicants, editId, api]);

  // Order page Add job: the order's quotation is picked at once (its Customer, Site and open DOs).
  useEffect(() => {
    if (open && quotationOn && initialQuotationId) void pickQuotation({ id: initialQuotationId } as QuotationOption);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, quotationOn, initialQuotationId]);

  // Quotation picked: its customer, Site and (only into empty Remarks) Subject; its order's open DOs for the DO pick.
  const pickQuotation = async (o: QuotationOption | null) => {
    if (!o) {
      setQuotation(null);
      set({ quotationId: null, doId: null, doRequired: false }); // the typed fields stay
      return;
    }
    setQuotationBusy(true);
    const res = await api<QuotationDetail>("GET", `/deliveries/quick-job/quotations/${o.id}`);
    setQuotationBusy(false);
    if (!res.ok || !res.data) return setError(res.message || "Couldn't load the quotation");
    const q = res.data;
    setError("");
    setQuotation(q);
    if (q.customer) setCustomer(q.customer as PickerCustomer);
    setForm((f) => {
      const filled = applyQuotationPick(f, q);
      return { ...filled, quotationId: q.id, doId: q.openDos.length === 1 ? q.openDos[0].id : null, doRequired: needsDoPick(q) };
    });
  };

  const set = (patch: Partial<QuickJobForm>) => setForm((f) => ({ ...f, ...patch }));
  const chosen = useMemo<WorkerOption[]>(() => form.workers.map((w) => workers.options.find((o) => o.id === w.id) ?? { id: w.id, name: w.name, employeeNo: null, group: "Current" }), [form.workers, workers.options]);

  const save = async () => {
    // PTW applicant only when a PTW is needed.
    const styled = form.style ? { ...form, style: { ...form.style, ptwApplicant: form.ptwStatus === "NOT_NEEDED" ? null : form.style.ptwApplicant } } : form;
    const { body, error: bad } = quickJobBody(styled);
    if (!body) return setError(bad || "Check the form");
    setSaving(true);
    setError("");
    type Saved = { id: string; orderNumber?: string | null; doName?: string | null };
    const res = edit ? await api<Saved>("PATCH", `/deliveries/quick-job/${edit.id}`, body) : await api<Saved>("POST", "/deliveries/quick-job", body);
    setSaving(false);
    if (!res.ok) return setError(res.message || "Couldn't save the job");
    const saved = res.data;
    onSaved(edit?.id ?? saved?.id ?? "", edit ? undefined : { orderNumber: saved?.orderNumber ?? null, doName: saved?.doName ?? null, quotationName: quotation?.name ?? null });
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
        <Stack spacing={2} sx={{ mt: 1 }}>
          {quotationOn && (
            <QuotationPicker value={quotation} customerId={form.customerId} busy={quotationBusy} onChange={(o) => void pickQuotation(o)} />
          )}
          {quotationOn && quotation && needsDoPick(quotation) && (
            <TextField select required label="DO" size="small" fullWidth value={form.doId ?? ""} onChange={(e) => set({ doId: e.target.value || null })} data-tour="quick-job-do">
              {quotation.openDos.map((d) => (
                <MenuItem key={d.id} value={d.id}>
                  {doOptionLabel(d)}
                </MenuItem>
              ))}
            </TextField>
          )}
          {/* Job category (WCT group) after the Quotation (2026-11-18). */}
          {categoryDef && (
            <TextField select required label="Job category" size="small" fullWidth value={form.category ?? categoryDef.defaultValue} onChange={(e) => set({ category: e.target.value })} data-tour="quick-job-category">
              {categoryDef.options.map((o) => (
                <MenuItem key={o} value={o}>
                  {o}
                </MenuItem>
              ))}
            </TextField>
          )}
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
            <DateInput label="Date" size="small" value={form.date} onChange={(e) => set({ date: e.target.value })} InputLabelProps={{ shrink: true }} sx={{ flex: 1 }} />
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
            <Stack direction="row" spacing={0.5} alignItems="center">
              <Typography variant="body2" color="text.secondary">
                Assigned workers
              </Typography>
              <Tooltip title="SiteClock is not connected, so workers can't be assigned here." enterTouchDelay={0}>
                <InfoOutlinedIcon fontSize="small" sx={{ color: "text.secondary", cursor: "help" }} aria-label="SiteClock is not connected, so workers can't be assigned here." />
              </Tooltip>
            </Stack>
          )}
          <TextField label="Remarks" size="small" fullWidth multiline minRows={2} value={form.remarks} onChange={(e) => set({ remarks: e.target.value })} />
          <Box>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
              <TextField select label="PTW" size="small" value={form.ptwStatus} onChange={(e) => set({ ptwStatus: e.target.value as PtwStatus })} sx={{ minWidth: 170 }} data-tour="quick-job-ptw">
                {ptwOptions(people.enabled).map((o) => (
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
          {people.enabled && form.style && (
            <JobStyleFields
              value={form.style}
              onChange={(patch) => setForm((f) => ({ ...f, style: { ...f.style!, ...patch } }))}
              salespeople={people.salespeople}
              applicants={people.applicants}
              applicantsFromList={!!people.applicantsFromList}
              showApplicant={form.ptwStatus !== "NOT_NEEDED"}
            />
          )}
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

/** The Quotation field: server search (QO number, customer, Subject), newest first, narrowed to the picked customer. */
function QuotationPicker({ value, customerId, busy, onChange }: { value: QuotationOption | null; customerId: string | null; busy: boolean; onChange: (o: QuotationOption | null) => void }) {
  const api = useCalendarApi();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [options, setOptions] = useState<QuotationOption[]>([]);
  const [loading, setLoading] = useState(false);
  const latest = useRef("");
  // While the box shows the picked quotation, the list is the newest ones (not a search for its number).
  const term = value && input === quotationLabel(value) ? "" : input;

  useEffect(() => {
    if (!open) return;
    const path = quotationSearchPath(term, customerId);
    latest.current = path;
    const t = setTimeout(async () => {
      setLoading(true);
      const res = await api<QuotationOption[]>("GET", path);
      if (latest.current !== path) return;
      setLoading(false);
      setOptions(res.ok && Array.isArray(res.data) ? res.data : []);
    }, 250);
    return () => clearTimeout(t);
  }, [open, term, customerId, api]);

  const shown = value && !options.some((o) => o.id === value.id) ? [value, ...options] : options;
  return (
    <Autocomplete<QuotationOption, false, false, false>
      open={open}
      onOpen={() => setOpen(true)}
      onClose={() => setOpen(false)}
      options={shown}
      value={value}
      onChange={(_e, o) => onChange(o ?? null)}
      inputValue={input}
      onInputChange={(_e, v) => setInput(v)}
      filterOptions={(x) => x}
      getOptionLabel={(o) => quotationLabel(o)}
      isOptionEqualToValue={(a, b) => a.id === b.id}
      loading={loading || busy}
      size="small"
      fullWidth
      autoHighlight
      clearOnEscape
      noOptionsText={term ? "No quotations match" : "No quotations"}
      ListboxProps={{ sx: { maxHeight: 340 } }}
      renderOption={(props, o) => {
        const r = quotationRow(o);
        return (
          <li {...props} key={o.id}>
            <Box sx={{ minWidth: 0, width: "100%" }}>
              <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between">
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {r.title}
                </Typography>
                {r.status && <Chip size="small" variant="outlined" label={r.status} color={o.orderNumber ? "primary" : "default"} />}
              </Stack>
              {r.detail && (
                <Typography variant="caption" color="text.secondary" display="block" sx={{ whiteSpace: "normal", wordBreak: "break-word" }}>
                  {r.detail}
                </Typography>
              )}
            </Box>
          </li>
        );
      }}
      renderInput={(params) => (
        <TextField
          {...params}
          label="Quotation"
          data-tour="quick-job-quotation"
          InputProps={{
            ...params.InputProps,
            endAdornment: (
              <>
                {loading || busy ? <CircularProgress size={16} /> : null}
                {params.InputProps.endAdornment}
              </>
            ),
          }}
        />
      )}
    />
  );
}
