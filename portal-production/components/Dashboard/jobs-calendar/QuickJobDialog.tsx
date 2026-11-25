"use client";

// WCT jobs calendar add (2026-11-04): the quick "Job" form from an empty calendar slot, and its edit from the job
// page. No quotation: the job shows as a purple Misc job until "Link to…" puts it under an order. The first worker is the
// SiteClock assignee; the others are listed in the SiteClock job's notes.
// Quotation (2026-11-17, withQuotation: the calendar's New job): an optional first field, searched on the server by
// QO number, customer or Subject. Picking one fills Customer, Site and (when empty) Remarks; on save the job goes
// under the quotation's order (and its DO), or waits for the order until the quotation is signed.

import React, { useEffect, useMemo, useRef, useState } from "react";
import JobDayPreview, { JobSplitContent, SlotHintsAlert, SPLIT_PAPER_SX } from "./JobDayPreview";
import { closeAction, formDirty } from "@/helpers/calendarDiscard";
import DiscardChangesDialog from "./DiscardChangesDialog";
import { Alert, Autocomplete, Box, Button, Checkbox, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, MenuItem, Stack, TextField, Tooltip, Typography, useMediaQuery } from "@mui/material";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import CustomerPicker from "@/components/CustomerPicker";
import type { PickerCustomer } from "@/app/portal/hooks/api/useCustomerPicker";
import { ptwOptions, quickJobBody, sgtParts, type PtwStatus, type QuickJobForm } from "@/helpers/calendarAdd";
import { useCalendarApi, useCalendarStylePeople, useJobCompanies, useSiteClockWorkers, type WorkerOption } from "./calendarAddApi";
import JobStyleFields from "./JobStyleFields";
import JobEditDetails, { type JobEditRun } from "./JobEditDetails";
import { applyQuotationPick, doOptionLabel, needsDoPick, quotationLabel, quotationRow, quotationSearchPath, type QuotationDetail, type QuotationOption } from "@/helpers/quickJobQuotation";
import DateInput from "@/components/DateInput";
import RepeatField, { repeatRuleToSave, repeatValueOf, type RepeatValue } from "./RepeatField";

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
  run = null,
  createdBy = null,
  onComplete,
  onRunChanged,
  repeat = null,
}: {
  open: boolean;
  onClose: () => void;
  /** result (new job): where it went (orderNumber / doName; orgName when saved under another company), for the toast. */
  onSaved: (id: string, result?: { orderNumber?: string | null; doName?: string | null; quotationName?: string | null; orgName?: string | null }) => void;
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
  /** One job form (WCT group, 2026-11-24), Edit only: the full job (items, proof of job, its DO), shown read only. */
  run?: JobEditRun | null;
  /** Edit: who made the job (read only). */
  createdBy?: string | null;
  /** Edit: "Complete job" in the footer (the customer sign-off, as the job page did). */
  onComplete?: () => void;
  /** Edit: the job changed outside the form (location, verification): reload it. */
  onRunChanged?: () => void;
  /** Repeating jobs (WCT group, 2026-11-25), Edit only: the series being edited ("All events" of its template). */
  repeat?: { seriesId: string; rrule: string } | null;
}) {
  const baseApi = useCalendarApi();
  const phone = useMediaQuery((t: any) => t.breakpoints.down("sm"));
  // Group New job (WCT group, 2026-11-22): the Company the job goes under. Default = the org the person is in now;
  // another company of the group = every load and the save go to that company (its customers, quotations, people,
  // workers, numbering), and the server checks the person's access there. Edit: shown, never changed.
  const companies = useJobCompanies(open);
  const [companyId, setCompanyId] = useState<string | null>(null);
  useEffect(() => {
    if (open) setCompanyId(null);
  }, [open]);
  const orgFor = !edit && companies?.group && companyId && companyId !== companies.current ? companyId : null;
  const companyName = (id: string | null | undefined) => companies?.orgs.find((o) => o.id === id)?.name ?? "";
  const api = useMemo(() => (orgFor ? (<T = any,>(m: string, p: string, b?: any) => baseApi<T>(m, p, b, orgFor)) : baseApi), [baseApi, orgFor]) as typeof baseApi;
  const workers = useSiteClockWorkers(open, orgFor);
  const [form, setForm] = useState<QuickJobForm>(() => blank(slot));
  // "Discard changes?" (2026-11-25): the form as it opened, with what the pop-up filled in by itself (defaults, the
  // job's saved style, an order's quotation) applied to it too, so only the person's own changes make it differ.
  const [baseline, setBaseline] = useState<QuickJobForm>(form);
  const [askDiscard, setAskDiscard] = useState(false);
  const loadForm = (u: (f: QuickJobForm) => QuickJobForm) => {
    setForm(u);
    setBaseline(u);
  };
  // Round 39 #8: the mini calendar's warning above Save (same team at the same time, a busy slot).
  const [hints, setHints] = useState<string[]>([]);
  const [customer, setCustomer] = useState<PickerCustomer | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  // Repeat (WCT group): a new job, or the series of a repeating job opened as "All events".
  const [repeatValue, setRepeatValue] = useState<RepeatValue>(() => repeatValueOf(null, ""));
  useEffect(() => {
    if (open) setRepeatValue(repeatValueOf(edit ? repeat?.rrule ?? null : null, edit ? sgtParts(edit.scheduledFor).date : slot?.date ?? ""));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, edit?.id, repeat?.seriesId]);
  const quotationOn = withQuotation && !edit;
  const [quotation, setQuotation] = useState<QuotationDetail | null>(null);
  const [quotationBusy, setQuotationBusy] = useState(false);
  // Job category (2026-11-25, Elroy): no field for now. A new job is stored as the org's default ("Service order")
  // by the server; an edited job sends its own category back unchanged.
  useEffect(() => {
    if (!open) return;
    setError("");
    setConfirmDelete(false);
    setAskDiscard(false);
    if (edit) {
      const p = sgtParts(edit.scheduledFor);
      loadForm(() => ({
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
      }));
      setCustomer(edit.customer);
    } else {
      loadForm(() => blank(slot));
      setCustomer(null);
    }
    setQuotation(null);
  }, [open, edit, slot]);

  // Calendar style (enableCalendarStyle; disabled for every other org: no fields shown, nothing sent).
  const people = useCalendarStylePeople(open, orgFor);
  // WCT group (calendar style orgs): every field shows straight away (2026-11-23); Company, Job category and the people
  // fill in when their lists arrive, nothing waits on another request.
  const wctForm = people.pending || people.enabled;
  const editId = edit?.id ?? null;
  useEffect(() => {
    if (!open || editId || !people.pending) return;
    loadForm((f) => ({ ...f, style: f.style ?? { salesperson: null, ptwApplicant: null, cod: false, sticker: false, team: "", crew: [], shopName: "", jobTitle: "" } }));
  }, [open, editId, people.pending]);
  useEffect(() => {
    if (!open || !people.loaded || !people.enabled) return;
    if (!editId) {
      // The defaults fill only what is still empty (a pick made while the people loaded stays).
      loadForm((f) => ({
        ...f,
        style: f.style
          ? { ...f.style, salesperson: f.style.salesperson ?? people.defaultSalesperson, ptwApplicant: f.style.ptwApplicant ?? people.defaultApplicant }
          : { salesperson: people.defaultSalesperson, ptwApplicant: people.defaultApplicant, cod: false, sticker: false, team: "", crew: [], shopName: "", jobTitle: "" },
      }));
      return;
    }
    let live = true;
    void api<any>("GET", `/deliveries/${editId}/style`).then((res) => {
      if (!live) return;
      const d = res.ok ? res.data : null;
      const person = (id: string | null | undefined, name: string | null | undefined) => (id ? { id, name: name || people.applicants.find((p) => p.id === id)?.name || id } : null);
      loadForm((f) => ({
        ...f,
        style: { salesperson: person(d?.salespersonId, d?.salespersonName), ptwApplicant: person(d?.ptwApplicantId, d?.ptwApplicantName) ?? people.defaultApplicant, cod: !!d?.cod, sticker: !!d?.sticker, team: d?.team ?? "", crew: Array.isArray(d?.crew) ? d.crew : [], shopName: d?.shopName ?? "", jobTitle: d?.jobTitle ?? "" },
      }));
    });
    return () => {
      live = false;
    };
  }, [open, people.loaded, people.enabled, people.defaultSalesperson, people.defaultApplicant, people.applicants, editId, api]);

  // Order page Add job: the order's quotation is picked at once (its Customer, Site and open DOs).
  useEffect(() => {
    if (open && quotationOn && initialQuotationId) void pickQuotation({ id: initialQuotationId } as QuotationOption, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, quotationOn, initialQuotationId]);

  // Quotation picked: its customer, Site and (only into empty Remarks) Subject; its order's open DOs for the DO pick.
  const pickQuotation = async (o: QuotationOption | null, auto = false) => {
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
    (auto ? loadForm : setForm)((f: QuickJobForm) => {
      const picked = applyQuotationPick(f, q);
      // Job title (WCT group, 2026-11-24): the quotation subject fills an empty Job title (not the Remarks any more).
      const subject = (q.subject ?? "").trim();
      const filled = f.style ? { ...picked, remarks: f.remarks, style: { ...f.style, jobTitle: f.style.jobTitle?.trim() ? f.style.jobTitle : subject } } : picked;
      return { ...filled, quotationId: q.id, doId: q.openDos.length === 1 ? q.openDos[0].id : null, doRequired: needsDoPick(q) };
    });
  };

  const set = (patch: Partial<QuickJobForm>) => setForm((f) => ({ ...f, ...patch }));
  // A new Company clears everything that belongs to a company; its own lists load in their place.
  const switchCompany = (id: string) => {
    if (id === (companyId ?? companies?.current)) return;
    setCompanyId(id);
    setQuotation(null);
    setCustomer(null);
    setError("");
    setForm((f) => ({ ...f, quotationId: null, doId: null, doRequired: false, customerId: null, siteAddress: "", workers: [], style: undefined, category: null }));
  };
  const chosen = useMemo<WorkerOption[]>(() => form.workers.map((w) => workers.options.find((o) => o.id === w.id) ?? { id: w.id, name: w.name, employeeNo: null, group: "Current" }), [form.workers, workers.options]);

  const save = async () => {
    // PTW applicant only when a PTW is needed.
    // The style fields go only to an org that has them (never the placeholders of an org that turned out not to).
    const styled = form.style && wctForm ? { ...form, style: { ...form.style, ptwApplicant: form.ptwStatus === "NOT_NEEDED" ? null : form.style.ptwApplicant } } : { ...form, style: undefined };
    const { body: built, error: bad } = quickJobBody(styled);
    if (!built) return setError(bad || "Check the form");
    // Another company of the group: the server checks both orgs are in the same group.
    const body = orgFor && companies ? { ...built, groupFromOrgId: companies.current } : built;
    setSaving(true);
    setError("");
    type Saved = { id: string; orderNumber?: string | null; doName?: string | null };
    const res = edit ? await api<Saved>("PATCH", `/deliveries/quick-job/${edit.id}`, body) : await api<Saved>("POST", "/deliveries/quick-job", body);
    setSaving(false);
    if (!res.ok) return setError(res.message || "Couldn't save the job");
    const saved = res.data;
    // Repeat: a new job becomes a series' template; a series edited as "All events" takes its new rule.
    const rule = repeatRuleToSave(repeatValue, form.date);
    if (!edit && rule && saved?.id) {
      const r = await api("POST", "/dashboard/jobs-calendar/series", { kind: "JOB", recordId: saved.id, rrule: rule });
      if (!r.ok) setError(r.message || "The job was saved but could not be made to repeat");
    } else if (edit && repeat && repeatValue.changed) {
      // "Does not repeat" on a series: only its first occurrence stays.
      const r = await api("PATCH", `/dashboard/jobs-calendar/series/${repeat.seriesId}`, { rrule: rule ?? "FREQ=DAILY;COUNT=1" });
      if (!r.ok) return setError(r.message || "Couldn't save how it repeats");
    }
    onSaved(edit?.id ?? saved?.id ?? "", edit ? undefined : { orderNumber: saved?.orderNumber ?? null, doName: saved?.doName ?? null, quotationName: quotation?.name ?? null, orgName: orgFor ? companyName(orgFor) : null });
  };

  // Cancel, Esc or a click outside: closes at once when nothing was typed, else asks "Discard changes?".
  const requestClose = () => {
    const a = closeAction({ dirty: formDirty(form, baseline), busy: saving });
    if (a === "close") onClose();
    else if (a === "ask") setAskDiscard(true);
  };

  const remove = async () => {
    if (!edit) return;
    setSaving(true);
    // A repeating job opened as "All events" (or "This and following"): the whole series goes.
    const res = repeat ? await api("DELETE", `/dashboard/jobs-calendar/series/${repeat.seriesId}`) : await api("DELETE", `/deliveries/${edit.id}`);
    setSaving(false);
    if (!res.ok) return setError(res.message || "Couldn't delete the job");
    onDeleted?.();
  };

  return (
    // Round 39 #8: a large dialog, the form on the left and the day's jobs on the right (full screen on phones).
    <>
    <Dialog open={open} onClose={requestClose} fullWidth maxWidth={false} fullScreen={phone} PaperProps={{ sx: phone ? undefined : SPLIT_PAPER_SX }}>
      <DialogTitle>{edit ? "Edit job" : "New job"}</DialogTitle>
      <DialogContent dividers sx={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
        <JobSplitContent
          preview={
            <JobDayPreview
              date={form.date}
              time={form.time}
              allDay={!!form.allDay}
              durationMin={form.durationMin}
              crew={form.style?.crew ?? null}
              excludeId={edit?.id ?? null}
              orgId={orgFor}
              onPick={(sl) => set(sl.time ? { date: sl.date, time: sl.time, allDay: false } : { date: sl.date, allDay: true })}
              onHints={setHints}
            />
          }
          form={
        <Stack spacing={2} sx={{ mt: 1 }}>
          {companies?.group && !edit && companies.orgs.length > 1 && (
            <TextField select label="Organisation" size="small" fullWidth value={companyId ?? companies.current} onChange={(e) => switchCompany(e.target.value)} data-tour="quick-job-company">
              {companies.orgs.map((o) => (
                <MenuItem key={o.id} value={o.id}>
                  {o.name}
                </MenuItem>
              ))}
            </TextField>
          )}
          {companies?.group && edit && <TextField label="Organisation" size="small" fullWidth value={companyName(companies.current)} InputProps={{ readOnly: true }} disabled />}
          {!companies && wctForm && <TextField label="Organisation" size="small" fullWidth value="" disabled InputProps={{ endAdornment: <CircularProgress size={14} /> }} data-tour="quick-job-company" />}
          {quotationOn && (
            <QuotationPicker key={`quotation-${orgFor ?? "own"}`} api={api} value={quotation} customerId={form.customerId} busy={quotationBusy} onChange={(o) => void pickQuotation(o)} />
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
          <CustomerPicker
            key={`customer-${orgFor ?? "own"}`}
            orgId={orgFor}
            value={form.customerId}
            initialCustomer={customer}
            onChange={(c) => {
              setCustomer(c);
              set({ customerId: c?.id ?? null, ...(c && !form.siteAddress ? { siteAddress: (c as any).address || "" } : {}) });
            }}
            label={wctForm ? "Company" : "Customer"}
            required
            size="small"
            fullWidth
          />
          {/* Shop name (WCT group, 2026-11-24): optional, under Customer; this customer's earlier shop names suggested. */}
          {wctForm && form.style && (
            <ShopNameField api={api} customerId={form.customerId} value={form.style.shopName ?? ""} onChange={(v) => setForm((f) => ({ ...f, style: { ...f.style!, shopName: v } }))} />
          )}
          {/* Job title (WCT group, 2026-11-24): under Shop name; prefilled from the quotation subject, editable. */}
          {wctForm && form.style && (
            <TextField
              label="Job title"
              size="small"
              fullWidth
              value={form.style.jobTitle ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, style: { ...f.style!, jobTitle: e.target.value } }))}
              inputProps={{ maxLength: 200, "data-tour": "quick-job-title" }}
            />
          )}
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
          {wctForm && (!edit || repeat) && <RepeatField date={form.date} value={repeatValue} onChange={setRepeatValue} />}
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
                  helperText={workers.error || (wctForm ? undefined : "The first worker gets the job in SiteClock; the others are listed in its notes.")}
                  error={!!workers.error}
                />
              )}
            />
          ) : workers.crewSync ? (
            <Typography variant="body2" color="text.secondary">
              The teams and workers picked under Team / crew get this job in their SiteClock app.
            </Typography>
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
            </Stack>
          </Box>
          {wctForm && form.style && (
            <JobStyleFields
              value={form.style}
              onChange={(patch) => setForm((f) => ({ ...f, style: { ...f.style!, ...patch } }))}
              salespeople={people.salespeople}
              applicants={people.applicants}
              applicantsFromList={!!people.applicantsFromList}
              showApplicant={form.ptwStatus !== "NOT_NEEDED"}
            />
          )}
          {edit && run && (
            <JobEditDetails
              run={run}
              createdBy={createdBy}
              saveLocation={async (v) => {
                const r = await api<any>("PATCH", `/deliveries/job-location/${edit.id}`, { machineLocation: v });
                if (r.ok) onRunChanged?.();
                return { ok: r.ok, message: r.message };
              }}
              onChanged={() => onRunChanged?.()}
            />
          )}
          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
          }
        />
      </DialogContent>
      <SlotHintsAlert lines={hints} />
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
        {edit && onComplete && run?.status === "scheduled" && !!(run as any)?.order && (run?.items?.length ?? 0) > 0 && (
          <Button variant="outlined" onClick={onComplete} disabled={saving} data-tour="job-edit-complete">
            Complete job
          </Button>
        )}
        <Button onClick={requestClose} disabled={saving}>
          Cancel
        </Button>
        <Button variant="contained" onClick={() => void save()} disabled={saving}>
          {saving ? "Saving…" : edit ? "Save" : "Add job"}
        </Button>
      </DialogActions>
    </Dialog>
    <DiscardChangesDialog
      open={askDiscard}
      onKeep={() => setAskDiscard(false)}
      onDiscard={() => {
        setAskDiscard(false);
        onClose();
      }}
    />
    </>
  );
}

/** Shop name (WCT group, 2026-11-24): free text, with this customer's earlier shop names suggested. */
function ShopNameField({ api, customerId, value, onChange }: { api: ReturnType<typeof useCalendarApi>; customerId: string | null; value: string; onChange: (v: string) => void }) {
  const [options, setOptions] = useState<string[]>([]);
  useEffect(() => {
    if (!customerId) return setOptions([]);
    let live = true;
    void api<{ names: string[] }>("GET", `/deliveries/shop-names?customerId=${encodeURIComponent(customerId)}`).then((r) => {
      if (live) setOptions(r.ok && Array.isArray(r.data?.names) ? r.data!.names : []);
    });
    return () => {
      live = false;
    };
  }, [api, customerId]);
  return (
    <Autocomplete<string, false, false, true>
      freeSolo
      options={options}
      inputValue={value}
      onInputChange={(_e, v) => onChange(v)}
      size="small"
      fullWidth
      renderInput={(params) => <TextField {...params} label="Shop name" inputProps={{ ...params.inputProps, maxLength: 120, "data-tour": "quick-job-shop-name" }} />}
    />
  );
}

function blank(slot?: { date: string; time: string } | null): QuickJobForm {
  return { customerId: null, siteAddress: "", date: slot?.date ?? "", time: slot?.time ?? "09:00", durationMin: 60, workers: [], remarks: "", ptwStatus: "NOT_NEEDED", ptwRemark: "" };
}

/** The Quotation field: server search (QO number, customer, Subject), newest first, narrowed to the picked customer. */
function QuotationPicker({ api, value, customerId, busy, onChange }: { api: ReturnType<typeof useCalendarApi>; value: QuotationOption | null; customerId: string | null; busy: boolean; onChange: (o: QuotationOption | null) => void }) {
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
    }, 300);
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
