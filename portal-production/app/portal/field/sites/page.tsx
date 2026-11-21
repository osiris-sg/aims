"use client";

// Field > Sites (FIELD_PLAN.md phase 1; ported from SiteClock web/src/pages/Sites.tsx @62b7d9d).
// Geofenced places to clock at: permanent sites, bases (office, yard, dormitory) and, on request, the
// one-off job places. Address search fills the map point; radius, GPS accuracy, time zone and the
// auto-close window are SiteClock's (same ranges and defaults).
import * as React from "react";
import {
  Alert, Autocomplete, Button, Checkbox, Chip, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, Link,
  MenuItem, Stack, Switch, Tab, Tabs, TextField, Typography,
} from "@mui/material";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import PageTable from "@/components/PageTable";
import { fieldAtLeast } from "@/helpers/fieldModule";
import { SITE_KIND_LABEL, SITE_LIMITS, siteFormErrors } from "@/helpers/fieldPeople";
import FieldGate from "../_components/FieldGate";
import { useFieldApi, type FieldMe } from "../_lib/useField";

type Site = {
  id: string; name: string; address: string | null; lat: number; lng: number; radiusM: number; maxAccuracyM: number; autoCloseAfterH: number;
  timezone: string; active: boolean; kind: string; allWorkers: boolean; assignments: Array<{ workerId: string; name: string; isSupervisor: boolean }>;
};
type Form = {
  id?: string; name: string; address: string; lat: string; lng: string; radiusM: number; maxAccuracyM: number; autoCloseAfterH: number;
  timezone: string; active: boolean; kind: string; allWorkers: boolean; people: Array<{ workerId: string; isSupervisor: boolean }>;
};
const EMPTY: Form = { name: "", address: "", lat: "", lng: "", radiusM: SITE_LIMITS.radiusM.def, maxAccuracyM: SITE_LIMITS.maxAccuracyM.def, autoCloseAfterH: SITE_LIMITS.autoCloseAfterH.def, timezone: "Asia/Singapore", active: true, kind: "PERMANENT", allWorkers: false, people: [] };

export default function FieldSitesPage() {
  return <FieldGate area="people" title="Sites">{(me) => <Sites me={me} />}</FieldGate>;
}

function Sites({ me }: { me: FieldMe }) {
  const { get, send } = useFieldApi();
  const qc = useQueryClient();
  const canEdit = fieldAtLeast(me.access.levels.people, "edit") && !me.access.scoped.people;
  const [kind, setKind] = React.useState("");
  const sites = useQuery({ queryKey: ["field-sites", kind], queryFn: () => get<{ sites: Site[] }>(`/field/people/sites${kind ? `?kind=${kind}` : ""}`) });
  const workers = useQuery({ queryKey: ["field-workers"], queryFn: () => get<{ workers: any[] }>(`/field/people/workers`) });
  const [form, setForm] = React.useState<Form | null>(null);
  const [tab, setTab] = React.useState(0);
  const [search, setSearch] = React.useState<{ q: string; results: Array<{ label: string; lat: number; lng: number }> }>({ q: "", results: [] });
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const people = (workers.data?.workers ?? []).filter((w) => w.active);

  const open = (s?: Site) => {
    setTab(0);
    setSearch({ q: "", results: [] });
    setForm(
      s
        ? { id: s.id, name: s.name, address: s.address ?? "", lat: String(s.lat), lng: String(s.lng), radiusM: s.radiusM, maxAccuracyM: s.maxAccuracyM, autoCloseAfterH: s.autoCloseAfterH, timezone: s.timezone, active: s.active, kind: s.kind, allWorkers: s.allWorkers, people: s.assignments.map((a) => ({ workerId: a.workerId, isSupervisor: a.isSupervisor })) }
        : { ...EMPTY },
    );
  };

  const lookUp = async () => {
    if (search.q.trim().length < 3) return;
    try {
      setSearch({ ...search, results: (await get<any>(`/field/people/sites/geocode?q=${encodeURIComponent(search.q.trim())}`)).results ?? [] });
    } catch (e: any) {
      setError(e?.message || "Address search failed");
    }
  };

  const save = async () => {
    if (!form) return;
    const err = siteFormErrors(form);
    if (err) return setError(err);
    setBusy(true);
    setError(null);
    try {
      const body = {
        name: form.name.trim(), address: form.address.trim() || undefined, lat: Number(form.lat), lng: Number(form.lng), radiusM: Number(form.radiusM),
        maxAccuracyM: Number(form.maxAccuracyM), autoCloseAfterH: Number(form.autoCloseAfterH), timezone: form.timezone, active: form.active,
        ...(form.kind !== "JOB" ? { kind: form.kind, allWorkers: form.kind === "BASE" && form.allWorkers } : {}),
      };
      const out: any = form.id ? await send(`/field/people/sites/${form.id}`, "PATCH", body) : await send(`/field/people/sites`, "POST", body);
      const id = form.id ?? out.site.id;
      const before = sites.data?.sites.find((s) => s.id === id)?.assignments ?? [];
      const changed = JSON.stringify(before.map((a) => [a.workerId, a.isSupervisor]).sort()) !== JSON.stringify(form.people.map((a) => [a.workerId, a.isSupervisor]).sort());
      if (changed) await send(`/field/people/sites/${id}/assignments`, "PUT", { assignments: form.people });
      setForm(null);
      await qc.invalidateQueries({ queryKey: ["field-sites"] });
      await qc.invalidateQueries({ queryKey: ["field-workers"] });
    } catch (e: any) {
      setError(e?.message || "Could not save");
    } finally {
      setBusy(false);
    }
  };

  const columns = [
    {
      id: "name",
      header: "Name",
      cell: ({ row }: any) => (
        <Stack direction="row" gap={1} alignItems="center">
          <span>{row.original.name}</span>
          {!row.original.active && <Chip size="small" variant="outlined" label="Off" />}
        </Stack>
      ),
    },
    { id: "kind", header: "Kind", cell: ({ row }: any) => SITE_KIND_LABEL[row.original.kind] ?? row.original.kind },
    { id: "address", header: "Address", cell: ({ row }: any) => row.original.address || "" },
    { id: "radius", header: "Radius", cell: ({ row }: any) => `${row.original.radiusM} m` },
    { id: "autoclose", header: "Auto-close", cell: ({ row }: any) => `${row.original.autoCloseAfterH} h` },
    { id: "people", header: "People", cell: ({ row }: any) => (row.original.allWorkers ? "Everyone" : row.original.assignments.length) },
  ];

  return (
    <>
      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}
      <PageTable
        columns={columns as any}
        data={sites.data?.sites ?? []}
        tableName="Sites"
        loading={sites.isLoading}
        clientPaging
        noSelectionColumn
        onRowClick={(s: Site) => canEdit && open(s)}
        buttonName={canEdit ? "Add site" : undefined}
        onAddClick={canEdit ? () => open() : undefined}
        headerContent={
          <Stack direction="row" gap={2} sx={{ px: 2, pb: 1 }}>
            <TextField size="small" select label="Show" value={kind} onChange={(e) => setKind(e.target.value)} sx={{ width: 220 }}>
              <MenuItem value="">Sites and bases</MenuItem>
              <MenuItem value="job">Job places</MenuItem>
              <MenuItem value="all">All</MenuItem>
            </TextField>
          </Stack>
        }
      />

      <Dialog open={!!form} onClose={() => !busy && setForm(null)} maxWidth="md" fullWidth>
        <DialogTitle>{form?.id ? form.name : "Add site"}</DialogTitle>
        <DialogContent dividers>
          {form && (
            <>
              <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 2 }}>
                <Tab label="Place" />
                <Tab label="People" />
              </Tabs>
              {tab === 0 && (
                <Stack gap={2}>
                  <TextField label="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} fullWidth />
                  <Stack direction="row" gap={1}>
                    <TextField label="Find the address" value={search.q} onChange={(e) => setSearch({ ...search, q: e.target.value })} onKeyDown={(e) => e.key === "Enter" && void lookUp()} fullWidth />
                    <Button variant="outlined" onClick={() => void lookUp()}>Search</Button>
                  </Stack>
                  {search.results.map((r) => (
                    <Button key={`${r.lat},${r.lng}`} size="small" sx={{ justifyContent: "flex-start", textTransform: "none" }}
                      onClick={() => { setForm({ ...form, address: r.label, lat: String(r.lat), lng: String(r.lng) }); setSearch({ q: "", results: [] }); }}>
                      {r.label}
                    </Button>
                  ))}
                  <TextField label="Address" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} fullWidth />
                  <Stack direction="row" gap={2}>
                    <TextField label="Latitude" value={form.lat} onChange={(e) => setForm({ ...form, lat: e.target.value })} />
                    <TextField label="Longitude" value={form.lng} onChange={(e) => setForm({ ...form, lng: e.target.value })} />
                    {form.lat && form.lng && (
                      <Link sx={{ alignSelf: "center" }} target="_blank" rel="noreferrer" href={`https://www.openstreetmap.org/?mlat=${form.lat}&mlon=${form.lng}#map=18/${form.lat}/${form.lng}`}>
                        Map
                      </Link>
                    )}
                  </Stack>
                  <Stack direction="row" gap={2}>
                    <TextField type="number" label="Radius (m)" value={form.radiusM} onChange={(e) => setForm({ ...form, radiusM: Number(e.target.value) })} />
                    <TextField type="number" label="GPS accuracy (m)" value={form.maxAccuracyM} onChange={(e) => setForm({ ...form, maxAccuracyM: Number(e.target.value) })} />
                    <TextField type="number" label="Auto-close (h)" value={form.autoCloseAfterH} onChange={(e) => setForm({ ...form, autoCloseAfterH: Number(e.target.value) })} />
                  </Stack>
                  <TextField label="Time zone" value={form.timezone} onChange={(e) => setForm({ ...form, timezone: e.target.value })} />
                  {form.kind !== "JOB" ? (
                    <TextField select label="Kind" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
                      <MenuItem value="PERMANENT">Site</MenuItem>
                      <MenuItem value="BASE">Base (office, yard, dormitory)</MenuItem>
                    </TextField>
                  ) : (
                    <Typography color="text.secondary">Job place (made from a job address)</Typography>
                  )}
                  {form.kind === "BASE" && (
                    <FormControlLabel control={<Switch checked={form.allWorkers} onChange={(e) => setForm({ ...form, allWorkers: e.target.checked })} />} label="Every worker may clock here" />
                  )}
                  <FormControlLabel control={<Switch checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />} label="Active" />
                </Stack>
              )}
              {tab === 1 && (
                <Stack gap={1}>
                  <Autocomplete multiple options={people} getOptionLabel={(w: any) => w.name} value={people.filter((w) => form.people.some((p) => p.workerId === w.id))}
                    onChange={(_, v) => setForm({ ...form, people: v.map((w: any) => form.people.find((p) => p.workerId === w.id) ?? { workerId: w.id, isSupervisor: false }) })}
                    renderInput={(p) => <TextField {...p} label="People at this site" />} />
                  {form.people.map((p) => (
                    <FormControlLabel key={p.workerId}
                      control={<Checkbox checked={p.isSupervisor} onChange={() => setForm({ ...form, people: form.people.map((x) => (x.workerId === p.workerId ? { ...x, isSupervisor: !x.isSupervisor } : x)) })} />}
                      label={`${people.find((w) => w.id === p.workerId)?.name ?? ""} supervises`} />
                  ))}
                </Stack>
              )}
            </>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setForm(null)} disabled={busy}>Cancel</Button>
          <Button variant="contained" disableElevation onClick={() => void save()} disabled={busy}>Save</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
