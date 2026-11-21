"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  ListItemText,
  Menu,
  MenuItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import SyncIcon from "@mui/icons-material/Sync";
import MainCard from "@/components/MainCard";
import { request } from "@/helpers/request";
import { useOrganizationFeatures } from "@/app/portal/hooks/useOrganizationFeatures";
import { useUserPermissions } from "@/app/portal/hooks/useUserPermissions";
import { useOrganization } from "@hooks/useOrganization";
import { memberChanges, sortRows, syncDifferences, syncSummary, teamNames, unmatchedLogins, type WtTeam, type WtWorker, withActive } from "@/helpers/workersTeams";

// Workers & Teams (WCT 2026-11-20, enableWorkersTeams): the org's field workers and crews, added here or synced from
// SiteClock (read-only there: preview first, then Apply). A row opens its dialog; the three dots hide / unhide it
// (nothing is deleted). API: src/workers-teams.

interface Data {
  workers: WtWorker[];
  teams: WtTeam[];
  users: Array<{ id: string; name: string | null }>;
}
type WorkerForm = { id?: string; name: string; phone: string; role: string; userId: string | null };
type TeamForm = { id?: string; name: string; workerIds: string[] };
type RowMenu = { pos: { left: number; top: number }; kind: "worker" | "team"; id: string; active: boolean } | null;

export default function WorkersTeamsPage() {
  const { getToken } = useAuth();
  const { isWorkersTeamsEnabled, isLoading } = useOrganizationFeatures();
  const { hasPermission, userRoles, isLoading: rolesLoading } = useUserPermissions();
  const { isOsirisAdmin } = useOrganization();
  const canEdit = !rolesLoading && (!!isOsirisAdmin || userRoles.some((r: any) => ["superadmin", "osirisadmin"].includes(String(r?.name).toLowerCase())) || hasPermission("organizations", "update"));
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [worker, setWorker] = useState<WorkerForm | null>(null);
  const [team, setTeam] = useState<TeamForm | null>(null);
  const [menu, setMenu] = useState<RowMenu>(null);
  const [sync, setSync] = useState<{ loading: boolean; report: any | null; error: string | null } | null>(null);

  const call = useCallback(
    async (path: string, method: string, body: any = {}) => {
      const token = await getToken();
      const res: any = await request({ path, method, ownError: true }, body, token ?? undefined);
      if (res?.success === false) {
        const m = res?.message;
        throw new Error((Array.isArray(m) ? m.join(". ") : m) || "Something went wrong");
      }
      return res?.data ?? res;
    },
    [getToken],
  );

  const load = useCallback(async () => {
    try {
      // A fresh list every time (the reload after Hide / Unhide must never be answered from a cache).
      const d = await call(`/workers-teams?fresh=${Date.now()}`, "GET");
      setData({ workers: d?.workers ?? [], teams: d?.teams ?? [], users: d?.users ?? [] });
    } catch (e: any) {
      setError(e?.message || "Could not load the workers");
      setData({ workers: [], teams: [], users: [] });
    }
  }, [call]);

  useEffect(() => {
    if (isWorkersTeamsEnabled) void load();
  }, [isWorkersTeamsEnabled, load]);

  const workers = useMemo(() => sortRows(data?.workers ?? []), [data]);
  const teams = useMemo(() => sortRows(data?.teams ?? []), [data]);
  const workerName = (id: string) => data?.workers.find((w) => w.id === id)?.name ?? "";

  const run = async (fn: () => Promise<unknown>, after?: () => void) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      after?.();
      await load();
    } catch (e: any) {
      setError(e?.message || "Could not save");
    } finally {
      setBusy(false);
    }
  };

  const saveWorker = () => {
    if (!worker) return;
    if (!worker.name.trim()) return setError("Give the worker a name");
    const body = { name: worker.name, phone: worker.phone, role: worker.role, userId: worker.userId };
    void run(() => (worker.id ? call(`/workers-teams/workers/${worker.id}`, "PATCH", body) : call("/workers-teams/workers", "POST", body)), () => setWorker(null));
  };

  const saveTeam = () => {
    if (!team) return;
    if (!team.name.trim()) return setError("Give the team a name");
    void run(async () => {
      if (!team.id) {
        await call("/workers-teams/teams", "POST", { name: team.name, workerIds: team.workerIds });
        return;
      }
      await call(`/workers-teams/teams/${team.id}`, "PATCH", { name: team.name });
      const current = data?.teams.find((t) => t.id === team.id)?.workerIds ?? [];
      const { add, remove } = memberChanges(current, team.workerIds);
      for (const w of add) await call(`/workers-teams/teams/${team.id}/members`, "POST", { workerId: w });
      for (const w of remove) await call(`/workers-teams/teams/${team.id}/members/${w}`, "DELETE");
    }, () => setTeam(null));
  };

  const toggle = (m: NonNullable<RowMenu>) => {
    setMenu(null);
    const base = m.kind === "worker" ? "workers" : "teams";
    // The row changes at once; the reload that follows confirms it.
    void run(async () => {
      await call(`/workers-teams/${base}/${m.id}/${m.active ? "hide" : "unhide"}`, "POST");
      setData((d) => (d ? withActive(d, m.kind, m.id, !m.active) : d));
    });
  };

  const openSync = async () => {
    setSync({ loading: true, report: null, error: null });
    try {
      setSync({ loading: false, report: await call("/workers-teams/siteclock-sync", "GET"), error: null });
    } catch (e: any) {
      setSync({ loading: false, report: null, error: e?.message || "Could not read SiteClock" });
    }
  };
  const applySync = async () => {
    setSync((s) => (s ? { ...s, loading: true } : s));
    try {
      const report = await call("/workers-teams/siteclock-sync", "POST");
      setSync({ loading: false, report, error: null });
      await load();
    } catch (e: any) {
      setSync((s) => ({ loading: false, report: s?.report ?? null, error: e?.message || "Could not apply the sync" }));
    }
  };

  if (isLoading) return null;
  if (!isWorkersTeamsEnabled) {
    return (
      <MainCard>
        <Alert severity="info">Workers & Teams is not on for this company.</Alert>
      </MainCard>
    );
  }

  const menuButton = (kind: "worker" | "team", id: string, active: boolean) =>
    canEdit ? (
      <TableCell padding="checkbox" onClick={(e) => e.stopPropagation()}>
        <IconButton
          size="small"
          aria-label="More actions"
          onClick={(e) => {
            e.stopPropagation();
            setMenu({ pos: { left: e.clientX, top: e.clientY }, kind, id, active });
          }}
        >
          <MoreVertIcon fontSize="small" />
        </IconButton>
      </TableCell>
    ) : (
      <TableCell padding="checkbox" />
    );
  const hiddenChip = <Chip size="small" label="Hidden" variant="outlined" sx={{ ml: 1 }} />;
  const scChip = <Chip size="small" label="SiteClock" variant="outlined" sx={{ ml: 1 }} />;

  return (
    <MainCard>
      <Stack direction="row" alignItems="center" spacing={1} useFlexGap flexWrap="wrap" sx={{ mb: 2 }}>
        <Typography variant="h5" fontWeight={700}>
          Workers & Teams
        </Typography>
        <Box sx={{ flex: 1 }} />
        {canEdit && (
          <>
            <Button variant="outlined" startIcon={<SyncIcon />} onClick={() => void openSync()}>
              Sync from SiteClock
            </Button>
            <Button variant="outlined" startIcon={<AddIcon />} onClick={() => setTeam({ name: "", workerIds: [] })}>
              Add team
            </Button>
            <Button variant="contained" disableElevation startIcon={<AddIcon />} onClick={() => setWorker({ name: "", phone: "", role: "", userId: null })}>
              Add worker
            </Button>
          </>
        )}
      </Stack>
      {error && (
        <Alert severity="warning" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      {data === null ? (
        <CircularProgress />
      ) : (
        <Stack spacing={3}>
          <Box>
            <Typography variant="h6" sx={{ mb: 1 }}>
              Teams ({teams.filter((t) => t.active).length})
            </Typography>
            {teams.length === 0 ? (
              <Alert severity="info">No teams yet.</Alert>
            ) : (
              <TableContainer sx={{ border: 1, borderColor: "divider", borderRadius: 1 }}>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Team</TableCell>
                      <TableCell>Workers</TableCell>
                      <TableCell padding="checkbox" />
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {teams.map((t) => (
                      <TableRow key={t.id} hover sx={{ cursor: canEdit ? "pointer" : "default", opacity: t.active ? 1 : 0.55 }} onClick={() => canEdit && setTeam({ id: t.id, name: t.name, workerIds: t.workerIds })}>
                        <TableCell sx={{ fontWeight: 600, whiteSpace: "nowrap" }}>
                          {t.name}
                          {t.siteclockId && scChip}
                          {!t.active && hiddenChip}
                        </TableCell>
                        <TableCell>{t.workerIds.map(workerName).filter(Boolean).join(", ")}</TableCell>
                        {menuButton("team", t.id, t.active)}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
          </Box>
          <Box>
            <Typography variant="h6" sx={{ mb: 1 }}>
              Workers ({workers.filter((w) => w.active).length})
            </Typography>
            {workers.length === 0 ? (
              <Alert severity="info">No workers yet.</Alert>
            ) : (
              <TableContainer sx={{ border: 1, borderColor: "divider", borderRadius: 1 }}>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Name</TableCell>
                      <TableCell>Phone</TableCell>
                      <TableCell>Role</TableCell>
                      <TableCell>Teams</TableCell>
                      <TableCell>AIMS login</TableCell>
                      <TableCell padding="checkbox" />
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {workers.map((w) => (
                      <TableRow
                        key={w.id}
                        hover
                        sx={{ cursor: canEdit ? "pointer" : "default", opacity: w.active ? 1 : 0.55 }}
                        onClick={() => canEdit && setWorker({ id: w.id, name: w.name, phone: w.phone ?? "", role: w.role ?? "", userId: w.userId })}
                      >
                        <TableCell sx={{ fontWeight: 600, whiteSpace: "nowrap" }}>
                          {w.name}
                          {w.siteclockId && scChip}
                          {!w.active && hiddenChip}
                        </TableCell>
                        <TableCell sx={{ whiteSpace: "nowrap" }}>{w.phone || "-"}</TableCell>
                        <TableCell>{w.role || "-"}</TableCell>
                        <TableCell>{teamNames(w, data.teams) || "-"}</TableCell>
                        <TableCell>{w.userName || (w.userId ? "Linked" : "-")}</TableCell>
                        {menuButton("worker", w.id, w.active)}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
          </Box>
        </Stack>
      )}

      {/* Row menu: anchored to the click position (rows re-render). */}
      <Menu open={!!menu} onClose={() => setMenu(null)} anchorReference="anchorPosition" anchorPosition={menu?.pos}>
        {menu && (
          <MenuItem onClick={() => toggle(menu)}>
            <ListItemText>{menu.active ? "Hide" : "Unhide"}</ListItemText>
          </MenuItem>
        )}
      </Menu>

      <Dialog open={!!worker} onClose={() => !busy && setWorker(null)} fullWidth maxWidth="xs">
        <DialogTitle>{worker?.id ? "Edit worker" : "Add worker"}</DialogTitle>
        <DialogContent>
          {worker && (
            <Stack spacing={2} sx={{ pt: 1 }}>
              <TextField label="Name" value={worker.name} onChange={(e) => setWorker({ ...worker, name: e.target.value })} autoFocus required fullWidth />
              <TextField label="Phone" value={worker.phone} onChange={(e) => setWorker({ ...worker, phone: e.target.value })} fullWidth />
              <TextField label="Role / trade" value={worker.role} onChange={(e) => setWorker({ ...worker, role: e.target.value })} fullWidth />
              <Autocomplete
                options={data?.users ?? []}
                value={(data?.users ?? []).find((u) => u.id === worker.userId) ?? null}
                getOptionLabel={(u) => u.name || u.id}
                isOptionEqualToValue={(a, b) => a.id === b.id}
                onChange={(_, u) => setWorker({ ...worker, userId: u?.id ?? null })}
                renderInput={(p) => <TextField {...p} label="AIMS login" />}
              />
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setWorker(null)} disabled={busy}>
            Cancel
          </Button>
          <Button variant="contained" disableElevation onClick={saveWorker} disabled={busy}>
            Save
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={!!team} onClose={() => !busy && setTeam(null)} fullWidth maxWidth="sm">
        <DialogTitle>{team?.id ? "Edit team" : "Add team"}</DialogTitle>
        <DialogContent>
          {team && (
            <Stack spacing={2} sx={{ pt: 1 }}>
              <TextField label="Team name" value={team.name} onChange={(e) => setTeam({ ...team, name: e.target.value })} autoFocus required fullWidth />
              <Autocomplete
                multiple
                options={(data?.workers ?? []).filter((w) => w.active || team.workerIds.includes(w.id))}
                value={(data?.workers ?? []).filter((w) => team.workerIds.includes(w.id))}
                getOptionLabel={(w) => w.name}
                isOptionEqualToValue={(a, b) => a.id === b.id}
                onChange={(_, list) => setTeam({ ...team, workerIds: list.map((w) => w.id) })}
                renderInput={(p) => <TextField {...p} label="Workers" />}
              />
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setTeam(null)} disabled={busy}>
            Cancel
          </Button>
          <Button variant="contained" disableElevation onClick={saveTeam} disabled={busy}>
            Save
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={!!sync} onClose={() => !sync?.loading && setSync(null)} fullWidth maxWidth="sm">
        <DialogTitle>{sync?.report?.applied ? "Synced from SiteClock" : "Sync from SiteClock"}</DialogTitle>
        <DialogContent>
          {sync?.loading && <CircularProgress size={24} />}
          {sync?.error && (
            <Alert severity="warning" sx={{ mb: 2 }}>
              {sync.error}
            </Alert>
          )}
          {sync?.report && (
            <Stack spacing={1.5}>
              <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
                {syncSummary(sync.report).map((l) => (
                  <li key={l}>
                    <Typography variant="body2">{l}</Typography>
                  </li>
                ))}
              </Box>
              {syncDifferences(sync.report).length > 0 && (
                <Box>
                  <Typography variant="subtitle2">Kept as in AIMS</Typography>
                  <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
                    {syncDifferences(sync.report).map((l) => (
                      <li key={l}>
                        <Typography variant="body2">{l}</Typography>
                      </li>
                    ))}
                  </Box>
                </Box>
              )}
              {unmatchedLogins(sync.report).length > 0 && (
                <Box>
                  <Typography variant="subtitle2">No AIMS login</Typography>
                  <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
                    {unmatchedLogins(sync.report).map((l) => (
                      <li key={l}>
                        <Typography variant="body2">{l}</Typography>
                      </li>
                    ))}
                  </Box>
                </Box>
              )}
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSync(null)} disabled={!!sync?.loading}>
            {sync?.report?.applied ? "Close" : "Cancel"}
          </Button>
          {!sync?.report?.applied && (
            <Button variant="contained" disableElevation onClick={() => void applySync()} disabled={!sync?.report || !!sync?.loading}>
              Apply
            </Button>
          )}
        </DialogActions>
      </Dialog>
    </MainCard>
  );
}
