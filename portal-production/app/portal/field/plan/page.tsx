"use client";

// Field > Plan (FIELD_PLAN.md phase 2; ported from SiteClock web Roster.tsx Plan / Attendance views @62b7d9d).
// One day: the calendar's jobs with their Field side (place, clocking, QR, crew, expected minutes), the day
// note, Mark crews as told, Copy day / week (calendar quick jobs only), and who turned up. Jobs are still made
// on the Jobs calendar; this page sets how the crew clocks at them.
import * as React from "react";
import {
  Alert, Autocomplete, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, MenuItem, Stack, Switch, Tab, Tabs, TextField, Typography,
} from "@mui/material";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import PageTable from "@/components/PageTable";
import { fieldAtLeast } from "@/helpers/fieldModule";
import { ATTENDANCE_LABEL, CLOCKING_LABEL, STATUS_LABEL, addDaysIso, mondayOf, toldText } from "@/helpers/fieldJobs";
import { todayIso } from "@/helpers/orgToday";
import FieldGate from "../_components/FieldGate";
import { useFieldApi, type FieldMe } from "../_lib/useField";

type Job = {
  key: string; deliveryId: string | null; fieldJobId: string | null; source: string; jobNumber: number | null; orderJob: boolean; cancelled: boolean;
  startTime: string | null; allDay: boolean; title: string; location: string; site: any; settingsSaved: boolean; clocking: string | null; qrRequired: boolean;
  qrToken: string | null; expectedMinutes: number | null; instructions: string | null; teamIds: string[]; exceptWorkerIds: string[]; status: string;
  crew: Array<{ workerId: string; name: string; teamId: string | null; notifiedAt: string | null; arrived: any; left: any }>;
};

export default function FieldPlanPage() {
  return <FieldGate area="jobs" title="Plan">{(me) => <Plan me={me} />}</FieldGate>;
}

function Plan({ me }: { me: FieldMe }) {
  const { get, send } = useFieldApi();
  const qc = useQueryClient();
  const canEdit = fieldAtLeast(me.access.levels.jobs, "edit");
  const [date, setDate] = React.useState(todayIso());
  const [tab, setTab] = React.useState(0);
  const plan = useQuery({ queryKey: ["field-plan", date], queryFn: () => get<{ date: string; note: string; jobClocking: string; jobs: Job[] }>(`/field/jobs/day?date=${date}`) });
  const attendance = useQuery({ queryKey: ["field-attendance", date], queryFn: () => get<any>(`/field/jobs/attendance?date=${date}`), enabled: tab === 1 });
  const workers = useQuery({ queryKey: ["field-workers"], queryFn: () => get<{ workers: any[] }>(`/field/people/workers`), enabled: fieldAtLeast(me.access.levels.people, "view") });
  const teams = useQuery({ queryKey: ["field-teams", "", false], queryFn: () => get<{ teams: any[] }>(`/field/people/teams`), enabled: fieldAtLeast(me.access.levels.people, "view") });
  const sites = useQuery({ queryKey: ["field-sites", ""], queryFn: () => get<{ sites: any[] }>(`/field/people/sites`), enabled: fieldAtLeast(me.access.levels.people, "view") });
  const [edit, setEdit] = React.useState<any | null>(null);
  const [note, setNote] = React.useState<string | null>(null);
  const [copy, setCopy] = React.useState<{ kind: "day" | "week"; to: string } | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const people = (workers.data?.workers ?? []).filter((w) => w.active);

  const run = async (fn: () => Promise<any>, done?: (out: any) => void) => {
    setBusy(true);
    setError(null);
    try {
      const out = await fn();
      done?.(out);
      await qc.invalidateQueries({ queryKey: ["field-plan"] });
      await qc.invalidateQueries({ queryKey: ["field-attendance"] });
    } catch (e: any) {
      setError(e?.message || "Could not save");
    } finally {
      setBusy(false);
    }
  };

  const open = (j: Job) =>
    setEdit({
      deliveryId: j.deliveryId, fieldJobId: j.fieldJobId, title: j.title, location: j.location, siteId: j.site?.id ?? "", search: "",
      clocking: j.clocking ?? "", qrRequired: j.qrRequired, qrToken: j.qrToken, expectedMinutes: j.expectedMinutes ? String(j.expectedMinutes) : "",
      instructions: j.instructions ?? "", teamIds: j.teamIds, exceptWorkerIds: j.exceptWorkerIds,
      workerIds: j.crew.filter((c) => !c.teamId).map((c) => c.workerId), external: j.source === "siteclock-external",
    });

  const save = () =>
    edit &&
    void run(
      () =>
        send(`/field/jobs/settings`, "PUT", {
          ...(edit.fieldJobId ? { fieldJobId: edit.fieldJobId } : { deliveryId: edit.deliveryId }),
          ...(edit.siteId ? { siteId: edit.siteId } : { location: edit.location, ...(edit.search ? { search: edit.search } : {}) }),
          clocking: edit.clocking || null, qrRequired: edit.qrRequired, expectedMinutes: edit.expectedMinutes ? Number(edit.expectedMinutes) : null,
          instructions: edit.instructions || null, teamIds: edit.teamIds, workerIds: edit.workerIds, exceptWorkerIds: edit.exceptWorkerIds,
        }),
      () => setEdit(null),
    );

  const columns = [
    { id: "time", header: "Time", cell: ({ row }: any) => (row.original.allDay ? "All day" : row.original.startTime ?? "") },
    {
      id: "title",
      header: "Job",
      cell: ({ row }: any) => (
        <Stack direction="row" gap={1} alignItems="center" flexWrap="wrap">
          <span>{row.original.title}</span>
          {row.original.jobNumber && <Typography variant="caption" color="text.secondary">#{row.original.jobNumber}</Typography>}
          {row.original.cancelled && <Chip size="small" label="Cancelled" />}
          {row.original.source !== "aims" && <Chip size="small" variant="outlined" label="From SiteClock" />}
          {!row.original.settingsSaved && row.original.deliveryId && <Chip size="small" color="warning" variant="outlined" label="Field not set" />}
        </Stack>
      ),
    },
    { id: "place", header: "Place", cell: ({ row }: any) => row.original.site?.name ?? row.original.location },
    { id: "crew", header: "Crew", cell: ({ row }: any) => row.original.crew.map((c: any) => c.name).join(", ") },
    { id: "clocking", header: "Clocking", cell: ({ row }: any) => (row.original.clocking ? CLOCKING_LABEL[row.original.clocking] : "Company rule") },
    { id: "qr", header: "QR", cell: ({ row }: any) => (row.original.qrRequired ? "Yes" : "") },
    { id: "told", header: "Told", cell: ({ row }: any) => toldText(row.original.crew) },
    { id: "status", header: "Progress", cell: ({ row }: any) => STATUS_LABEL[row.original.status] },
  ];

  const attCols = [
    { id: "job", header: "Job", cell: ({ row }: any) => `${row.original.startTime ?? ""} ${row.original.title}`.trim() },
    { id: "name", header: "Worker", cell: ({ row }: any) => row.original.name },
    { id: "state", header: "State", cell: ({ row }: any) => ATTENDANCE_LABEL[row.original.state] },
    { id: "in", header: "Clocked in", cell: ({ row }: any) => (row.original.clockInAt ? new Date(row.original.clockInAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : "") },
  ];
  const attRows = (attendance.data?.jobs ?? []).flatMap((j: any) => j.crew.map((c: any) => ({ ...c, title: j.title, startTime: j.startTime, id: `${j.key}-${c.workerId}` })));

  return (
    <>
      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}
      {notice && <Alert severity="info" sx={{ mb: 2 }} onClose={() => setNotice(null)}>{notice}</Alert>}
      <Stack direction="row" gap={1} alignItems="center" flexWrap="wrap" sx={{ mb: 2 }}>
        <Button onClick={() => setDate(addDaysIso(date, -1))}>Previous</Button>
        <TextField size="small" type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
        <Button onClick={() => setDate(addDaysIso(date, 1))}>Next</Button>
        <Box sx={{ flex: 1 }} />
        {canEdit && (
          <>
            <Button variant="outlined" disabled={busy} onClick={() => setNote(plan.data?.note ?? "")}>Day note</Button>
            <Button variant="outlined" disabled={busy} onClick={() => setCopy({ kind: "day", to: addDaysIso(date, 1) })}>Copy day</Button>
            <Button variant="outlined" disabled={busy} onClick={() => setCopy({ kind: "week", to: addDaysIso(mondayOf(date), 7) })}>Copy week</Button>
            <Button variant="contained" disableElevation disabled={busy}
              onClick={() => void run(() => send(`/field/jobs/notify`, "POST", { date }), (o) => setNotice(o.marked ? `${o.workers} workers marked as told. They see their jobs in the AIMS phone app once it is out.` : "Everyone on this day was already told."))}>
              Mark crews as told
            </Button>
          </>
        )}
      </Stack>
      {plan.data?.note && <Alert severity="info" sx={{ mb: 2 }}>{plan.data.note}</Alert>}
      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 2 }}>
        <Tab label={`Jobs (${plan.data?.jobs.length ?? 0})`} />
        <Tab label="Who turned up" />
      </Tabs>
      {tab === 0 && (
        <PageTable columns={columns as any} data={plan.data?.jobs ?? []} tableName="Jobs" loading={plan.isLoading} clientPaging noSelectionColumn
          onRowClick={(j: Job) => canEdit && j.source !== "siteclock-external" && open(j)} />
      )}
      {tab === 1 && (
        <>
          {attendance.data && (
            <Stack direction="row" gap={1} sx={{ mb: 1 }} flexWrap="wrap">
              <Chip label={`Expected ${attendance.data.counts.expected}`} />
              <Chip color="success" label={`On the job ${attendance.data.counts.clockedIn}`} />
              <Chip label={`Done ${attendance.data.counts.done}`} />
              <Chip label={`On leave ${attendance.data.counts.onLeave}`} />
              <Chip color="warning" label={`Not arrived ${attendance.data.counts.notArrived}`} />
            </Stack>
          )}
          <PageTable columns={attCols as any} data={attRows} tableName="Who turned up" loading={attendance.isLoading} clientPaging noSelectionColumn />
        </>
      )}

      <Dialog open={!!edit} onClose={() => !busy && setEdit(null)} maxWidth="md" fullWidth>
        <DialogTitle>{edit?.title}</DialogTitle>
        <DialogContent dividers>
          {edit && (
            <Stack gap={2}>
              <TextField select label="Site" value={edit.siteId} onChange={(e) => setEdit({ ...edit, siteId: e.target.value })}>
                <MenuItem value="">The job address</MenuItem>
                {(sites.data?.sites ?? []).map((s) => (
                  <MenuItem key={s.id} value={s.id}>{s.name}</MenuItem>
                ))}
              </TextField>
              {!edit.siteId && (
                <Stack direction="row" gap={2}>
                  <TextField label="Address" value={edit.location} onChange={(e) => setEdit({ ...edit, location: e.target.value })} fullWidth />
                  <TextField label="Postal code or building" value={edit.search} onChange={(e) => setEdit({ ...edit, search: e.target.value })} />
                </Stack>
              )}
              <Autocomplete multiple options={teams.data?.teams ?? []} getOptionLabel={(t: any) => t.name} value={(teams.data?.teams ?? []).filter((t) => edit.teamIds.includes(t.id))}
                onChange={(_, v) => setEdit({ ...edit, teamIds: v.map((t: any) => t.id) })} renderInput={(p) => <TextField {...p} label="Teams" />} />
              <Autocomplete multiple options={people} getOptionLabel={(w: any) => w.name} value={people.filter((w) => edit.exceptWorkerIds.includes(w.id))}
                onChange={(_, v) => setEdit({ ...edit, exceptWorkerIds: v.map((w: any) => w.id) })} renderInput={(p) => <TextField {...p} label="Leave out of the teams" />} />
              <Autocomplete multiple options={people} getOptionLabel={(w: any) => w.name} value={people.filter((w) => edit.workerIds.includes(w.id))}
                onChange={(_, v) => setEdit({ ...edit, workerIds: v.map((w: any) => w.id) })} renderInput={(p) => <TextField {...p} label="Also send" />} />
              <TextField select label="Clocking" value={edit.clocking} onChange={(e) => setEdit({ ...edit, clocking: e.target.value })}>
                <MenuItem value="">Company rule ({CLOCKING_LABEL[plan.data?.jobClocking ?? "ARRIVE_LEAVE"]})</MenuItem>
                {Object.entries(CLOCKING_LABEL).map(([v, l]) => (
                  <MenuItem key={v} value={v}>{l}</MenuItem>
                ))}
              </TextField>
              <TextField label="Expected minutes" value={edit.expectedMinutes} onChange={(e) => setEdit({ ...edit, expectedMinutes: e.target.value.replace(/\D/g, "") })} />
              <TextField label="Instructions for the crew" value={edit.instructions} onChange={(e) => setEdit({ ...edit, instructions: e.target.value })} multiline minRows={2} />
              <Stack direction="row" gap={2} alignItems="center">
                <FormControlLabel control={<Switch checked={edit.qrRequired} onChange={(e) => setEdit({ ...edit, qrRequired: e.target.checked })} />} label="Scan the job's QR code to clock in" />
                {edit.fieldJobId && edit.qrRequired && (
                  <Button size="small" disabled={busy}
                    onClick={() => window.confirm("Make a new code? Printed codes stop working.") && void run(() => send(`/field/jobs/${edit.fieldJobId}/qr`, "POST"), (o) => setEdit({ ...edit, qrToken: o.job.qrToken }))}>
                    New code
                  </Button>
                )}
              </Stack>
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEdit(null)} disabled={busy}>Cancel</Button>
          <Button variant="contained" disableElevation onClick={save} disabled={busy}>Save</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={note !== null} onClose={() => !busy && setNote(null)} maxWidth="sm" fullWidth>
        <DialogTitle>Note for {date}</DialogTitle>
        <DialogContent dividers>
          <TextField value={note ?? ""} onChange={(e) => setNote(e.target.value)} multiline minRows={3} fullWidth inputProps={{ maxLength: 2000 }} />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setNote(null)} disabled={busy}>Cancel</Button>
          <Button variant="contained" disableElevation disabled={busy} onClick={() => void run(() => send(`/field/jobs/notes/${date}`, "PUT", { text: note ?? "" }), () => setNote(null))}>Save</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={!!copy} onClose={() => !busy && setCopy(null)} maxWidth="xs" fullWidth>
        <DialogTitle>{copy?.kind === "week" ? `Copy the week of ${mondayOf(date)}` : `Copy ${date}`}</DialogTitle>
        <DialogContent dividers>
          <Stack gap={2}>
            <TextField type="date" label={copy?.kind === "week" ? "To the week of" : "To"} InputLabelProps={{ shrink: true }} value={copy?.to ?? ""} onChange={(e) => copy && setCopy({ ...copy, to: e.target.value })} />
            <Typography variant="body2" color="text.secondary">Jobs of an order are not copied. A job already there for the same customer and time is left alone.</Typography>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCopy(null)} disabled={busy}>Cancel</Button>
          <Button variant="contained" disableElevation disabled={busy || !copy?.to}
            onClick={() => copy && void run(
              () => (copy.kind === "day" ? send(`/field/jobs/copy-day`, "POST", { fromDate: date, toDate: copy.to }) : send(`/field/jobs/copy-week`, "POST", { fromMonday: mondayOf(date), toMonday: mondayOf(copy.to) })),
              (o) => { setCopy(null); setNotice(`${o.copied} jobs copied.`); },
            )}>
            Copy
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
