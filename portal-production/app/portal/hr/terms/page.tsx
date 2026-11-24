"use client";

// HR > Terms (SiteClock web Terms.tsx @62b7d9d): the terms workers accept in the app, and who has accepted
// the current version. Only an Admin changes the text; a new version asks everyone to accept again.
import * as React from "react";
import { Alert, Button, Chip, Stack, TextField, Typography } from "@mui/material";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import PageTable from "@/components/PageTable";
import FieldGate from "../_components/FieldGate";
import { useFieldApi, type FieldMe } from "../_lib/useField";

export default function HrTermsPage() {
  return <FieldGate area="reports" title="Terms">{(me) => <Terms me={me} />}</FieldGate>;
}

function Terms({ me }: { me: FieldMe }) {
  const { get, send } = useFieldApi();
  const qc = useQueryClient();
  const admin = me.access.admin;
  const terms = useQuery({ queryKey: ["field-terms"], queryFn: () => get<any>("/field/reports/terms") });
  const [text, setText] = React.useState<string | null>(null);
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => {
    if (terms.data && text === null) setText(terms.data.text ?? "");
  }, [terms.data, text]);

  const save = async (reaccept: boolean) => {
    setBusy(true);
    setMsg(null);
    try {
      await send("/field/reports/terms", "PUT", { text, reaccept });
      await qc.invalidateQueries({ queryKey: ["field-terms"] });
      setMsg({ ok: true, text: reaccept ? "Saved. Everyone is asked to accept again." : "Saved" });
    } catch (e: any) {
      setMsg({ ok: false, text: e?.message || "Could not save" });
    } finally {
      setBusy(false);
    }
  };

  const rows: any[] = terms.data?.acceptances ?? [];
  const accepted = rows.filter((a) => a.current).length;
  const tooShort = (text ?? "").length < 20;
  return (
    <Stack gap={2}>
      {msg && <Alert severity={msg.ok ? "success" : "error"} onClose={() => setMsg(null)}>{msg.text}</Alert>}
      <Stack direction="row" gap={1} alignItems="center" flexWrap="wrap">
        <Chip size="small" label={`Version ${terms.data?.version ?? 0}`} />
        <Chip size="small" color={rows.length && accepted === rows.length ? "success" : "default"} label={`${accepted} of ${rows.length} accepted`} />
        {terms.data?.updatedAt && <Typography variant="body2">Last changed {new Date(terms.data.updatedAt).toLocaleString("en-SG")}</Typography>}
      </Stack>
      <TextField multiline minRows={8} label="Terms workers accept in the app" value={text ?? ""} disabled={!admin} onChange={(e) => setText(e.target.value)} />
      {!admin && <Typography variant="body2">Only an Admin can change the terms.</Typography>}
      {admin && (
        <Stack direction="row" gap={1} flexWrap="wrap">
          <Button variant="contained" disableElevation disabled={busy || tooShort} onClick={() => void save(true)}>
            Save, everyone accepts again
          </Button>
          <Button disabled={busy || tooShort} onClick={() => void save(false)}>
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
        data={rows.map((a: any) => ({ ...a, id: a.workerId }))}
        tableName="Accepted by"
        loading={terms.isLoading}
        clientPaging
        noSelectionColumn
      />
    </Stack>
  );
}
