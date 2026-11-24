"use client";

// Field > Leave (FIELD_PLAN.md phase 5; ported from SiteClock web Leave.tsx @62b7d9d). Requests (approve, reject,
// cancel, record leave a worker took), balances per year, the month calendar and leave types. SiteClock rules kept:
// no over-balance check (the row says by how much), balances count calendar days.
import * as React from "react";
import {
  Alert, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, IconButton, ListItemText, Menu, MenuItem, Stack, Switch, Tab, Tabs, TextField, Typography,
} from "@mui/material";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import PageTable from "@/components/PageTable";
import { fieldAtLeast } from "@/helpers/fieldModule";
import { todayIso } from "@/helpers/orgToday";
import FieldGate from "../_components/FieldGate";
import { useFieldApi, type FieldMe } from "../_lib/useField";

const STATUS: Record<string, string> = { PENDING: "To approve", APPROVED: "Approved", REJECTED: "Rejected", CANCELLED: "Cancelled" };
const dates = (r: any) => `${r.startDate}${r.endDate !== r.startDate ? ` to ${r.endDate}` : ""}${r.halfDay ? ", half day" : ""}`;

export default function FieldLeavePage() {
  return <FieldGate area="leave" title="Leave">{(me) => <Leave me={me} />}</FieldGate>;
}

function Leave({ me }: { me: FieldMe }) {
  const { get, send } = useFieldApi();
  const qc = useQueryClient();
  const canApprove = fieldAtLeast(me.access.levels.leave, "approve");
  const canManage = me.access.admin;
  const [tab, setTab] = React.useState(0);
  const [status, setStatus] = React.useState("PENDING");
  const [year, setYear] = React.useState(String(new Date().getFullYear()));
  const [month, setMonth] = React.useState(todayIso().slice(0, 7));
  const requests = useQuery({ queryKey: ["field-leave", status], queryFn: () => get<{ requests: any[] }>(`/field/leave/requests${status ? `?status=${status}` : ""}`) });
  const balances = useQuery({ queryKey: ["field-leave-bal", year], queryFn: () => get<{ workers: any[] }>(`/field/leave/balances?year=${year}`), enabled: tab === 1 });
  const calendar = useQuery({ queryKey: ["field-leave-cal", month], queryFn: () => get<{ requests: any[] }>(`/field/leave/calendar?month=${month}`), enabled: tab === 2 });
  const types = useQuery({ queryKey: ["field-leave-types"], queryFn: () => get<{ types: any[] }>(`/field/leave/types?all=1`) });
  const workers = useQuery({ queryKey: ["field-workers"], queryFn: () => get<{ workers: any[] }>(`/field/people/workers`), enabled: fieldAtLeast(me.access.levels.people, "view") });
  const [menu, setMenu] = React.useState<{ pos: { left: number; top: number }; row: any } | null>(null);
  const [rec, setRec] = React.useState<any | null>(null);
  const [type, setType] = React.useState<any | null>(null);
  const [ent, setEnt] = React.useState<{ workerId: string; name: string; values: Record<string, string> } | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const activeTypes = (types.data?.types ?? []).filter((t) => !t.archived);

  const run = async (fn: () => Promise<any>, done?: (o: any) => void) => {
    setBusy(true);
    setError(null);
    try {
      const o = await fn();
      done?.(o);
      await Promise.all(["field-leave", "field-leave-bal", "field-leave-cal", "field-leave-types"].map((k) => qc.invalidateQueries({ queryKey: [k] })));
    } catch (e: any) {
      setError(e?.message || "Could not save");
    } finally {
      setBusy(false);
    }
  };
  const overNote = (o: any) => {
    if (o?.overBy) setNotice(`Done. This goes over the balance by ${o.overBy} ${o.overBy === 1 ? "day" : "days"}.`);
  };

  const reqCols = [
    { id: "who", header: "Worker", cell: ({ row }: any) => row.original.workerName },
    { id: "type", header: "Leave", cell: ({ row }: any) => row.original.type?.name ?? "" },
    { id: "dates", header: "Dates", cell: ({ row }: any) => dates(row.original) },
    { id: "days", header: "Days", cell: ({ row }: any) => row.original.days },
    { id: "reason", header: "Reason", cell: ({ row }: any) => row.original.reason ?? "" },
    {
      id: "state",
      header: "State",
      cell: ({ row }: any) => (
        <Stack direction="row" gap={0.5} flexWrap="wrap">
          <Chip size="small" label={STATUS[row.original.status]} />
          {row.original.recorded && <Chip size="small" variant="outlined" label="Entered by the office" />}
          {row.original.overBy ? <Chip size="small" color="warning" variant="outlined" label={`Over balance by ${row.original.overBy}`} /> : null}
          {row.original.hasDocument && <Chip size="small" variant="outlined" label={row.original.documentsCopied ? `${row.original.documentCount} document` : "Document still in SiteClock"} />}
        </Stack>
      ),
    },
    {
      id: "menu",
      header: "",
      cell: ({ row }: any) =>
        canApprove ? (
          <IconButton size="small" onClick={(e) => { e.stopPropagation(); setMenu({ pos: { left: e.clientX, top: e.clientY }, row: row.original }); }}>
            <MoreVertIcon fontSize="small" />
          </IconButton>
        ) : null,
    },
  ];
  const balRows = (balances.data?.workers ?? []).map((w) => ({ id: w.workerId, ...w }));
  const balCols = [
    { id: "who", header: "Worker", cell: ({ row }: any) => row.original.name },
    ...activeTypes.map((t) => ({
      id: t.id,
      header: t.name,
      cell: ({ row }: any) => {
        const b = row.original.balances.find((x: any) => x.typeId === t.id);
        if (!b) return "";
        return b.entitled == null ? `${b.taken} taken` : `${b.remaining} of ${b.entitled} left${b.pending ? `, ${b.pending} asked` : ""}`;
      },
    })),
  ];
  const calCols = [
    { id: "who", header: "Worker", cell: ({ row }: any) => row.original.workerName },
    { id: "type", header: "Leave", cell: ({ row }: any) => row.original.typeName },
    { id: "dates", header: "Dates", cell: ({ row }: any) => dates(row.original) },
  ];
  const typeCols = [
    { id: "name", header: "Leave type", cell: ({ row }: any) => (<Stack direction="row" gap={1}><span>{row.original.name}</span>{row.original.archived && <Chip size="small" variant="outlined" label="Archived" />}</Stack>) },
    { id: "paid", header: "Paid", cell: ({ row }: any) => (row.original.paid ? "Yes" : "No") },
    { id: "days", header: "Days a year", cell: ({ row }: any) => row.original.defaultDays ?? "Not tracked" },
    { id: "doc", header: "Needs a document", cell: ({ row }: any) => (row.original.requiresDocument ? "Yes" : "") },
    { id: "used", header: "Requests", cell: ({ row }: any) => row.original.requestCount },
  ];

  return (
    <>
      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}
      {notice && <Alert severity="info" sx={{ mb: 2 }} onClose={() => setNotice(null)}>{notice}</Alert>}
      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 2 }}>
        <Tab label="Requests" />
        <Tab label="Balances" />
        <Tab label="Calendar" />
        <Tab label="Leave types" />
      </Tabs>
      {tab === 0 && (
        <>
          <Stack direction="row" gap={1} sx={{ mb: 2 }}>
            <TextField size="small" select label="State" value={status} onChange={(e) => setStatus(e.target.value)} sx={{ minWidth: 160 }}>
              <MenuItem value="">All</MenuItem>
              {Object.entries(STATUS).map(([v, l]) => (
                <MenuItem key={v} value={v}>{l}</MenuItem>
              ))}
            </TextField>
            {canManage && <Button variant="outlined" onClick={() => setRec({ workerId: "", typeId: "", startDate: todayIso(), endDate: todayIso(), halfDay: false, reason: "" })}>Enter leave a worker took</Button>}
          </Stack>
          <PageTable columns={reqCols as any} data={requests.data?.requests ?? []} tableName="Requests" loading={requests.isLoading} clientPaging noSelectionColumn />
        </>
      )}
      {tab === 1 && (
        <>
          <TextField size="small" label="Year" value={year} onChange={(e) => setYear(e.target.value.replace(/\D/g, "").slice(0, 4))} sx={{ mb: 2, width: 120 }} />
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>Days are calendar days, as in SiteClock (payroll counts working days).</Typography>
          <PageTable columns={balCols as any} data={balRows} tableName="Balances" loading={balances.isLoading} clientPaging noSelectionColumn
            onRowClick={(r: any) => canManage && setEnt({ workerId: r.workerId, name: r.name, values: Object.fromEntries(activeTypes.map((t) => { const b = r.balances.find((x: any) => x.typeId === t.id); return [t.id, b?.custom ? String(b.entitled) : ""]; })) })} />
        </>
      )}
      {tab === 2 && (
        <>
          <TextField size="small" type="month" label="Month" InputLabelProps={{ shrink: true }} value={month} onChange={(e) => setMonth(e.target.value)} sx={{ mb: 2 }} />
          <PageTable columns={calCols as any} data={calendar.data?.requests ?? []} tableName="Approved leave" loading={calendar.isLoading} clientPaging noSelectionColumn />
        </>
      )}
      {tab === 3 && (
        <PageTable columns={typeCols as any} data={types.data?.types ?? []} tableName="Leave types" loading={types.isLoading} clientPaging noSelectionColumn
          onRowClick={(t: any) => canManage && setType({ ...t, defaultDays: t.defaultDays == null ? "" : String(t.defaultDays) })}
          buttonName={canManage ? "Add leave type" : undefined} onAddClick={canManage ? () => setType({ name: "", paid: true, defaultDays: "", requiresDocument: false }) : undefined} />
      )}

      <Menu open={!!menu} onClose={() => setMenu(null)} anchorReference="anchorPosition" anchorPosition={menu?.pos}>
        {menu && [
          menu.row.status === "PENDING" && (
            <MenuItem key="ap" onClick={() => { const r = menu.row; setMenu(null); void run(() => send(`/field/leave/requests/${r.id}/approve`, "POST"), overNote); }}><ListItemText>Approve</ListItemText></MenuItem>
          ),
          menu.row.status === "PENDING" && (
            <MenuItem key="rj" onClick={() => { const r = menu.row; setMenu(null); void run(() => send(`/field/leave/requests/${r.id}/reject`, "POST")); }}><ListItemText>Reject</ListItemText></MenuItem>
          ),
          canManage && menu.row.status !== "CANCELLED" && (
            <MenuItem key="cx" sx={{ color: "error.main" }} onClick={() => { const r = menu.row; setMenu(null); if (window.confirm("Cancel this leave?")) void run(() => send(`/field/leave/requests/${r.id}/cancel`, "POST")); }}><ListItemText>Cancel the leave</ListItemText></MenuItem>
          ),
        ]}
      </Menu>

      <Dialog open={!!rec} onClose={() => !busy && setRec(null)} maxWidth="sm" fullWidth>
        <DialogTitle>Enter leave a worker took</DialogTitle>
        <DialogContent dividers>
          {rec && (
            <Stack gap={2}>
              <TextField select label="Worker" value={rec.workerId} onChange={(e) => setRec({ ...rec, workerId: e.target.value })}>
                {(workers.data?.workers ?? []).filter((w) => w.active).map((w) => (
                  <MenuItem key={w.id} value={w.id}>{w.name}</MenuItem>
                ))}
              </TextField>
              <TextField select label="Leave" value={rec.typeId} onChange={(e) => setRec({ ...rec, typeId: e.target.value })}>
                {activeTypes.map((t) => (
                  <MenuItem key={t.id} value={t.id}>{t.name}</MenuItem>
                ))}
              </TextField>
              <Stack direction="row" gap={2}>
                <TextField type="date" label="From" InputLabelProps={{ shrink: true }} value={rec.startDate} onChange={(e) => setRec({ ...rec, startDate: e.target.value })} />
                <TextField type="date" label="To" InputLabelProps={{ shrink: true }} value={rec.endDate} onChange={(e) => setRec({ ...rec, endDate: e.target.value })} />
              </Stack>
              <FormControlLabel control={<Switch checked={rec.halfDay} onChange={(e) => setRec({ ...rec, halfDay: e.target.checked })} />} label="Half day" />
              <TextField label="Reason" value={rec.reason} onChange={(e) => setRec({ ...rec, reason: e.target.value })} inputProps={{ maxLength: 500 }} />
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRec(null)} disabled={busy}>Cancel</Button>
          <Button variant="contained" disableElevation disabled={busy || !rec?.workerId || !rec?.typeId}
            onClick={() => rec && void run(() => send(`/field/leave/requests/record`, "POST", { workerId: rec.workerId, typeId: rec.typeId, startDate: rec.startDate, endDate: rec.endDate, halfDay: rec.halfDay, ...(rec.reason.trim() ? { reason: rec.reason.trim() } : {}) }), (o) => { setRec(null); overNote(o); })}>
            Save
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={!!type} onClose={() => !busy && setType(null)} maxWidth="xs" fullWidth>
        <DialogTitle>{type?.id ? type.name : "Add leave type"}</DialogTitle>
        <DialogContent dividers>
          {type && (
            <Stack gap={2}>
              <TextField label="Name" value={type.name} onChange={(e) => setType({ ...type, name: e.target.value })} />
              <TextField label="Days a year" value={type.defaultDays} onChange={(e) => setType({ ...type, defaultDays: e.target.value.replace(/[^\d.]/g, "") })} />
              <FormControlLabel control={<Switch checked={type.paid} onChange={(e) => setType({ ...type, paid: e.target.checked })} />} label="Paid" />
              <FormControlLabel control={<Switch checked={type.requiresDocument} onChange={(e) => setType({ ...type, requiresDocument: e.target.checked })} />} label="Needs a document (for example an MC)" />
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          {type?.id && (
            <Button color="error" sx={{ mr: "auto" }} disabled={busy}
              onClick={() => {
                if (type.archived) void run(() => send(`/field/leave/types/${type.id}/restore`, "POST"), () => setType(null));
                else if (window.confirm(`Delete ${type.name}? A type with requests is archived instead.`)) void run(() => send(`/field/leave/types/${type.id}`, "DELETE"), () => setType(null));
              }}>
              {type.archived ? "Restore" : "Delete"}
            </Button>
          )}
          <Button onClick={() => setType(null)} disabled={busy}>Cancel</Button>
          <Button variant="contained" disableElevation disabled={busy || !type?.name.trim()}
            onClick={() => type && void run(() => {
              const body = { name: type.name.trim(), paid: type.paid, requiresDocument: type.requiresDocument, defaultDays: type.defaultDays === "" ? null : Number(type.defaultDays) };
              return type.id ? send(`/field/leave/types/${type.id}`, "PATCH", body) : send(`/field/leave/types`, "POST", body);
            }, () => setType(null))}>
            Save
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={!!ent} onClose={() => !busy && setEnt(null)} maxWidth="xs" fullWidth>
        <DialogTitle>{ent?.name}: days a year</DialogTitle>
        <DialogContent dividers>
          {ent && (
            <Stack gap={2}>
              {activeTypes.map((t) => (
                <TextField key={t.id} label={`${t.name} (blank = ${t.defaultDays ?? "not tracked"})`} value={ent.values[t.id] ?? ""} onChange={(e) => setEnt({ ...ent, values: { ...ent.values, [t.id]: e.target.value.replace(/[^\d.]/g, "") } })} />
              ))}
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEnt(null)} disabled={busy}>Cancel</Button>
          <Button variant="contained" disableElevation disabled={busy}
            onClick={() => ent && void run(() => send(`/field/leave/entitlements/${ent.workerId}`, "PUT", { entitlements: Object.fromEntries(Object.entries(ent.values).map(([k, v]) => [k, v === "" ? null : Number(v)])) }), () => setEnt(null))}>
            Save
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
