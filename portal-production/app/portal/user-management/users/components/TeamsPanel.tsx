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
import { useTranslations } from "next-intl";

type OrgUser = { id: string; name: string; email: string; roles?: Array<{ name: string }> };
type Team = {
  id: string; name: string; leaderUserId: string | null;
  yearlyTarget: number | null; memberUserIds: string[];
};

const money = (n: number | null | undefined) =>
  n == null ? "—" : `S$ ${new Intl.NumberFormat("en-SG", { maximumFractionDigits: 0 }).format(Number(n) || 0)}`;

export default function TeamsPanel() {
  const { getToken } = useAuth();
  const tr = useTranslations("users.teams");
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
    (userId: string | null) => users.find((u) => u.id === userId)?.name || users.find((u) => u.id === userId)?.email || (userId ? tr("unknownUser") : "—"),
    [users, tr]
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
            {tr("title")}
          </Typography>
          <Typography variant="caption" sx={{ color: "text.secondary" }}>
            {tr("intro")}
          </Typography>
        </Box>
        <Button size="small" variant="outlined" startIcon={<AddIcon />} onClick={openCreate}>
          {tr("newTeam")}
        </Button>
      </Stack>

      {loading ? (
        <Box sx={{ p: 3, textAlign: "center" }}>
          <CircularProgress size={22} />
        </Box>
      ) : teams.length === 0 ? (
        <Typography variant="body2" sx={{ color: "text.disabled", px: 2, pb: 2 }}>
          {tr("none")}
        </Typography>
      ) : (
        <Box sx={{ overflowX: "auto" }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{tr("team")}</TableCell>
                <TableCell>{tr("leader")}</TableCell>
                <TableCell>{tr("members")}</TableCell>
                <TableCell align="right">{tr("yearlyTarget")}</TableCell>
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
                      {/* Explicit affordance (guru/Mike 2026-09-25): opens the
                          same edit dialog on its member picker. */}
                      <Chip
                        size="small"
                        icon={<AddIcon sx={{ fontSize: 14 }} />}
                        label={t.memberUserIds?.length ? tr("edit") : tr("addMembers")}
                        onClick={(e) => {
                          e.stopPropagation();
                          openEdit(t);
                        }}
                        sx={{ height: 22 }}
                      />
                    </Stack>
                  </TableCell>
                  <TableCell align="right" sx={{ fontVariantNumeric: "tabular-nums" }}>
                    {money(t.yearlyTarget)}
                  </TableCell>
                  <TableCell align="right" onClick={(e) => e.stopPropagation()}>
                    <Tooltip title={tr("delete")}>
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
        <DialogTitle>{editing ? tr("editTitle", { name: editing.name }) : tr("newTeam")}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 0.5 }}>
            <TextField label={tr("teamName")} value={name} onChange={(e) => setName(e.target.value)} size="small" fullWidth autoFocus />
            <TextField select label={tr("leaderLabel")} value={leaderUserId} onChange={(e) => setLeaderUserId(e.target.value)} size="small" fullWidth helperText={tr("leaderHelp")}>
              <MenuItem value="">
                <em>{tr("noLeader")}</em>
              </MenuItem>
              {sortedUsers.map((u) => (
                <MenuItem key={u.id} value={u.id}>
                  {u.name || u.email}
                  {u.roles?.some((r) => r.name === "Junior Manager") ? " · Junior Manager" : ""}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              label={tr("targetLabel")}
              value={target}
              onChange={(e) => {
                if (/^[0-9]*\.?[0-9]*$/.test(e.target.value)) setTarget(e.target.value);
              }}
              size="small"
              fullWidth
              inputProps={{ inputMode: "decimal" }}
              helperText={tr("targetHelp")}
            />
            <Box>
              <Typography variant="caption" sx={{ color: "text.secondary" }}>
                {tr("membersHint")}
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
            {tr("cancel")}
          </Button>
          <Button variant="contained" onClick={save} disabled={busy || !name.trim()}>
            {busy ? tr("saving") : editing ? tr("save") : tr("create")}
          </Button>
        </DialogActions>
      </Dialog>

      <DeleteItemDialogNoConfirm open={!!deleting} onCancel={() => setDeleting(null)} onConfirm={confirmDelete} loading={busy} />
    </Paper>
  );
}
