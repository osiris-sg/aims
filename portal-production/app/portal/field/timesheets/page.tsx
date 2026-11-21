"use client";

// Field > Timesheets (FIELD_PLAN.md phase 4; ported from SiteClock web Timesheets.tsx @62b7d9d).
// Each day's entry with the engine's numbers (gross, break, regular, OT, late, early, paid hours that follow the
// crew); approve, reject, approve the ticked ones (entries held for review are left out, as in SiteClock, and the
// result says so), edit times, no-lunch-break, manual entry, reopen, delete, export, and shared hours.
import * as React from "react";
import {
  Alert, Button, Checkbox, Chip, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, IconButton, ListItemText, Menu, MenuItem, Stack, Switch, Tab, Tabs, TextField, Typography,
} from "@mui/material";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ReportPrintExportButton, type ReportExportModel } from "@/app/portal/accounting/_lib/report-export";
import { useOrganization } from "@/app/portal/hooks/useOrganization";
import PageTable from "@/components/PageTable";
import { fieldAtLeast } from "@/helpers/fieldModule";
import { toLocalInput } from "@/helpers/fieldJobs";
import { ENTRY_STATUS_LABEL, bulkResultText, entryWarnings, hm, plainNote } from "@/helpers/fieldTimesheets";
import { addDaysIso } from "@/helpers/fieldJobs";
import { todayIso } from "@/helpers/orgToday";
import FieldGate from "../_components/FieldGate";
import { useFieldApi, type FieldMe } from "../_lib/useField";

const clock = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : "");

export default function FieldTimesheetsPage() {
  return <FieldGate area="timesheets" title="Timesheets">{(me) => <Timesheets me={me} />}</FieldGate>;
}

function Timesheets({ me }: { me: FieldMe }) {
  const { get, send } = useFieldApi();
  const qc = useQueryClient();
  const canEdit = fieldAtLeast(me.access.levels.timesheets, "edit");
  const canApprove = fieldAtLeast(me.access.levels.timesheets, "approve");
  const [tab, setTab] = React.useState(0);
  const [f, setF] = React.useState({ from: addDaysIso(todayIso(), -13), to: todayIso(), status: "", needsReview: false, requests: false, workerId: "", teamId: "" });
  const qs = new URLSearchParams(Object.entries({ from: f.from, to: f.to, ...(f.status ? { status: f.status } : {}), ...(f.needsReview ? { needsReview: "true" } : {}), ...(f.requests ? { requests: "true" } : {}), ...(f.workerId ? { workerId: f.workerId } : {}), ...(f.teamId ? { teamId: f.teamId } : {}) })).toString();
  const list = useQuery({ queryKey: ["field-timesheets", qs], queryFn: () => get<{ entries: any[] }>(`/field/timesheets?${qs}`) });
  const linked = useQuery({ queryKey: ["field-linked", f.from, f.to, tab], queryFn: () => get<{ rows: any[] }>(`/field/timesheets/linked?from=${f.from}&to=${f.to}&direction=${tab === 2 ? "lent" : "borrowed"}`), enabled: tab > 0 });
  const workers = useQuery({ queryKey: ["field-workers"], queryFn: () => get<{ workers: any[] }>(`/field/people/workers`), enabled: fieldAtLeast(me.access.levels.people, "view") });
  const teams = useQuery({ queryKey: ["field-teams", "", true], queryFn: () => get<{ teams: any[] }>(`/field/people/teams?all=1`), enabled: fieldAtLeast(me.access.levels.people, "view") });
  const sites = useQuery({ queryKey: ["field-sites", ""], queryFn: () => get<{ sites: any[] }>(`/field/people/sites`), enabled: fieldAtLeast(me.access.levels.people, "view") });
  const crewOf = React.useMemo(() => new Map((workers.data?.workers ?? []).map((w) => [w.id, !!w.overrides?.payFollowsCrew])), [workers.data]);
  const [ticked, setTicked] = React.useState<string[]>([]);
  const [edit, setEdit] = React.useState<any | null>(null);
  const [manual, setManual] = React.useState<any | null>(null);
  const [detail, setDetail] = React.useState<any | null>(null);
  const [menu, setMenu] = React.useState<{ pos: { left: number; top: number }; row: any } | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const run = async (fn: () => Promise<any>, done?: (o: any) => void) => {
    setBusy(true);
    setError(null);
    try {
      const o = await fn();
      done?.(o);
      await qc.invalidateQueries({ queryKey: ["field-timesheets"] });
    } catch (e: any) {
      setError(e?.message || "Could not save");
    } finally {
      setBusy(false);
    }
  };

  // Print / Export (report standard): SiteClock's export columns and rows, same filters, every state.
  const { organization } = useOrganization();
  const exportRows = useQuery({ queryKey: ["field-timesheets-export", qs], queryFn: () => get<{ headers: string[]; rows: any[][] }>(`/field/timesheets/export?${qs}`), enabled: tab === 0 });
  const exportModel = (): ReportExportModel | null =>
    exportRows.data
      ? {
          title: "TIMESHEET",
          orgName: organization?.name ?? "",
          metaLines: [`From ${f.from} to ${f.to}`, "Auto-closed entries are included"],
          tables: [{ headers: exportRows.data.headers, rows: exportRows.data.rows.map((r) => r.map((c) => String(c ?? ""))) }],
          landscape: true,
        }
      : null;

  const columns = [
    {
      id: "tick",
      header: "",
      cell: ({ row }: any) =>
        canApprove && ["PENDING", "AUTO_CLOSED"].includes(row.original.status) ? (
          <Checkbox size="small" checked={ticked.includes(row.original.id)} onClick={(e) => e.stopPropagation()}
            onChange={() => setTicked(ticked.includes(row.original.id) ? ticked.filter((x) => x !== row.original.id) : [...ticked, row.original.id])} />
        ) : null,
    },
    { id: "date", header: "Date", cell: ({ row }: any) => row.original.workDate },
    { id: "worker", header: "Worker", cell: ({ row }: any) => row.original.worker.name },
    { id: "site", header: "Site", cell: ({ row }: any) => row.original.site?.name ?? "" },
    { id: "in", header: "In", cell: ({ row }: any) => clock(row.original.clockInAt) },
    { id: "out", header: "Out", cell: ({ row }: any) => clock(row.original.clockOutAt) },
    { id: "gross", header: "Worked", cell: ({ row }: any) => hm(row.original.grossMinutes) },
    { id: "break", header: "Break", cell: ({ row }: any) => hm(row.original.breakMinutes) },
    { id: "reg", header: "Regular", cell: ({ row }: any) => hm(row.original.regularMinutes) },
    { id: "ot", header: "OT", cell: ({ row }: any) => (row.original.otMinutes ? `${hm(row.original.otMinutes)} x${row.original.otMultiplier ?? 1.5}` : "") },
    { id: "late", header: "Late", cell: ({ row }: any) => hm(row.original.lateMinutes || null) },
    {
      id: "state",
      header: "State",
      cell: ({ row }: any) => (
        <Stack direction="row" gap={0.5} flexWrap="wrap">
          <Chip size="small" label={ENTRY_STATUS_LABEL[row.original.status]} />
          {row.original.workerRequest && <Chip size="small" variant="outlined" label="Worker request" />}
          {entryWarnings({ ...row.original, payFollowsCrew: crewOf.get(row.original.workerId) }).map((w) => (
            <Chip key={w} size="small" color="warning" variant="outlined" label={w} />
          ))}
        </Stack>
      ),
    },
    {
      id: "menu",
      header: "",
      cell: ({ row }: any) =>
        canEdit || canApprove ? (
          <IconButton size="small" onClick={(e) => { e.stopPropagation(); setMenu({ pos: { left: e.clientX, top: e.clientY }, row: row.original }); }}>
            <MoreVertIcon fontSize="small" />
          </IconButton>
        ) : null,
    },
  ];
  const linkedCols = [
    { id: "date", header: "Date", cell: ({ row }: any) => row.original.workDate },
    { id: "who", header: "Worker", cell: ({ row }: any) => row.original.name },
    { id: "org", header: "Organisation", cell: ({ row }: any) => row.original.organizationName },
    { id: "min", header: "On those jobs", cell: ({ row }: any) => hm(row.original.minutes) },
    { id: "gross", header: "Day worked", cell: ({ row }: any) => hm(row.original.grossMinutes) },
  ];

  return (
    <>
      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}
      {notice && <Alert severity="info" sx={{ mb: 2 }} onClose={() => setNotice(null)}>{notice}</Alert>}
      <Stack direction="row" gap={1} alignItems="center" flexWrap="wrap" sx={{ mb: 2 }}>
        <TextField size="small" type="date" label="From" InputLabelProps={{ shrink: true }} value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} />
        <TextField size="small" type="date" label="To" InputLabelProps={{ shrink: true }} value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} />
        <TextField size="small" select label="State" sx={{ minWidth: 150 }} value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
          <MenuItem value="">All</MenuItem>
          {Object.entries(ENTRY_STATUS_LABEL).map(([v, l]) => (
            <MenuItem key={v} value={v}>{l}</MenuItem>
          ))}
        </TextField>
        <TextField size="small" select label="Worker" sx={{ minWidth: 180 }} value={f.workerId} onChange={(e) => setF({ ...f, workerId: e.target.value })}>
          <MenuItem value="">Everyone</MenuItem>
          {(workers.data?.workers ?? []).map((w) => (
            <MenuItem key={w.id} value={w.id}>{w.name}</MenuItem>
          ))}
        </TextField>
        <TextField size="small" select label="Team" sx={{ minWidth: 150 }} value={f.teamId} onChange={(e) => setF({ ...f, teamId: e.target.value })}>
          <MenuItem value="">Any</MenuItem>
          {(teams.data?.teams ?? []).map((t) => (
            <MenuItem key={t.id} value={t.id}>{t.name}</MenuItem>
          ))}
        </TextField>
        <FormControlLabel control={<Switch checked={f.needsReview} onChange={(e) => setF({ ...f, needsReview: e.target.checked })} />} label="Needs review" />
        <FormControlLabel control={<Switch checked={f.requests} onChange={(e) => setF({ ...f, requests: e.target.checked })} />} label="Worker requests" />
      </Stack>
      <Stack direction="row" gap={1} sx={{ mb: 2 }} flexWrap="wrap">
        {canApprove && (
          <Button variant="contained" disableElevation disabled={busy || !ticked.length}
            onClick={() => void run(() => send(`/field/timesheets/approve-bulk`, "POST", { entryIds: ticked }), (o) => { setTicked([]); setNotice(bulkResultText(o.counts)); })}>
            Approve ticked ({ticked.length})
          </Button>
        )}
        {canEdit && (
          <Button variant="outlined" disabled={busy} onClick={() => setManual({ workerId: "", siteId: "", clockInAt: "", clockOutAt: "", note: "" })}>Add an entry</Button>
        )}
        <ReportPrintExportButton getModel={exportModel} size="medium" />
      </Stack>
      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 2 }}>
        <Tab label="Entries" />
        <Tab label="Others' workers on our jobs" />
        <Tab label="Our workers on others' jobs" />
      </Tabs>
      {tab === 0 && (
        <PageTable columns={columns as any} data={list.data?.entries ?? []} tableName="Entries" loading={list.isLoading} clientPaging noSelectionColumn
          onRowClick={(e: any) => void get(`/field/timesheets/entries/${e.id}`).then(setDetail).catch((x) => setError(x?.message))} />
      )}
      {tab > 0 && <PageTable columns={linkedCols as any} data={linked.data?.rows ?? []} tableName="Shared hours" loading={linked.isLoading} clientPaging noSelectionColumn />}

      <Menu open={!!menu} onClose={() => setMenu(null)} anchorReference="anchorPosition" anchorPosition={menu?.pos}>
        {menu && [
          canApprove && ["PENDING", "AUTO_CLOSED"].includes(menu.row.status) && (
            <MenuItem key="ap" onClick={() => { const r = menu.row; setMenu(null); void run(() => send(`/field/timesheets/entries/${r.id}/approve`, "POST")); }}><ListItemText>Approve</ListItemText></MenuItem>
          ),
          canApprove && ["PENDING", "AUTO_CLOSED"].includes(menu.row.status) && (
            <MenuItem key="rj" onClick={() => { const r = menu.row; setMenu(null); void run(() => send(`/field/timesheets/entries/${r.id}/reject`, "POST")); }}><ListItemText>Reject</ListItemText></MenuItem>
          ),
          canEdit && (
            <MenuItem key="ed" onClick={() => { const r = menu.row; setMenu(null); setEdit({ id: r.id, name: r.worker.name, clockInAt: toLocalInput(r.clockInAt), clockOutAt: toLocalInput(r.clockOutAt), note: "", nlb: r.nlb, nlbClaimed: r.nlbClaimed }); }}><ListItemText>Edit times</ListItemText></MenuItem>
          ),
          canEdit && menu.row.clockOutAt && (
            <MenuItem key="ro" onClick={() => { const r = menu.row; setMenu(null); if (window.confirm("Remove this clock-out and open the day again?")) void run(() => send(`/field/timesheets/entries/${r.id}/reopen`, "POST")); }}><ListItemText>Open the day again</ListItemText></MenuItem>
          ),
          me.access.admin && (
            <MenuItem key="del" sx={{ color: "error.main" }} onClick={() => { const r = menu.row; setMenu(null); if (window.confirm(`Delete ${r.worker.name}'s entry of ${r.workDate} and its clock-ins for good?`)) void run(() => send(`/field/timesheets/entries/${r.id}`, "DELETE")); }}><ListItemText>Delete</ListItemText></MenuItem>
          ),
        ]}
      </Menu>

      <Dialog open={!!edit} onClose={() => !busy && setEdit(null)} maxWidth="sm" fullWidth>
        <DialogTitle>Edit {edit?.name}</DialogTitle>
        <DialogContent dividers>
          {edit && (
            <Stack gap={2}>
              <TextField type="datetime-local" label="Clock-in" InputLabelProps={{ shrink: true }} value={edit.clockInAt} onChange={(e) => setEdit({ ...edit, clockInAt: e.target.value })} />
              <TextField type="datetime-local" label="Clock-out" InputLabelProps={{ shrink: true }} value={edit.clockOutAt} onChange={(e) => setEdit({ ...edit, clockOutAt: e.target.value })} />
              <TextField label="Why" value={edit.note} onChange={(e) => setEdit({ ...edit, note: e.target.value })} inputProps={{ maxLength: 500 }} />
              <FormControlLabel control={<Switch checked={!!edit.nlb} onChange={(e) => setEdit({ ...edit, nlb: e.target.checked })} />} label={`No lunch break${edit.nlbClaimed ? " (asked by the worker)" : ""}`} />
              <Typography variant="body2" color="text.secondary">Saving makes the entry wait for approval again. Paid hours that follow the crew stop applying to an edited day.</Typography>
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEdit(null)} disabled={busy}>Cancel</Button>
          <Button variant="contained" disableElevation disabled={busy}
            onClick={() => edit && void run(() => send(`/field/timesheets/entries/${edit.id}`, "PATCH", {
              ...(edit.clockInAt ? { clockInAt: new Date(edit.clockInAt).toISOString() } : {}), ...(edit.clockOutAt ? { clockOutAt: new Date(edit.clockOutAt).toISOString() } : {}),
              ...(edit.note.trim() ? { note: edit.note.trim() } : {}), nlb: !!edit.nlb,
            }), () => setEdit(null))}>
            Save
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={!!manual} onClose={() => !busy && setManual(null)} maxWidth="sm" fullWidth>
        <DialogTitle>Add an entry</DialogTitle>
        <DialogContent dividers>
          {manual && (
            <Stack gap={2}>
              <TextField select label="Worker" value={manual.workerId} onChange={(e) => setManual({ ...manual, workerId: e.target.value })}>
                {(workers.data?.workers ?? []).filter((w) => w.active).map((w) => (
                  <MenuItem key={w.id} value={w.id}>{w.name}</MenuItem>
                ))}
              </TextField>
              <TextField select label="Site" value={manual.siteId} onChange={(e) => setManual({ ...manual, siteId: e.target.value })}>
                {(sites.data?.sites ?? []).map((s) => (
                  <MenuItem key={s.id} value={s.id}>{s.name}</MenuItem>
                ))}
              </TextField>
              <TextField type="datetime-local" label="Clock-in" InputLabelProps={{ shrink: true }} value={manual.clockInAt} onChange={(e) => setManual({ ...manual, clockInAt: e.target.value })} />
              <TextField type="datetime-local" label="Clock-out" InputLabelProps={{ shrink: true }} value={manual.clockOutAt} onChange={(e) => setManual({ ...manual, clockOutAt: e.target.value })} />
              <TextField label="Note" value={manual.note} onChange={(e) => setManual({ ...manual, note: e.target.value })} />
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setManual(null)} disabled={busy}>Cancel</Button>
          <Button variant="contained" disableElevation disabled={busy || !manual?.workerId || !manual?.siteId || !manual?.clockInAt || !manual?.clockOutAt}
            onClick={() => manual && void run(() => send(`/field/timesheets/entries`, "POST", {
              workerId: manual.workerId, siteId: manual.siteId, clockInAt: new Date(manual.clockInAt).toISOString(), clockOutAt: new Date(manual.clockOutAt).toISOString(), ...(manual.note.trim() ? { note: manual.note.trim() } : {}),
            }), () => setManual(null))}>
            Save
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={!!detail} onClose={() => setDetail(null)} maxWidth="md" fullWidth>
        <DialogTitle>{detail ? `${detail.worker?.name}, ${detail.entry.workDate} at ${detail.site?.name ?? ""}` : ""}</DialogTitle>
        <DialogContent dividers>
          {detail && (
            <Stack gap={1.5}>
              <Typography>
                {clock(detail.entry.clockInAt)} to {clock(detail.entry.clockOutAt)}: worked {hm(detail.entry.grossMinutes)}, break {hm(detail.entry.breakMinutes)}, regular {hm(detail.entry.regularMinutes)}, OT {hm(detail.entry.otMinutes) || "0m"}.
              </Typography>
              {detail.entry.paidFromAt && (
                <Typography>Paid {clock(detail.entry.paidFromAt)} to {clock(detail.entry.paidToAt)}; crew {clock(detail.entry.crewFirstInAt)} to {clock(detail.entry.crewLastOutAt)}.</Typography>
              )}
              {detail.entry.crewNote && <Alert severity="warning">{plainNote(detail.entry.crewNote)}</Alert>}
              {(detail.entry.origClockInAt || detail.entry.origClockOutAt) && (
                <Typography color="text.secondary">Before the first edit: {clock(detail.entry.origClockInAt ?? detail.entry.clockInAt)} to {clock(detail.entry.origClockOutAt ?? detail.entry.clockOutAt)}</Typography>
              )}
              {detail.entry.editNote && <Typography color="text.secondary">Note: {plainNote(detail.entry.editNote)}{detail.entry.editedBy ? ` (${detail.entry.editedBy})` : ""}</Typography>}
              {detail.entry.approvedBy && <Typography color="text.secondary">Approved by {detail.entry.approvedBy}</Typography>}
              <Typography variant="subtitle2" sx={{ mt: 1 }}>Clock-ins</Typography>
              {detail.punches.map((p: any) => (
                <Typography key={p.id} variant="body2">
                  {p.type === "IN" ? "In" : "Out"} {clock(p.serverTime)}{p.originalTime ? ` (punched ${clock(p.originalTime)})` : ""}, {Math.round(p.distanceM)} m, {p.status.toLowerCase()}
                  {p.reviewedBy ? `, reviewed by ${p.reviewedBy}` : ""}{p.reviewNote ? `: ${p.reviewNote}` : ""}
                </Typography>
              ))}
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDetail(null)}>Close</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
