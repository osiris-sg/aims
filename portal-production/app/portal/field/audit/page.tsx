"use client";

// Field > Audit log (FIELD_PLAN.md phase 7): Field changes from the Activity Log, plus SiteClock's own history
// brought over by the shadow import. Read only.
import * as React from "react";
import { MenuItem, Stack, TextField } from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import PageTable from "@/components/PageTable";
import { todayIso } from "@/helpers/orgToday";
import FieldGate from "../_components/FieldGate";
import { useFieldApi } from "../_lib/useField";

export default function FieldAuditPage() {
  return <FieldGate area="reports" title="Audit log">{() => <Audit />}</FieldGate>;
}

function Audit() {
  const { get } = useFieldApi();
  const d30 = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);
  const [from, setFrom] = React.useState(d30);
  const [to, setTo] = React.useState(todayIso());
  const [source, setSource] = React.useState("");
  const q = useQuery({ queryKey: ["field-audit", from, to, source], queryFn: () => get<any>(`/field/reports/audit?from=${from}&to=${to}${source ? `&source=${source}` : ""}`) });
  return (
    <>
      <Stack direction="row" gap={1} sx={{ mb: 2 }} flexWrap="wrap">
        <TextField size="small" type="date" label="From" InputLabelProps={{ shrink: true }} value={from} onChange={(e) => setFrom(e.target.value)} />
        <TextField size="small" type="date" label="To" InputLabelProps={{ shrink: true }} value={to} onChange={(e) => setTo(e.target.value)} />
        <TextField size="small" select label="From where" value={source} onChange={(e) => setSource(e.target.value)} sx={{ minWidth: 160 }}>
          <MenuItem value="">Both</MenuItem>
          <MenuItem value="aims">AIMS</MenuItem>
          <MenuItem value="siteclock">SiteClock history</MenuItem>
        </TextField>
      </Stack>
      <PageTable
        columns={[
          { id: "at", header: "When", cell: ({ row }: any) => new Date(row.original.at).toLocaleString("en-SG") },
          { id: "who", header: "Who", cell: ({ row }: any) => row.original.actor ?? "" },
          { id: "act", header: "Action", cell: ({ row }: any) => row.original.action },
          { id: "ent", header: "Record", cell: ({ row }: any) => [row.original.entity, row.original.entityId].filter(Boolean).join(" ") },
          { id: "src", header: "Where", cell: ({ row }: any) => row.original.source },
        ] as any}
        data={q.data?.rows ?? []}
        tableName="Field audit log"
        loading={q.isLoading}
        clientPaging
        noSelectionColumn
      />
    </>
  );
}
