"use client";

// PTW applicants (WCT group, 2026-11-19, same setting as the calendar style: enableCalendarStyle) on Settings > Job
// fields: the managed list the PTW applicant pickers offer (New job, job page, Add job). Each entry: name, bar colour,
// an optional login. Add, rename, reorder, hide; one default. Shown only when the calendar style answers (the flag is
// on); every other org sees nothing new.

import React, { useEffect, useMemo, useState } from "react";
import { Alert, Autocomplete, Box, Button, Checkbox, IconButton, MenuItem, Radio, Select, Stack, Table, TableBody, TableCell, TableHead, TableRow, TextField, Tooltip, Typography } from "@mui/material";
import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";
import ArrowDownwardIcon from "@mui/icons-material/ArrowDownward";
import AddIcon from "@mui/icons-material/Add";
import { useCalendarApi } from "@/components/Dashboard/jobs-calendar/calendarAddApi";
import { moveEntry, newEntry, rowsOf, sameList, toSaveBody, type ApplicantEntry, type SavedList } from "./ptwApplicantsModel";

interface Login {
  id: string;
  name: string;
  email: string | null;
}
interface Payload {
  list: SavedList | null;
  users: Login[];
  palette: string[];
}

function Swatch({ colour }: { colour: string | null }) {
  return <Box sx={{ width: 18, height: 18, borderRadius: "4px", bgcolor: colour ?? "transparent", border: 1, borderColor: "divider", flexShrink: 0 }} />;
}

export default function PtwApplicants() {
  const api = useCalendarApi();
  const [data, setData] = useState<Payload | null>(null);
  const [rows, setRows] = useState<ApplicantEntry[]>([]);
  const [defaultId, setDefaultId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const take = (p: Payload) => {
    setData(p);
    setRows(rowsOf(p.list));
    setDefaultId(p.list?.defaultId ?? null);
  };

  useEffect(() => {
    let live = true;
    void api<Payload>("GET", "/dashboard/calendar-style/ptw-applicants").then((res) => {
      if (!live || !res.ok || !res.data || !Array.isArray(res.data.users)) return;
      take(res.data);
    });
    return () => {
      live = false;
    };
  }, [api]);

  const dirty = useMemo(() => !!data && !sameList(data.list, rows, defaultId), [data, rows, defaultId]);
  if (!data) return null;

  const set = (i: number, patch: Partial<ApplicantEntry>) => setRows((list) => list.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  const linkedElsewhere = (userId: string, i: number) => rows.some((r, k) => k !== i && r.userId === userId);

  const save = async () => {
    setSaving(true);
    setError(null);
    const res = await api<Payload>("PUT", "/dashboard/calendar-style/ptw-applicants", toSaveBody(rows, defaultId));
    setSaving(false);
    if (!res.ok || !res.data) return setError(res.message || "Could not save");
    take(res.data);
  };

  return (
    <Box sx={{ border: 1, borderColor: "divider", borderRadius: 1, p: 2, mb: 2 }} data-tour="ptw-applicants">
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
        <Typography variant="subtitle1" fontWeight={700} sx={{ flex: 1 }}>
          PTW applicants
        </Typography>
        <Button size="small" startIcon={<AddIcon />} onClick={() => setRows((list) => [...list, newEntry(list, data.palette)])}>
          Add applicant
        </Button>
        <Button variant="contained" disableElevation disabled={!dirty || saving || !rows.length} onClick={() => void save()}>
          {saving ? "Saving" : "Save"}
        </Button>
      </Stack>
      {error && (
        <Alert severity="warning" sx={{ mb: 1 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      {rows.length > 0 && (
        <Box sx={{ overflowX: "auto" }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Name</TableCell>
                <TableCell>Colour</TableCell>
                <TableCell>Login</TableCell>
                <TableCell align="center">Shown</TableCell>
                <TableCell align="center">Default</TableCell>
                <TableCell align="right">Order</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((r, i) => {
                const login = r.userId ? data.users.find((u) => u.id === r.userId) ?? { id: r.userId, name: "Former user", email: null } : null;
                const colours = data.palette.includes(r.colour) ? data.palette : [r.colour, ...data.palette];
                return (
                  <TableRow key={r.key} sx={{ opacity: r.hidden ? 0.6 : 1 }}>
                    <TableCell sx={{ minWidth: 160 }}>
                      <TextField size="small" value={r.name} onChange={(e) => set(i, { name: e.target.value })} inputProps={{ "aria-label": `Name ${i + 1}`, maxLength: 60 }} fullWidth />
                    </TableCell>
                    <TableCell>
                      <Select size="small" value={r.colour} onChange={(e) => set(i, { colour: e.target.value as string })} inputProps={{ "aria-label": `Colour of ${r.name || "applicant"}` }} renderValue={(v) => <Swatch colour={v as string} />} sx={{ minWidth: 72 }}>
                        {colours.map((c) => (
                          <MenuItem key={c} value={c}>
                            <Swatch colour={c} />
                          </MenuItem>
                        ))}
                      </Select>
                    </TableCell>
                    <TableCell sx={{ minWidth: 220 }}>
                      <Autocomplete
                        size="small"
                        options={data.users}
                        value={login}
                        onChange={(_e, v) => set(i, { userId: v?.id ?? null })}
                        isOptionEqualToValue={(a, b) => a.id === b.id}
                        getOptionDisabled={(o) => linkedElsewhere(o.id, i)}
                        getOptionLabel={(o) => (o.email ? `${o.name} (${o.email})` : o.name)}
                        renderInput={(params) => <TextField {...params} placeholder="No login" inputProps={{ ...params.inputProps, "aria-label": `Login of ${r.name || "applicant"}` }} />}
                      />
                    </TableCell>
                    <TableCell align="center">
                      <Checkbox
                        size="small"
                        checked={!r.hidden}
                        onChange={(e) => set(i, { hidden: !e.target.checked })}
                        inputProps={{ "aria-label": `Show ${r.name || "applicant"}` }}
                      />
                    </TableCell>
                    <TableCell align="center">
                      <Radio size="small" checked={defaultId === r.key} disabled={r.hidden} onClick={() => setDefaultId(r.key)} inputProps={{ "aria-label": `Default: ${r.name}` }} />
                    </TableCell>
                    <TableCell align="right" sx={{ whiteSpace: "nowrap" }}>
                      <Tooltip title="Move up">
                        <span>
                          <IconButton size="small" aria-label={`Move ${r.name} up`} disabled={i === 0} onClick={() => setRows((list) => moveEntry(list, i, -1))}>
                            <ArrowUpwardIcon fontSize="small" />
                          </IconButton>
                        </span>
                      </Tooltip>
                      <Tooltip title="Move down">
                        <span>
                          <IconButton size="small" aria-label={`Move ${r.name} down`} disabled={i === rows.length - 1} onClick={() => setRows((list) => moveEntry(list, i, 1))}>
                            <ArrowDownwardIcon fontSize="small" />
                          </IconButton>
                        </span>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Box>
      )}
    </Box>
  );
}
