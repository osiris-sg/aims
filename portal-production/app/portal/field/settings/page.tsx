"use client";

// Field settings (FIELD_PLAN.md phase 1): linked organisations and worker sharing (SiteClock Rules > Share
// workers + platform Link companies, @62b7d9d), trades, and who can do what in Field (the role presets).
import * as React from "react";
import {
  Alert, Box, Button, Chip, IconButton, MenuItem, Stack, Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography,
} from "@mui/material";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FIELD_AREAS, fieldAtLeast } from "@/helpers/fieldModule";
import FieldGate from "../_components/FieldGate";
import { useFieldApi, type FieldMe } from "../_lib/useField";

const AREA_LABEL: Record<string, string> = { people: "Workers, teams, sites", jobs: "Jobs", punches: "Clock-ins", timesheets: "Timesheets", leave: "Leave", payroll: "Payroll", reports: "Reports" };
const LEVEL_LABEL: Record<string, string> = { none: "No access", view: "View", edit: "Edit", approve: "Approve" };
// The presets (api src/field/common/field-access.ts FIELD_PRESETS / SUPERVISOR_GRANT), shown for reference.
const PRESETS: Array<{ name: string; levels: Record<string, string>; note?: string }> = [
  { name: "Admin", levels: Object.fromEntries(FIELD_AREAS.map((a) => [a, "approve"])) },
  { name: "Operations", levels: { people: "view", jobs: "edit", punches: "approve", timesheets: "approve", leave: "approve", payroll: "none", reports: "view" } },
  { name: "Accounting", levels: { people: "view", jobs: "none", punches: "none", timesheets: "view", leave: "none", payroll: "edit", reports: "view" } },
  { name: "Supervisor", levels: { people: "view", jobs: "view", punches: "approve", timesheets: "edit", leave: "approve", payroll: "none", reports: "view" }, note: "own sites and teams" },
];

export default function FieldSettingsPage() {
  return <FieldGate area="people" title="Field settings">{(me) => <Settings me={me} />}</FieldGate>;
}

function Settings({ me }: { me: FieldMe }) {
  const { get, send } = useFieldApi();
  const qc = useQueryClient();
  const canEdit = fieldAtLeast(me.access.levels.people, "edit") && !me.access.scoped.people;
  const links = useQuery({ queryKey: ["field-links"], queryFn: () => get<{ shareWorkers: string; links: any[] }>(`/field/people/links`) });
  const trades = useQuery({ queryKey: ["field-trades"], queryFn: () => get<{ trades: any[] }>(`/field/people/trades`) });
  const shared = useQuery({ queryKey: ["field-shared"], queryFn: () => get<{ workers: any[] }>(`/field/people/shared-workers`) });
  const [newTrade, setNewTrade] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const run = async (fn: () => Promise<unknown>, done?: () => void) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      done?.();
      await Promise.all(["field-links", "field-trades", "field-shared"].map((k) => qc.invalidateQueries({ queryKey: [k] })));
    } catch (e: any) {
      setError(e?.message || "Could not save");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Stack gap={4}>
      {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}

      <Box>
        <Typography variant="h6" sx={{ mb: 1 }}>Linked organisations</Typography>
        {(links.data?.links ?? []).length === 0 ? (
          <Typography color="text.secondary">Not linked to another organisation.</Typography>
        ) : (
          <Stack direction="row" gap={1} flexWrap="wrap" sx={{ mb: 2 }}>
            {links.data!.links.map((l) => (
              <Chip key={l.id} label={`${l.name}: shares ${l.shareWorkers === "ALL" ? "every worker" : l.shareWorkers === "SELECTED" ? "selected workers" : "no one"}`} />
            ))}
          </Stack>
        )}
        <TextField select size="small" label="Workers this organisation shares" sx={{ width: 320, mt: 1 }} disabled={!me.access.admin || busy}
          value={links.data?.shareWorkers ?? "NONE"} onChange={(e) => void run(() => send(`/field/people/share-workers`, "PUT", { shareWorkers: e.target.value }))}>
          <MenuItem value="NONE">No one</MenuItem>
          <MenuItem value="ALL">Every worker</MenuItem>
          <MenuItem value="SELECTED">The ones ticked on their worker page</MenuItem>
        </TextField>
        {(shared.data?.workers ?? []).length > 0 && (
          <Typography color="text.secondary" sx={{ mt: 1 }}>
            Workers shared with you: {shared.data!.workers.map((w) => `${w.name} (${w.organizationName})`).join(", ")}
          </Typography>
        )}
      </Box>

      <Box>
        <Typography variant="h6" sx={{ mb: 1 }}>Trades</Typography>
        <Table size="small" sx={{ maxWidth: 520 }}>
          <TableBody>
            {(trades.data?.trades ?? []).map((t) => (
              <TableRow key={t.id}>
                <TableCell>{t.name}</TableCell>
                <TableCell>{t.workers} workers</TableCell>
                <TableCell align="right">
                  {canEdit && (
                    <IconButton size="small" color="error" disabled={busy} onClick={() => window.confirm(`Delete the trade ${t.name}?`) && void run(() => send(`/field/people/trades/${t.id}`, "DELETE"))}>
                      <DeleteOutlineIcon fontSize="small" />
                    </IconButton>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {canEdit && (
          <Stack direction="row" gap={1} sx={{ mt: 1 }}>
            <TextField size="small" label="New trade" value={newTrade} onChange={(e) => setNewTrade(e.target.value)} inputProps={{ maxLength: 60 }} />
            <Button variant="outlined" disabled={busy || !newTrade.trim()} onClick={() => void run(() => send(`/field/people/trades`, "POST", { name: newTrade.trim() }), () => setNewTrade(""))}>Add</Button>
          </Stack>
        )}
      </Box>

      <Box>
        <Typography variant="h6" sx={{ mb: 1 }}>Who can do what</Typography>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Role</TableCell>
              {FIELD_AREAS.map((a) => (
                <TableCell key={a}>{AREA_LABEL[a]}</TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {PRESETS.map((p) => (
              <TableRow key={p.name}>
                <TableCell>{p.note ? `${p.name} (${p.note})` : p.name}</TableCell>
                {FIELD_AREAS.map((a) => (
                  <TableCell key={a}>{LEVEL_LABEL[p.levels[a]]}</TableCell>
                ))}
              </TableRow>
            ))}
            <TableRow>
              <TableCell sx={{ fontWeight: 600 }}>You</TableCell>
              {FIELD_AREAS.map((a) => (
                <TableCell key={a} sx={{ fontWeight: 600 }}>{LEVEL_LABEL[me.access.levels[a]]}{me.access.scoped[a] ? " (own)" : ""}</TableCell>
              ))}
            </TableRow>
          </TableBody>
        </Table>
      </Box>
    </Stack>
  );
}
