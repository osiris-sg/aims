"use client";

// Field > Reports (FIELD_PLAN.md phase 7; SiteClock reports.router @62b7d9d): the attendance report (a row per worker,
// a verdict per day, 1 to 92 days), the per-site summary and the flagged clock-ins. Print / Export per the report
// standard. Oddity kept and said: the flags count days in UTC, as in SiteClock.
import * as React from "react";
import { Alert, Button, MenuItem, Stack, Tab, Tabs, TextField, Typography } from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import PageTable from "@/components/PageTable";
import { ReportPrintExportButton, type ReportExportModel } from "@/app/portal/accounting/_lib/report-export";
import { useOrganization } from "@/app/portal/hooks/useOrganization";
import { todayIso } from "@/helpers/orgToday";
import FieldGate from "../_components/FieldGate";
import { useFieldApi, type FieldMe } from "../_lib/useField";

const monthStart = () => `${todayIso().slice(0, 7)}-01`;
const h = (min: number) => (min / 60).toFixed(2);

export default function FieldReportsPage() {
  return <FieldGate area="reports" title="Reports">{(me) => <Reports me={me} />}</FieldGate>;
}

function Reports({ me }: { me: FieldMe }) {
  void me;
  const { get } = useFieldApi();
  const { organization } = useOrganization();
  const [tab, setTab] = React.useState(0);
  const [from, setFrom] = React.useState(monthStart());
  const [to, setTo] = React.useState(todayIso());
  const [siteId, setSiteId] = React.useState("");
  const [run, setRun] = React.useState<{ from: string; to: string; siteId: string } | null>({ from: monthStart(), to: todayIso(), siteId: "" });
  const sites = useQuery({ queryKey: ["field-sites-pick"], queryFn: () => get<any>("/field/people/sites") });
  const qs = run ? `from=${run.from}&to=${run.to}` : "";
  const att = useQuery({ queryKey: ["field-att", run], queryFn: () => get<any>(`/field/reports/attendance?${qs}${run?.siteId ? `&siteId=${run.siteId}` : ""}`), enabled: !!run && tab === 0, retry: false });
  const sum = useQuery({ queryKey: ["field-sum", run], queryFn: () => get<any>(`/field/reports/summary?${qs}`), enabled: !!run && tab === 1, retry: false });
  const fraud = useQuery({ queryKey: ["field-fraud", run], queryFn: () => get<any>(`/field/reports/fraud?${qs}`), enabled: !!run && tab === 2, retry: false });
  const err = (tab === 0 ? att.error : tab === 1 ? sum.error : fraud.error) as Error | null;
  const siteList: any[] = sites.data?.sites ?? sites.data ?? [];
  const meta = run ? [`${run.from} to ${run.to}`] : [];

  const model = (): ReportExportModel | null => {
    if (tab === 0 && att.data) return { title: att.data.title, orgName: organization?.name ?? "", metaLines: meta, tables: [{ headers: att.data.headers, rows: att.data.rows }], landscape: true };
    if (tab === 1 && sum.data)
      return { title: "ATTENDANCE BY SITE", orgName: organization?.name ?? "", metaLines: meta, tables: [{ headers: ["Site", "Entries", "Workers", "Regular h", "OT h", "Late count", "Late min"], rows: sum.data.summary.map((s: any) => [s.siteName, s.entries, s.uniqueWorkers, h(s.totalRegularMin), h(s.totalOtMin), s.lateCount, s.totalLateMin].map(String)) }] };
    if (tab === 2 && fraud.data)
      return {
        title: "FLAGGED CLOCK-INS",
        orgName: organization?.name ?? "",
        metaLines: [...meta, "Days counted in UTC, as in SiteClock"],
        tables: [
          { heading: "By reason", headers: ["Reason", "Count"], rows: Object.entries(fraud.data.byReason).map(([k, v]) => [k, String(v)]) },
          { heading: "Most flagged workers", headers: ["Worker", "Flags"], rows: fraud.data.topWorkers.map((w: any) => [w.name, String(w.flags)]) },
        ],
      };
    return null;
  };

  const attCols = (att.data?.headers ?? []).map((hd: string, i: number) => ({ id: `c${i}`, header: hd, cell: ({ row }: any) => row.original.cells[i] }));
  return (
    <>
      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 2 }}>
        <Tab label="Attendance" />
        <Tab label="By site" />
        <Tab label="Flagged clock-ins" />
      </Tabs>
      <Stack direction="row" gap={1} alignItems="center" flexWrap="wrap" sx={{ mb: 2 }}>
        <TextField size="small" type="date" label="From" InputLabelProps={{ shrink: true }} value={from} onChange={(e) => setFrom(e.target.value)} />
        <TextField size="small" type="date" label="To" InputLabelProps={{ shrink: true }} value={to} onChange={(e) => setTo(e.target.value)} />
        {tab === 0 && (
          <TextField size="small" select label="Site" value={siteId} onChange={(e) => setSiteId(e.target.value)} sx={{ minWidth: 180 }}>
            <MenuItem value="">All my sites</MenuItem>
            {siteList.map((s: any) => (
              <MenuItem key={s.id} value={s.id}>{s.name}</MenuItem>
            ))}
          </TextField>
        )}
        <Button variant="contained" disableElevation onClick={() => setRun({ from, to, siteId })}>Show</Button>
        <ReportPrintExportButton getModel={model} size="medium" />
      </Stack>
      {err && <Alert severity="error" sx={{ mb: 2 }}>{err.message}</Alert>}
      {tab === 0 && <PageTable columns={attCols as any} data={(att.data?.rows ?? []).map((cells: string[], i: number) => ({ id: String(i), cells }))} tableName="Attendance" loading={att.isLoading} clientPaging noSelectionColumn />}
      {tab === 1 && (
        <PageTable
          columns={[
            { id: "s", header: "Site", cell: ({ row }: any) => row.original.siteName },
            { id: "e", header: "Entries", cell: ({ row }: any) => row.original.entries },
            { id: "w", header: "Workers", cell: ({ row }: any) => row.original.uniqueWorkers },
            { id: "r", header: "Regular h", cell: ({ row }: any) => h(row.original.totalRegularMin) },
            { id: "o", header: "OT h", cell: ({ row }: any) => h(row.original.totalOtMin) },
            { id: "l", header: "Late", cell: ({ row }: any) => `${row.original.lateCount} (${row.original.totalLateMin} min)` },
          ] as any}
          data={(sum.data?.summary ?? []).map((s: any) => ({ ...s, id: s.siteId }))}
          tableName="By site"
          loading={sum.isLoading}
          clientPaging
          noSelectionColumn
        />
      )}
      {tab === 2 && fraud.data && (
        <Stack gap={2}>
          <Alert severity="warning">As in SiteClock, days here are counted in UTC: a clock-in before 8am Singapore time falls on the day before.</Alert>
          <Typography>{fraud.data.total} flagged. {Object.entries(fraud.data.byReason).map(([k, v]) => `${k}: ${v}`).join(", ")}</Typography>
          <PageTable
            columns={[
              { id: "n", header: "Worker", cell: ({ row }: any) => row.original.name },
              { id: "f", header: "Flags", cell: ({ row }: any) => row.original.flags },
            ] as any}
            data={fraud.data.topWorkers.map((w: any) => ({ ...w, id: w.workerId }))}
            tableName="Most flagged workers"
            loading={false}
            clientPaging
            noSelectionColumn
          />
        </Stack>
      )}
    </>
  );
}
