"use client";

// Org Settings > Calendar colours (WCT group, 2026-11-25, enableCalendarStyle; Org Settings edit only, the server
// checks it). People: a colour per person on the jobs calendar's People list (fills their chips and their tick box).
// PTW: a stripe colour per PTW status; the default keeps the applicant's colour (Settings > Job fields > PTW applicants).
// Every other org: the page says it is not available and the menu never links here.

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Box, Button, CircularProgress, MenuItem, Select, Stack, Table, TableBody, TableCell, TableHead, TableRow, Tooltip, Typography } from "@mui/material";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import { toast } from "react-toastify";
import MainCard from "@/components/MainCard";
import { useOrganizationFeatures } from "@/app/portal/hooks/useOrganizationFeatures";
import { useCalendarApi } from "@/components/Dashboard/jobs-calendar/calendarAddApi";
import { colourChanges, pickOf, pickerOptions, shownColour, type ColoursPage, type PersonPick } from "@/helpers/calendarColours";

function Swatch({ colour, stripe }: { colour: string | null; stripe?: boolean }) {
  return (
    <Box
      sx={{
        width: stripe ? 8 : 20,
        height: 20,
        borderRadius: stripe ? "2px" : "4px",
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
  stripe,
}: {
  value: string | null;
  palette: string[];
  onChange: (c: string | null) => void;
  label: string;
  noneLabel: string;
  /** Swatches shown beside the "none" option (the automatic colour, or the applicants' colours). */
  noneSwatches: Array<string | null>;
  stripe?: boolean;
}) {
  const none = (
    <Stack direction="row" spacing={0.5} alignItems="center">
      {noneSwatches.map((c, i) => (
        <Swatch key={`${c}-${i}`} colour={c} stripe={stripe} />
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
      renderValue={(v) => (v ? <Swatch colour={v as string} stripe={stripe} /> : none)}
      sx={{ minWidth: 180 }}
      MenuProps={{ PaperProps: { sx: { maxHeight: 360 } } }}
    >
      <MenuItem value="">{none}</MenuItem>
      {pickerOptions(palette, value).map((c) => (
        <MenuItem key={c} value={c} aria-label={c}>
          <Swatch colour={c} stripe={stripe} />
        </MenuItem>
      ))}
    </Select>
  );
}

export default function CalendarColoursPage() {
  const api = useCalendarApi();
  const { features, isLoading } = useOrganizationFeatures();
  const on = features?.enableCalendarStyle === true;
  const [page, setPage] = useState<ColoursPage | null>(null);
  const [people, setPeople] = useState<Record<string, PersonPick>>({});
  const [ptw, setPtw] = useState<Record<string, string | null>>({});
  const [error, setError] = useState<string | null>(null);
  const [denied, setDenied] = useState(false);
  const [saving, setSaving] = useState(false);

  const take = (p: ColoursPage) => {
    setPage(p);
    setPeople(Object.fromEntries(p.people.map((x) => [x.id, pickOf(x)])));
    setPtw(Object.fromEntries(p.ptw.map((r) => [r.status, r.colour])));
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

  const changes = useMemo(() => (page ? colourChanges(page, people, ptw) : null), [page, people, ptw]);

  const save = async () => {
    if (!changes) return;
    setSaving(true);
    setError(null);
    const res = await api<ColoursPage>("PUT", "/dashboard/calendar-style/colours", changes);
    setSaving(false);
    if (!res.ok || !res.data) return setError(res.message || "Could not save");
    take(res.data);
    toast.success("Calendar colours saved");
  };

  if (isLoading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
        <CircularProgress size={28} />
      </Box>
    );
  }

  const title = (
    <Stack direction="row" alignItems="center" spacing={1} sx={{ width: "100%", mb: 2 }}>
      <Typography variant="h5" sx={{ fontWeight: 700, flex: 1 }}>
        Calendar colours
      </Typography>
      {on && page && (
        <Button variant="contained" disableElevation disabled={!changes || saving} onClick={() => void save()} data-tour="calendar-colours-save">
          {saving ? "Saving…" : "Save"}
        </Button>
      )}
    </Stack>
  );

  if (!on) {
    return (
      <MainCard>
        {title}
        <Alert severity="info">Calendar colours are not available for this organisation.</Alert>
      </MainCard>
    );
  }
  if (denied) {
    return (
      <MainCard>
        {title}
        <Alert severity="info">Only people with Org Settings edit can change the calendar colours.</Alert>
      </MainCard>
    );
  }

  const applicantColours = page?.applicants.map((a) => a.colour) ?? [];

  return (
    <MainCard>
        {title}
      {error && (
        <Alert severity="warning" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      {!page ? (
        <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>{!error && <CircularProgress size={24} />}</Box>
      ) : (
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

          <Box>
            <Stack direction="row" alignItems="center" spacing={0.75} sx={{ mb: 1 }}>
              <Typography variant="subtitle1" fontWeight={700}>
                PTW
              </Typography>
              <Tooltip
                title="The stripe on the right edge of a job that needs a PTW. Applicant colour = the PTW applicant's colour from Job fields > PTW applicants. Pending = applied, waiting for approval."
                enterTouchDelay={0}
              >
                <InfoOutlinedIcon fontSize="small" sx={{ color: "text.secondary", cursor: "help" }} aria-label="About PTW colours" />
              </Tooltip>
            </Stack>
            <Box sx={{ overflowX: "auto" }}>
              <Table size="small" sx={{ maxWidth: 560 }}>
                <TableHead>
                  <TableRow>
                    <TableCell>PTW status</TableCell>
                    <TableCell>Stripe colour</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {page.ptw.map((r) => (
                    <TableRow key={r.status}>
                      <TableCell>{r.label}</TableCell>
                      <TableCell>
                        <ColourPicker
                          label={`PTW ${r.label} colour`}
                          value={ptw[r.status] ?? null}
                          palette={page.palettes.ptw}
                          onChange={(c) => setPtw((m) => ({ ...m, [r.status]: c }))}
                          noneLabel="Applicant colour"
                          noneSwatches={applicantColours.length ? applicantColours : [null]}
                          stripe
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Box>
          </Box>
        </Stack>
      )}
    </MainCard>
  );
}
