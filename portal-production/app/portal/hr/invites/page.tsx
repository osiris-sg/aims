"use client";

// Field > Invites (FIELD_PLAN.md phase 1; ported from SiteClock web Workers > Invites / join requests and
// the photo review, @62b7d9d). Office side only: invite links, the people who asked to join (approve
// creates the worker), and new photos on record to approve. The join page and the photo upload belong to
// the worker app, which comes later, so links made here are not usable by workers yet.
import * as React from "react";
import {
  Alert, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, ListItemText, Menu, MenuItem, Stack, Tab, Tabs, TextField,
} from "@mui/material";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import PageTable from "@/components/PageTable";
import { fieldAtLeast } from "@/helpers/fieldModule";
import { inviteState } from "@/helpers/fieldPeople";
import FieldGate from "../_components/FieldGate";
import { useFieldApi, type FieldMe } from "../_lib/useField";

export default function FieldInvitesPage() {
  return <FieldGate area="people" title="Invites">{(me) => <Invites me={me} />}</FieldGate>;
}

function Invites({ me }: { me: FieldMe }) {
  const { get, send } = useFieldApi();
  const qc = useQueryClient();
  const canEdit = fieldAtLeast(me.access.levels.people, "edit");
  const [tab, setTab] = React.useState(0);
  const invites = useQuery({ queryKey: ["field-invites"], queryFn: () => get<{ invites: any[] }>(`/field/people/invites`) });
  const regs = useQuery({ queryKey: ["field-registrations"], queryFn: () => get<{ requests: any[] }>(`/field/people/registrations`) });
  const photos = useQuery({ queryKey: ["field-photo-updates"], queryFn: () => get<{ updates: any[] }>(`/field/people/photo-updates`) });
  const sites = useQuery({ queryKey: ["field-sites", ""], queryFn: () => get<{ sites: any[] }>(`/field/people/sites`) });
  const [form, setForm] = React.useState<{ label: string; role: string; siteId: string; maxUses: string; expiresAt: string } | null>(null);
  const [menu, setMenu] = React.useState<{ pos: { left: number; top: number }; row: any } | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const siteName = (id: string | null) => (sites.data?.sites ?? []).find((s) => s.id === id)?.name ?? "";

  const run = async (fn: () => Promise<unknown>, done?: () => void) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      done?.();
      await Promise.all(["field-invites", "field-registrations", "field-photo-updates", "field-workers"].map((k) => qc.invalidateQueries({ queryKey: [k] })));
    } catch (e: any) {
      setError(e?.message || "Could not save");
    } finally {
      setBusy(false);
    }
  };

  const inviteCols = [
    { id: "label", header: "Invite", cell: ({ row }: any) => row.original.label || "Invite link" },
    { id: "role", header: "Joins as", cell: ({ row }: any) => (row.original.role === "SUPERVISOR" ? "Supervisor" : "Worker") },
    { id: "site", header: "Site", cell: ({ row }: any) => siteName(row.original.siteId) },
    { id: "uses", header: "Used", cell: ({ row }: any) => `${row.original.uses}${row.original.maxUses != null ? ` of ${row.original.maxUses}` : ""}` },
    { id: "pending", header: "To approve", cell: ({ row }: any) => row.original.pendingCount || "" },
    { id: "state", header: "State", cell: ({ row }: any) => <Chip size="small" label={inviteState(row.original)} /> },
    {
      id: "menu",
      header: "",
      cell: ({ row }: any) =>
        canEdit ? (
          <IconButton size="small" onClick={(e) => { e.stopPropagation(); setMenu({ pos: { left: e.clientX, top: e.clientY }, row: row.original }); }}>
            <MoreVertIcon fontSize="small" />
          </IconButton>
        ) : null,
    },
  ];

  const regCols = [
    { id: "name", header: "Name", cell: ({ row }: any) => row.original.name },
    { id: "phone", header: "Phone", cell: ({ row }: any) => row.original.phone },
    { id: "emp", header: "Employee no", cell: ({ row }: any) => row.original.employeeNo || "" },
    { id: "when", header: "Asked", cell: ({ row }: any) => new Date(row.original.createdAt).toLocaleDateString("en-GB") },
    {
      id: "act",
      header: "",
      cell: ({ row }: any) =>
        canEdit ? (
          <Stack direction="row" gap={1} onClick={(e) => e.stopPropagation()}>
            <Button size="small" variant="contained" disableElevation disabled={busy} onClick={() => void run(() => send(`/field/people/registrations/${row.original.id}/approve`, "POST"))}>Approve</Button>
            <Button size="small" color="error" disabled={busy} onClick={() => void run(() => send(`/field/people/registrations/${row.original.id}/reject`, "POST"))}>Reject</Button>
          </Stack>
        ) : null,
    },
  ];

  const photoCols = [
    { id: "name", header: "Worker", cell: ({ row }: any) => row.original.workerName },
    { id: "status", header: "State", cell: ({ row }: any) => (row.original.status === "PENDING" ? "Sent, to approve" : "Asked, not sent yet") },
    { id: "by", header: "Asked by", cell: ({ row }: any) => (row.original.auto ? "First login" : row.original.requestedByName || "The worker") },
    { id: "note", header: "Note", cell: ({ row }: any) => row.original.note || "" },
    {
      id: "act",
      header: "",
      cell: ({ row }: any) =>
        canEdit ? (
          <Stack direction="row" gap={1} onClick={(e) => e.stopPropagation()}>
            {row.original.status === "PENDING" ? (
              <>
                <Button size="small" variant="contained" disableElevation disabled={busy} onClick={() => void run(() => send(`/field/people/photo-updates/${row.original.id}/approve`, "POST"))}>Approve</Button>
                <Button size="small" color="error" disabled={busy}
                  onClick={() => { const note = window.prompt("Why is it not accepted?") ?? ""; void run(() => send(`/field/people/photo-updates/${row.original.id}/reject`, "POST", { note })); }}>
                  Reject
                </Button>
              </>
            ) : (
              <Button size="small" disabled={busy} onClick={() => void run(() => send(`/field/people/photo-updates/request/${row.original.workerId}`, "DELETE"))}>Cancel request</Button>
            )}
          </Stack>
        ) : null,
    },
  ];

  return (
    <>
      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}
      <Alert severity="info" sx={{ mb: 2 }}>Workers join and send photos from the AIMS phone app, which is not out yet.</Alert>
      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 2 }}>
        <Tab label="Invite links" />
        <Tab label={`Join requests (${regs.data?.requests.length ?? 0})`} />
        <Tab label={`Photos (${photos.data?.updates.length ?? 0})`} />
      </Tabs>
      {tab === 0 && (
        <PageTable columns={inviteCols as any} data={invites.data?.invites ?? []} tableName="Invite links" loading={invites.isLoading} clientPaging noSelectionColumn
          buttonName={canEdit ? "Add invite" : undefined} onAddClick={canEdit ? () => setForm({ label: "", role: "WORKER", siteId: "", maxUses: "", expiresAt: "" }) : undefined} />
      )}
      {tab === 1 && <PageTable columns={regCols as any} data={regs.data?.requests ?? []} tableName="Join requests" loading={regs.isLoading} clientPaging noSelectionColumn />}
      {tab === 2 && <PageTable columns={photoCols as any} data={photos.data?.updates ?? []} tableName="Photos on record" loading={photos.isLoading} clientPaging noSelectionColumn />}

      <Menu open={!!menu} onClose={() => setMenu(null)} anchorReference="anchorPosition" anchorPosition={menu?.pos}>
        {menu && [
          <MenuItem key="toggle" onClick={() => { const r = menu.row; setMenu(null); void run(() => send(`/field/people/invites/${r.id}`, "PATCH", { active: !r.active })); }}>
            <ListItemText>{menu.row.active ? "Turn off" : "Turn on"}</ListItemText>
          </MenuItem>,
          <MenuItem key="del" sx={{ color: "error.main" }} onClick={() => { const r = menu.row; setMenu(null); if (window.confirm("Delete this invite link and its join requests?")) void run(() => send(`/field/people/invites/${r.id}`, "DELETE")); }}>
            <ListItemText>Delete</ListItemText>
          </MenuItem>,
        ]}
      </Menu>

      <Dialog open={!!form} onClose={() => !busy && setForm(null)} maxWidth="sm" fullWidth>
        <DialogTitle>Add invite</DialogTitle>
        <DialogContent dividers>
          {form && (
            <Stack gap={2}>
              <TextField label="Name of the link" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} inputProps={{ maxLength: 60 }} />
              <TextField select label="Joins as" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                <MenuItem value="WORKER">Worker</MenuItem>
                <MenuItem value="SUPERVISOR" disabled={me.access.scoped.people}>Supervisor</MenuItem>
              </TextField>
              <TextField select label="Site" value={form.siteId} onChange={(e) => setForm({ ...form, siteId: e.target.value })}>
                <MenuItem value="">No site</MenuItem>
                {(sites.data?.sites ?? []).map((s) => (
                  <MenuItem key={s.id} value={s.id}>{s.name}</MenuItem>
                ))}
              </TextField>
              <TextField label="Most uses" value={form.maxUses} onChange={(e) => setForm({ ...form, maxUses: e.target.value.replace(/\D/g, "") })} />
              <TextField type="date" label="Expires" InputLabelProps={{ shrink: true }} value={form.expiresAt} onChange={(e) => setForm({ ...form, expiresAt: e.target.value })} />
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setForm(null)} disabled={busy}>Cancel</Button>
          <Button variant="contained" disableElevation disabled={busy}
            onClick={() => form && void run(() => send(`/field/people/invites`, "POST", {
              ...(form.label.trim() ? { label: form.label.trim() } : {}), role: form.role, ...(form.siteId ? { siteId: form.siteId } : {}),
              ...(form.maxUses ? { maxUses: Number(form.maxUses) } : {}), ...(form.expiresAt ? { expiresAt: new Date(`${form.expiresAt}T23:59:59+08:00`).toISOString() } : {}),
            }), () => setForm(null))}>
            Save
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
