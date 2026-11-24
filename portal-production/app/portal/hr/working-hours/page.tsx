"use client";

// Field > Working hours (FIELD_PLAN.md phase 2; ported from SiteClock web Schedules.tsx @62b7d9d).
// Shift templates (days, start / end, grace for late, early clock-in mode, sites), who works which template
// from when, and a site's day: who was expected and how they did.
import * as React from "react";
import {
  Alert, Autocomplete, Button, Checkbox, Chip, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, IconButton, MenuItem, Stack, Switch, Tab, Tabs, TextField,
} from "@mui/material";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import PageTable from "@/components/PageTable";
import { fieldAtLeast } from "@/helpers/fieldModule";
import { DAY_NAMES, ROSTER_LABEL, daysText } from "@/helpers/fieldJobs";
import { todayIso } from "@/helpers/orgToday";
import FieldGate from "../_components/FieldGate";
import { useFieldApi, type FieldMe } from "../_lib/useField";

const EARLY: Record<string, string> = { "": "Company rule", clamp: "Count from the shift start", pay: "Pay early time", slide: "Shift starts when they clock in" };

export default function FieldWorkingHoursPage() {
  return <FieldGate area="jobs" title="Working hours">{(me) => <WorkingHours me={me} />}</FieldGate>;
}

function WorkingHours({ me }: { me: FieldMe }) {
  const { get, send } = useFieldApi();
  const qc = useQueryClient();
  const canEdit = fieldAtLeast(me.access.levels.jobs, "edit");
  const canAssign = canEdit || me.access.scoped.jobs;
  const [tab, setTab] = React.useState(0);
  const templates = useQuery({ queryKey: ["field-templates"], queryFn: () => get<{ templates: any[] }>(`/field/jobs/templates`) });
  const assignments = useQuery({ queryKey: ["field-assignments"], queryFn: () => get<{ assignments: any[] }>(`/field/jobs/assignments`) });
  const sites = useQuery({ queryKey: ["field-sites", ""], queryFn: () => get<{ sites: any[] }>(`/field/people/sites`), enabled: fieldAtLeast(me.access.levels.people, "view") });
  const workers = useQuery({ queryKey: ["field-workers"], queryFn: () => get<{ workers: any[] }>(`/field/people/workers`), enabled: fieldAtLeast(me.access.levels.people, "view") });
  const [day, setDay] = React.useState({ siteId: "", date: todayIso() });
  const roster = useQuery({ queryKey: ["field-exceptions", day.siteId, day.date], queryFn: () => get<{ roster: any[] }>(`/field/jobs/exceptions?siteId=${day.siteId}&date=${day.date}`), enabled: tab === 2 && !!day.siteId });
  const [tpl, setTpl] = React.useState<any | null>(null);
  const [asg, setAsg] = React.useState<{ templateId: string; workerIds: string[]; startDate: string; endDate: string } | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const run = async (fn: () => Promise<any>, done?: () => void) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      done?.();
      await Promise.all(["field-templates", "field-assignments", "field-exceptions"].map((k) => qc.invalidateQueries({ queryKey: [k] })));
    } catch (e: any) {
      setError(e?.message || "Could not save");
    } finally {
      setBusy(false);
    }
  };

  const saveTpl = () =>
    tpl &&
    void run(() => {
      const body = { name: tpl.name.trim(), startTime: tpl.startTime, endTime: tpl.endTime, daysOfWeek: tpl.daysOfWeek, graceLateMin: Number(tpl.graceLateMin), earlyMode: tpl.earlyMode || null, siteIds: tpl.siteIds, active: tpl.active };
      return tpl.id ? send(`/field/jobs/templates/${tpl.id}`, "PATCH", body) : send(`/field/jobs/templates`, "POST", body);
    }, () => setTpl(null));

  const tplCols = [
    { id: "name", header: "Template", cell: ({ row }: any) => (<Stack direction="row" gap={1}><span>{row.original.name}</span>{!row.original.active && <Chip size="small" variant="outlined" label="Off" />}</Stack>) },
    { id: "hours", header: "Hours", cell: ({ row }: any) => `${row.original.startTime} to ${row.original.endTime}` },
    { id: "days", header: "Days", cell: ({ row }: any) => daysText(row.original.daysOfWeek) },
    { id: "grace", header: "Late after", cell: ({ row }: any) => `${row.original.graceLateMin} min` },
    { id: "sites", header: "Sites", cell: ({ row }: any) => (row.original.sites.length ? row.original.sites.map((s: any) => s.name).join(", ") : "Every site") },
    { id: "people", header: "People", cell: ({ row }: any) => row.original.assignmentCount },
  ];
  const asgCols = [
    { id: "worker", header: "Worker", cell: ({ row }: any) => row.original.workerName },
    { id: "tpl", header: "Template", cell: ({ row }: any) => row.original.template?.name ?? "" },
    { id: "from", header: "From", cell: ({ row }: any) => row.original.startDate },
    { id: "to", header: "Until", cell: ({ row }: any) => row.original.endDate ?? "" },
    { id: "warn", header: "", cell: ({ row }: any) => (row.original.overlaps ? <Chip size="small" color="warning" label="Overlaps another assignment" /> : null) },
    {
      id: "del",
      header: "",
      cell: ({ row }: any) =>
        canAssign ? (
          <IconButton size="small" color="error" disabled={busy}
            onClick={(e) => { e.stopPropagation(); if (window.confirm(`Take ${row.original.workerName} off ${row.original.template?.name}?`)) void run(() => send(`/field/jobs/assignments/${row.original.id}`, "DELETE")); }}>
            <DeleteOutlineIcon fontSize="small" />
          </IconButton>
        ) : null,
    },
  ];
  const rosterCols = [
    { id: "name", header: "Worker", cell: ({ row }: any) => row.original.name },
    { id: "shift", header: "Shift", cell: ({ row }: any) => row.original.shift },
    { id: "status", header: "How they did", cell: ({ row }: any) => ROSTER_LABEL[row.original.status] },
    { id: "late", header: "Late", cell: ({ row }: any) => (row.original.lateMinutes ? `${row.original.lateMinutes} min` : "") },
    { id: "left", header: "Left early", cell: ({ row }: any) => (row.original.leftEarlyMinutes ? `${row.original.leftEarlyMinutes} min` : "") },
  ];

  return (
    <>
      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}
      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 2 }}>
        <Tab label="Templates" />
        <Tab label="Who works what" />
        <Tab label="A site's day" />
      </Tabs>
      {tab === 0 && (
        <PageTable columns={tplCols as any} data={templates.data?.templates ?? []} tableName="Templates" loading={templates.isLoading} clientPaging noSelectionColumn
          onRowClick={(t: any) => canEdit && setTpl({ ...t, earlyMode: t.earlyMode ?? "" })}
          buttonName={canEdit ? "Add template" : undefined}
          onAddClick={canEdit ? () => setTpl({ name: "", startTime: "08:00", endTime: "17:00", daysOfWeek: [1, 2, 3, 4, 5], graceLateMin: 10, earlyMode: "", siteIds: [], active: true }) : undefined} />
      )}
      {tab === 1 && (
        <PageTable columns={asgCols as any} data={assignments.data?.assignments ?? []} tableName="Who works what" loading={assignments.isLoading} clientPaging noSelectionColumn
          buttonName={canAssign ? "Assign" : undefined} onAddClick={canAssign ? () => setAsg({ templateId: "", workerIds: [], startDate: todayIso(), endDate: "" }) : undefined} />
      )}
      {tab === 2 && (
        <>
          <Stack direction="row" gap={2} sx={{ mb: 2 }}>
            <TextField select size="small" label="Site" sx={{ minWidth: 240 }} value={day.siteId} onChange={(e) => setDay({ ...day, siteId: e.target.value })}>
              {(sites.data?.sites ?? []).map((s) => (
                <MenuItem key={s.id} value={s.id}>{s.name}</MenuItem>
              ))}
            </TextField>
            <TextField size="small" type="date" value={day.date} onChange={(e) => setDay({ ...day, date: e.target.value })} />
          </Stack>
          {day.siteId && <PageTable columns={rosterCols as any} data={roster.data?.roster ?? []} tableName="Expected" loading={roster.isLoading} clientPaging noSelectionColumn />}
        </>
      )}

      <Dialog open={!!tpl} onClose={() => !busy && setTpl(null)} maxWidth="sm" fullWidth>
        <DialogTitle>{tpl?.id ? tpl.name : "Add template"}</DialogTitle>
        <DialogContent dividers>
          {tpl && (
            <Stack gap={2}>
              <TextField label="Name" value={tpl.name} onChange={(e) => setTpl({ ...tpl, name: e.target.value })} />
              <Stack direction="row" gap={2}>
                <TextField type="time" label="Start" InputLabelProps={{ shrink: true }} value={tpl.startTime} onChange={(e) => setTpl({ ...tpl, startTime: e.target.value })} />
                <TextField type="time" label="End" InputLabelProps={{ shrink: true }} value={tpl.endTime} onChange={(e) => setTpl({ ...tpl, endTime: e.target.value })} />
                <TextField type="number" label="Late after (min)" value={tpl.graceLateMin} onChange={(e) => setTpl({ ...tpl, graceLateMin: e.target.value })} />
              </Stack>
              <Stack direction="row" flexWrap="wrap">
                {DAY_NAMES.map((d, i) => (
                  <FormControlLabel key={d} label={d}
                    control={<Checkbox checked={tpl.daysOfWeek.includes(i + 1)} onChange={() => setTpl({ ...tpl, daysOfWeek: tpl.daysOfWeek.includes(i + 1) ? tpl.daysOfWeek.filter((x: number) => x !== i + 1) : [...tpl.daysOfWeek, i + 1] })} />} />
                ))}
              </Stack>
              <TextField select label="Clocking in early" value={tpl.earlyMode} onChange={(e) => setTpl({ ...tpl, earlyMode: e.target.value })}>
                {Object.entries(EARLY).map(([v, l]) => (
                  <MenuItem key={v} value={v}>{l}</MenuItem>
                ))}
              </TextField>
              <Autocomplete multiple options={sites.data?.sites ?? []} getOptionLabel={(s: any) => s.name} value={(sites.data?.sites ?? []).filter((s) => tpl.siteIds.includes(s.id))}
                onChange={(_, v) => setTpl({ ...tpl, siteIds: v.map((s: any) => s.id) })} renderInput={(p) => <TextField {...p} label="Sites (none = every site)" />} />
              <FormControlLabel control={<Switch checked={tpl.active} onChange={(e) => setTpl({ ...tpl, active: e.target.checked })} />} label="Active" />
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          {tpl?.id && (
            <Button color="error" sx={{ mr: "auto" }} disabled={busy} onClick={() => window.confirm(`Delete ${tpl.name}? Its assignments go too.`) && void run(() => send(`/field/jobs/templates/${tpl.id}`, "DELETE"), () => setTpl(null))}>
              Delete
            </Button>
          )}
          <Button onClick={() => setTpl(null)} disabled={busy}>Cancel</Button>
          <Button variant="contained" disableElevation onClick={saveTpl} disabled={busy || !tpl?.name.trim() || !tpl?.daysOfWeek.length}>Save</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={!!asg} onClose={() => !busy && setAsg(null)} maxWidth="sm" fullWidth>
        <DialogTitle>Assign working hours</DialogTitle>
        <DialogContent dividers>
          {asg && (
            <Stack gap={2}>
              <TextField select label="Template" value={asg.templateId} onChange={(e) => setAsg({ ...asg, templateId: e.target.value })}>
                {(templates.data?.templates ?? []).filter((t) => t.active).map((t) => (
                  <MenuItem key={t.id} value={t.id}>{t.name}</MenuItem>
                ))}
              </TextField>
              <Autocomplete multiple options={(workers.data?.workers ?? []).filter((w) => w.active)} getOptionLabel={(w: any) => w.name}
                value={(workers.data?.workers ?? []).filter((w) => asg.workerIds.includes(w.id))} onChange={(_, v) => setAsg({ ...asg, workerIds: v.map((w: any) => w.id) })}
                renderInput={(p) => <TextField {...p} label="Workers" />} />
              <Stack direction="row" gap={2}>
                <TextField type="date" label="From" InputLabelProps={{ shrink: true }} value={asg.startDate} onChange={(e) => setAsg({ ...asg, startDate: e.target.value })} />
                <TextField type="date" label="Until" InputLabelProps={{ shrink: true }} value={asg.endDate} onChange={(e) => setAsg({ ...asg, endDate: e.target.value })} />
              </Stack>
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAsg(null)} disabled={busy}>Cancel</Button>
          <Button variant="contained" disableElevation disabled={busy || !asg?.templateId || !asg?.workerIds.length}
            onClick={() => asg && void run(async () => {
              for (const w of asg.workerIds) await send(`/field/jobs/assignments`, "POST", { templateId: asg.templateId, workerId: w, startDate: asg.startDate, endDate: asg.endDate || null });
            }, () => setAsg(null))}>
            Save
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
