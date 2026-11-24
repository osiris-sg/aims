"use client";

// Field > Payroll (FIELD_PLAN.md phase 6; ported from SiteClock web Payroll.tsx @62b7d9d). The month's pay from
// approved time and leave (SG MOM / IPA model, no CPF, same as SiteClock), pay profiles, public holidays, a
// worker's payslip, and Print / Export. SiteClock rules kept and said: monthly salary is not prorated, admins are
// left out, payroll counts working days.
import * as React from "react";
import {
  Alert, Button, Checkbox, Chip, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, IconButton, MenuItem, Stack, Switch, Tab, Tabs, TextField, Typography,
} from "@mui/material";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import PageTable from "@/components/PageTable";
import { ReportPrintExportButton, type ReportExportModel } from "@/app/portal/accounting/_lib/report-export";
import { useOrganization } from "@/app/portal/hooks/useOrganization";
import { fieldAtLeast } from "@/helpers/fieldModule";
import { DAY_NAMES } from "@/helpers/fieldJobs";
import { PAY_TYPE_LABEL, PREMIUM_LABEL, hours, money, profileBody, profileForm } from "@/helpers/fieldPayroll";
import { todayIso } from "@/helpers/orgToday";
import FieldGate from "../_components/FieldGate";
import { useFieldApi, type FieldMe } from "../_lib/useField";

export default function FieldPayrollPage() {
  return <FieldGate area="payroll" title="Payroll">{(me) => <Payroll me={me} />}</FieldGate>;
}

function Payroll({ me }: { me: FieldMe }) {
  const { get, send } = useFieldApi();
  const qc = useQueryClient();
  const { organization } = useOrganization();
  const canEdit = fieldAtLeast(me.access.levels.payroll, "edit");
  const [tab, setTab] = React.useState(0);
  const [month, setMonth] = React.useState(todayIso().slice(0, 7));
  const [year, setYear] = React.useState(todayIso().slice(0, 4));
  const run_ = useQuery({ queryKey: ["field-payroll", month], queryFn: () => get<any>(`/field/payroll?month=${month}`) });
  const exportRows = useQuery({ queryKey: ["field-payroll-export", month], queryFn: () => get<{ headers: string[]; rows: string[][] }>(`/field/payroll/export?month=${month}`) });
  const holidays = useQuery({ queryKey: ["field-holidays", year], queryFn: () => get<{ holidays: any[] }>(`/field/payroll/holidays?year=${year}`), enabled: tab === 1 });
  const [slip, setSlip] = React.useState<any | null>(null);
  const [prof, setProf] = React.useState<{ workerId: string; name: string; f: any; rates?: any } | null>(null);
  const [hol, setHol] = React.useState<{ date: string; name: string } | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const run = async (fn: () => Promise<any>, done?: (o: any) => void) => {
    setBusy(true);
    setError(null);
    try {
      const o = await fn();
      done?.(o);
      await Promise.all(["field-payroll", "field-payroll-export", "field-holidays"].map((k) => qc.invalidateQueries({ queryKey: [k] })));
    } catch (e: any) {
      setError(e?.message || "Could not save");
    } finally {
      setBusy(false);
    }
  };

  const model = (): ReportExportModel | null =>
    exportRows.data
      ? { title: "PAYROLL", orgName: organization?.name ?? "", metaLines: [`Month ${month}`, "Approved time and leave only. No CPF."], tables: [{ headers: exportRows.data.headers, rows: exportRows.data.rows }], landscape: true }
      : null;

  const openProfile = async (w: any) => {
    try {
      const p = await get<any>(`/field/payroll/profiles/${w.workerId}`);
      setProf({ workerId: w.workerId, name: w.name, f: profileForm(p.profile), rates: p.rates });
    } catch (e: any) {
      setError(e?.message || "Could not load the pay profile");
    }
  };

  const columns = [
    { id: "name", header: "Worker", cell: ({ row }: any) => (<Stack direction="row" gap={1}><span>{row.original.name}</span>{!row.original.hasProfile && <Chip size="small" color="warning" variant="outlined" label="No pay profile" />}</Stack>) },
    { id: "type", header: "Pay", cell: ({ row }: any) => PAY_TYPE_LABEL[row.original.payType] },
    { id: "days", header: "Days", cell: ({ row }: any) => row.original.daysWorked },
    { id: "reg", header: "Regular h", cell: ({ row }: any) => hours(row.original.regularMinutes) },
    { id: "ot", header: "OT h", cell: ({ row }: any) => hours(row.original.otMinutes) },
    { id: "otpay", header: "OT pay", cell: ({ row }: any) => money(row.original.otPayCents) },
    { id: "prem", header: "PH / rest days", cell: ({ row }: any) => (row.original.premiumDays.length ? `${row.original.premiumDays.length}, ${money(row.original.premiumPayCents)}` : "") },
    { id: "leave", header: "Leave", cell: ({ row }: any) => row.original.leaveDays.map((l: any) => `${l.days} ${l.type}${l.paid ? "" : " (unpaid)"}`).join(", ") },
    { id: "gross", header: "Gross", cell: ({ row }: any) => money(row.original.grossCents) },
    { id: "ded", header: "Deductions", cell: ({ row }: any) => money(row.original.deductionCents) },
    { id: "net", header: "Net", cell: ({ row }: any) => <b>{money(row.original.netCents)}</b> },
  ];
  const rows = (run_.data?.workers ?? []).map((w: any) => ({ ...w, id: w.workerId }));

  return (
    <>
      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}
      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 2 }}>
        <Tab label="Month" />
        <Tab label="Public holidays" />
      </Tabs>
      {tab === 0 && (
        <>
          <Stack direction="row" gap={1} alignItems="center" sx={{ mb: 2 }} flexWrap="wrap">
            <TextField size="small" type="month" label="Month" InputLabelProps={{ shrink: true }} value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} />
            <ReportPrintExportButton getModel={model} size="medium" />
          </Stack>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            As in SiteClock: a monthly salary is paid in full for any part of the month, and leave counts working days.
            {run_.data?.leftOut?.length ? ` Admins are left out: ${run_.data.leftOut.map((x: any) => x.name).join(", ")}.` : ""}
          </Typography>
          <PageTable columns={columns as any} data={rows} tableName={`Payroll ${month}`} loading={run_.isLoading} clientPaging noSelectionColumn onRowClick={(w: any) => setSlip(w)} />
        </>
      )}
      {tab === 1 && (
        <>
          <Stack direction="row" gap={1} sx={{ mb: 2 }}>
            <TextField size="small" label="Year" value={year} onChange={(e) => setYear(e.target.value.replace(/\D/g, "").slice(0, 4))} sx={{ width: 120 }} />
            {canEdit && <Button variant="outlined" onClick={() => setHol({ date: `${year}-01-01`, name: "" })}>Add a holiday</Button>}
          </Stack>
          <PageTable
            columns={[
              { id: "date", header: "Date", cell: ({ row }: any) => row.original.date },
              { id: "name", header: "Holiday", cell: ({ row }: any) => row.original.name },
              {
                id: "del",
                header: "",
                cell: ({ row }: any) =>
                  canEdit ? (
                    <IconButton size="small" color="error" disabled={busy} onClick={() => window.confirm(`Remove ${row.original.name}?`) && void run(() => send(`/field/payroll/holidays/${row.original.id}`, "DELETE"))}>
                      <DeleteOutlineIcon fontSize="small" />
                    </IconButton>
                  ) : null,
              },
            ] as any}
            data={holidays.data?.holidays ?? []}
            tableName="Public holidays"
            loading={holidays.isLoading}
            clientPaging
            noSelectionColumn
          />
        </>
      )}

      <Dialog open={!!slip} onClose={() => setSlip(null)} maxWidth="sm" fullWidth>
        <DialogTitle>{slip ? `${slip.name}, payslip ${month}` : ""}</DialogTitle>
        <DialogContent dividers>
          {slip && (
            <Stack gap={0.75}>
              <Typography>{PAY_TYPE_LABEL[slip.payType]}; daily rate {money(slip.dailyRateCents)}; OT {money(slip.otRateCents)} an hour</Typography>
              <Typography>Basic: {money(slip.basicPayCents)} ({slip.daysWorked} days, {hours(slip.regularMinutes)} regular hours)</Typography>
              <Typography>Allowance: {money(slip.profile.fixedAllowanceCents)}</Typography>
              <Typography>OT: {money(slip.otPayCents)} ({hours(slip.otPaidMinutes)} of {hours(slip.otMinutes)} hours paid{slip.weekdayOt ? "" : "; weekday OT is not paid"})</Typography>
              <Typography>Public holidays and rest days: {money(slip.premiumPayCents)} ({slip.premiumDays.map((d: any) => `${d.date}${d.name ? ` ${d.name}` : ""}`).join(", ") || "none"}; {PREMIUM_LABEL[slip.premiumMode]})</Typography>
              <Typography>Leave: {slip.leaveDays.map((l: any) => `${l.days} ${l.type}${l.paid ? "" : " unpaid"}`).join(", ") || "none"}{slip.unpaidLeaveDeductCents ? `; unpaid leave ${money(slip.unpaidLeaveDeductCents)}` : ""}</Typography>
              <Typography>Deductions: {money(slip.deductionCents)}</Typography>
              <Typography sx={{ fontWeight: 700, mt: 1 }}>Gross {money(slip.grossCents)}, net {money(slip.netCents)}</Typography>
              <Typography variant="body2" color="text.secondary">{slip.payslipVisible ? "The worker can see this payslip in the app." : "Not shown to the worker in the app."}</Typography>
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          {canEdit && slip && <Button onClick={() => { const s = slip; setSlip(null); void openProfile(s); }}>Pay profile</Button>}
          <Button onClick={() => setSlip(null)}>Close</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={!!prof} onClose={() => !busy && setProf(null)} maxWidth="sm" fullWidth>
        <DialogTitle>{prof?.name}: pay profile</DialogTitle>
        <DialogContent dividers>
          {prof && (
            <Stack gap={2}>
              <TextField select label="Pay" value={prof.f.payType} onChange={(e) => setProf({ ...prof, f: { ...prof.f, payType: e.target.value } })}>
                {Object.entries(PAY_TYPE_LABEL).map(([v, l]) => (
                  <MenuItem key={v} value={v}>{l}</MenuItem>
                ))}
              </TextField>
              {prof.f.payType === "MONTHLY" && <TextField label="Basic a month ($)" value={prof.f.basicMonthly} onChange={(e) => setProf({ ...prof, f: { ...prof.f, basicMonthly: e.target.value } })} />}
              {prof.f.payType === "HOURLY" && <TextField label="Rate an hour ($)" value={prof.f.hourlyRate} onChange={(e) => setProf({ ...prof, f: { ...prof.f, hourlyRate: e.target.value } })} />}
              <Stack direction="row" gap={2}>
                <TextField label={prof.f.payType === "DAILY" ? "Rate a day ($)" : "Daily rate ($, blank = worked out)"} value={prof.f.dailyRateOverride} onChange={(e) => setProf({ ...prof, f: { ...prof.f, dailyRateOverride: e.target.value } })} />
                <TextField label="OT rate an hour ($, blank = worked out)" value={prof.f.otRateOverride} onChange={(e) => setProf({ ...prof, f: { ...prof.f, otRateOverride: e.target.value } })} />
              </Stack>
              <TextField label="Working days a week" value={prof.f.workDaysPerWeek} onChange={(e) => setProf({ ...prof, f: { ...prof.f, workDaysPerWeek: e.target.value.replace(/\D/g, "").slice(0, 1) } })} />
              <Stack direction="row" flexWrap="wrap" alignItems="center">
                <Typography sx={{ mr: 1 }}>Off days</Typography>
                {DAY_NAMES.map((d, i) => (
                  <FormControlLabel key={d} label={d}
                    control={<Checkbox checked={prof.f.restDays.includes(i + 1)} onChange={() => setProf({ ...prof, f: { ...prof.f, restDays: prof.f.restDays.includes(i + 1) ? prof.f.restDays.filter((x: number) => x !== i + 1) : [...prof.f.restDays, i + 1] } })} />} />
                ))}
              </Stack>
              <TextField select label="A public holiday or off day worked" value={prof.f.premiumMode} onChange={(e) => setProf({ ...prof, f: { ...prof.f, premiumMode: e.target.value } })}>
                {Object.entries(PREMIUM_LABEL).map(([v, l]) => (
                  <MenuItem key={v} value={v}>{l}</MenuItem>
                ))}
              </TextField>
              {prof.f.premiumMode === "FIXED_HOURLY" && <TextField label="Fixed rate an hour ($)" value={prof.f.premiumRate} onChange={(e) => setProf({ ...prof, f: { ...prof.f, premiumRate: e.target.value } })} />}
              <FormControlLabel control={<Switch checked={!!prof.f.weekdayOt} onChange={(e) => setProf({ ...prof, f: { ...prof.f, weekdayOt: e.target.checked } })} />} label="Pay OT on ordinary days" />
              <Stack direction="row" gap={2}>
                <TextField label="Allowance a month ($)" value={prof.f.fixedAllowance} onChange={(e) => setProf({ ...prof, f: { ...prof.f, fixedAllowance: e.target.value } })} />
                <TextField label="Housing deduction ($)" value={prof.f.deductHousing} onChange={(e) => setProf({ ...prof, f: { ...prof.f, deductHousing: e.target.value } })} />
                <TextField label="Other deduction ($)" value={prof.f.deductOther} onChange={(e) => setProf({ ...prof, f: { ...prof.f, deductOther: e.target.value } })} />
              </Stack>
              {prof.rates && <Typography variant="body2" color="text.secondary">Now: daily {money(prof.rates.dailyRateCents)}, OT {money(prof.rates.otRateCents)} an hour.</Typography>}
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setProf(null)} disabled={busy}>Cancel</Button>
          <Button variant="contained" disableElevation disabled={busy} onClick={() => prof && void run(() => send(`/field/payroll/profiles/${prof.workerId}`, "PUT", profileBody(prof.f)), () => setProf(null))}>
            Save
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={!!hol} onClose={() => !busy && setHol(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Add a public holiday</DialogTitle>
        <DialogContent dividers>
          {hol && (
            <Stack gap={2}>
              <TextField type="date" label="Date" InputLabelProps={{ shrink: true }} value={hol.date} onChange={(e) => setHol({ ...hol, date: e.target.value })} />
              <TextField label="Name" value={hol.name} onChange={(e) => setHol({ ...hol, name: e.target.value })} inputProps={{ maxLength: 100 }} />
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setHol(null)} disabled={busy}>Cancel</Button>
          <Button variant="contained" disableElevation disabled={busy || !hol?.name.trim()} onClick={() => hol && void run(() => send(`/field/payroll/holidays`, "POST", { date: hol.date, name: hol.name.trim() }), () => setHol(null))}>
            Save
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
