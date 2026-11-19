"use client";

// Calendar colours (WCT group, 2026-11-18, enableCalendarStyle) on Settings > Job fields: per person, the
// salesperson colour (a job chip's fill) and the PTW applicant colour (its left bar), and the default PTW applicant.
// The two palettes never overlap, so a bar never reads as a fill. Shown only when GET /dashboard/calendar-style
// answers (the flag is on); every other org sees nothing new.

import React, { useEffect, useMemo, useState } from "react";
import { Alert, Box, Button, MenuItem, Radio, Select, Stack, Table, TableBody, TableCell, TableHead, TableRow, TextField, Tooltip, Typography } from "@mui/material";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import { useCalendarApi } from "@/components/Dashboard/jobs-calendar/calendarAddApi";

interface Person {
  id: string;
  name: string;
  email: string | null;
  sales: boolean;
  fill: string | null;
  bar: string | null;
  ptwDefault: boolean;
}
interface StyleSettings {
  people: Person[];
  palettes: { fill: string[]; bar: string[] };
  neutral: string;
  /** The org has a PTW applicants list (2026-11-19): PTW colours and the default live there, not per person. */
  ptwList?: boolean;
}

function Swatch({ colour }: { colour: string | null }) {
  return <Box sx={{ width: 18, height: 18, borderRadius: "4px", bgcolor: colour ?? "transparent", border: 1, borderColor: "divider", flexShrink: 0 }} />;
}

function ColourSelect({ value, palette, onChange, label }: { value: string | null; palette: string[]; onChange: (c: string | null) => void; label: string }) {
  const options = value && !palette.includes(value) ? [value, ...palette] : palette;
  return (
    <Select
      size="small"
      value={value ?? ""}
      displayEmpty
      onChange={(e) => onChange((e.target.value as string) || null)}
      inputProps={{ "aria-label": label }}
      renderValue={(v) => (
        <Stack direction="row" spacing={1} alignItems="center">
          <Swatch colour={(v as string) || null} />
          <span>{v ? "" : "None"}</span>
        </Stack>
      )}
      sx={{ minWidth: 96 }}
    >
      <MenuItem value="">
        <Stack direction="row" spacing={1} alignItems="center">
          <Swatch colour={null} />
          <span>None</span>
        </Stack>
      </MenuItem>
      {options.map((c) => (
        <MenuItem key={c} value={c}>
          <Swatch colour={c} />
        </MenuItem>
      ))}
    </Select>
  );
}

export default function CalendarColours() {
  const api = useCalendarApi();
  const [data, setData] = useState<StyleSettings | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [filter, setFilter] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void api<StyleSettings>("GET", "/dashboard/calendar-style").then((res) => {
      if (!live || !res.ok || !res.data || !Array.isArray(res.data.people)) return;
      setData(res.data);
      setPeople(res.data.people);
    });
    return () => {
      live = false;
    };
  }, [api]);

  const changed = useMemo(() => {
    if (!data) return [];
    const before = new Map(data.people.map((p) => [p.id, p]));
    return people.filter((p) => {
      const b = before.get(p.id);
      return !b || b.fill !== p.fill || b.bar !== p.bar || b.ptwDefault !== p.ptwDefault;
    });
  }, [data, people]);

  if (!data) return null;

  const set = (id: string, patch: Partial<Person>) => setPeople((list) => list.map((p) => (p.id === id ? { ...p, ...patch } : patch.ptwDefault ? { ...p, ptwDefault: false } : p)));
  const term = filter.trim().toLowerCase();
  const shown = people.filter((p) => !term || p.name.toLowerCase().includes(term) || (p.email ?? "").toLowerCase().includes(term));

  const save = async () => {
    setSaving(true);
    setError(null);
    const res = await api<StyleSettings>("PUT", "/dashboard/calendar-style", { people: changed.map((p) => ({ id: p.id, fill: p.fill, bar: p.bar, ptwDefault: p.ptwDefault })) });
    setSaving(false);
    if (!res.ok || !res.data) return setError(res.message || "Could not save");
    setData(res.data);
    setPeople(res.data.people);
  };

  return (
    <Box sx={{ border: 1, borderColor: "divider", borderRadius: 1, p: 2, mb: 2 }} data-tour="calendar-colours">
      <Stack direction={{ xs: "column", sm: "row" }} alignItems={{ sm: "center" }} spacing={1} sx={{ mb: 1 }}>
        <Stack direction="row" alignItems="center" spacing={0.75} sx={{ flex: 1 }}>
          <Typography variant="subtitle1" fontWeight={700}>
            Calendar colours
          </Typography>
          <Tooltip
            title={data.ptwList ? "Salesperson colour fills the jobs of that salesperson on the jobs calendar." : "Salesperson colour fills the jobs of that salesperson on the jobs calendar. PTW colour is the bar on the right of a job that needs a PTW, for its applicant. The default PTW applicant is filled in on new jobs."}
            enterTouchDelay={0}
          >
            <InfoOutlinedIcon fontSize="small" sx={{ color: "text.secondary", cursor: "help" }} aria-label="About calendar colours" />
          </Tooltip>
        </Stack>
        <TextField size="small" placeholder="Search people" value={filter} onChange={(e) => setFilter(e.target.value)} sx={{ minWidth: 200 }} />
        <Button variant="contained" disableElevation disabled={!changed.length || saving} onClick={() => void save()}>
          {saving ? "Saving…" : "Save"}
        </Button>
      </Stack>
      {error && (
        <Alert severity="warning" sx={{ mb: 1 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      <Box sx={{ overflowX: "auto" }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Person</TableCell>
              <TableCell>Salesperson colour</TableCell>
              {!data.ptwList && <TableCell>PTW colour</TableCell>}
              {!data.ptwList && <TableCell align="center">Default PTW applicant</TableCell>}
            </TableRow>
          </TableHead>
          <TableBody>
            {shown.map((p) => (
              <TableRow key={p.id}>
                <TableCell>
                  <Typography variant="body2" fontWeight={500}>
                    {p.name}
                  </Typography>
                  {p.email && (
                    <Typography variant="caption" color="text.secondary">
                      {p.email}
                    </Typography>
                  )}
                </TableCell>
                <TableCell>
                  <ColourSelect label={`Salesperson colour of ${p.name}`} value={p.fill} palette={data.palettes.fill} onChange={(fill) => set(p.id, { fill })} />
                </TableCell>
                {!data.ptwList && (
                  <TableCell>
                    <ColourSelect label={`PTW colour of ${p.name}`} value={p.bar} palette={data.palettes.bar} onChange={(bar) => set(p.id, { bar })} />
                  </TableCell>
                )}
                {!data.ptwList && (
                  <TableCell align="center">
                    <Radio size="small" checked={p.ptwDefault} onClick={() => set(p.id, { ptwDefault: !p.ptwDefault })} inputProps={{ "aria-label": `Default PTW applicant: ${p.name}` }} />
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Box>
    </Box>
  );
}
