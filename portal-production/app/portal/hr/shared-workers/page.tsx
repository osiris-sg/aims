"use client";

// HR > Shared workers (SiteClock web SharedWorkers.tsx @62b7d9d): hours worked across linked organisations.
// "Their workers on our jobs" and "Our workers on their jobs", for a date range (at most 92 days).
import * as React from "react";
import { Alert, Stack, Tab, Tabs, TextField } from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import PageTable from "@/components/PageTable";
import FieldGate from "../_components/FieldGate";
import { useFieldApi } from "../_lib/useField";

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const hm = (m: number | null | undefined) => (m == null ? "" : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min`);

export default function HrSharedWorkersPage() {
  return <FieldGate area="timesheets" title="Shared workers">{() => <SharedWorkers />}</FieldGate>;
}

function SharedWorkers() {
  const { get } = useFieldApi();
  const [tab, setTab] = React.useState(0);
  const [f, setF] = React.useState(() => ({ from: iso(new Date(Date.now() - 13 * 86400_000)), to: iso(new Date()) }));
  const direction = tab === 1 ? "lent" : "borrowed";
  const q = useQuery({
    queryKey: ["field-linked", f.from, f.to, direction],
    queryFn: () => get<{ rows: any[] }>(`/field/timesheets/linked?from=${f.from}&to=${f.to}&direction=${direction}`),
    enabled: !!f.from && !!f.to,
  });
  const cols = [
    { id: "date", header: "Date", cell: ({ row }: any) => row.original.workDate },
    { id: "who", header: "Worker", cell: ({ row }: any) => row.original.name },
    { id: "org", header: tab === 1 ? "Worked for" : "Their organisation", cell: ({ row }: any) => row.original.organizationName },
    { id: "min", header: tab === 1 ? "On their jobs" : "On our jobs", cell: ({ row }: any) => hm(row.original.minutes) },
    { id: "gross", header: "Whole day", cell: ({ row }: any) => hm(row.original.grossMinutes) },
  ];
  return (
    <Stack gap={2}>
      <Stack direction="row" gap={1.5} flexWrap="wrap">
        <TextField type="date" label="From" InputLabelProps={{ shrink: true }} value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} />
        <TextField type="date" label="To" InputLabelProps={{ shrink: true }} value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} />
      </Stack>
      {q.error && <Alert severity="error">{(q.error as Error).message}</Alert>}
      <Tabs value={tab} onChange={(_, v) => setTab(v)}>
        <Tab label="Their workers on our jobs" />
        <Tab label="Our workers on their jobs" />
      </Tabs>
      <PageTable
        columns={cols as any}
        data={(q.data?.rows ?? []).map((r: any) => ({ ...r, id: `${r.entryId}-${r.organizationId}` }))}
        tableName="Shared hours"
        loading={q.isLoading}
        clientPaging
        noSelectionColumn
      />
    </Stack>
  );
}
