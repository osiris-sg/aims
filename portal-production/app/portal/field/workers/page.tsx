"use client";

// Field > Workers (FIELD_PLAN.md phase 1; ported from SiteClock web/src/pages/Workers.tsx @62b7d9d).
// The org's workers (AIMS Worker rows) with their Field profile: role, sites, rules, trades, device.
// Row opens the edit dialog; the three dots hold the rarer actions (change phone, reset device,
// new photo, ask to verify). Flag enableFieldPeople (+ enableFieldModule).
import * as React from "react";
import {
  Alert, Box, Button, Checkbox, Chip, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, IconButton,
  ListItemText, Menu, MenuItem, Stack, Switch, Tab, Tabs, TextField, Typography,
} from "@mui/material";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import PageTable from "@/components/PageTable";
import { fieldAtLeast } from "@/helpers/fieldModule";
import { RULE_OPTIONS, TIER_LABEL, filterWorkers, ruleBadges, workerPatch, type FieldWorkerRow } from "@/helpers/fieldPeople";
import FieldGate from "../_components/FieldGate";
import { useFieldApi, type FieldMe } from "../_lib/useField";

type Form = {
  id?: string;
  name: string;
  phone: string;
  employeeNo: string;
  tier: string;
  active: boolean;
  siteIds: string[];
  supervisorSiteIds: string[];
  jobClocking: string;
  offSiteClocking: string;
  selfiePolicy: string;
  baseClocking: string;
  payFollowsCrew: boolean;
  crewMarginBeforeMin: string;
  crewMarginAfterMin: string;
  attendanceExempt: boolean;
  payslipVisible: boolean;
  sharedWithLinked: boolean;
  tradeIds: string[];
};

const EMPTY: Form = {
  name: "", phone: "", employeeNo: "", tier: "WORKER", active: true, siteIds: [], supervisorSiteIds: [],
  jobClocking: "", offSiteClocking: "", selfiePolicy: "", baseClocking: "", payFollowsCrew: false,
  crewMarginBeforeMin: "", crewMarginAfterMin: "", attendanceExempt: false, payslipVisible: false, sharedWithLinked: false, tradeIds: [],
};

function toForm(w: FieldWorkerRow): Form {
  const o = w.overrides || {};
  return {
    id: w.id, name: w.name, phone: w.phone ?? "", employeeNo: w.employeeNo ?? "", tier: w.tier, active: w.active,
    siteIds: w.sites.filter((s) => !s.isSupervisor).map((s) => s.siteId), supervisorSiteIds: w.sites.filter((s) => s.isSupervisor).map((s) => s.siteId),
    jobClocking: o.jobClocking ?? "", offSiteClocking: o.offSiteClocking ?? "", selfiePolicy: o.selfiePolicy ?? "", baseClocking: o.baseClocking ?? "",
    payFollowsCrew: !!o.payFollowsCrew, crewMarginBeforeMin: o.crewMarginBeforeMin == null ? "" : String(o.crewMarginBeforeMin),
    crewMarginAfterMin: o.crewMarginAfterMin == null ? "" : String(o.crewMarginAfterMin), attendanceExempt: !!o.attendanceExempt,
    payslipVisible: !!o.payslipVisible, sharedWithLinked: !!o.sharedWithLinked, tradeIds: w.trades.map((t) => t.id),
  };
}

/** The API body from the form (numbers for margins; "" keeps "company rule"). */
function toBody(f: Form) {
  const n = (v: string) => (v.trim() === "" ? null : Number(v));
  return {
    name: f.name.trim(), employeeNo: f.employeeNo.trim(), tier: f.tier, active: f.active, siteIds: f.siteIds, supervisorSiteIds: f.supervisorSiteIds,
    jobClocking: f.jobClocking || null, offSiteClocking: f.offSiteClocking || null, selfiePolicy: f.selfiePolicy || null, baseClocking: f.baseClocking || null,
    payFollowsCrew: f.payFollowsCrew, crewMarginBeforeMin: n(f.crewMarginBeforeMin), crewMarginAfterMin: n(f.crewMarginAfterMin),
    attendanceExempt: f.attendanceExempt, payslipVisible: f.payslipVisible, sharedWithLinked: f.sharedWithLinked,
  };
}

export default function FieldWorkersPage() {
  return <FieldGate area="people" title="Workers">{(me) => <Workers me={me} />}</FieldGate>;
}

function Workers({ me }: { me: FieldMe }) {
  const { get, send } = useFieldApi();
  const qc = useQueryClient();
  const canEdit = fieldAtLeast(me.access.levels.people, "edit") && !me.access.scoped.people;
  const workers = useQuery({ queryKey: ["field-workers"], queryFn: () => get<{ workers: FieldWorkerRow[] }>(`/field/people/workers`) });
  const sites = useQuery({ queryKey: ["field-sites", "picker"], queryFn: () => get<{ sites: any[] }>(`/field/people/sites`) });
  const trades = useQuery({ queryKey: ["field-trades"], queryFn: () => get<{ trades: any[] }>(`/field/people/trades`) });
  const [q, setQ] = React.useState("");
  const [showHidden, setShowHidden] = React.useState(false);
  const [form, setForm] = React.useState<Form | null>(null);
  const [tab, setTab] = React.useState(0);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [menu, setMenu] = React.useState<{ pos: { left: number; top: number }; row: FieldWorkerRow } | null>(null);
  const [phoneFor, setPhoneFor] = React.useState<{ row: FieldWorkerRow; phone: string; resetDevice: boolean } | null>(null);
  const rows = React.useMemo(() => filterWorkers(workers.data?.workers ?? [], q, showHidden), [workers.data, q, showHidden]);
  const refresh = () => qc.invalidateQueries({ queryKey: ["field-workers"] });

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

  const save = () => {
    if (!form) return;
    if (!form.name.trim()) return setError("Give the worker a name");
    const body = toBody(form);
    void run(async () => {
      if (form.id) {
        const before = toBody(toForm(workers.data!.workers.find((w) => w.id === form.id)!));
        const patch = workerPatch(before, body);
        if (Object.keys(patch).length) await send(`/field/people/workers/${form.id}`, "PATCH", patch);
        const was = workers.data!.workers.find((w) => w.id === form.id)!.trades.map((t) => t.id).sort().join();
        if (was !== [...form.tradeIds].sort().join()) await send(`/field/people/workers/${form.id}/trades`, "PUT", { tradeIds: form.tradeIds });
      } else {
        const out: any = await send(`/field/people/workers`, "POST", { ...body, phone: form.phone.trim() });
        if (form.tradeIds.length) await send(`/field/people/workers/${out.worker.id}/trades`, "PUT", { tradeIds: form.tradeIds });
        if (out.otherCompanies?.length) setNotice(`${form.name} also works for ${out.otherCompanies.join(", ")}.`);
      }
    }, () => setForm(null));
  };

  const action = (path: string, body: unknown = {}, msg?: string) => {
    setMenu(null);
    void run(() => send(path, "POST", body), () => msg && setNotice(msg));
  };

  const columns = [
    {
      id: "name",
      header: "Name",
      cell: ({ row }: any) => (
        <Stack direction="row" alignItems="center" gap={1}>
          <span>{row.original.name}</span>
          {!row.original.active && <Chip size="small" variant="outlined" label="Hidden" />}
        </Stack>
      ),
    },
    { id: "employeeNo", header: "Employee no", cell: ({ row }: any) => row.original.employeeNo || "" },
    { id: "phone", header: "Phone", cell: ({ row }: any) => row.original.phone || "" },
    { id: "tier", header: "Role", cell: ({ row }: any) => TIER_LABEL[row.original.tier] ?? row.original.tier },
    { id: "teams", header: "Team", cell: ({ row }: any) => row.original.teams.map((t: any) => t.name).join(", ") },
    { id: "sites", header: "Sites", cell: ({ row }: any) => row.original.sites.map((s: any) => (s.isSupervisor ? `${s.name} (supervises)` : s.name)).join(", ") },
    {
      id: "rules",
      header: "Rules",
      cell: ({ row }: any) => (
        <Stack direction="row" gap={0.5} flexWrap="wrap">
          {ruleBadges(row.original.overrides).map((b) => (
            <Chip key={b} size="small" label={b} />
          ))}
        </Stack>
      ),
    },
    { id: "device", header: "Phone bound", cell: ({ row }: any) => (row.original.device.bound ? "Yes" : "No") },
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

  const siteList = (sites.data?.sites ?? []).filter((s) => s.active);
  const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  return (
    <>
      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}
      {notice && <Alert severity="info" sx={{ mb: 2 }} onClose={() => setNotice(null)}>{notice}</Alert>}
      <PageTable
        columns={columns as any}
        data={rows}
        tableName="Workers"
        loading={workers.isLoading}
        clientPaging
        noSelectionColumn
        onRowClick={(r: FieldWorkerRow) => canEdit && (setTab(0), setForm(toForm(r)))}
        buttonName={canEdit ? "Add worker" : undefined}
        onAddClick={canEdit ? () => (setTab(0), setForm({ ...EMPTY })) : undefined}
        headerContent={
          <Stack direction="row" gap={2} alignItems="center" sx={{ px: 2, pb: 1 }}>
            <TextField size="small" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} sx={{ width: 260 }} />
            <FormControlLabel control={<Switch checked={showHidden} onChange={(e) => setShowHidden(e.target.checked)} />} label="Show hidden" />
          </Stack>
        }
      />

      <Menu open={!!menu} onClose={() => setMenu(null)} anchorReference="anchorPosition" anchorPosition={menu?.pos}>
        {menu && [
          <MenuItem key="phone" onClick={() => { setPhoneFor({ row: menu.row, phone: menu.row.phone ?? "", resetDevice: false }); setMenu(null); }}>
            <ListItemText>Change phone</ListItemText>
          </MenuItem>,
          <MenuItem key="device" disabled={!menu.row.device.bound} onClick={() => action(`/field/people/workers/${menu.row.id}/reset-device`, {}, `${menu.row.name} can bind a new phone at the next login.`)}>
            <ListItemText>Reset phone binding</ListItemText>
          </MenuItem>,
          <MenuItem key="photo" onClick={() => action(`/field/people/photo-updates/request/${menu.row.id}`, {}, `A new photo is asked of ${menu.row.name}.`)}>
            <ListItemText>Ask for a new photo</ListItemText>
          </MenuItem>,
          <MenuItem key="verify" onClick={() => action(`/field/people/workers/${menu.row.id}/request-verification`, {}, `${menu.row.name}'s next clock-in needs a selfie and is held for review.`)}>
            <ListItemText>Ask to verify at the next clock-in</ListItemText>
          </MenuItem>,
          <MenuItem key="active" sx={menu.row.active ? { color: "error.main" } : undefined} onClick={() => { setMenu(null); void run(() => send(`/field/people/workers/${menu.row.id}`, "PATCH", { active: !menu.row.active })); }}>
            <ListItemText>{menu.row.active ? "Hide" : "Unhide"}</ListItemText>
          </MenuItem>,
        ]}
      </Menu>

      <Dialog open={!!form} onClose={() => !busy && setForm(null)} maxWidth="md" fullWidth>
        <DialogTitle>{form?.id ? form.name : "Add worker"}</DialogTitle>
        <DialogContent dividers>
          {form && (
            <>
              <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 2 }}>
                <Tab label="Details" />
                <Tab label="Sites" />
                <Tab label="Rules" />
                <Tab label="Trades" />
              </Tabs>
              {tab === 0 && (
                <Stack gap={2}>
                  <TextField label="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} fullWidth />
                  <TextField label="Phone" value={form.phone} disabled={!!form.id} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+6591234567" fullWidth />
                  <TextField label="Employee no" value={form.employeeNo} onChange={(e) => setForm({ ...form, employeeNo: e.target.value })} fullWidth />
                  <TextField select label="Role" value={form.tier} onChange={(e) => setForm({ ...form, tier: e.target.value })} fullWidth>
                    {Object.entries(TIER_LABEL).map(([v, l]) => (
                      <MenuItem key={v} value={v}>{l}</MenuItem>
                    ))}
                  </TextField>
                  <FormControlLabel control={<Switch checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />} label="Active" />
                </Stack>
              )}
              {tab === 1 && (
                <Stack gap={0.5}>
                  {siteList.length === 0 && <Typography color="text.secondary">No sites yet. Add them in Field &gt; Sites.</Typography>}
                  {siteList.map((s) => {
                    const at = form.siteIds.includes(s.id) || form.supervisorSiteIds.includes(s.id);
                    const sup = form.supervisorSiteIds.includes(s.id);
                    return (
                      <Stack key={s.id} direction="row" alignItems="center" gap={2}>
                        <FormControlLabel
                          sx={{ minWidth: 280 }}
                          control={<Checkbox checked={at} onChange={() => setForm({ ...form, siteIds: at ? form.siteIds.filter((x) => x !== s.id) : [...form.siteIds, s.id], supervisorSiteIds: at ? form.supervisorSiteIds.filter((x) => x !== s.id) : form.supervisorSiteIds })} />}
                          label={s.name}
                        />
                        <FormControlLabel
                          disabled={!at}
                          control={<Checkbox checked={sup} onChange={() => setForm({ ...form, supervisorSiteIds: toggle(form.supervisorSiteIds, s.id), siteIds: sup ? [...form.siteIds, s.id] : form.siteIds.filter((x) => x !== s.id) })} />}
                          label="Supervises"
                        />
                      </Stack>
                    );
                  })}
                </Stack>
              )}
              {tab === 2 && (
                <Stack gap={2}>
                  {(["jobClocking", "offSiteClocking", "selfiePolicy", "baseClocking"] as const).map((k) => (
                    <TextField key={k} select fullWidth value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })}
                      label={{ jobClocking: "Job clocking", offSiteClocking: "Off-site clock-ins", selfiePolicy: "Selfie", baseClocking: "Clock at a base" }[k]}>
                      {RULE_OPTIONS[k].map((o) => (
                        <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>
                      ))}
                    </TextField>
                  ))}
                  <FormControlLabel control={<Switch checked={form.payFollowsCrew} onChange={(e) => setForm({ ...form, payFollowsCrew: e.target.checked })} />} label="Paid hours follow the crew's jobs" />
                  {form.payFollowsCrew && (
                    <Stack direction="row" gap={2}>
                      <TextField label="Minutes before" value={form.crewMarginBeforeMin} onChange={(e) => setForm({ ...form, crewMarginBeforeMin: e.target.value.replace(/\D/g, "") })} />
                      <TextField label="Minutes after" value={form.crewMarginAfterMin} onChange={(e) => setForm({ ...form, crewMarginAfterMin: e.target.value.replace(/\D/g, "") })} />
                    </Stack>
                  )}
                  <FormControlLabel control={<Switch checked={form.attendanceExempt} onChange={(e) => setForm({ ...form, attendanceExempt: e.target.checked })} />} label="No clock-in needed (office staff)" />
                  <FormControlLabel control={<Switch checked={form.payslipVisible} onChange={(e) => setForm({ ...form, payslipVisible: e.target.checked })} />} label="Can see their payslip in the app" />
                  <FormControlLabel control={<Switch checked={form.sharedWithLinked} onChange={(e) => setForm({ ...form, sharedWithLinked: e.target.checked })} />} label="Shared with linked companies" />
                </Stack>
              )}
              {tab === 3 && (
                <Stack gap={0.5}>
                  {(trades.data?.trades ?? []).length === 0 && <Typography color="text.secondary">No trades yet. Add them in Field settings.</Typography>}
                  {(trades.data?.trades ?? []).map((t: any) => (
                    <FormControlLabel key={t.id} control={<Checkbox checked={form.tradeIds.includes(t.id)} onChange={() => setForm({ ...form, tradeIds: toggle(form.tradeIds, t.id) })} />} label={t.name} />
                  ))}
                </Stack>
              )}
            </>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setForm(null)} disabled={busy}>Cancel</Button>
          <Button variant="contained" disableElevation onClick={save} disabled={busy}>Save</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={!!phoneFor} onClose={() => !busy && setPhoneFor(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Change phone</DialogTitle>
        <DialogContent dividers>
          {phoneFor && (
            <Stack gap={2}>
              <TextField label="New phone" value={phoneFor.phone} onChange={(e) => setPhoneFor({ ...phoneFor, phone: e.target.value })} placeholder="+6591234567" fullWidth />
              <FormControlLabel control={<Checkbox checked={phoneFor.resetDevice} onChange={(e) => setPhoneFor({ ...phoneFor, resetDevice: e.target.checked })} />} label="New handset too (reset the phone binding)" />
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPhoneFor(null)} disabled={busy}>Cancel</Button>
          <Button variant="contained" disableElevation disabled={busy}
            onClick={() => phoneFor && void run(() => send(`/field/people/workers/${phoneFor.row.id}/change-phone`, "POST", { phone: phoneFor.phone.trim(), resetDevice: phoneFor.resetDevice }), () => setPhoneFor(null))}>
            Save
          </Button>
        </DialogActions>
      </Dialog>
      <Box />
    </>
  );
}
