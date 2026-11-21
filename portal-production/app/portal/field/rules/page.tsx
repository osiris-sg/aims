"use client";

// Field > Rules (FIELD_PLAN.md phase 7; SiteClock rules.router + terms.router @62b7d9d): overtime and break rules
// (company-wide, or for one site), the clock-in rules, and the worker terms. Admin changes; others read.
import * as React from "react";
import { Alert, Button, FormControlLabel, MenuItem, Stack, Switch, Tab, Tabs, TextField, Typography } from "@mui/material";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import PageTable from "@/components/PageTable";
import FieldGate from "../_components/FieldGate";
import { useFieldApi, type FieldMe } from "../_lib/useField";

export default function FieldRulesPage() {
  return <FieldGate area="reports" title="Rules">{(me) => <Rules me={me} />}</FieldGate>;
}

const PUNCH_CHOICES: Record<string, { label: string; options: Record<string, string> }> = {
  selfiePolicy: { label: "Selfie", options: { SMART: "Only when something looks off", ALWAYS: "Every clock-in" } },
  offSiteReview: { label: "Clock-in away from the site", options: { REVIEW: "Send for review", MARK: "Mark it only", BLOCK: "Block it" } },
  missedClockOut: { label: "A missed clock-out counts", options: { FULL_SHIFT: "The full shift", SHIFT_END: "Up to the shift end", NO_HOURS: "No hours" } },
  jobClocking: { label: "Clock on jobs", options: { OFF: "Off", ARRIVE: "On arrival", ARRIVE_LEAVE: "On arrival and leaving" } },
  groupClockBy: { label: "Clock in a crew", options: { ANYONE: "Anyone in it", SUPERVISORS: "Supervisors only" } },
  shareWorkers: { label: "Share workers with linked companies", options: { NONE: "No", ALL: "All", SELECTED: "Selected" } },
};
const PUNCH_SWITCHES: Record<string, string> = {
  unassignedSelfie: "Selfie at sites the worker is not assigned to",
  notifyRoster: "Tell workers when the roster changes",
  groupJobClocking: "Crew clock-in on jobs",
  photoAtFirstLogin: "Photo at first sign-in",
  baseClocking: "Clock in at the base",
};

function Rules({ me }: { me: FieldMe }) {
  const { get, send } = useFieldApi();
  const qc = useQueryClient();
  const admin = me.access.admin;
  const [tab, setTab] = React.useState(0);
  const rules = useQuery({ queryKey: ["field-rules"], queryFn: () => get<any>("/field/reports/rules") });
  const sites = useQuery({ queryKey: ["field-sites-pick"], queryFn: () => get<any>("/field/people/sites") });
  const terms = useQuery({ queryKey: ["field-terms"], queryFn: () => get<any>("/field/reports/terms"), enabled: tab === 2 });
  const siteName = (id: string | null) => (id ? (sites.data?.sites ?? []).find((s: any) => s.id === id)?.name ?? "A site" : "Whole company");
  const [ot, setOt] = React.useState<any | null>(null);
  const [br, setBr] = React.useState<any | null>(null);
  const [punch, setPunch] = React.useState<any | null>(null);
  const [text, setText] = React.useState<string | null>(null);
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => {
    if (rules.data && !punch) setPunch(rules.data.punch);
  }, [rules.data, punch]);
  React.useEffect(() => {
    if (terms.data && text === null) setText(terms.data.text ?? "");
  }, [terms.data, text]);

  const save = async (fn: () => Promise<any>, after?: () => void) => {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      after?.();
      await Promise.all([qc.invalidateQueries({ queryKey: ["field-rules"] }), qc.invalidateQueries({ queryKey: ["field-terms"] })]);
      setMsg({ ok: true, text: "Saved" });
    } catch (e: any) {
      setMsg({ ok: false, text: e?.message || "Could not save" });
    } finally {
      setBusy(false);
    }
  };
  const num = (v: string) => (v === "" ? null : Number(v));

  return (
    <>
      {msg && <Alert severity={msg.ok ? "success" : "error"} sx={{ mb: 2 }} onClose={() => setMsg(null)}>{msg.text}</Alert>}
      {!admin && <Alert severity="info" sx={{ mb: 2 }}>Only an Admin changes the rules.</Alert>}
      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 2 }}>
        <Tab label="Overtime and breaks" />
        <Tab label="Clock-in rules" />
        <Tab label="Worker terms" />
      </Tabs>

      {tab === 0 && (
        <Stack gap={3}>
          <PageTable
            columns={[
              { id: "s", header: "Overtime", cell: ({ row }: any) => siteName(row.original.siteId) },
              { id: "t", header: "OT after (h)", cell: ({ row }: any) => (row.original.dailyThresholdMin / 60).toFixed(2) },
              { id: "m", header: "OT rate", cell: ({ row }: any) => `x${row.original.otMultiplier}` },
              { id: "c", header: "Weekly OT cap (min)", cell: ({ row }: any) => row.original.weeklyCapOtMin ?? "" },
              { id: "e", header: "Early arrival", cell: ({ row }: any) => row.original.earlyMode ?? (row.original.countEarlyAsWork ? "pay" : "clamp") },
            ] as any}
            data={rules.data?.overtime ?? []}
            tableName="Overtime rules"
            loading={rules.isLoading}
            clientPaging
            noSelectionColumn
            onRowClick={admin ? (r: any) => setOt({ siteId: r.siteId, dailyThresholdMin: String(r.dailyThresholdMin), otMultiplier: String(r.otMultiplier), weeklyCapOtMin: r.weeklyCapOtMin == null ? "" : String(r.weeklyCapOtMin), earlyMode: r.earlyMode ?? "clamp" }) : undefined}
          />
          {admin && (
            <Button sx={{ alignSelf: "flex-start" }} variant="outlined" onClick={() => setOt({ siteId: "", dailyThresholdMin: "528", otMultiplier: "1.5", weeklyCapOtMin: "", earlyMode: "clamp" })}>
              Add an overtime rule for a site
            </Button>
          )}
          {ot && (
            <Stack gap={2} direction="row" flexWrap="wrap" alignItems="center">
              <TextField size="small" select label="For" value={ot.siteId ?? ""} onChange={(e) => setOt({ ...ot, siteId: e.target.value || null })} sx={{ minWidth: 180 }}>
                <MenuItem value="">Whole company</MenuItem>
                {(sites.data?.sites ?? []).map((s: any) => (
                  <MenuItem key={s.id} value={s.id}>{s.name}</MenuItem>
                ))}
              </TextField>
              <TextField size="small" label="OT after (min)" value={ot.dailyThresholdMin} onChange={(e) => setOt({ ...ot, dailyThresholdMin: e.target.value })} />
              <TextField size="small" label="OT rate (x)" value={ot.otMultiplier} onChange={(e) => setOt({ ...ot, otMultiplier: e.target.value })} />
              <TextField size="small" label="Weekly OT cap (min)" value={ot.weeklyCapOtMin} onChange={(e) => setOt({ ...ot, weeklyCapOtMin: e.target.value })} />
              <TextField size="small" select label="Early arrival" value={ot.earlyMode} onChange={(e) => setOt({ ...ot, earlyMode: e.target.value })}>
                <MenuItem value="clamp">Counts from the shift start</MenuItem>
                <MenuItem value="pay">Paid from arrival</MenuItem>
                <MenuItem value="slide">The shift moves with arrival</MenuItem>
              </TextField>
              <Button variant="contained" disableElevation disabled={busy} onClick={() => save(() => send("/field/reports/rules/overtime", "PUT", { siteId: ot.siteId || null, dailyThresholdMin: Number(ot.dailyThresholdMin), otMultiplier: Number(ot.otMultiplier), weeklyCapOtMin: num(ot.weeklyCapOtMin), earlyMode: ot.earlyMode }), () => setOt(null))}>Save</Button>
              <Button onClick={() => setOt(null)}>Cancel</Button>
            </Stack>
          )}
          <PageTable
            columns={[
              { id: "s", header: "Breaks", cell: ({ row }: any) => siteName(row.original.siteId) },
              { id: "d", header: "Break taken off (min)", cell: ({ row }: any) => row.original.deductMinutes },
              { id: "m", header: "For shifts over (min)", cell: ({ row }: any) => row.original.minShiftMinutes },
              { id: "n", header: "No-lunch-break credit (min)", cell: ({ row }: any) => row.original.nlbCreditMinutes },
            ] as any}
            data={rules.data?.breaks ?? []}
            tableName="Break rules"
            loading={rules.isLoading}
            clientPaging
            noSelectionColumn
            onRowClick={admin ? (r: any) => setBr({ siteId: r.siteId, deductMinutes: String(r.deductMinutes), minShiftMinutes: String(r.minShiftMinutes), nlbCreditMinutes: String(r.nlbCreditMinutes) }) : undefined}
          />
          {admin && (
            <Button sx={{ alignSelf: "flex-start" }} variant="outlined" onClick={() => setBr({ siteId: "", deductMinutes: "60", minShiftMinutes: "360", nlbCreditMinutes: "0" })}>
              Add a break rule for a site
            </Button>
          )}
          {br && (
            <Stack gap={2} direction="row" flexWrap="wrap" alignItems="center">
              <TextField size="small" select label="For" value={br.siteId ?? ""} onChange={(e) => setBr({ ...br, siteId: e.target.value || null })} sx={{ minWidth: 180 }}>
                <MenuItem value="">Whole company</MenuItem>
                {(sites.data?.sites ?? []).map((s: any) => (
                  <MenuItem key={s.id} value={s.id}>{s.name}</MenuItem>
                ))}
              </TextField>
              <TextField size="small" label="Break taken off (min)" value={br.deductMinutes} onChange={(e) => setBr({ ...br, deductMinutes: e.target.value })} />
              <TextField size="small" label="For shifts over (min)" value={br.minShiftMinutes} onChange={(e) => setBr({ ...br, minShiftMinutes: e.target.value })} />
              <TextField size="small" label="No-lunch-break credit (min)" value={br.nlbCreditMinutes} onChange={(e) => setBr({ ...br, nlbCreditMinutes: e.target.value })} />
              <Button variant="contained" disableElevation disabled={busy} onClick={() => save(() => send("/field/reports/rules/breaks", "PUT", { siteId: br.siteId || null, deductMinutes: Number(br.deductMinutes), minShiftMinutes: Number(br.minShiftMinutes), nlbCreditMinutes: Number(br.nlbCreditMinutes) }), () => setBr(null))}>Save</Button>
              <Button onClick={() => setBr(null)}>Cancel</Button>
            </Stack>
          )}
        </Stack>
      )}

      {tab === 1 && punch && (
        <Stack gap={2} sx={{ maxWidth: 560 }}>
          {Object.entries(PUNCH_CHOICES).map(([k, c]) => (
            <TextField key={k} select size="small" label={c.label} value={punch[k] ?? ""} disabled={!admin} onChange={(e) => setPunch({ ...punch, [k]: e.target.value })}>
              {Object.entries(c.options).map(([v, l]) => (
                <MenuItem key={v} value={v}>{l}</MenuItem>
              ))}
            </TextField>
          ))}
          <Stack direction="row" gap={2}>
            <TextField size="small" label="Crew window before the job (min)" value={punch.crewMarginBeforeMin ?? 0} disabled={!admin} onChange={(e) => setPunch({ ...punch, crewMarginBeforeMin: Number(e.target.value.replace(/\D/g, "")) })} />
            <TextField size="small" label="After the job (min)" value={punch.crewMarginAfterMin ?? 0} disabled={!admin} onChange={(e) => setPunch({ ...punch, crewMarginAfterMin: Number(e.target.value.replace(/\D/g, "")) })} />
          </Stack>
          {Object.entries(PUNCH_SWITCHES).map(([k, l]) => (
            <FormControlLabel key={k} label={l} control={<Switch checked={!!punch[k]} disabled={!admin} onChange={(e) => setPunch({ ...punch, [k]: e.target.checked })} />} />
          ))}
          <Typography variant="body2" color="text.secondary">These rules apply to the worker app. Until the AIMS app is live, the SiteClock app keeps its own.</Typography>
          {admin && (
            <Button sx={{ alignSelf: "flex-start" }} variant="contained" disableElevation disabled={busy} onClick={() => save(() => send("/field/reports/rules/punch", "PUT", punch))}>
              Save
            </Button>
          )}
        </Stack>
      )}

      {tab === 2 && (
        <Stack gap={2}>
          <TextField multiline minRows={8} label={`Terms (version ${terms.data?.version ?? 0})`} value={text ?? ""} disabled={!admin} onChange={(e) => setText(e.target.value)} />
          {admin && (
            <Stack direction="row" gap={1}>
              <Button variant="contained" disableElevation disabled={busy || (text ?? "").length < 20} onClick={() => save(() => send("/field/reports/terms", "PUT", { text, reaccept: true }))}>
                Save, everyone accepts again
              </Button>
              <Button disabled={busy || (text ?? "").length < 20} onClick={() => save(() => send("/field/reports/terms", "PUT", { text, reaccept: false }))}>
                Save a small fix
              </Button>
            </Stack>
          )}
          <PageTable
            columns={[
              { id: "n", header: "Worker", cell: ({ row }: any) => row.original.name },
              { id: "v", header: "Accepted", cell: ({ row }: any) => (row.original.acceptedVersion ? `Version ${row.original.acceptedVersion}${row.original.current ? "" : " (old)"}` : "Not yet") },
              { id: "a", header: "On", cell: ({ row }: any) => (row.original.acceptedAt ? new Date(row.original.acceptedAt).toLocaleString("en-SG") : "") },
            ] as any}
            data={(terms.data?.acceptances ?? []).map((a: any) => ({ ...a, id: a.workerId }))}
            tableName="Accepted by"
            loading={terms.isLoading}
            clientPaging
            noSelectionColumn
          />
        </Stack>
      )}
    </>
  );
}
