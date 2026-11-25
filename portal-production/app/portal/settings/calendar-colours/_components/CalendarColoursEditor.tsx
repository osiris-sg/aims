"use client";

// Calendar colours (WCT group, 2026-11-25, enableCalendarStyle; Org Settings edit only, the server checks it): the
// editor shared by Org Settings > Calendar colours and the jobs calendar's "Settings" button (a dialog). People: a
// colour per person on the People list (fills their chips and their tick box). The PTW "Stripe colour" section is
// gone (2026-11-26: chips draw no PTW stripe; the PTW status shows as an icon).

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Box, MenuItem, Select, Stack, Table, TableBody, TableCell, TableHead, TableRow, Tooltip, Typography } from "@mui/material";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import { toast } from "react-toastify";
import { useCalendarApi } from "@/components/Dashboard/jobs-calendar/calendarAddApi";
import { colourChanges, pickOf, pickerOptions, shownColour, type ColoursPage, type PersonPick } from "@/helpers/calendarColours";

function Swatch({ colour }: { colour: string | null }) {
  return (
    <Box
      sx={{
        width: 20,
        height: 20,
        borderRadius: "4px",
        bgcolor: colour ?? "transparent",
        border: 1,
        borderColor: "divider",
        flexShrink: 0,
      }}
    />
  );
}

function ColourPicker({
  value,
  palette,
  onChange,
  label,
  noneLabel,
  noneSwatches,
}: {
  value: string | null;
  palette: string[];
  onChange: (c: string | null) => void;
  label: string;
  noneLabel: string;
  /** Swatches shown beside the "none" option (the automatic colour). */
  noneSwatches: Array<string | null>;
}) {
  const none = (
    <Stack direction="row" spacing={0.5} alignItems="center">
      {noneSwatches.map((c, i) => (
        <Swatch key={`${c}-${i}`} colour={c} />
      ))}
      <Typography variant="body2" sx={{ pl: 0.5 }}>
        {noneLabel}
      </Typography>
    </Stack>
  );
  return (
    <Select
      size="small"
      value={value ?? ""}
      displayEmpty
      onChange={(e) => onChange((e.target.value as string) || null)}
      inputProps={{ "aria-label": label }}
      renderValue={(v) => (v ? <Swatch colour={v as string} /> : none)}
      sx={{ minWidth: 180 }}
      MenuProps={{ PaperProps: { sx: { maxHeight: 360 } } }}
    >
      <MenuItem value="">{none}</MenuItem>
      {pickerOptions(palette, value).map((c) => (
        <MenuItem key={c} value={c} aria-label={c}>
          <Swatch colour={c} />
        </MenuItem>
      ))}
    </Select>
  );
}

/** The page's data, the picks and Save (null changes = nothing to save). */
export function useCalendarColours(on: boolean) {
  const api = useCalendarApi();
  const [page, setPage] = useState<ColoursPage | null>(null);
  const [people, setPeople] = useState<Record<string, PersonPick>>({});
  const [error, setError] = useState<string | null>(null);
  const [denied, setDenied] = useState(false);
  const [saving, setSaving] = useState(false);

  const take = (p: ColoursPage) => {
    setPage(p);
    setPeople(Object.fromEntries(p.people.map((x) => [x.id, pickOf(x)])));
  };

  const load = useCallback(async () => {
    const res = await api<ColoursPage>("GET", "/dashboard/calendar-style/colours");
    if (res.status === 403) return setDenied(true);
    if (!res.ok || !res.data || !Array.isArray(res.data.people)) return setError(res.message || "Could not load the colours");
    take(res.data);
  }, [api]);

  useEffect(() => {
    if (on) void load();
  }, [on, load]);

  const changes = useMemo(() => (page ? colourChanges(page, people) : null), [page, people]);

  const save = async (): Promise<boolean> => {
    if (!changes) return false;
    setSaving(true);
    setError(null);
    const res = await api<ColoursPage>("PUT", "/dashboard/calendar-style/colours", changes);
    setSaving(false);
    if (!res.ok || !res.data) {
      setError(res.message || "Could not save");
      return false;
    }
    take(res.data);
    toast.success("Calendar colours saved");
    return true;
  };

  return { page, people, setPeople, error, setError, denied, saving, changes, save };
}

export type CalendarColoursState = ReturnType<typeof useCalendarColours>;

/** The People table. */
export function CalendarColoursTables({ state }: { state: CalendarColoursState }) {
  const { page, people, setPeople } = state;
  if (!page) return null;
  return (
        <Stack spacing={3} data-tour="calendar-colours">
          <Box>
            <Stack direction="row" alignItems="center" spacing={0.75} sx={{ mb: 1 }}>
              <Typography variant="subtitle1" fontWeight={700}>
                People
              </Typography>
              <Tooltip title="Fills the person's jobs on the jobs calendar and colours their tick box in the People list. Automatic = the colour the calendar gives them until one is picked." enterTouchDelay={0}>
                <InfoOutlinedIcon fontSize="small" sx={{ color: "text.secondary", cursor: "help" }} aria-label="About people colours" />
              </Tooltip>
            </Stack>
            <Box sx={{ overflowX: "auto" }}>
              <Table size="small" sx={{ maxWidth: 560 }}>
                <TableHead>
                  <TableRow>
                    <TableCell>Person</TableCell>
                    <TableCell>Colour</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {page.people.map((p) => {
                    const pick = people[p.id];
                    return (
                      <TableRow key={p.id}>
                        <TableCell>
                          <Stack direction="row" spacing={1} alignItems="center">
                            <Swatch colour={shownColour(p, pick)} />
                            <Typography variant="body2" fontWeight={500}>
                              {p.name}
                            </Typography>
                          </Stack>
                        </TableCell>
                        <TableCell>
                          <ColourPicker
                            label={`Colour of ${p.name}`}
                            value={pick ?? null}
                            palette={page.palettes.people}
                            onChange={(c) => setPeople((m) => ({ ...m, [p.id]: c }))}
                            noneLabel="Automatic"
                            noneSwatches={[p.auto ? p.colour : null]}
                          />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </Box>
          </Box>
        </Stack>
  );
}
