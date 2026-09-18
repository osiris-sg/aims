"use client";

// Sales-team hierarchy (CIEL, 2026-09-19): Master-tier users create Teams,
// pick a Junior Manager as leader, set the members and a yearly TEAM target.
// The leader's dashboard then scopes to the team and shows the team bubble.
// Rendered under the Users table; gated on enableIdQuotation.

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent,
  DialogTitle, IconButton, MenuItem, Paper, Stack, Table, TableBody, TableCell,
  TableHead, TableRow, TextField, Tooltip, Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import GroupsIcon from "@mui/icons-material/GroupsOutlined";
import { useAuth } from "@clerk/nextjs";
import { request } from "@/helpers/request";
import DeleteItemDialogNoConfirm from "@/components/DeleteItemDialogNoConfirm";

type OrgUser = { id: string; name: string; email: string; roles?: Array<{ name: string }> };
type Team = {
  id: string; name: string; leaderUserId: string | null;
  yearlyTarget: number | null; memberUserIds: string[];
};

const money = (n: number | null | undefined) =>
  n == null ? "—" : `S$ ${new Intl.NumberFormat("en-SG", { maximumFractionDigits: 0 }).format(Number(n) || 0)}`;

export default function TeamsPanel() {
  const { getToken } = useAuth();
  const [teams, setTeams] = useState<Team[]>([]);
  const [users, setUsers] = useState<OrgUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Team | null>(null); // existing team being edited
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState<Team | null>(null);
  const [busy, setBusy] = useState(false);

  // Draft form state (strings so decimals type naturally).
  const [name, setName] = useState("");
  const [leaderUserId, setLeaderUserId] = useState("");
  const [target, setTarget] = useState("");
  const [memberIds, setMemberIds] = useState<string[]>([]);

  const load = useCallback(async () => {
    try {
      const token = await getToken();
      if (!token) return;
      const [teamsRes, usersRes] = await Promise.all([
        request({ method: "GET", path: "/teams" }, undefined, token),
        request({ method: "POST", path: "/users/list" }, { page: 1, limit: 200, search: "", filters: {} }, token),
      ]);
      setTeams(Array.isArray(teamsRes) ? teamsRes : teamsRes?.data || []);
      setUsers(usersRes?.data?.users || []);
    } catch (e) {
      console.error("Failed to load teams", e);
    } finally {
      setLoading(false);
    }
  }, [getToken]);

  useEffect(() => {
    load();
  }, [load]);

  const nameOf = useCallback(
    (userId: string | null) => users.find((u) => u.id === userId)?.name || users.find((u) => u.id === userId)?.email || (userId ? "Unknown user" : "—"),
    [users]
  );

  const openCreate = () => {
    setEditing(null);
    setName("");
    setLeaderUserId("");
    setTarget("");
    setMemberIds([]);
    setDialogOpen(true);
  };
  const openEdit = (t: Team) => {
    setEditing(t);
    setName(t.name);
    setLeaderUserId(t.leaderUserId || "");
    setTarget(t.yearlyTarget != null ? String(t.yearlyTarget) : "");
    setMemberIds(t.memberUserIds || []);
    setDialogOpen(true);
  };

  const save = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const token = await getToken();
      if (!token) return;
      const payload = {
        name: name.trim(),
        leaderUserId: leaderUserId || null,
        yearlyTarget: target.trim() === "" ? null : Number(target),
      };
      let teamId = editing?.id;
      if (editing) {
        await request({ method: "PATCH", path: "/teams/:id" }, { id: editing.id, ...payload }, token);
      } else {
        const created = await request({ method: "POST", path: "/teams" }, payload, token);
        teamId = created?.id || created?.data?.id;
      }
      // Leader is always a member — include them so their own numbers count in the team bubble.
      const finalMembers = Array.from(new Set([...memberIds, ...(leaderUserId ? [leaderUserId] : [])]));
      if (teamId) {
        await request({ method: "POST", path: "/teams/:id/members" }, { id: teamId, userIds: finalMembers }, token);
      }
      setDialogOpen(false);
      await load();
    } catch (e) {
      console.error("Failed to save team", e);
    } finally {
      setBusy(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    setBusy(true);
    try {
      const token = await getToken();
      if (!token) return;
      await request({ method: "DELETE", path: "/teams/:id" }, { id: deleting.id }, token);
      setDeleting(null);
      await load();
    } catch (e) {
      console.error("Failed to delete team", e);
    } finally {
      setBusy(false);
    }
  };

  const toggleMember = (userId: string) =>
    setMemberIds((ids) => (ids.includes(userId) ? ids.filter((i) => i !== userId) : [...ids, userId]));

  const sortedUsers = useMemo(() => [...users].sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email)), [users]);

  return (
    <Paper variant="outlined" sx={{ borderRadius: 2, mt: 3, overflow: "hidden" }} data-tour="teams-panel">
      <Stack direction="row" alignItems="center" spacing={1} sx={{ px: 2, pt: 2, pb: 1 }}>
        <GroupsIcon fontSize="small" sx={{ color: "text.secondary" }} />
        <Box sx={{ flex: 1 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
            Teams
          </Typography>
          <Typography variant="caption" sx={{ color: "text.secondary" }}>
            Group members under a team leader (Junior Manager) with a yearly team target — the leader&apos;s dashboard shows the team&apos;s projects, leads and revenue.
          </Typography>
        </Box>
        <Button size="small" variant="outlined" startIcon={<AddIcon />} onClick={openCreate}>
          New team
        </Button>
      </Stack>

      {loading ? (
        <Box sx={{ p: 3, textAlign: "center" }}>
          <CircularProgress size={22} />
        </Box>
      ) : teams.length === 0 ? (
        <Typography variant="body2" sx={{ color: "text.disabled", px: 2, pb: 2 }}>
          No teams yet.
        </Typography>
      ) : (
        <Box sx={{ overflowX: "auto" }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Team</TableCell>
                <TableCell>Leader</TableCell>
                <TableCell>Members</TableCell>
                <TableCell align="right">Yearly team target</TableCell>
                <TableCell align="right" />
              </TableRow>
            </TableHead>
            <TableBody>
              {teams.map((t) => (
                <TableRow key={t.id} hover sx={{ cursor: "pointer" }} onClick={() => openEdit(t)}>
                  <TableCell sx={{ fontWeight: 600 }}>{t.name}</TableCell>
                  <TableCell>{nameOf(t.leaderUserId)}</TableCell>
                  <TableCell>
                    <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                      {(t.memberUserIds || []).map((id) => (
                        <Chip key={id} size="small" variant="outlined" label={nameOf(id)} sx={{ height: 22 }} />
                      ))}
                      {!t.memberUserIds?.length && (
                        <Typography variant="caption" sx={{ color: "text.disabled" }}>
                          no members
                        </Typography>
                      )}
                    </Stack>
                  </TableCell>
                  <TableCell align="right" sx={{ fontVariantNumeric: "tabular-nums" }}>
                    {money(t.yearlyTarget)}
                  </TableCell>
                  <TableCell align="right" onClick={(e) => e.stopPropagation()}>
                    <Tooltip title="Delete team">
                      <IconButton size="small" onClick={() => setDeleting(t)} sx={{ color: "error.main" }}>
                        <DeleteOutlineIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Box>
      )}

      <Dialog open={dialogOpen} onClose={() => !busy && setDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{editing ? `Edit ${editing.name}` : "New team"}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 0.5 }}>
            <TextField label="Team name" value={name} onChange={(e) => setName(e.target.value)} size="small" fullWidth autoFocus />
            <TextField select label="Team leader (Junior Manager)" value={leaderUserId} onChange={(e) => setLeaderUserId(e.target.value)} size="small" fullWidth helperText="The leader sees the whole team's leads, projects and the team bubble on their dashboard.">
              <MenuItem value="">
                <em>No leader</em>
              </MenuItem>
              {sortedUsers.map((u) => (
                <MenuItem key={u.id} value={u.id}>
                  {u.name || u.email}
                  {u.roles?.some((r) => r.name === "Junior Manager") ? " · Junior Manager" : ""}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              label="Yearly team target (S$)"
              value={target}
              onChange={(e) => {
                if (/^[0-9]*\.?[0-9]*$/.test(e.target.value)) setTarget(e.target.value);
              }}
              size="small"
              fullWidth
              inputProps={{ inputMode: "decimal" }}
              helperText="Separate from each member's personal target."
            />
            <Box>
              <Typography variant="caption" sx={{ color: "text.secondary" }}>
                Members — tap to add or remove (leader is always included)
              </Typography>
              <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap sx={{ mt: 0.75 }}>
                {sortedUsers.map((u) => {
                  const selected = memberIds.includes(u.id) || u.id === leaderUserId;
                  return (
                    <Chip
                      key={u.id}
                      size="small"
                      label={u.name || u.email}
                      color={selected ? "primary" : "default"}
                      variant={selected ? "filled" : "outlined"}
                      onClick={() => u.id !== leaderUserId && toggleMember(u.id)}
                    />
                  );
                })}
              </Stack>
            </Box>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)} disabled={busy}>
            Cancel
          </Button>
          <Button variant="contained" onClick={save} disabled={busy || !name.trim()}>
            {busy ? "Saving…" : editing ? "Save" : "Create team"}
          </Button>
        </DialogActions>
      </Dialog>

      <DeleteItemDialogNoConfirm open={!!deleting} onCancel={() => setDeleting(null)} onConfirm={confirmDelete} loading={busy} />
    </Paper>
  );
}
