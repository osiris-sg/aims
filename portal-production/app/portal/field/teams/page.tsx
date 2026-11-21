"use client";

// Field > Teams (FIELD_PLAN.md phase 1; ported from SiteClock web/src/pages/Teams.tsx @62b7d9d).
// Teams with dated membership: who was in the team on any date, the full history, supervisors, archive.
// A member is added from a date and removed with a last day; rows are never rewritten.
import * as React from "react";
import {
  Alert, Autocomplete, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, IconButton,
  ListItemText, Menu, MenuItem, Stack, Switch, Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography,
} from "@mui/material";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import PageTable from "@/components/PageTable";
import { fieldAtLeast } from "@/helpers/fieldModule";
import FieldGate from "../_components/FieldGate";
import { useFieldApi, type FieldMe } from "../_lib/useField";

type Member = { membershipId: string; id: string; name: string; startDate: string; endDate: string | null };
type Team = { id: string; name: string; active: boolean; supervisors: Array<{ id: string; name: string }>; members: Member[]; everCount: number };

export default function FieldTeamsPage() {
  return <FieldGate area="people" title="Teams">{(me) => <Teams me={me} />}</FieldGate>;
}

function Teams({ me }: { me: FieldMe }) {
  const { get, send } = useFieldApi();
  const qc = useQueryClient();
  const canEdit = fieldAtLeast(me.access.levels.people, "edit") && !me.access.scoped.people;
  const [date, setDate] = React.useState("");
  const [showArchived, setShowArchived] = React.useState(false);
  const key = ["field-teams", date, showArchived];
  const teams = useQuery({ queryKey: key, queryFn: () => get<{ date: string; teams: Team[] }>(`/field/people/teams?all=${showArchived ? 1 : 0}${date ? `&date=${date}` : ""}`) });
  const workers = useQuery({ queryKey: ["field-workers"], queryFn: () => get<{ workers: any[] }>(`/field/people/workers`) });
  const [open, setOpen] = React.useState<Team | null>(null);
  const [creating, setCreating] = React.useState<{ name: string; memberIds: string[]; supervisorIds: string[]; startDate: string } | null>(null);
  const [adding, setAdding] = React.useState<{ workerIds: string[]; startDate: string }>({ workerIds: [], startDate: "" });
  const [history, setHistory] = React.useState<any[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [menu, setMenu] = React.useState<{ pos: { left: number; top: number }; member: Member } | null>(null);
  const [endFor, setEndFor] = React.useState<{ member: Member; lastDay: string } | null>(null);

  const people = (workers.data?.workers ?? []).filter((w) => w.active);
  const supervisorsOk = people.filter((w) => w.tier === "SUPERVISOR" || w.tier === "COMPANY_ADMIN");
  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ["field-teams"] });
    await qc.invalidateQueries({ queryKey: ["field-workers"] });
  };
  const current = open ? teams.data?.teams.find((t) => t.id === open.id) ?? open : null;

  const run = async (fn: () => Promise<unknown>, done?: () => void) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      done?.();
      await refresh();
    } catch (e: any) {
      setError(e?.message || "Could not save");
    } finally {
      setBusy(false);
    }
  };

  const loadHistory = async (id: string) => {
    try {
      setHistory((await get<any>(`/field/people/teams/${id}/history`)).stints);
    } catch (e: any) {
      setError(e?.message || "Could not load the history");
    }
  };

  const columns = [
    {
      id: "name",
      header: "Team",
      cell: ({ row }: any) => (
        <Stack direction="row" gap={1} alignItems="center">
          <span>{row.original.name}</span>
          {!row.original.active && <Chip size="small" variant="outlined" label="Archived" />}
        </Stack>
      ),
    },
    { id: "members", header: "Members", cell: ({ row }: any) => row.original.members.map((m: Member) => m.name).join(", ") },
    { id: "count", header: "People", cell: ({ row }: any) => row.original.members.length },
    { id: "supervisors", header: "Supervisors", cell: ({ row }: any) => row.original.supervisors.map((s: any) => s.name).join(", ") },
  ];

  return (
    <>
      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}
      <PageTable
        columns={columns as any}
        data={teams.data?.teams ?? []}
        tableName="Teams"
        loading={teams.isLoading}
        clientPaging
        noSelectionColumn
        onRowClick={(t: Team) => { setOpen(t); setHistory(null); setAdding({ workerIds: [], startDate: "" }); }}
        buttonName={canEdit ? "Add team" : undefined}
        onAddClick={canEdit ? () => setCreating({ name: "", memberIds: [], supervisorIds: [], startDate: "" }) : undefined}
        headerContent={
          <Stack direction="row" gap={2} alignItems="center" sx={{ px: 2, pb: 1 }}>
            <TextField size="small" type="date" label="Members on" InputLabelProps={{ shrink: true }} value={date || teams.data?.date || ""} onChange={(e) => setDate(e.target.value)} />
            <FormControlLabel control={<Switch checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />} label="Show archived" />
          </Stack>
        }
      />

      <Dialog open={!!creating} onClose={() => !busy && setCreating(null)} maxWidth="sm" fullWidth>
        <DialogTitle>Add team</DialogTitle>
        <DialogContent dividers>
          {creating && (
            <Stack gap={2}>
              <TextField label="Name" value={creating.name} onChange={(e) => setCreating({ ...creating, name: e.target.value })} fullWidth />
              <Autocomplete multiple options={people} getOptionLabel={(w: any) => w.name} value={people.filter((w) => creating.memberIds.includes(w.id))}
                onChange={(_, v) => setCreating({ ...creating, memberIds: v.map((w: any) => w.id) })} renderInput={(p) => <TextField {...p} label="Members" />} />
              <TextField type="date" label="In the team from" InputLabelProps={{ shrink: true }} value={creating.startDate} onChange={(e) => setCreating({ ...creating, startDate: e.target.value })} />
              <Autocomplete multiple options={supervisorsOk} getOptionLabel={(w: any) => w.name} value={supervisorsOk.filter((w) => creating.supervisorIds.includes(w.id))}
                onChange={(_, v) => setCreating({ ...creating, supervisorIds: v.map((w: any) => w.id) })} renderInput={(p) => <TextField {...p} label="Supervisors" />} />
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreating(null)} disabled={busy}>Cancel</Button>
          <Button variant="contained" disableElevation disabled={busy || !creating?.name.trim()}
            onClick={() => creating && void run(() => send(`/field/people/teams`, "POST", { name: creating.name.trim(), memberIds: creating.memberIds, supervisorIds: creating.supervisorIds, ...(creating.startDate ? { startDate: creating.startDate } : {}) }), () => setCreating(null))}>
            Save
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={!!current} onClose={() => !busy && setOpen(null)} maxWidth="md" fullWidth>
        <DialogTitle>{current?.name}</DialogTitle>
        <DialogContent dividers>
          {current && (
            <Stack gap={3}>
              {canEdit && (
                <Stack direction="row" gap={2} alignItems="center" flexWrap="wrap">
                  <TextField size="small" label="Name" defaultValue={current.name} key={current.id}
                    onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== current.name && void run(() => send(`/field/people/teams/${current.id}`, "PATCH", { name: e.target.value.trim() }))} />
                  <Button variant="outlined" color={current.active ? "error" : "primary"} disabled={busy}
                    onClick={() => void run(() => send(`/field/people/teams/${current.id}`, "PATCH", { active: !current.active }))}>
                    {current.active ? "Archive" : "Restore"}
                  </Button>
                </Stack>
              )}
              <Box>
                <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>Supervisors</Typography>
                <Autocomplete multiple disabled={!canEdit || busy} options={supervisorsOk} getOptionLabel={(w: any) => w.name}
                  value={supervisorsOk.filter((w) => current.supervisors.some((s) => s.id === w.id))}
                  onChange={(_, v) => void run(() => send(`/field/people/teams/${current.id}/supervisors`, "PUT", { workerIds: v.map((w: any) => w.id) }))}
                  renderInput={(p) => <TextField {...p} size="small" />} />
              </Box>
              <Box>
                <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>Members on {date || teams.data?.date}</Typography>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Name</TableCell>
                      <TableCell>From</TableCell>
                      <TableCell>Last day</TableCell>
                      <TableCell />
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {current.members.map((m) => (
                      <TableRow key={m.membershipId}>
                        <TableCell>{m.name}</TableCell>
                        <TableCell>{m.startDate}</TableCell>
                        <TableCell>{m.endDate ?? ""}</TableCell>
                        <TableCell align="right">
                          {canEdit && (
                            <IconButton size="small" onClick={(e) => setMenu({ pos: { left: e.clientX, top: e.clientY }, member: m })}>
                              <MoreVertIcon fontSize="small" />
                            </IconButton>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Box>
              {canEdit && (
                <Stack direction="row" gap={2} alignItems="center" flexWrap="wrap">
                  <Autocomplete multiple sx={{ minWidth: 320, flex: 1 }} options={people.filter((w) => !current.members.some((m) => m.id === w.id))} getOptionLabel={(w: any) => w.name}
                    value={people.filter((w) => adding.workerIds.includes(w.id))} onChange={(_, v) => setAdding({ ...adding, workerIds: v.map((w: any) => w.id) })}
                    renderInput={(p) => <TextField {...p} size="small" label="Add members" />} />
                  <TextField size="small" type="date" label="From" InputLabelProps={{ shrink: true }} value={adding.startDate} onChange={(e) => setAdding({ ...adding, startDate: e.target.value })} />
                  <Button variant="contained" disableElevation disabled={busy || !adding.workerIds.length}
                    onClick={() => void run(() => send(`/field/people/teams/${current.id}/members`, "POST", { workerIds: adding.workerIds, ...(adding.startDate ? { startDate: adding.startDate } : {}) }), () => setAdding({ workerIds: [], startDate: "" }))}>
                    Add
                  </Button>
                </Stack>
              )}
              <Box>
                <Button size="small" onClick={() => void loadHistory(current.id)}>Show history ({current.everCount} people)</Button>
                {history && (
                  <Table size="small" sx={{ mt: 1 }}>
                    <TableBody>
                      {history.map((s) => (
                        <TableRow key={s.id}>
                          <TableCell>{s.name}</TableCell>
                          <TableCell>{s.startDate}</TableCell>
                          <TableCell>{s.endDate ?? "now"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </Box>
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(null)} disabled={busy}>Close</Button>
        </DialogActions>
      </Dialog>

      <Menu open={!!menu} onClose={() => setMenu(null)} anchorReference="anchorPosition" anchorPosition={menu?.pos}>
        {menu && [
          <MenuItem key="end" onClick={() => { setEndFor({ member: menu.member, lastDay: "" }); setMenu(null); }}>
            <ListItemText>Remove from the team</ListItemText>
          </MenuItem>,
          <MenuItem key="del" sx={{ color: "error.main" }} onClick={() => { const m = menu.member; setMenu(null); if (window.confirm(`Delete ${m.name}'s period in this team? Use this only for a mistake.`)) void run(() => send(`/field/people/stints/${m.membershipId}`, "DELETE")); }}>
            <ListItemText>Delete this period</ListItemText>
          </MenuItem>,
        ]}
      </Menu>

      <Dialog open={!!endFor} onClose={() => !busy && setEndFor(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Remove {endFor?.member.name}</DialogTitle>
        <DialogContent dividers>
          <TextField type="date" fullWidth label="Last day in the team" InputLabelProps={{ shrink: true }} value={endFor?.lastDay ?? ""} onChange={(e) => endFor && setEndFor({ ...endFor, lastDay: e.target.value })} />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEndFor(null)} disabled={busy}>Cancel</Button>
          <Button variant="contained" disableElevation disabled={busy}
            onClick={() => endFor && current && void run(() => send(`/field/people/teams/${current.id}/members/${endFor.member.id}/remove`, "POST", endFor.lastDay ? { lastDay: endFor.lastDay } : {}), () => setEndFor(null))}>
            Remove
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
